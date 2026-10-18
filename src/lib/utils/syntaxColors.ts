import Color from 'color'
import { ensureReadability } from './colorUtils'
import type { SyntaxColors } from '@/lib/types/colors'
import { SYNTAX_KEYS, syntaxSpec } from '@/lib/colors/syntax'
import { applyReadability, resolveDrawable } from '@/lib/colors/spec'
import { resolvePoolHue } from '@/lib/colors/assignment'
import type { Assignment } from '@/lib/colors/assignment'
import type { Pools } from './uiColors'

// Syntax colours resolve from three things and nothing else: the assignment, the
// harmonic `pools`, and the syntax saturation. Consumes no randomness — see
// `src/lib/colors/assignment.ts`.
//
// Each token's hue is `pool[slot.index % len] + hueShift`, so a Base Hue change adds
// the same δ to every pool-derived token: the relationships hold and the palette
// rotates as a whole. `comment` is the one token that reads the inverse (low-contrast)
// lightness base; it is also the only token exempt from the saturation slider, but it
// is *not* exempt from the readability floor (see `syntaxSpec.comment.readability`).

export interface SyntaxResolveInput {
  assignment: Assignment
  pools: Pools
  syntaxSaturation: number
  backgroundColor: string
}

export function resolveSyntaxColors(
  input: SyntaxResolveInput,
  locked: Partial<SyntaxColors> = {}
): SyntaxColors {
  const { assignment, pools, syntaxSaturation, backgroundColor } = input
  const baseColor = Color(backgroundColor)
  const isDark = baseColor.isDark()
  const baseLightness = isDark ? 80 : 25
  const inverseBaseLightness = isDark ? 15 : 85

  const generateColor = (
    poolHue: number,
    saturationMultiplier: number,
    lightnessShift: number,
    hueShift: number,
    highContrast: boolean
  ) => {
    const hue = (poolHue + hueShift) % 360
    const saturation = Math.max(2, Math.min(100, syntaxSaturation * saturationMultiplier))
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

  const syntaxColors = {} as SyntaxColors

  for (const key of SYNTAX_KEYS) {
    const lockedColor = locked[key]
    if (lockedColor) {
      syntaxColors[key] = lockedColor
      continue
    }

    const spec = syntaxSpec[key]
    const entry = assignment.syntax.entries[key]

    syntaxColors[key] = generateColor(
      resolvePoolHue(pools, entry.slot),
      spec.sat,
      resolveDrawable(entry.lightShiftRoll, spec.lightShift),
      resolveDrawable(entry.hueShiftRoll, spec.hueShift),
      !spec.inverseLightness
    )
  }

  // Readability. Every key — `comment` included — is floored at 5.5; `comment` is then
  // additionally pulled into its low-contrast band by `floor-then-band`.
  for (const key of SYNTAX_KEYS) {
    if (locked[key]) continue
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
    const newSaturation = Math.max(
      2,
      Math.min(100, newSyntaxSaturation * saturationMultiplier)
    )
    return Color.hsl(hsl.hue(), newSaturation, hsl.lightness()).hex()
  }

  const updatedColors: SyntaxColors = { ...currentColors }

  // Saturation and readability share one skip condition (both exclude `comment` and
  // locked keys), so a single pass is equivalent.
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
