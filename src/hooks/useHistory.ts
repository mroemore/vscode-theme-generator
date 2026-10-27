// The history controller (design §4, §9.2, §9.3).
//
// Owns three things the provider must not:
//
//   * the per-theme undo stack, loaded from and written to `vsc_themegen.history.v1.<id>`;
//   * the gesture in flight — the pre-drag snapshot and the latest post-commit state, so a
//     twelve-move drag becomes one step that spans before-first to after-last;
//   * the guard rails: a malformed persisted step is dropped instead of moving the cursor
//     onto a patch that cannot be applied.
//
// ── What this hook does NOT own ──────────────────────────────────────────────
// The live `ThemeState`. It reads a snapshot through `snapshot()` and hands an applied
// patch to `restore()`, which is the provider's job: only the provider can `relink` the
// displayed palette, schedule the record save and tell next-themes that the document mode
// changed (design §4.3).
//
// ── Cursor ───────────────────────────────────────────────────────────────────
// `cursor` is the number of steps applied, so undo is `steps[cursor - 1]` and redo is
// `steps[cursor]` (see `diff.ts`). A history is per theme; switching themes loads that
// theme's own bytes, which is why an undo can never reach across a switch.
//
// ── Reload ──────────────────────────────────────────────────────────────────
// Loading is a read, not an edit: the effect sets the stack from storage and writes
// nothing back unless a step had to be dropped. Adoption and the bootstrap path pass
// `record: false`, so no step can be created by opening a theme or by the first paint.

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  diffThemes,
  invertPatch,
  recordStep,
  redoStep,
  undoStep,
} from '@/lib/themes/diff'
import type { History, PatchableState, ThemePatch } from '@/lib/themes/diff'
import { readHistory, removeHistory, writeHistory } from '@/lib/themes/storage'
import { useGestureBoundary } from '@/hooks/useGestureBoundary'

/** Trailing debounce for a history write: a drag lands once, at the end of the gesture. */
export const HISTORY_WRITE_DEBOUNCE_MS = 400

/** A history with nothing in it; a factory, because it is stored in a ref. */
const emptyHistory = (): History => ({ cursor: 0, steps: [] })

export interface HistoryOptions {
  /** The open theme's id, or null before the library has been read / with no record open. */
  themeId: string | null
  /** The authoritative state, read at the start of a gesture. */
  snapshot: () => PatchableState
  /**
   * Adopt the state a patch produces. The provider relinks the displayed palettes, saves
   * the record and switches the document mode when the patch touches `isDark`.
   */
  restore: (patch: ThemePatch) => void
  /**
   * Called when a history write lands nowhere (quota exhaustion, private mode, a store
   * that throws). Routes to the library's `lastError` strip — never the saved chip,
   * which would lie "Not saved" about a record that *did* save (fix A, 2026-10-26
   * round). A history write that failed while the record save succeeded is visible, not
   * silent.
   */
  reportRefused?: () => void
}

export interface HistoryController {
  /**
   * Record one commit. While a gesture is open this only remembers the new state — the
   * step is pushed when the gesture ends, spanning the whole drag. A commit that arrives
   * after a missed `pointerup` closes the stale gesture first instead of joining it.
   */
  recordEdit: (before: PatchableState, after: PatchableState) => void
  /** Open a gesture anchored at the current state. */
  beginGesture: () => void
  /** Close the open gesture, pushing its accumulated patch as one step. */
  endGesture: () => void
  undo: () => void
  redo: () => void
  /** True while an earlier step exists for the *open* theme. */
  canUndo: boolean
  /** True while an undone step is still redoable for the *open* theme. */
  canRedo: boolean
  /** Drop the current theme's history, immediately on disk. */
  clearHistory: () => void
  /**
   * Forget one theme's history for good: cancel its armed write, drop its pending
   * payload, and remove its stored key. The delete path calls this after removing the
   * record, so the 400 ms debounce can never re-write a history whose record is gone
   * (that orphan was invisible to the catalogue and grew without bound).
   */
  forgetTheme: (id: string) => void
}

/** Ctrl/Cmd+Z etc. must be left to the browser while the user is typing. */
function isTextEntry(element: Element | null): boolean {
  if (element === null) return false
  const tag = element.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return (
    (element as HTMLElement).isContentEditable === true ||
    element.closest('[contenteditable]') !== null
  )
}

/**
 * A patch that can actually be applied. `invertPatch` already tolerates junk shapes; this
 * additionally rejects an empty patch (an undo that would move the cursor and change
 * nothing) and an entry whose value is `undefined` — the one JavaScript value JSON cannot
 * carry, so it can only come from a hand-edited or foreign step, and writing it into a
 * palette would put `undefined` in a colour slot.
 */
