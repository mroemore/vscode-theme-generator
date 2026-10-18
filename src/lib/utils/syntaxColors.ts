import { randomInteger } from '@/lib/utils/math'
import { ensureReadability } from './colorUtils'
import { SyntaxColors } from '@/lib/types/colors'
import Color from 'color'
import { SYNTAX_GROUPS, SYNTAX_KEYS, syntaxSpec } from '@/lib/colors/syntax'
import { applyReadability, draw } from '@/lib/colors/spec'

// Row-driven from `syntaxSpec`, in `SYNTAX_KEYS` order. Per row the draws land in the
// order hue-index → lightness-shift → hue-shift, matching the original call's argument
// evaluation order. The six group pool indices are drawn up-front in `SYNTAX_GROUPS`
// order; keys without `ownIndex` reuse their group's index and draw nothing for it.
export function generateSyntaxColors(
  backgroundColor: string,
  schemeHues: number[],
  syntaxSaturation: number = 70,
  lockedColors: Partial<SyntaxColors> = {},
  forceRegenerate: boolean = false
): SyntaxColors {
  const baseColor = Color(backgroundColor)
  const isDark = baseColor.isDark()
  const baseLightness = isDark ? 80 : 25
  const inverseBaseLightness = isDark ? 15 : 85

  const generateColor = (
    hueIndex: number,
    saturationMultiplier: number = 1,
    lightnessShift: number = 0,
    hueShift: number = 0,
    highContrast: boolean = true
  ) => {
    const hue = (schemeHues[hueIndex % schemeHues.length] + hueShift) % 360
    const saturation = Math.max(
      2,
      Math.min(100, syntaxSaturation * saturationMultiplier)
    )
    const lightness = Math.min(
      100,
      Math.max(
        0,
        highContrast
          ? baseLightness + lightnessShift
          : inverseBaseLightness - lightnessShift
      )
    )
    return Color.hsl(hue, saturation, lightness).hex()
  }

  const groupIndex: Record<string, number> = {}
  for (const group of SYNTAX_GROUPS) {
    groupIndex[group] = randomInteger(0, schemeHues.length - 1)
  }

  const syntaxColors = {} as SyntaxColors

  for (const key of SYNTAX_KEYS) {
    const spec = syntaxSpec[key]

    const locked = lockedColors[key]
    if (locked) {
      syntaxColors[key] = locked
      continue
    }

    const hueIndex = spec.ownIndex
      ? randomInteger(0, schemeHues.length - 1)
      : groupIndex[spec.group!]
    const lightnessShift = draw(spec.lightShift)
    const hueShift = draw(spec.hueShift)

    syntaxColors[key] = generateColor(
      hueIndex,
      spec.sat,
      lightnessShift,
      hueShift,
      !spec.inverseLightness
    )
  }

  // Readability. Every key — `comment` included — is floored at 5.5; `comment` is then
  // additionally pulled into its low-contrast band by `floor-then-band`.
  for (const key of SYNTAX_KEYS) {
    if (lockedColors[key]) continue
    syntaxColors[key] = applyReadability(
      syntaxColors[key],
      backgroundColor,
      syntaxSpec[key].readability,
      isDark
    )
  }

  return syntaxColors
}

export function updateSyntaxColorsWithSaturation(
  currentColors: SyntaxColors,
  newSyntaxSaturation: number,
  backgroundColor: string,
  lockedColors: Set<string>
): SyntaxColors {
  const updateColorSaturation = (
    color: string,
    saturationMultiplier: number
  ) => {
    const hsl = Color(color).hsl()
    let newSaturation = Math.max(
      2,
      Math.min(100, newSyntaxSaturation * saturationMultiplier)
    )
    return Color.hsl(hsl.hue(), newSaturation, hsl.lightness()).hex()
  }

  const updatedColors: SyntaxColors = { ...currentColors }

  // Saturation and readability share one skip condition in the original (both exclude
  // `comment` and locked keys), so a single pass is equivalent.
  for (const key of SYNTAX_KEYS) {
    const spec = syntaxSpec[key]
    if (spec.sliderExcluded) continue
    if (lockedColors.has(key)) continue

    const saturated = updateColorSaturation(
      currentColors[key],
      newSyntaxSaturation * (spec.sliderSat ?? spec.sat)
    )
    updatedColors[key] = ensureReadability(saturated, backgroundColor, 5.5)
  }

  return updatedColors
}
