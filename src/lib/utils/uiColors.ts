import Color from 'color'

import { randomInteger } from '@/lib/utils/math'
import { generateSchemeColors } from './colorUtils'
import { ColorScheme } from '@/lib/types/colors'
import type { UIColors, ThemeGenerationOptions } from '@/lib/types/colors'
import { UI_KEYS, uiSpec } from '@/lib/colors/ui'
import { applyReadability, resolveHue, resolveLightness } from '@/lib/colors/spec'

// Generation is driven row-by-row from `uiSpec`. Two invariants hold the output stable:
//
//  1. Rows are evaluated in `UI_KEYS` order, which is the order the original object
//     literal used. Every row's draws extend the shared `Math.random` sequence.
//  2. Within a row the hue index is drawn *before* the lightness expression, mirroring
//     the left-to-right argument evaluation of the original `generateColor(...)` call.
//
// A key already supplied in `initialColors` short-circuits before drawing anything —
// the original used `initialColors.X || generateColor(...)`, so an overridden key
// consumed no randomness. `.tmp_files/parity.ts` fails if either invariant drifts.
export function generateThemeColors(
  options: ThemeGenerationOptions,
  initialColors: Partial<UIColors> = {},
  forceRegenerate: boolean = false
): {
  colors: UIColors
  schemeHues: number[]
  scheme: ColorScheme
} {
  const {
    isDark,
    baseHue = Math.random() * 360,
    uiSaturation = isDark ? randomInteger(15, 45) : randomInteger(45, 75),
    scheme = ColorScheme.Analogous,
    few,
  } = options

  const schemeHues = generateSchemeColors(baseHue, scheme)

  const bgBase = isDark ? randomInteger(0, 15) : randomInteger(85, 100)
  const fgBase = isDark ? randomInteger(85, 100) : randomInteger(0, 15)
  const mode = isDark ? 'dark' : 'light'

  const generateColor = (
    hue: number,
    saturation: number,
    lightness: number
  ) => {
    if (!forceRegenerate) {
      const randomHueShift = Math.random() * 10 - 5
      const randomSaturationShift = Math.random() * 20 - 10
      const randomLightnessShift = Math.random() * 10 - 5

      hue = (hue + randomHueShift + 360) % 360
      saturation = Math.max(
        2,
        Math.min(100, saturation + randomSaturationShift)
      )
      lightness = Math.max(0, Math.min(100, lightness + randomLightnessShift))
    }

    const color = Color.hsl(hue, saturation, lightness).hex()
    return color
  }

  const colors = {} as UIColors

  for (const key of UI_KEYS) {
    const spec = uiSpec[key]

    const provided = initialColors[key]
    if (provided) {
      colors[key] = provided
      continue
    }

    const hue = resolveHue(spec.hue, schemeHues)
    const lightness = resolveLightness(spec.lightness[mode], { bgBase, fgBase })
    const generated = generateColor(hue, uiSaturation * spec.sat, lightness)

    colors[key] = spec.alphaSuffix
      ? Color(generated).hex() + spec.alphaSuffix
      : generated
  }

  // Readability pass. `readability: { kind: 'none' }` is how the exclusion set
  // (lineHighlight, selection, findMatch, BORDER, BG1-3, FG3) is expressed.
  for (const key of UI_KEYS) {
    if (initialColors[key]) continue
    const policy = uiSpec[key].readability
    if (policy.kind === 'none') continue
    colors[key] = applyReadability(colors[key], colors.BG1, policy, isDark)
  }

  // In "full" pool mode the accent colours contribute their own harmonic pools to
  // the syntax side. Note this reads the *post-readability* AC1/AC2.
  const ac1Hue = Color(colors.AC1).hue()
  const ac2Hue = Color(colors.AC2).hue()

  let updatedSchemeHues = [...schemeHues]

  if (!few) {
    const ac1AdditionalHues = generateSchemeColors(ac1Hue, scheme)
    const ac2AdditionalHues = generateSchemeColors(ac2Hue, scheme)

    updatedSchemeHues = [
      ...schemeHues,
      ...ac1AdditionalHues,
      ...ac2AdditionalHues,
    ]
  }

  return { colors, schemeHues: updatedSchemeHues, scheme }
}

export function updateThemeColorsWithSaturation(
  currentColors: UIColors,
  newUiSaturation: number,
  lockedColors: Set<string>
): UIColors {
  const updateColorSaturation = (
    color: string,
    saturationMultiplier: number
  ) => {
    const hsl = Color(color).hsl()
    let newSaturation = Math.max(
      2,
      Math.min(100, newUiSaturation * saturationMultiplier)
    )
    return Color.hsl(hsl.hue(), newSaturation, hsl.lightness()).hex()
  }

  const updatedColors: UIColors = { ...currentColors }

  for (const key of UI_KEYS) {
    const spec = uiSpec[key]
    if (spec.sliderExcluded) continue
    if (lockedColors.has(key)) continue
    updatedColors[key] = updateColorSaturation(
      currentColors[key],
      newUiSaturation * (spec.sliderSat ?? spec.sat)
    )
  }

  return updatedColors
}
