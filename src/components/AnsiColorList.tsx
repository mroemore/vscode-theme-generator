import React from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { Button } from './ui/button'
import {
  TargetLinkControls,
  highlightStyle,
} from './ColorLinkControls'
import { ansiTargetId } from '@/lib/colors/links'

// The ANSI panel. Target side of linking: no lock UI (theme colours have locks, the
// terminal palette does not), but every row is linkable and behaves exactly like a
// syntax row while a placement is open.

const AnsiColorList: React.FC = () => {
  const {
    ansiColors,
    setActiveColor,
    colors,
    links,
    linkingSource,
    linkTarget,
    hoveredSource,
  } = useTheme()

  const colorPairs = [
    ['Black', 'BrightBlack'],
    ['Red', 'BrightRed'],
    ['Green', 'BrightGreen'],
    ['Yellow', 'BrightYellow'],
    ['Blue', 'BrightBlue'],
    ['Magenta', 'BrightMagenta'],
    ['Cyan', 'BrightCyan'],
    ['White', 'BrightWhite'],
  ]

  const ColorBox = ({
    colorKey,
    colorValue,
  }: {
    colorKey: string
    colorValue: string
  }) => {
    const targetId = ansiTargetId(colorKey)
    const link = links[targetId]
    const placing = linkingSource !== null
    const crossHighlighted =
      hoveredSource !== null && link?.source === hoveredSource

    return (
      <div
        className="w-full h-7 flex items-center justify-between px-2 cursor-pointer"
        style={{
          borderBottom: '1px solid',
          borderBottomColor: colorValue,
          ...highlightStyle(placing || crossHighlighted, colorValue),
        }}
        onClick={() => (placing ? linkTarget(targetId) : setActiveColor(targetId))}
        title={placing ? `Link to ${linkingSource}` : undefined}
      >
        <span className="text-xs font-semibold truncate" style={{ color: colorValue }}>
          {colorKey}
        </span>
        <TargetLinkControls targetId={targetId} value={colorValue} />
      </div>
    )
  }

  return (
    <div
      style={{ backgroundColor: colors.BG1 }}
      className="p-4 border-border border rounded-lg shadow-md"
    >
      <h2 className="text-xl font-semibold mb-2">ANSI Colors</h2>
      <div className="grid grid-cols-1 gap-4">
        {colorPairs.map(([color, brightColor]) => (
          <div key={color} className="flex gap-2">
            <div className="w-1/2">
              <ColorBox
                colorKey={color}
                colorValue={ansiColors[color as keyof typeof ansiColors]}
              />
            </div>
            <div className="w-1/2">
              <ColorBox
                colorKey={brightColor}
                colorValue={ansiColors[brightColor as keyof typeof ansiColors]}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default AnsiColorList
