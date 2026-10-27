import React from 'react'
import { IconArrowBackUp, IconArrowForwardUp } from '@tabler/icons-react'

// The undo/redo pair's glyphs are Tabler's own `arrow-back-up` / `arrow-forward-up`,
// taken from `@tabler/icons-react` rather than copied by hand: a hand-copied path
// drifts from the library's, and Tabler's 2-unit stroke is what makes the pair sit at
// the same weight as the pin glyph beside it (a 1.5 stroke reads hairline next to it).
//
// Both surfaces (the desktop header row and the mobile module's `actions`) draw the same
// two shapes, so the pair is defined once here rather than copied into each.

export const UndoIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <IconArrowBackUp size={size} aria-hidden />
)

export const RedoIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <IconArrowForwardUp size={size} aria-hidden />
)
