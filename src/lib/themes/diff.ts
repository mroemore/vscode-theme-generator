// The undo/redo diff engine (design §4).
//
// A patch holds *authoritative* state only — the inputs, the three base palettes, the
// links, the locks and the foreign-theme flag (`paletteOnly`). `syntaxColors` / `ansiColors` are derived by `relink`, so storing
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
import type { Link, Links } from '@/lib/colors/links'
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
  /**
   * True while the theme is foreign (palette-only): the record keeps
   * `inputs === undefined` and no metadata block is written. A generator control flips it
   * to false — the conversion — and it must be part of that step's patch, or an undo of
   * the conversion would restore the imported colours but leave the theme flagged as
   * generated: a record whose `inputs` do not generate the colours it stores. As with
   * every scalar here, a persisted patch from an older version that carries no
   * `paletteOnly` entry leaves the field exactly as it was — `applyPatch` never defaults
   * a path that is absent.
   */
  paletteOnly: boolean
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

/**
 * Structural copy of a JSON-clean value. Used where a value taken out of a patch is put
 * into a returned state: the patch belongs to a *stored step*, so a later in-place edit
 * through the state must not be able to rewrite history.
 */
function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepCopy(item)) as unknown as T
  if (value === null || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(source)) copy[key] = deepCopy(source[key])
  return copy as T
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
  // `paletteOnly` is last on purpose: conversion steps were emitted before the flag was
  // patchable, so a reader that asserts on a patch's shape sees the new path appended
  // rather than interpolated.
  const scalars: [keyof PatchableState, unknown][] = [
    ['isDark', after.isDark],
    ['baseHue', after.baseHue],
    ['uiSaturation', after.uiSaturation],
    ['syntaxSaturation', after.syntaxSaturation],
    ['scheme', after.scheme],
    ['paletteOnly', after.paletteOnly],
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

/**
 * The entries of a patch that came back from persistence, or `[]` when the step is not
 * shaped like a patch at all.
 *
 * `readHistory` only guarantees that `steps` is an array (a hand-edited or
 * future-version step can be anything), and the storage layer's promise is that a corrupt
 * history behaves like an empty one. Nothing here may throw out of a render.
 */
function patchEntries(patch: unknown): PatchEntry[] {
  if (typeof patch !== 'object' || patch === null) return []
  const entries = (patch as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return []
  return entries.filter(
    (entry): entry is PatchEntry =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as PatchEntry).path === 'string'
  )
}

/** A step's timestamp, or `0` when it is corrupt. */
function patchAt(patch: unknown): number {
  const at =
    typeof patch === 'object' && patch !== null ? (patch as { at?: unknown }).at : undefined
  return typeof at === 'number' && Number.isFinite(at) ? at : 0
}

/** The same patch backwards. `at` is kept so an undo keeps its place in time. */
export function invertPatch(patch: ThemePatch): ThemePatch {
  return {
    at: patchAt(patch),
    entries: patchEntries(patch).map((entry) => ({
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

  for (const { path, after } of patchEntries(patch)) {
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
        case 'paletteOnly':
          // The conversion flag. Only a patch that names it writes it; an older patch
          // that does not leaves the field as it was (the spread above), so a step
          // recorded before the flag was patchable cannot convert a theme backwards.
          next.paletteOnly = after as boolean
          break
        case 'assignment':
          // Copied, not aliased: the value belongs to a stored step and a later in-place
          // edit of the returned state must not rewrite the history.
          if (typeof after === 'object' && after !== null) {
            next.assignment = deepCopy(after as Assignment)
          }
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
        else if (typeof after === 'object') links[key] = { ...(after as Link) }
        // A malformed value is ignored and the link stays as it was, like an unknown path.
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
function pathSet(entries: readonly PatchEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.path))
}

function isSubset(of: Set<string>, superset: Set<string>): boolean {
  for (const path of of) if (!superset.has(path)) return false
  return true
}

/**
 * Merge `next` into `prev`: the earlier `before` values survive, the later `after` values
 * win, and every entry the merge leaves net-unchanged is dropped. Only called when
 * `next`'s paths are a subset of `prev`'s, so no path is added.
 *
 * The filter is what makes an out-and-back inside the 500 ms window free: `347 → 350 →
 * 347` merges to `{before: 347, after: 347}`, an entry whose undo can do nothing visible.
 * The comparison is structural because `assignment` and link values are objects.
 */
function mergeInto(prev: ThemePatch, next: ThemePatch): ThemePatch {
  const prevEntries = patchEntries(prev)
  const index = new Map<string, number>()
  prevEntries.forEach((entry, i) => index.set(entry.path, i))
  const entries = prevEntries.map((entry) => ({ ...entry }))
  for (const entry of patchEntries(next)) {
    const i = index.get(entry.path)
    if (i !== undefined) entries[i].after = entry.after
  }
  return {
    at: patchAt(next),
    entries: entries.filter((entry) => !deepEqual(entry.before, entry.after)),
  }
}

/**
 * Record a step at the cursor (design §4.2 / §4.4):
 *
 *  * an empty patch is not an edit — it is dropped, so a no-op commit cannot push a step;
 *  * a new edit while `cursor < steps.length` truncates the redo tail;
 *  * a patch whose path set is a subset of the previous step's, arriving within 500 ms,
 *    merges into it (keyboard repeat, a programmatic burst); a merge that leaves the
 *    step with no net change drops the step itself — it never happened;
 *  * the oldest step is dropped past `HISTORY_CAP`.
 */
export function recordStep(history: History, patch: ThemePatch): History {
  const entries = patchEntries(patch)
  if (entries.length === 0) return history

  const cursor = clampCursor(history)
  const steps = history.steps.slice(0, cursor)

  const prev = steps[steps.length - 1]
  const prevPaths = prev === undefined ? new Set<string>() : pathSet(patchEntries(prev))
  const canMerge =
    prev !== undefined &&
    prevPaths.size > 0 &&
    patchAt(patch) - patchAt(prev) >= 0 &&
    patchAt(patch) - patchAt(prev) <= COALESCE_WINDOW_MS &&
    isSubset(pathSet(entries), prevPaths)

  if (canMerge) {
    const merged = mergeInto(prev, patch)
    if (merged.entries.length === 0) {
      // The window closed on a net no-op, so the step it merged into never happened:
      // drop it rather than leave an undo slot that does nothing visible.
      steps.pop()
      return { cursor: steps.length, steps }
    }
    steps[steps.length - 1] = merged
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
