// The localStorage layer for the theme library (design §2).
//
// Three keys, deliberately split so a corrupt history can never take the catalogue
// down with it (spec §2.1):
//
//   vsc_themegen.library.v1         the index: one small record, { schemaVersion, currentId, order }
//   vsc_themegen.theme.v1.<id>      one SavedTheme per theme, debounced on every change
//   vsc_themegen.history.v1.<id>    one History per theme
//
// Every public function takes an optional `store` and must work when it is absent,
// null, or throws (design §2.2 / Review Focus 1). Storage is a cache, never the
// source of truth for whether the app can run: private mode, storage disabled, a
// zero quota or a SecurityError all degrade to "no saved themes yet" rather than a
// crash or a broken catalogue. The one place this is load-bearing is `browserStore`,
// which resolves `globalThis.localStorage` lazily inside try/catch — module scope
// runs on the server, where there is no localStorage at all.
//
// Quota escalation (design §2.2) never sacrifices a theme record to make room for
// history: history is dropped oldest-first, records are not.

import { parseStoredTheme } from '@/lib/themes/schema'
import type { SavedTheme } from '@/lib/themes/schema'
import type { History } from '@/lib/themes/diff'

/** The narrow slice of the Storage interface this module needs. */
export interface KeyValueStore {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

export const LIBRARY_KEY = 'vsc_themegen.library.v1'
export const themeKey = (id: string): string => `vsc_themegen.theme.v1.${id}`
export const historyKey = (id: string): string => `vsc_themegen.history.v1.${id}`

export interface LibraryIndex {
  schemaVersion: 1
  currentId: string | null
  order: string[]
}

/** Per-theme step cap (design §4.4 / §2.2). Mirrors `HISTORY_CAP` in `diff.ts`. */
export const MAX_STEPS_PER_THEME = 20

/** Global history budget in bytes (design §2.2): 1.5 MB. */
export const HISTORY_BUDGET_BYTES = 1_500_000

const EMPTY_INDEX: LibraryIndex = { schemaVersion: 1, currentId: null, order: [] }

/** A store plus its identity — kept so callers can skip a second resolve. */
type Resolved = KeyValueStore | null

// ---------------------------------------------------------------------------
// store resolution and safe access
// ---------------------------------------------------------------------------

/**
 * Resolve the browser store lazily. Never touches `localStorage` at module scope:
 * the server has none, and a browser can make the mere *access* throw (blocked
 * cookies, a sandboxed frame), so the lookup itself is guarded too.
 */
export const browserStore = (): KeyValueStore | null => {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStore }).localStorage
    if (ls === null || ls === undefined) return null
    if (typeof ls.getItem !== 'function' || typeof ls.setItem !== 'function') return null
    return ls
  } catch {
    return null
  }
}