function isApplicable(patch: ThemePatch): boolean {
  const entries: unknown = (patch as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries) || entries.length === 0) return false
  return entries.every((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false
    const candidate = entry as { path?: unknown; before?: unknown; after?: unknown }
    return (
      typeof candidate.path === 'string' &&
      candidate.before !== undefined &&
      candidate.after !== undefined
    )
  })
}

/** The step backwards, or null when the step cannot be applied backwards. */
function invertibleStep(step: ThemePatch): ThemePatch | null {
  const inverse = invertPatch(step)
  return isApplicable(inverse) ? inverse : null
}

/** The stack with one step removed, cursor adjusted if the step sat before it. */
function dropStepAt(history: History, index: number): History {
  const steps = history.steps.filter((_, i) => i !== index)
  const cursor = index < history.cursor ? history.cursor - 1 : history.cursor
  return { cursor: Math.max(0, Math.min(cursor, steps.length)), steps }
}

/**
 * Drop every step that cannot be undone, keeping the cursor pointing at the same applied
 * state: a step that sat before the cursor is gone from the count, one after it is only a
 * redo that no longer exists.
 *
 * This is the load-time repair as well as the pre-undo guard, so `canUndo` never promises
 * an undo that would do nothing.
 */
function repaired(history: History): { history: History; changed: boolean } {
  const rawCursor = Number.isFinite(history.cursor) ? history.cursor : 0
  const cursor = Math.max(0, Math.min(Math.trunc(rawCursor), history.steps.length))

  const steps: ThemePatch[] = []
  let next = cursor
  let changed = false
  history.steps.forEach((step, index) => {
    if (invertibleStep(step) === null) {
      changed = true
      if (index < cursor) next -= 1
      return
    }
    steps.push(step)
  })

  if (!changed) return { history, changed: false }
  return { history: { cursor: Math.max(0, next), steps }, changed: true }
}

