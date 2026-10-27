import React from 'react'

// The undo/redo pair's glyphs, inlined the way the catalogue inlines its row icons
// (`ThemeLibrary`): Tabler's outline paths as plain `<svg>`, no icon dependency. Both
// surfaces (the desktop header row and the mobile module's `actions`) draw the same two
// shapes, so the paths live here once rather than being copied into each.
//
// Tabler's arrow-back-up / arrow-forward-up, on the upstream 24-unit grid; `strokeWidth`
// is 1.5 and the caps are round, which is what makes them read as Tabler rather than as
// chunky arrows.

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
} as const

export const UndoIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <svg {...iconProps} width={size} height={size}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
  </svg>
)

export const RedoIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <svg {...iconProps} width={size} height={size}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
  </svg>
)
