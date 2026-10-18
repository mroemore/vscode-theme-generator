import React from 'react'
import Color from 'color'
import { Lock, Unlock } from 'lucide-react'
import { Button } from './ui/button'

import { useTheme } from '@/contexts/ThemeContext'
import {
  TargetLinkControls,
  contrastOn,
  highlightStyle,
  tintOn,
} from './ColorLinkControls'

import type { SyntaxColors, UIColors } from '@/lib/types/colors'

// The syntax panel. Target side of linking: while a placement is open every row is
// outlined and clicking links instead of selecting, so the mode is always one click
// away from being used and Escape away from being left.

type ColorListProps = {
  title: string
  isThemeColors: boolean
}

const ColorList: React.FC<ColorListProps> = ({ title, isThemeColors }) => {
  const {
    colors,
    syntaxColors,
    lockedColors,
    toggleColorLock,
    setColorLocks,
    setActiveColor,
    links,
    linkingSource,
    linkTarget,
    hoveredSource,
  } = useTheme()

  const colorList = isThemeColors ? colors : syntaxColors

  const displayColors: UIColors | SyntaxColors = isThemeColors
    ? colorList
    : { ...colorList, selector: (colorList as SyntaxColors).selector }

  const keys = Object.keys(displayColors)
  const noneLocked = keys.every((key) => !lockedColors.has(key))

  const getDisplayColor = (key: string, value: string) => {
    try {
      return Color(value).string()
    } catch (error) {
      console.error(`Error processing color for ${key}:`, error)
      return value
    }
  }

  return (
    <div
      style={{ backgroundColor: colors.BG1 }}
      className="p-4 border-border border rounded-lg shadow-md"
    >
      <div className="flex justify-between items-center gap-2">
        <h2 className="text-xl font-semibold mb-5">{title}</h2>

        <Button
          size={'sm'}
          onClick={() => setColorLocks(keys, false)}
          disabled={noneLocked}
          title="Unlock every colour in this panel"
        >
          Unlock All
        </Button>
      </div>
      <div className="grid grid-rows-4 grid-flow-col auto-cols-auto gap-3 w-full">
        {Object.entries(displayColors).map(([key, value]) => {
          const link = links[key]
          const placing = linkingSource !== null
          const crossHighlighted =
            hoveredSource !== null && link?.source === hoveredSource

          return (
            <div
              key={key}
              onClick={() => (placing ? linkTarget(key) : setActiveColor(key))}
              title={placing ? `Link to ${linkingSource}` : undefined}
              style={{
                borderBottom: '1px solid',
                borderBottomColor: getDisplayColor(key, value),
                ...highlightStyle(placing || crossHighlighted, value),
              }}
              className="cursor-pointer"
            >
              <div className="w-full cursor-pointer flex items-center justify-between">
                <h3
                  className="text-sm truncate first-letter:uppercase pt-1"
                  style={{ color: getDisplayColor(key, value) }}
                >
                  {key}
                </h3>
                <div className="flex items-center">
                  <TargetLinkControls targetId={key} value={value} />
                  <Button
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleColorLock(key)
                    }}
                    style={{ backgroundColor: tintOn(value) }}
                  >
                    {lockedColors.has(key) ? (
                      <Lock size={16} color={contrastOn(value)} />
                    ) : (
                      <Unlock size={16} color={contrastOn(value)} />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ColorList
