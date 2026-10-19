// Colour maths: contrast repair, HSL <-> hex, and the small clamps the sliders use.
//
// The scheme tables used to live here; they moved to `src/lib/colors/schemes.ts` in
// Phase C, which is where the covariant-offset contract is enforced (see the note at the
// top of that file). This module now holds no scheme knowledge.

import Color from 'color'

export function adjustCommentColor(
  commentColor: string,
  backgroundColor: string,
  minContrast: number,
  maxContrast: number
): string {
  const bgColor = Color(backgroundColor)
  let comment = Color(commentColor)
  const bgLuminosity = bgColor.luminosity()
  const isDarkTheme = bgColor.isDark()
  const maxSaturation = isDarkTheme ? 15 : 35
  // Adjust the comment color until it meets our criteria
  while (true) {
    const contrast = comment.contrast(bgColor)
    const luminanceRatio =
      Math.abs(comment.luminosity() - bgLuminosity) /
      Math.max(comment.luminosity(), bgLuminosity)

    if (isDarkTheme) {
      // For dark themes, we want to darken the comment color
      if (contrast < minContrast || contrast > maxContrast) {
        if (contrast > maxContrast) {
          comment = comment.darken(0.2)
          comment = comment.desaturate(0.5)
        } else if (contrast < minContrast) {
          comment = comment.lighten(0.2)
          comment = comment.saturate(0.2)
        }
      } else {
        break
      }
    } else {
      // For light themes, keep the current behavior
      if (contrast < minContrast || contrast > maxContrast) {
        if (contrast < minContrast) {
          comment = comment.darken(0.2)
          comment = comment.saturate(0.2)
        } else if (contrast > maxContrast) {
          comment = comment.lighten(0.2)
          comment = comment.desaturate(0.5)
        }
      } else {
        break
      }
    }
    // Prevent infinite loop and ensure the color doesn't get too dark or too light
    if (isDarkTheme && comment.luminosity() < 0.05) break
    if (!isDarkTheme && comment.luminosity() > 0.95) break
  }

  // Ensure maxSaturation
  while (Color(comment).hsl().saturationl() > maxSaturation) {
    comment = comment.desaturate(0.01)
  }

  // The loop above can bail out through its luminosity guard while the result is still
  // *below* `minContrast` — measured: #2D2D30 becomes #36363A, contrast ≈1.4 against a
  // 3.0 floor, because one `lighten` step still leaves luminosity under 0.05. The
  // saturation cap is cosmetic; an unreadable comment is a bug, so the floor wins.
  const result = comment.hex()
  if (Color(result).contrast(bgColor) < minContrast) {
    return ensureReadability(result, backgroundColor, minContrast)
  }

  return result
}

export function ensureReadability(
  foreground: string,
  background: string,
  minContrast = 5.5
): string {
  let color = Color(foreground)
  const bgColor = Color(background)
  let iterations = 0
  const maxIterations = 100

  // Move *away from the background*: darken on a light background, lighten on a dark
  // one. The direction used to be taken from the foreground's own `isLight()`, which
  // for a light background means a mid-dark foreground gets lightened — straight
  // toward the background — so the loop oscillated around the isLight threshold and
  // gave up after 100 iterations. Measured before the fix: 617 of 3360 light-mode UI
  // keys ended below their floor.
  const goDarker = bgColor.isLight()

  // Judge the colour that is actually *returned*, not the internal float: `hex()`
  // rounds each channel to 8 bits, which can push a colour that just met the floor back
  // under it (measured: internal 5.5001 → returned 5.4857, 79 of 18355 link
  // assertions). Comparing the rounded value makes the floor a guarantee rather than a
  // near-miss, at the cost of occasionally overshooting by one 5% step.
  const meetsFloor = (c: Color) => Color(c.hex()).contrast(bgColor) >= minContrast

  while (!meetsFloor(color) && iterations < maxIterations) {
    color = goDarker
      ? color.darken(0.05).saturate(0.05)
      : color.lighten(0.05).saturate(0.05)
    iterations++
  }

  // Relative darken/lighten converge slowly for some inputs and can stall short of the
  // floor. Fall back to whichever pole actually maximises contrast, so the floor is met
  // wherever the background physically allows it.
  if (!meetsFloor(color)) {
    const black = Color('#000000')
    const white = Color('#FFFFFF')
    const best =
      black.contrast(bgColor) >= white.contrast(bgColor) ? black : white
    if (best.contrast(bgColor) > Color(color.hex()).contrast(bgColor)) color = best
  }

  return color.hex()
}

export function hexToHSL(hex: string): { h: number; s: number; l: number } {
  let r = 0,
    g = 0,
    b = 0
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16)
    g = parseInt(hex[2] + hex[2], 16)
    b = parseInt(hex[3] + hex[3], 16)
  } else if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16)
    g = parseInt(hex.slice(3, 5), 16)
    b = parseInt(hex.slice(5, 7), 16)
  }

  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0,
    s,
    l = (max + min) / 2

  if (max === min) {
    h = s = 0
  } else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }

  return { h: h * 360, s: s * 100, l: l * 100 }
}

export function hslToHex(h: number, s: number, l: number): string {
  h /= 360
  s /= 100
  l /= 100
  let r, g, b

  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function adjustHue(hue: number): number {
  return (hue + 360) % 360
}

export function adjustSaturation(saturation: number): number {
  return Math.max(0, Math.min(100, saturation))
}

export function adjustLightness(lightness: number): number {
  return Math.max(0, Math.min(100, lightness))
}

export function isHexColor(color: string): boolean {
  return /^#[A-Fa-f0-9]{6}$/.test(color)
}

// The formats the picker can show a value in (mobile, spec §3.5: a dropdown in the hex row).
export type ColorFormat = 'hex' | 'rgb' | 'hsl'

export const COLOR_FORMATS: readonly ColorFormat[] = ['hex', 'rgb', 'hsl']

export const isColorFormat = (value: unknown): value is ColorFormat =>
  typeof value === 'string' && (COLOR_FORMATS as readonly string[]).includes(value)

/** The colour written in the given format, for display and for the picker's own input. */
export function formatColorValue(color: string, format: ColorFormat): string {
  try {
    const parsed = Color(color)
    if (format === 'rgb') return parsed.rgb().string()
    if (format === 'hsl') return parsed.hsl().round().string()
    return parsed.hex().toUpperCase()
  } catch {
    return color
  }
}

// What a *complete* value of each format looks like. The `color` library happily parses
// prefixes (`rgb(9`), so the shape has to be checked before a half-typed value is offered to it.
const FORMAT_SHAPE: Record<ColorFormat, RegExp> = {
  hex: /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i,
  rgb: /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i,
  hsl: /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*\)$/i,
}

/**
 * The colour a typed value means, as hex — or null while it is not yet a complete value.
 * Hex is accepted whatever format the field shows, so pasting hex into an `rgb()` field works.
 */
export function parseColorValue(value: string, format: ColorFormat): string | null {
  const trimmed = value.trim()
  const complete =
    FORMAT_SHAPE[format].test(trimmed) || FORMAT_SHAPE.hex.test(trimmed)
  if (!complete) return null
  try {
    return Color(trimmed).hex()
  } catch {
    return null
  }
}