export function useHistory({
  themeId,
  snapshot,
  restore,
  reportRefused,
}: HistoryOptions): HistoryController {
  const [, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const historyRef = useRef<History>(emptyHistory())
  const idRef = useRef<string | null>(null)

  // The gesture in flight: the state at `pointerdown`, and the state after the latest
  // commit inside it. `at` is the gesture's start, so its step keeps its place in time
  // for the 500 ms fallback coalescer.
  const gestureRef = useRef<{ before: PatchableState; after: PatchableState | null; at: number } | null>(
    null
  )

  const pendingWrite = useRef<{ id: string; history: History } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** One write with its refusal surfaced through the library's `lastError` strip. */
  const writeNow = useCallback(
    (id: string, history: History) => {
      if (writeHistory(id, history) !== 'ok') reportRefused?.()
    },
    [reportRefused]
  )

  const flushWrite = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingWrite.current
    pendingWrite.current = null
    if (pending !== null) writeNow(pending.id, pending.history)
  }, [writeNow])

  const queueWrite = useCallback((history: History) => {
    const id = idRef.current
    if (id === null) return
    pendingWrite.current = { id, history }
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      const pending = pendingWrite.current
      pendingWrite.current = null
      if (pending !== null) writeNow(pending.id, pending.history)
    }, HISTORY_WRITE_DEBOUNCE_MS)
  }, [writeNow])

  /**
   * Forget one theme's history: cancel the write waiting for it, drop the payload, and
   * clear whatever key it still holds. Called by the delete path right after the record
   * is removed — once the key is gone nothing in this hook may put bytes back under it.
   */
  const forgetTheme = useCallback((id: string) => {
    if (pendingWrite.current !== null && pendingWrite.current.id === id) {
      pendingWrite.current = null
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    removeHistory(id)
  }, [])

  /** Adopt a stack as the current one and persist it. */
  const adopt = useCallback(
    (history: History) => {
      historyRef.current = history
      bump()
      queueWrite(history)
    },
    [bump, queueWrite]
  )

  /** Push one step at the cursor. */
  const pushStep = useCallback(
    (patch: ThemePatch) => {
      const next = recordStep(historyRef.current, patch)
      if (next === historyRef.current) return
      adopt(next)
    },
    [adopt]
  )

  /**
   * Close the gesture in flight, pushing everything it accumulated as ONE step. A gesture
   * that produced no commit — a click, a cancelled drag — contributes nothing, which is
   * why an unrelated pointerdown can never consume an undo slot.
   */
  const endGesture = useCallback(() => {
    const gesture = gestureRef.current
    gestureRef.current = null
    if (gesture === null || gesture.after === null) return

    const patch = diffThemes(gesture.before, gesture.after, gesture.at)
    if (patch.entries.length === 0) return
    pushStep(patch)
  }, [pushStep])

  const onGestureBegin = useCallback(() => {
    gestureRef.current = { before: snapshot(), after: null, at: Date.now() }
  }, [snapshot])

  const boundary = useGestureBoundary(onGestureBegin, endGesture)

  const beginGesture = boundary.begin

  const recordEdit = useCallback(
    (before: PatchableState, after: PatchableState) => {
      // A commit with no pointer held while a gesture is open means the `pointerup` was
      // lost. Close that gesture (its edits are real) so this commit starts its own step
      // instead of being swallowed by an anchor from an earlier drag.
      if (gestureRef.current !== null && !boundary.isPressed()) endGesture()

      const gesture = gestureRef.current
      if (gesture !== null) {
        gesture.after = after
        return
      }

      const patch = diffThemes(before, after, Date.now())
      if (patch.entries.length === 0) return
      pushStep(patch)
    },
    [boundary, endGesture, pushStep]
  )

  const undo = useCallback(() => {
    // A drag in flight is a real edit that has not become a step yet; close it before
    // stepping back so the undo does not skip it.
    endGesture()

    let working = repaired(historyRef.current).history
    let dropped = working !== historyRef.current
    let stepped = undoStep(working)

    // A step that cannot be inverted is not an undo, it is a broken cursor: drop it and
    // try the one before, rather than moving the cursor onto a patch that cannot apply.
    while (stepped !== null && !isApplicable(stepped.patch)) {
      working = dropStepAt(working, working.cursor - 1)
      stepped = undoStep(working)
      dropped = true
    }

    if (stepped === null) {
      if (dropped) adopt(working)
      return
    }
    restore(stepped.patch)
    adopt(stepped.history)
  }, [adopt, endGesture, restore])

  const redo = useCallback(() => {
    endGesture()

    let working = repaired(historyRef.current).history
    let dropped = working !== historyRef.current
    let stepped = redoStep(working)

    while (stepped !== null && !isApplicable(stepped.patch)) {
      working = dropStepAt(working, working.cursor)
      stepped = redoStep(working)
      dropped = true
    }

    if (stepped === null) {
      if (dropped) adopt(working)
      return
    }
    restore(stepped.patch)
    adopt(stepped.history)
  }, [adopt, endGesture, restore])

  const clearHistory = useCallback(() => {
    // Clear *after* folding a gesture in would race its queued write; end it, cancel the
    // queued write, then put the empty stack on disk before returning.
    endGesture()
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pendingWrite.current = null
    historyRef.current = emptyHistory()
    bump()
    const id = idRef.current
    if (id !== null) writeNow(id, emptyHistory())
  }, [bump, endGesture, writeNow])

  // Load the open theme's stack. A read, never a write: the history that was on disk is
  // the history that comes back, with the same cursor, and no step is created here.
  useEffect(() => {
    // A stack swap invalidates any gesture anchor: its `before` belongs to the previous
    // theme, so folding it in would record an edit that never happened on this one.
    gestureRef.current = null
    flushWrite()

    if (themeId === null) {
      idRef.current = null
      historyRef.current = emptyHistory()
      bump()
      return
    }

    idRef.current = themeId
    const loaded = readHistory(themeId)
    const repair = repaired(loaded)
    historyRef.current = repair.history
    bump()
    // Only when a step had to be dropped: a healthy history is not rewritten by a reload.
    if (repair.changed) writeNow(themeId, repair.history)
  }, [themeId, bump, flushWrite, writeNow])

  // A closing tab must not lose the last gesture's step write.
  useEffect(() => {
    const onPageHide = () => flushWrite()
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      flushWrite()
    }
  }, [flushWrite])

  // Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y (design §9.3). Left to the browser while a
  // text field, select or contenteditable holds focus: no `preventDefault` there, so the
  // field's own native undo keeps working and the theme is not silently rewound under a
  // half-typed hex value.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const backwards = key === 'z' && !event.shiftKey
      const forwards = (key === 'z' && event.shiftKey) || key === 'y'
      if (!backwards && !forwards) return
      if (isTextEntry(document.activeElement)) return
      event.preventDefault()
      if (backwards) undo()
      else redo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  const history = historyRef.current
  return {
    recordEdit,
    beginGesture,
    endGesture,
    undo,
    redo,
    canUndo: history.cursor > 0,
    canRedo: history.cursor < history.steps.length,
    clearHistory,
    forgetTheme,
  }
}
