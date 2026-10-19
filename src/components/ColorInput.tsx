import {
  formatColorValue,
  isHexColor,
  parseColorValue,
  type ColorFormat,
} from '@/lib/utils/colorUtils'
import React, { useEffect, useState } from 'react'
import { Input } from './ui/input'

interface ColorInputProps {
  color: string
  onValidColorInput: (color: string) => void
  /**
   * Mobile only: the format the field shows its value in, chosen from the dropdown in the flat
   * picker's hex row (spec §3.5). Omitted on desktop, where the field stays a plain hex entry —
   * passing no format keeps the desktop behaviour byte-identical, including the raw value it
   * hands back for a typed hex.
   */
  format?: ColorFormat
}

const ColorInput: React.FC<ColorInputProps> = ({
  color,
  onValidColorInput,
  format,
}) => {
  const [value, setValue] = useState(
    format ? formatColorValue(color, format) : color
  )

  useEffect(() => {
    setValue(format ? formatColorValue(color, format) : color)
  }, [color, format])

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const typed = e.target.value

    setValue(typed)
    if (!format) {
      if (isHexColor(typed)) onValidColorInput(typed)
      return
    }
    // A formatted field commits the colour a *complete* value means, so the theme always
    // receives hex however the value was written.
    const parsed = parseColorValue(typed, format)
    if (parsed !== null) onValidColorInput(parsed)
  }

  return <Input type="text" value={value} onChange={handleInput} />
}

export default ColorInput
