// The undo/redo diff engine (design §4).
//
// A patch holds *authoritative* state only — the inputs, the three base palettes, the
// links and the locks. `syntaxColors` / `ansiColors` are derived by `relink`, so storing
// them would duplicate every entry and could drift from the base they came from; they
// never appear in a patch and `applyPatch` never writes them.
//
// ── Why a patch must be JSON-clean ────────────────────────────────────────────
// A history is persisted (storage.ts writes it to localStorage), so every patch that
// survives `recordStep` is serialised and read back. Anything JSON cannot carry exactly
// is therefore forbidden inside an entry: no `Set` (locks are stored as per-key booleans
// and rebuilt on apply), no `undefined` (an absent value is `null`, which is unambiguous
// because no palette colour or link is ever `null`), no `Date` and no `NaN`. The harness
// asserts that `applyPatch(JSON.parse(JSON.stringify(p)))` equals `applyPatch(p)`, which
// is the property the persistence path depends on.
//
// ── Why `assignment` is compared structurally ─────────────────────────────────
// An assignment is drawn once and then shared by reference through most edits, but a
// randomize builds a brand-new object and some adoption paths deep-copy it. A reference
// comparison would therefore emit a phantom ~8 KB entry on every commit that happened to
// rebuild an identical assignment; `deepEqual` compares its contents instead, and the
// reference-equality fast path keeps the common case cheap.

import type { Assignment } from '@/lib/colors/assignment'
import type { Links } from '@/lib/colors/links'
import type { AnsiColors, ColorScheme, SyntaxColors, UIColors } from '@/lib/types/colors'

/** The slice of `ThemeState` a patch covers (design §4.1). */
export interface PatchableState {
  isDark: boolean
  baseHue: number
  uiSaturation: number
  syntaxSaturation: number
  scheme: ColorScheme
  assignment: Assignment
  colors: UIColors
  baseSyntaxColors: SyntaxColors
  baseAnsiColors: AnsiColors
  links: Links
  lockedColors: Set<string>
}

/**
 * One changed path. `before` / `after` are plain JSON values; `null` means "absent"
 * (a removed link, or a key that did not exist on that side).
 */
export interface PatchEntry {
  path: string
  before: unknown
  after: unknown
}

/** One undoable step. `at` is the commit time, used for coalescing (§4.2). */
export interface ThemePatch {
  at: number
  entries: PatchEntry[]
}

/** A per-theme undo stack: `cursor` steps applied, `0` = nothing applied (design §4.3). */
export interface History {
  cursor: number
  steps: ThemePatch[]
}

/** Steps retained per theme (design §4.4). */
export const HISTORY_CAP = 20

/** A keyboard-repeat / programmatic burst inside this window merges (§4.2 rule 2). */
const COALESCE_WINDOW_MS = 500

// ---------------------------------------------------------------------------
// comparison
// ---------------------------------------------------------------------------