/** Read one key, treating an absent or throwing store as "no value". */
function safeGet(store: Resolved, key: string): string | null {
  if (store === null || store === undefined) return null
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

type SetResult = 'ok' | 'quota'

/**
 * The index can also be *locked*: the key exists but its bytes are not this version's
 * library (a newer `schemaVersion`, or unparseable). A newer library is read-only — see
 * `writeIndex` — so "locked" is a refusal, never a success.
 */
export type IndexWriteResult = SetResult | 'locked'

/**
 * A theme write can also be *refused*: the stored record belongs to a newer app
 * version, so this write is not permitted to clobber it. A refusal is never a success
 * — the bytes on disk are unchanged — so a caller that read `'ok'` there would be
 * claiming a save that never happened.
 */
export type ThemeWriteResult = SetResult | 'refused'

/** Write one key, reporting quota exhaustion (or any write failure) as `'quota'`. */
function safeSet(store: Resolved, key: string, value: string): SetResult {
  if (store === null || store === undefined) return 'quota'
  try {
    store.setItem(key, value)
    return 'ok'
  } catch {
    // QuotaExceededError, a SecurityError from private mode, or a disabled store:
    // from the caller's point of view they all mean "could not write".
    return 'quota'
  }
}

function safeRemove(store: Resolved, key: string): void {
  if (store === null || store === undefined) return
  try {
    store.removeItem(key)
  } catch {
    // Removing something already gone is not an error worth surfacing.
  }
}

/** Byte cost of a value as UTF-16 code units (what localStorage charges for keys). */
function bytesOf(value: string): number {
  return value.length
}

// ---------------------------------------------------------------------------
// index
// ---------------------------------------------------------------------------

/** An empty index. Exported so callers can compare without allocating a literal. */
export function emptyIndex(): LibraryIndex {
  return { schemaVersion: 1, currentId: null, order: [] }
}

/**
 * The index as the store actually holds it:
 *
 *   * `'empty'`  — no key yet: this version may create the library;
 *   * `'ok'`     — this version's index, parsed;
 *   * `'locked'` — a key exists that is not this version's index (a newer app's library,
 *                  or bytes that do not parse). Read-only: see `writeIndex`.
 */
export type IndexRead =
  | { state: 'ok'; index: LibraryIndex }
  | { state: 'empty' }
  | { state: 'locked' }

/**
 * Read the index *and* report whether it is ours. Callers that only want a catalogue can
 * use `readIndex` (empty for both), but a mutating caller must distinguish "no library"
 * from "a library I must not overwrite" — the whole point of the `'locked'` state.
 */
export function readIndexState(store: Resolved = browserStore()): IndexRead {
  const raw = safeGet(store, LIBRARY_KEY)
  if (raw === null) return { state: 'empty' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { state: 'locked' }
  }
  if (typeof parsed !== 'object' || parsed === null) return { state: 'locked' }
  const rec = parsed as { schemaVersion?: unknown; currentId?: unknown; order?: unknown }
  // A newer index (a future app version's library) is not ours to rewrite. Refuse rather
  // than degrade: `writeIndex` would otherwise replace it with `{schemaVersion: 1,
  // order: [new]}` and orphan every palette record under its own key (Review Focus 3).
  if (rec.schemaVersion !== 1) return { state: 'locked' }
  const order = Array.isArray(rec.order)
    ? rec.order.filter((id): id is string => typeof id === 'string')
    : []
  const currentId = typeof rec.currentId === 'string' ? rec.currentId : null
  return {
    state: 'ok',
    index: {
      schemaVersion: 1,
      currentId: currentId !== null && order.includes(currentId) ? currentId : null,
      order,
    },
  }
}

/**
 * Read the library index. A missing, locked, or unreadable index degrades to the empty
 * index — the catalogue simply shows "No saved themes yet" — rather than throwing.
 * `order` is filtered to strings so a hand-edited index cannot inject a non-string id.
 * Mutating callers use `readIndexState` so a locked library is not mistaken for empty.
 */
export function readIndex(store: Resolved = browserStore()): LibraryIndex {
  const state = readIndexState(store)
  return state.state === 'ok' ? state.index : emptyIndex()
}

/**
 * Write the index. Refuses (`'locked'`) when the key holds a library this version cannot
 * read: a newer library is read-only, never clobbered.
 */
export function writeIndex(
  index: LibraryIndex,
  store: Resolved = browserStore()
): IndexWriteResult {
  if (readIndexState(store).state === 'locked') return 'locked'
  return safeSet(store, LIBRARY_KEY, JSON.stringify(index))
}

// ---------------------------------------------------------------------------
// themes
// ---------------------------------------------------------------------------

/**
 * Read one theme. Returns `null` for a parse failure of **any** kind — unreadable
 * store, invalid JSON, a Zod rejection, or a `schemaVersion` from a newer app — and
 * never deletes or rewrites the offending bytes (design §2.2 / Review Focus 2 & 3).
 * The catalogue shows every other theme; this one is simply absent until the user
 * does something about it.
 */
export function readTheme(id: string, store: Resolved = browserStore()): SavedTheme | null {
  const raw = safeGet(store, themeKey(id))
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const result = parseStoredTheme(parsed)
  if (!result.ok) return null
  return result.theme
}

/** Every theme that parses, in `index.order`; one bad record cannot sink the rest. */
export function readAllThemes(
  index: LibraryIndex,
  store: Resolved = browserStore()
): SavedTheme[] {
  const out: SavedTheme[] = []
  for (const id of index.order) {
    const theme = readTheme(id, store)
    // Guard against an index id disagreeing with the record it points at: the key is
    // the identity, so a mismatch means the index is stale for that entry.
    if (theme !== null && theme.id === id) out.push(theme)
  }
  return out
}

/**
 * Write one theme.
 *
 * Refuses to overwrite a stored record whose `schemaVersion` is higher than the
 * incoming one (design §2.3 / Review Focus 3): a newer app version's theme must not
 * be downgraded by an older tab, so the stored bytes are left exactly as they are.
 *
 * The refusal is reported as `'refused'`, not `'ok'`. Nothing was wrong with *this*
 * write — it was simply not permitted to clobber — but nothing was written either,
 * and a caller that reads `'ok'` would say "saved" over bytes that never moved. The
 * one place that claims a save is the one place that wrote.
 */
export function writeTheme(
  theme: SavedTheme,
  store: Resolved = browserStore()
): ThemeWriteResult {
  if (store === null || store === undefined) return 'quota'

  const existing = safeGet(store, themeKey(theme.id))
  if (existing !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(existing)
    } catch {
      parsed = undefined
    }
    if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
      const version = (parsed as { schemaVersion?: unknown }).schemaVersion
      if (typeof version === 'number' && version > theme.schemaVersion) return 'refused'
    }
  }

  return safeSet(store, themeKey(theme.id), JSON.stringify(theme))
}

