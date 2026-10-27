// The theme library controller (design §2, §3, §9).
//
// This hook owns everything the library needs that is *not* the live theme state:
//
//   * the debounced save path (`scheduleSave` → `persist` → `writeTheme`),
//   * the catalogue (`themes`, recomputed from storage on every mutation),
//   * the open record's identity (`themeId` / `themeName`) and the index's `currentId`,
//   * create / rename / delete of records.
//
// The provider keeps the orchestration that has to see the live `ThemeState` — adopting
// an opened record, drawing a new theme — and calls into this hook for the storage side.
//
// ── SSR ───────────────────────────────────────────────────────────────────────
// Nothing here touches `localStorage` during render or during the first client render.
// `browserStore()` is only called from effects and event handlers; every state starts
// from a constant. The provider's first paint therefore stays the deterministic
// bootstrap palette, and the catalogue can render a skeleton while `libraryLoaded` is
// false.
//
// ── Saving ────────────────────────────────────────────────────────────────────
// `persist` builds the record's `propsHash` from the *same export object the buttons
// produce* (`generateThemeJSON` with the record's name and `x-themegen` metadata), then
// `JSON.parse`s it. Hashing a hand-rolled `{ type, colors }` would let the hash drift
// from what is actually exported the day either exporter changes.

import { useCallback, useEffect, useRef, useState } from 'react'

import { propsHash } from '@/lib/themes/canonical'
import { metadataFor } from '@/lib/themes/exporter'
import { toRecord } from '@/lib/themes/record'
import type { ThemeStateLike } from '@/lib/themes/record'
import {
  browserStore,
  emptyIndex,
  readAllThemes,
  readIndex,
  readIndexState,
  readTheme,
  removeTheme as removeStoredTheme,
  writeIndex,
  writeTheme,
} from '@/lib/themes/storage'
import type { LibraryIndex } from '@/lib/themes/storage'
import type { SavedTheme, ThemeInputs } from '@/lib/themes/schema'
import { generateThemeJSON } from '@/lib/utils/exportTheme'

/** One catalogue row. `swatches` is sampled from the stored palette — no generator run. */
export interface ThemeSummary {
  id: string
  name: string
  updatedAt: number
  swatches: string[]
  paletteOnly: boolean
}

/** Trailing debounce for an auto-save: a drag writes once, at rest. */
export const SAVE_DEBOUNCE_MS = 400

const EMPTY_LIBRARY_MESSAGE = 'Storage full — delete a theme or clear history'

/** A newer app version's library: readable by it alone, so this version must not write. */
const READ_ONLY_MESSAGE = 'This library was saved by a newer version — read only'

/** The resolver's input view of a live state snapshot. Mirrors `ThemeContext.toInputs`. */
function inputsOf(s: ThemeStateLike): ThemeInputs {
  return {
    isDark: s.isDark,
    baseHue: s.baseHue,
    scheme: s.scheme,
    uiSaturation: s.uiSaturation,
    syntaxSaturation: s.syntaxSaturation,
    assignment: s.assignment,
  }
}

/** Six fixed samples across the three palettes (design §8.1). */
function swatchesOf(record: SavedTheme): string[] {
  return [
    record.palette.ui.BG1,
    record.palette.ui.FG1,
    record.palette.ui.AC1,
    record.palette.ui.AC2,
    record.palette.syntax.keyword,
    record.palette.ansi.Red,
  ]
}

function summaryOf(record: SavedTheme): ThemeSummary {
  return {
    id: record.id,
    name: record.name,
    updatedAt: record.updatedAt,
    swatches: swatchesOf(record),
    paletteOnly: record.inputs === undefined,
  }
}

/**
 * `crypto.randomUUID` where the browser has it, a timestamp+random string otherwise
 * (design §5.1): an id mismatch is harmless, a missing id is not.
 */
