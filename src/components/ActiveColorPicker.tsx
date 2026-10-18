import React from 'react'
import { useTheme } from '../contexts/ThemeContext'
import ColorInput from './ColorInput'
import ColorPicker from './ColorPicker'

interface ActiveColorPickerProps {
  /**
   * Mobile: the picker module in the flat language (spec §3.5) — the hex row above the picker with
   * the colour name drawn over its right-hand end, no rounded corners, and the picker flush to the
   * field. The desktop picker keeps its stock rounded look (spec §6.3 is still open on that).
   */
  flat?: boolean
}

const ActiveColorPicker: React.FC<ActiveColorPickerProps> = ({ flat = false }) => {
  const { activeColor, colors, syntaxColors, ansiColors, handleColorChange } =
    useTheme()

  if (!activeColor) return null

  let currentColor: string
  if (activeColor.startsWith('ansi')) {
    const ansiKey = activeColor.slice(4) as keyof typeof ansiColors
    currentColor = ansiColors[ansiKey]
  } else if (activeColor in colors) {
    currentColor = colors[activeColor as keyof typeof colors]
  } else {
    currentColor = syntaxColors[activeColor as keyof typeof syntaxColors]
  }

  const picker = (
    <ColorPicker
      color={currentColor}
      onChange={(newColor) => handleColorChange(activeColor, newColor)}
    />
  )
  const input = (
    <ColorInput
      color={currentColor}
      onValidColorInput={(newColor) => handleColorChange(activeColor, newColor)}
    />
  )

  if (flat) {
    return (
      <div className="flat-picker">
        <div className="flat-picker__hex">
          {input}
          <span className="flat-picker__label first-letter:uppercase">
            {activeColor}
          </span>
        </div>
        {picker}
      </div>
    )
  }

  return (
    <div className="mb-4 space-y-2">
      {picker}
      {input}
      <h3 className="text-lg font-semibold text-center first-letter:uppercase">
        {activeColor}
      </h3>
    </div>
  )
}

export default ActiveColorPicker