/** Remove the theme record and its history (design §4.4: deleting clears history). */
export function removeTheme(id: string, store = browserStore()): void {
  safeRemove(store, themeKey(id))
  safeRemove(store, historyKey(id))
}

/** Remove one theme's history key, leaving the record alone. */
export function removeHistory(id: string, store: Resolved = browserStore()): void {
  safeRemove(store, historyKey(id))
}

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

/** An empty history — also the sentinel for "no store", per the harness contract. */
export const BROWSER_UNAVAILABLE: History = { cursor: 0, steps: [] }

/**
 * Read one theme's history. A missing or corrupt history is an empty one: losing
 * undo steps is far better than throwing out of a render, and a broken history must
 * never affect the theme itself (it lives under its own key for exactly this reason).
 */
export function readHistory(id: string, store: Resolved = browserStore()): History {
  const raw = safeGet(store, historyKey(id))
  if (raw === null) return { cursor: 0, steps: [] }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { cursor: 0, steps: [] }
    const rec = parsed as { cursor?: unknown; steps?: unknown }
    const steps = Array.isArray(rec.steps) ? rec.steps : []
    const cursor =
      typeof rec.cursor === 'number' && Number.isFinite(rec.cursor)
        ? Math.max(0, Math.min(Math.trunc(rec.cursor), steps.length))
        : steps.length
    return { cursor, steps }
  } catch {
    return { cursor: 0, steps: [] }
  }
}

/**
 * Trim to the per-theme retention cap, keeping the newest steps and adjusting the
 * cursor by however many were dropped from the front (design §4.4).
 */
function capHistory(history: History): History {
  const { steps, cursor } = history
  if (steps.length <= MAX_STEPS_PER_THEME) return { cursor, steps }
  const drop = steps.length - MAX_STEPS_PER_THEME
  return { cursor: Math.max(0, cursor - drop), steps: steps.slice(drop) }
}

function serialiseHistory(history: History): string {
  return JSON.stringify(history)
}

/**
 * Write one theme's history, escalating on quota exhaustion (design §2.2, order):
 *
 *   1. keep only the newest `MAX_STEPS_PER_THEME` steps of *this* theme, retry;
 *   2. drop the oldest steps of *every other* theme to fit the global budget, retry;
 *   3. give up and return `'quota'`.
 *
 * A theme *record* is never dropped to make room for history.
 */