function newId(): string {
  try {
    const crypto = (globalThis as { crypto?: Crypto }).crypto
    if (crypto !== undefined && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Secure-context or disabled-crypto failure: fall through to the fallback.
  }
  return `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** `Theme N`, first free N (design §7.1). Duplicate names are allowed; this is a default. */
export function nextFreeName(records: readonly SavedTheme[]): string {
  const used = new Set<number>()
  for (const record of records) {
    const match = /^Theme (\d+)$/.exec(record.name)
    if (match !== null) used.add(Number(match[1]))
  }
  let n = 1
  while (used.has(n)) n += 1
  return `Theme ${n}`
}

/**
 * Assemble the record for one save. The hash is computed from the parsed export — the
 * identical bytes the Export buttons download — so `propsHash` can never describe a
 * different colours map than the file.
 */
function recordFor(
  state: ThemeStateLike,
  id: string,
  name: string,
  createdAt: number,
  updatedAt: number
): SavedTheme {
  const inputs = inputsOf(state)
  const exported = generateThemeJSON(
    state.colors,
    state.syntaxColors,
    state.ansiColors,
    name,
    metadataFor(inputs, state.lockedColors, state.links)
  )
  const hash = propsHash(JSON.parse(exported) as object)
  return toRecord(state, { id, name, createdAt, updatedAt, propsHash: hash })
}

export interface LibraryController {
  /** False until the first post-mount read of the index; the catalogue shows a skeleton. */
  libraryLoaded: boolean
  themes: ThemeSummary[]
  themeId: string | null
  themeName: string
  lastSavedAt: number | null
  lastError: string | null
  /** True while a debounced write is outstanding — the saved indicator's "Saving…". */
  saving: boolean
  /** Debounced write of a live state under the open record. No-op before the read. */
  scheduleSave: (state: ThemeStateLike) => void
  /** Write any pending save immediately. */
  flush: () => void
  /** Read the library after mount; returns the record `currentId` points at, if any. */
  loadCurrent: () => SavedTheme | null
  readRecord: (id: string) => SavedTheme | null
  /** Re-read the catalogue; a caller that saw unreadable bytes uses this to drop the row. */
  refreshCatalogue: () => void
  /** Whether a record is open. Reads the ref, so it is correct inside a batched handler. */
  hasOpenRecord: () => boolean
  /** Make `record` the open one in local state only; `writeCurrentId` persists it. */
  adoptCurrent: (record: { id: string; name: string; createdAt: number } | null) => void
  /** Persist `currentId`, keeping the index's `order` untouched. */
  writeCurrentId: (id: string | null) => void
  /** Persist a state as a brand-new record and make it current. Returns its id, or null. */
  createRecord: (state: ThemeStateLike, name?: string) => string | null
  /**
   * Persist a record that was built elsewhere — import is the only such caller — and make
   * it current. Returns its id, or null when the library refused the write.
   */
  addRecord: (record: SavedTheme) => string | null
  /** Rename one stored record; never the catalogue's display disambiguation. */
  renameRecord: (id: string, name: string) => boolean
  /** Remove a record and its history, repairing `currentId`/`order`. */
  deleteRecord: (id: string) => { wasCurrent: boolean; nextId: string | null }
}

export function useLibrary(): LibraryController {
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  const [themes, setThemes] = useState<ThemeSummary[]>([])
  const [themeId, setThemeId] = useState<string | null>(null)
  const [themeName, setThemeName] = useState('Theme 1')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  // A save is waiting on the debounce. Kept as state, not just as `timerRef`, because the
  // saved indicator has to say "Saving…" while it is true — a ref would paint nothing.
  const [saving, setSaving] = useState(false)

  // Read inside callbacks that fire outside React's render cycle.
  const loadedRef = useRef(false)
  const currentRef = useRef<{ id: string; name: string; createdAt: number } | null>(null)
  const pendingRef = useRef<ThemeStateLike | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pendingRef.current = null
    setSaving(false)
  }, [])

  const publish = useCallback((store: ReturnType<typeof browserStore>) => {
    const index = readIndex(store)
    setThemes(readAllThemes(index, store).map(summaryOf))
  }, [])

  /**
   * Write one state snapshot under the open record. Tolerant by contract (design §2.2):
   * a quota refusal surfaces as `lastError` and never throws or clears the library.
   */
  const persist = useCallback((state: ThemeStateLike) => {
    const current = currentRef.current
    if (!loadedRef.current || current === null) return

    const store = browserStore()
    const now = Date.now()
    const record = recordFor(state, current.id, current.name, current.createdAt, now)
    const result = writeTheme(record, store)

    if (result === 'quota') {
      setLastError(EMPTY_LIBRARY_MESSAGE)
    } else {
      // `'ok'` also covers writeTheme's refusal to downgrade a newer record (Task 5).
      setLastError(null)
      setLastSavedAt(now)
    }
    publish(store)
  }, [publish])

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending !== null) persist(pending)
    setSaving(false)
  }, [persist])

  const scheduleSave = useCallback(
    (state: ThemeStateLike) => {
      // Never save before the library has been read: the deterministic bootstrap palette
      // would otherwise overwrite the record that is about to be adopted.
      if (!loadedRef.current || currentRef.current === null) return
      pendingRef.current = state
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      setSaving(true)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const pending = pendingRef.current
        pendingRef.current = null
        if (pending !== null) persist(pending)
        setSaving(false)
      }, SAVE_DEBOUNCE_MS)
    },
    [persist]
  )

  // A closing tab must not lose the last 400 ms.
  useEffect(() => {
    const onPageHide = () => flush()
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [flush])

  const loadCurrent = useCallback((): SavedTheme | null => {
    const store = browserStore()
    const index = readIndex(store)
    const records = readAllThemes(index, store)
    setThemes(records.map(summaryOf))
    loadedRef.current = true
    setLibraryLoaded(true)
    if (index.currentId === null) return null
    return records.find((record) => record.id === index.currentId) ?? null
  }, [])

  const readRecord = useCallback((id: string): SavedTheme | null => {
    return readTheme(id, browserStore())
  }, [])

  const refreshCatalogue = useCallback(() => {
    publish(browserStore())
  }, [publish])

  const hasOpenRecord = useCallback(() => currentRef.current !== null, [])

  const adoptCurrent = useCallback(
    (record: { id: string; name: string; createdAt: number } | null) => {
      // With no record open there is nothing a queued save may write to: drop it rather
      // than let a timer from a since-deleted record fire against a new palette.
      if (record === null) cancelPending()
      currentRef.current = record
      setThemeId(record?.id ?? null)
      setThemeName(record?.name ?? 'Theme 1')
    },
    [cancelPending]
  )

  const writeCurrentId = useCallback((id: string | null) => {
    const store = browserStore()
    const index = readIndex(store)
    if (id !== null && !index.order.includes(id)) return
    const next: LibraryIndex = { ...index, currentId: id }
    writeIndex(next, store)
  }, [])

  const createRecord = useCallback(
    (state: ThemeStateLike, name?: string): string | null => {
      // This call persists the state itself; any timer queued under the outgoing id must
      // not fire afterwards and write the new palette into the old record.
      cancelPending()

      const store = browserStore()
      // Check *before* writing the record: under a locked (newer) index the appended id
      // would never reach `order`, leaving an orphan record nobody can see or delete.
      const indexState = readIndexState(store)
      if (indexState.state === 'locked') {
        setLastError(READ_ONLY_MESSAGE)
        return null
      }
      const index = indexState.state === 'ok' ? indexState.index : emptyIndex()
      const records = readAllThemes(index, store)
      const id = newId()
      const now = Date.now()
      const record = recordFor(state, id, name ?? nextFreeName(records), now, now)
      const result = writeTheme(record, store)
      if (result === 'quota') {
        setLastError(EMPTY_LIBRARY_MESSAGE)
        return null
      }

      const next: LibraryIndex = {
        ...index,
        currentId: id,
        order: [...index.order, id],
      }
      if (writeIndex(next, store) !== 'ok') {
        // The record was written but the catalogue cannot name it. Undo the record so the
        // library does not accumulate entries no index points at.
        removeStoredTheme(id, store)
        setLastError(EMPTY_LIBRARY_MESSAGE)
        return null
      }
      adoptCurrent({ id, name: record.name, createdAt: now })
      setThemes(readAllThemes(next, store).map(summaryOf))
      setLastError(null)
      setLastSavedAt(now)
      return id
    },
    [adoptCurrent, cancelPending]
  )

  const addRecord = useCallback(
    (record: SavedTheme): string | null => {
      // The record is already built; what is left is the same bookkeeping `createRecord`
      // does — refuse under a locked index, roll back an orphan, adopt, publish.
      cancelPending()
      const store = browserStore()
      const indexState = readIndexState(store)
      if (indexState.state === 'locked') {
        setLastError(READ_ONLY_MESSAGE)
        return null
      }
      const index = indexState.state === 'ok' ? indexState.index : emptyIndex()
      // A record whose id the index already names is not a new row; refuse rather than
      // overwrite whatever is stored under it.
      if (index.order.includes(record.id)) return null

      if (writeTheme(record, store) === 'quota') {
        setLastError(EMPTY_LIBRARY_MESSAGE)
        return null
      }
      const next: LibraryIndex = {
        ...index,
        currentId: record.id,
        order: [...index.order, record.id],
      }
      if (writeIndex(next, store) !== 'ok') {
        removeStoredTheme(record.id, store)
        setLastError(EMPTY_LIBRARY_MESSAGE)
        return null
      }
      adoptCurrent({ id: record.id, name: record.name, createdAt: record.createdAt })
      setThemes(readAllThemes(next, store).map(summaryOf))
      setLastError(null)
      setLastSavedAt(record.updatedAt)
      return record.id
    },
    [adoptCurrent, cancelPending]
  )

  const renameRecord = useCallback((id: string, name: string): boolean => {
    const trimmed = name.trim()
    if (trimmed === '') return false

    const store = browserStore()
    const record = readTheme(id, store)
    if (record === null) return false

    const now = Date.now()
    const renamed: SavedTheme = { ...record, name: trimmed, updatedAt: now }
    if (writeTheme(renamed, store) === 'quota') {
      setLastError(EMPTY_LIBRARY_MESSAGE)
      return false
    }

    if (currentRef.current?.id === id) {
      currentRef.current = { ...currentRef.current, name: trimmed }
      setThemeName(trimmed)
    }
    setLastError(null)
    setLastSavedAt(now)
    publish(store)
    return true
  }, [publish])

  const deleteRecord = useCallback(
    (id: string): { wasCurrent: boolean; nextId: string | null } => {
      const store = browserStore()
      // Deleting a record means rewriting the index that names it. Under a locked (newer)
      // library that write is refused, so removing the record would leave a dangling id.
      const indexState = readIndexState(store)
      if (indexState.state === 'locked') {
        setLastError(READ_ONLY_MESSAGE)
        return { wasCurrent: false, nextId: null }
      }
      const index = indexState.state === 'ok' ? indexState.index : emptyIndex()
      const order = index.order.filter((entry) => entry !== id)
      const wasCurrent = index.currentId === id || currentRef.current?.id === id

      // Pick the next *valid* record by order; a corrupt key must not become `currentId`.
      const validIds = readAllThemes(index, store).map((record) => record.id)
      const position = validIds.indexOf(id)
      const remaining = validIds.filter((entry) => entry !== id)
      const nextId =
        wasCurrent && remaining.length > 0
          ? remaining[Math.min(Math.max(position, 0), remaining.length - 1)]
          : null

      removeStoredTheme(id, store)
      const next: LibraryIndex = {
        ...index,
        currentId: wasCurrent ? nextId : index.currentId,
        order,
      }
      writeIndex(next, store)

      if (wasCurrent) adoptCurrent(null)
      setThemes(readAllThemes(next, store).map(summaryOf))
      return { wasCurrent, nextId }
    },
    [adoptCurrent]
  )

  return {
    libraryLoaded,
    themes,
    themeId,
    themeName,
    lastSavedAt,
    lastError,
    saving,
    scheduleSave,
    flush,
    loadCurrent,
    readRecord,
    refreshCatalogue,
    hasOpenRecord,
    adoptCurrent,
    writeCurrentId,
    createRecord,
    addRecord,
    renameRecord,
    deleteRecord,
  }
}