/**
 * Structural equality for the assignment (plain objects, arrays and numbers).
 *
 * Written out rather than `JSON.stringify`-compared because key order is not part of an
 * object's identity: a `{...a, seed: b.seed}` rebuild reorders nothing today but would
 * make a string comparison fragile for no gain.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (!deepEqual(left[key], right[key])) return false
  }
  return true
}

/** One entry per changed key of a colour record; fixed-size records, but be tolerant. */
function diffRecord(
  prefix: string,
  before: Record<string, string>,
  after: Record<string, string>
): PatchEntry[] {
  const out: PatchEntry[] = []
  for (const key of Object.keys(before)) {
    const prev = before[key]
    const next = after[key]
    if (prev !== next) {
      out.push({ path: `${prefix}.${key}`, before: prev, after: next === undefined ? null : next })
    }
  }
  for (const key of Object.keys(after)) {
    if (Object.prototype.hasOwnProperty.call(before, key)) continue
    out.push({ path: `${prefix}.${key}`, before: null, after: after[key] })
  }
  return out
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

/**
 * Every difference between two authoritative states, as one patch.
 *
 * `before === after` (or two structurally equal assignments and equal records) yields an
 * empty patch; `recordStep` refuses to store one, so a no-op commit cannot consume an
 * undo slot.
 */
export function diffThemes(
  before: PatchableState,
  after: PatchableState,
  at: number = Date.now()
): ThemePatch {
  const entries: PatchEntry[] = []

  // Scalars, in a fixed order so a patch is reproducible from the same pair of states.
  const scalars: [keyof PatchableState, unknown][] = [
    ['isDark', after.isDark],
    ['baseHue', after.baseHue],
    ['uiSaturation', after.uiSaturation],
    ['syntaxSaturation', after.syntaxSaturation],
    ['scheme', after.scheme],
  ]
  for (const [path, next] of scalars) {
    const prev = before[path]
    if (!Object.is(prev, next)) entries.push({ path, before: prev, after: next })
  }

  if (!deepEqual(before.assignment, after.assignment)) {
    entries.push({ path: 'assignment', before: before.assignment, after: after.assignment })
  }

  entries.push(...diffRecord('colors', before.colors, after.colors))
  entries.push(...diffRecord('baseSyntaxColors', before.baseSyntaxColors, after.baseSyntaxColors))
  entries.push(...diffRecord('baseAnsiColors', before.baseAnsiColors, after.baseAnsiColors))

  // Links: one entry per target, with `null` marking absence on either side.
  for (const target of Object.keys(before.links)) {
    const prev = before.links[target]
    const next = after.links[target]
    if (next === undefined) {
      entries.push({ path: `links.${target}`, before: prev, after: null })
    } else if (prev.source !== next.source || prev.adjust !== next.adjust) {
      entries.push({ path: `links.${target}`, before: prev, after: next })
    }
  }
  for (const target of Object.keys(after.links)) {
    if (Object.prototype.hasOwnProperty.call(before.links, target)) continue
    entries.push({ path: `links.${target}`, before: null, after: after.links[target] })
  }

  // Locks: per key booleans rather than two whole Sets, so a single toggle is tiny and
  // survives JSON (an entry with a `Set` would serialise to `{}`).
  for (const key of before.lockedColors) {
    if (!after.lockedColors.has(key)) {
      entries.push({ path: `locks.${key}`, before: true, after: false })
    }
  }
  for (const key of after.lockedColors) {
    if (!before.lockedColors.has(key)) {
      entries.push({ path: `locks.${key}`, before: false, after: true })
    }
  }

  return { at, entries }
}

/** The same patch backwards. `at` is kept so an undo keeps its place in time. */
export function invertPatch(patch: ThemePatch): ThemePatch {
  return {
    at: patch.at,
    entries: patch.entries.map((entry) => ({
      path: entry.path,
      before: entry.after,
      after: entry.before,
    })),
  }
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

/**
 * Apply a patch to a state snapshot. Pure: neither argument is mutated, untouched
 * sub-objects are shared with the input, and the displayed palettes are left exactly as
 * they were (the caller runs `relink` afterwards — design §4.3).
 *
 * Values are copied lazily per panel, so a one-key edit allocates one small record rather
 * than the whole state.
 */
export function applyPatch<T extends PatchableState>(state: T, patch: ThemePatch): T {
  const next: PatchableState = { ...state }

  let colors: UIColors | null = null
  let baseSyntax: SyntaxColors | null = null
  let baseAnsi: AnsiColors | null = null
  let links: Links | null = null
  let locks: Set<string> | null = null

  for (const { path, after } of patch.entries) {
    const dot = path.indexOf('.')

    if (dot < 0) {
      switch (path) {
        case 'isDark':
          next.isDark = after as boolean
          break
        case 'baseHue':
          next.baseHue = after as number
          break
        case 'uiSaturation':
          next.uiSaturation = after as number
          break
        case 'syntaxSaturation':
          next.syntaxSaturation = after as number
          break
        case 'scheme':
          next.scheme = after as ColorScheme
          break
        case 'assignment':
          next.assignment = after as Assignment
          break
        default:
          // A path this version does not know (written by a newer one): ignore rather
          // than throw — a history must never be able to break the open theme.
          break
      }
      continue
    }

    const root = path.slice(0, dot)
    const key = path.slice(dot + 1)

    switch (root) {
      case 'colors': {
        if (colors === null) colors = { ...state.colors }
        writeValue(colors as Record<string, string>, key, after)
        break
      }
      case 'baseSyntaxColors': {
        if (baseSyntax === null) baseSyntax = { ...state.baseSyntaxColors }
        writeValue(baseSyntax as Record<string, string>, key, after)
        break
      }
      case 'baseAnsiColors': {
        if (baseAnsi === null) baseAnsi = { ...state.baseAnsiColors }
        writeValue(baseAnsi as Record<string, string>, key, after)
        break
      }
      case 'links': {
        if (links === null) links = { ...state.links }
        if (after === null) delete links[key]
        else links[key] = after as Links[string]
        break
      }
      case 'locks': {
        if (locks === null) locks = new Set(state.lockedColors)
        if (after === true) locks.add(key)
        else locks.delete(key)
        break
      }
      default:
        break
    }
  }

  if (colors !== null) next.colors = colors
  if (baseSyntax !== null) next.baseSyntaxColors = baseSyntax
  if (baseAnsi !== null) next.baseAnsiColors = baseAnsi
  if (links !== null) next.links = links
  if (locks !== null) next.lockedColors = locks

  return next as T
}

/** Write or delete one record key; `null` is the "absent" sentinel. */
function writeValue(record: Record<string, string>, key: string, value: unknown): void {
  if (value === null) delete record[key]
  else record[key] = value as string
}

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

/** A cursor that is safe to index with even if the persisted bytes are corrupt. */
function clampCursor(history: History): number {
  if (!Number.isFinite(history.cursor)) return 0
  return Math.max(0, Math.min(Math.trunc(history.cursor), history.steps.length))
}

/** Every path a patch touches — the unit of the coalescing rule (§4.2). */
function pathSet(patch: ThemePatch): Set<string> {
  return new Set(patch.entries.map((entry) => entry.path))
}

function isSubset(of: Set<string>, superset: Set<string>): boolean {
  for (const path of of) if (!superset.has(path)) return false
  return true
}

/**
 * Merge `next` into `prev`: the earlier `before` values survive, the later `after` values
 * win. Only called when `next`'s paths are a subset of `prev`'s, so no path is added.
 */
function mergeInto(prev: ThemePatch, next: ThemePatch): ThemePatch {
  const index = new Map<string, number>()
  prev.entries.forEach((entry, i) => index.set(entry.path, i))
  const entries = prev.entries.map((entry) => ({ ...entry }))
  for (const entry of next.entries) {
    const i = index.get(entry.path)
    if (i !== undefined) entries[i].after = entry.after
  }
  return { at: next.at, entries }
}

/**
 * Record a step at the cursor (design §4.2 / §4.4):
 *
 *  * an empty patch is not an edit — it is dropped, so a no-op commit cannot push a step;
 *  * a new edit while `cursor < steps.length` truncates the redo tail;
 *  * a patch whose path set is a subset of the previous step's, arriving within 500 ms,
 *    merges into it (keyboard repeat, a programmatic burst);
 *  * the oldest step is dropped past `HISTORY_CAP`.
 */
export function recordStep(history: History, patch: ThemePatch): History {
  if (patch.entries.length === 0) return history

  const cursor = clampCursor(history)
  const steps = history.steps.slice(0, cursor)

  const prev = steps[steps.length - 1]
  const canMerge =
    prev !== undefined &&
    prev.entries.length > 0 &&
    patch.at - prev.at >= 0 &&
    patch.at - prev.at <= COALESCE_WINDOW_MS &&
    isSubset(pathSet(patch), pathSet(prev))

  if (canMerge) {
    steps[steps.length - 1] = mergeInto(prev, patch)
    return { cursor: steps.length, steps }
  }

  steps.push(patch)
  if (steps.length <= HISTORY_CAP) return { cursor: steps.length, steps }

  const drop = steps.length - HISTORY_CAP
  return { cursor: steps.length - drop, steps: steps.slice(drop) }
}

/** Apply the inverse of the step before the cursor, or `null` when there is none. */
export function undoStep(
  history: History
): { history: History; patch: ThemePatch } | null {
  const cursor = clampCursor(history)
  if (cursor <= 0) return null
  const step = history.steps[cursor - 1]
  if (step === undefined) return null
  return {
    history: { cursor: cursor - 1, steps: history.steps },
    patch: invertPatch(step),
  }
}

/** The step at the cursor, or `null` when everything is already applied. */
export function redoStep(
  history: History
): { history: History; patch: ThemePatch } | null {
  const cursor = clampCursor(history)
  if (cursor >= history.steps.length) return null
  const step = history.steps[cursor]
  if (step === undefined) return null
  return {
    history: { cursor: cursor + 1, steps: history.steps },
    patch: step,
  }
}