export function writeHistory(
  id: string,
  history: History,
  store: Resolved = browserStore()
): SetResult {
  if (store === null || store === undefined) return 'quota'

  // Step 1: the per-theme cap always applies, not only under quota pressure.
  const capped = capHistory(history)
  if (safeSet(store, historyKey(id), serialiseHistory(capped)) === 'ok') return 'ok'

  // Dropping oldest steps of *this* theme specifically, then retrying.
  const tighter = shrinkSteps(capped, 0.5)
  if (tighter.steps.length < capped.steps.length) {
    if (safeSet(store, historyKey(id), serialiseHistory(tighter)) === 'ok') return 'ok'
  }

  // Step 2: free space from every other theme's history to fit the global budget,
  // then retry this write.
  pruneToBudget(readIndex(store), store, id)
  if (safeSet(store, historyKey(id), serialiseHistory(tighter)) === 'ok') return 'ok'

  // One more aggressive drop of this theme's steps before conceding.
  const minimal = shrinkSteps(tighter, 0.5)
  if (minimal.steps.length < tighter.steps.length) {
    if (safeSet(store, historyKey(id), serialiseHistory(minimal)) === 'ok') return 'ok'
  }
  if (safeSet(store, historyKey(id), serialiseHistory({ cursor: 0, steps: [] })) === 'ok') {
    return 'ok'
  }

  return 'quota'
}

/** Drop the oldest `round(steps * fraction)` entries, adjusting the cursor. */
function shrinkSteps(history: History, fraction: number): History {
  const drop = Math.floor(history.steps.length * fraction)
  if (drop <= 0) return history
  return {
    cursor: Math.max(0, history.cursor - drop),
    steps: history.steps.slice(drop),
  }
}

// ---------------------------------------------------------------------------
// global budget
// ---------------------------------------------------------------------------

/** Total serialised bytes of every history named by `index.order`. */
function historyBytes(index: LibraryIndex, store: Resolved): number {
  let total = 0
  for (const id of index.order) {
    const raw = safeGet(store, historyKey(id))
    if (raw !== null) total += bytesOf(raw)
  }
  return total
}

/**
 * Drop the oldest history steps across `index.order` until the total falls under the
 * 1.5 MB budget (design §2.2). Records are never touched, and a theme whose history
 * is already empty is skipped so the loop cannot spin: with every history empty the
 * budget is unreachable only by non-history bytes, which this function must not drop.
 *
 * `protectId` is the theme currently being written; its history is pruned last so a
 * quota recovery does not immediately discard the steps being saved.
 */
export function pruneToBudget(
  index: LibraryIndex,
  store: Resolved = browserStore(),
  protectId?: string
): void {
  if (store === null || store === undefined) return

  let total = historyBytes(index, store)
  if (total <= HISTORY_BUDGET_BYTES) return

  // Work oldest-first: each pass drops one step from the theme with the most steps,
  // from the front. Round-robin rather than one-theme-at-a-time so the budget is met
  // by trimming everyone a little instead of gutting the first theme in `order`.
  const othersFirst = [
    ...index.order.filter((id) => id !== protectId),
    ...index.order.filter((id) => id === protectId),
  ]

  // Snapshot each history whole — cursor with it — so the loop is bounded and
  // re-serialisation is done once.
  const histories = new Map<string, History>()
  for (const id of othersFirst) {
    histories.set(id, readHistory(id, store))
  }

  let progress = true
  while (total > HISTORY_BUDGET_BYTES && progress) {
    progress = false
    for (const id of othersFirst) {
      if (total <= HISTORY_BUDGET_BYTES) break
      const history = histories.get(id)
      if (history === undefined || history.steps.length === 0) continue

      // Drop the oldest step. That step is the oldest *applied* one (the cursor counts
      // steps applied), so the cursor follows it down: `max(0, old - 1)`, never
      // `steps.length` — a history whose redo tail lives mid-stack must keep being able
      // to say what it has not applied (fix 2, 2026-10-26 round).
      const value = serialiseHistory({
        cursor: Math.max(0, history.cursor - 1),
        steps: history.steps.slice(1),
      })
      histories.set(id, { cursor: Math.max(0, history.cursor - 1), steps: history.steps.slice(1) })
      progress = true
      const key = historyKey(id)
      const raw = safeGet(store, key)
      const before = raw === null ? 0 : bytesOf(raw)
      if (safeSet(store, key, value) === 'ok') {
        total = total - before + bytesOf(value)
      }
    }
  }
}
