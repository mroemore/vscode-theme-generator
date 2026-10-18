import React from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import Color from 'color'
import { Lock, Unlock } from 'lucide-react'

import { Button } from './ui/button'
import {
  SourceLinkButton,
  contrastOn,
  highlightStyle,
  tintOn,
} from './ColorLinkControls'
import type { UIColors, SyntaxColors } from '@/lib/types/colors'

// The theme-colour panel. Source side of linking: every pill's Link button starts a
// placement, and hovering one cross-highlights its targets in the syntax and ANSI
// panels. Copy is gone from all three panels — the hex field under the picker replaced
// it, and the two link affordances needed the space.

interface ColorListProps {
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
    hoveredSource,
    linkingSource,
    setHoveredSource,
  } = useTheme()

  const colorList = isThemeColors ? colors : syntaxColors

  const displayColors: UIColors | SyntaxColors = isThemeColors
    ? colorList
    : { ...colorList, selector: (colorList as SyntaxColors).selector }

  const keys = Object.keys(displayColors)
  const allLocked = keys.length > 0 && keys.every((key) => lockedColors.has(key))
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
        <div className="flex gap-2">
          <Button
            size={'sm'}
            onClick={() => setColorLocks(keys, false)}
            disabled={noneLocked}
            title="Unlock every colour in this panel"
          >
            Unlock All
          </Button>
          {/* Theme colours only: syntax and ANSI deliberately have no Lock All. */}
          {isThemeColors && (
            <Button
              size={'sm'}
              onClick={() => setColorLocks(keys, true)}
              disabled={allLocked}
              title="Lock every colour in this panel"
            >
              Lock All
            </Button>
          )}
        </div>
      </div>
      {linkingSource && (
        <p className="text-xs mb-3" style={{ color: colors.FG2 }}>
          Linking from <strong>{linkingSource}</strong> — pick a syntax or ANSI colour
          to link it to. Escape cancels.
        </p>
      )}
      <div className="grid grid-rows-8 grid-flow-col-dense auto-cols-fr gap-2">
        {Object.entries(displayColors).map(([key, value]) => (
          <div key={key} className="relative">
            <div
              className="h-8 cursor-pointer flex items-center justify-between px-2 rounded-md shadow-sm"
              style={{
                backgroundColor: getDisplayColor(key, value as string),
                ...highlightStyle(hoveredSource === key, value as string),
              }}
              onClick={() => setActiveColor(key)}
              onMouseEnter={
                isThemeColors ? () => setHoveredSource(key as never) : undefined
              }
              onMouseLeave={isThemeColors ? () => setHoveredSource(null) : undefined}
            >
              <span
                className="text-xs font-semibold truncate"
                style={{ color: contrastOn(value as string) }}
              >
                {key}
              </span>
              <div className="flex gap-1">
                {isThemeColors && (
                  <SourceLinkButton colorKey={key} value={value as string} />
                )}
                <Button
                  className="h-5 w-5"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleColorLock(key)
                  }}
                  aria-label={
                    lockedColors.has(key) ? `Unlock ${key}` : `Lock ${key}`
                  }
                  style={{ backgroundColor: tintOn(value as string) }}
                >
                  {lockedColors.has(key) ? (
                    <Lock size={16} color={contrastOn(value as string)} />
                  ) : (
                    <Unlock size={16} color={contrastOn(value as string)} />
                  )}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ColorList
