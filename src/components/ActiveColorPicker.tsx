import React from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { useTheme } from '../contexts/ThemeContext'
import { COLOR_FORMATS, type ColorFormat } from '../lib/utils/colorUtils'
import ColorInput from './ColorInput'
import ColorPicker from './ColorPicker'

interface ActiveColorPickerProps {
  /**
   * Mobile: the picker module in the flat language (spec §3.5) — the hex row above the picker with
   * the colour name drawn over its right-hand end, no rounded corners, and the picker flush to the
   * field. The desktop picker keeps its stock rounded look (spec §6.3 is still open on that).
   */
  flat?: boolean
  /**
   * Mobile: the format the value is written in (spec §3.5). The dropdown that sets it lives in the
   * hex row; it applies to this picker's own value only — the theme keeps storing hex.
   */
  format?: ColorFormat
  onFormatChange?: (format: ColorFormat) => void
  /**
   * Mobile: the picker's original, full-bleed form (the pre-M8 374×240 box) rather than the
   * compact 250×160 one. Toggled from the title bar, left of the pin (spec §3.5).
   */
  large?: boolean
}

const ActiveColorPicker: React.FC<ActiveColorPickerProps> = ({
  flat = false,
  format,
  onFormatChange,
  large = false,
}) => {
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
      format={flat ? format : undefined}
    />
  )

  if (flat) {
    return (
      <div className={`flat-picker${large ? ' flat-picker--large' : ''}`}>
        <div className="flat-picker__hex">
          <span className="flat-picker__field">
            {input}
            <span className="flat-picker__label first-letter:uppercase">
              {activeColor}
            </span>
          </span>
          <span className="flat-picker__format-wrap">
            <select
              className="flat-picker__format"
              data-format-select="true"
              aria-label="Colour output format"
              value={format ?? 'hex'}
              onChange={(e) => onFormatChange?.(e.target.value as ColorFormat)}
            >
              {COLOR_FORMATS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <IconChevronDown size={12} />
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
