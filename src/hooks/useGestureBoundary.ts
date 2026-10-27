// Gesture boundaries for the undo history (design §9.2).
//
// A slider drag fires a commit per pointer move. Recording each one would need a dozen
// Ctrl+Z presses to undo one drag, so the history treats everything between a
// `pointerdown` and its matching `pointerup` as ONE step. This hook supplies only those
// boundaries: the history captures the pre-gesture state on `begin` and folds the
// accumulated patch into a single step on `end`.
//
// ── Why `window`, and why capture ────────────────────────────────────────────
// The listeners sit on `window` in the capture phase, so a handler that calls
// `stopPropagation` (the colour picker does) cannot hide the end of a drag. A release
// anywhere inside the window — over a portal, a tooltip or the scrollbar — is the same
// window's `pointerup`, so it closes the gesture too.
//
// ── Leaks ────────────────────────────────────────────────────────────────────
// A `pointerup` is not guaranteed: the pointer can leave the window before release, the
// tab can be switched, a touch can be cancelled, or the browser can drop the event while
// a native dialog is open. `pointercancel`, `blur` and a hidden document all close the
// gesture, and `isPressed()` lets the history refuse to swallow a later commit into a
// gesture whose release it never saw.
//
// A second `pointerdown` while a gesture is open means the previous one ended without us
// hearing about it. It is closed (its edits are real, so they become a step) and a fresh
// anchor is taken, rather than letting two drags merge into one undo.

import { useCallback, useEffect, useMemo, useRef } from 'react'

export interface GestureBoundary {
  /** Open a gesture anchored now. A second call closes the one that was open. */
  begin: () => void
  /** Close the open gesture. Safe to call when none is open. */
  end: () => void
  /** Whether a gesture is currently open. */
  isActive: () => boolean
  /** Whether a pointer button is held, as far as the window has told us. */
  isPressed: () => boolean
}

export function useGestureBoundary(onBegin: () => void, onEnd: () => void): GestureBoundary {
  const activeRef = useRef(false)
  const pressedRef = useRef(false)

  // The handlers are read through refs so the window listeners can be registered once,
  // on mount, instead of being torn down and rebuilt on every provider render — a
  // re-registration in the middle of a drag would be a window in which a `pointerup`
  // could be missed.
  const beginHandler = useRef(onBegin)
  const endHandler = useRef(onEnd)
  beginHandler.current = onBegin
  endHandler.current = onEnd

  const begin = useCallback(() => {
    if (activeRef.current) endHandler.current()
    activeRef.current = true
    beginHandler.current()
  }, [])

  const end = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    endHandler.current()
  }, [])

  const isActive = useCallback(() => activeRef.current, [])
  const isPressed = useCallback(() => pressedRef.current, [])

  useEffect(() => {
    const onPointerDown = () => {
      pressedRef.current = true
      begin()
    }
    const onPointerEnd = () => {
      pressedRef.current = false
      end()
    }
    // A blurred window cannot deliver a `pointerup` to us: whatever is open was released
    // (or cancelled) somewhere we cannot see.
    const onBlur = () => {
      pressedRef.current = false
      end()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') onBlur()
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerEnd, true)
    window.addEventListener('pointercancel', onPointerEnd, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerEnd, true)
      window.removeEventListener('pointercancel', onPointerEnd, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      // Flush rather than drop: an unmount mid-drag should not lose the edits.
      end()
    }
  }, [begin, end])

  return useMemo(
    () => ({ begin, end, isActive, isPressed }),
    [begin, end, isActive, isPressed]
  )
}
