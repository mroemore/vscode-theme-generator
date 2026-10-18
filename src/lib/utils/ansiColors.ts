import Color from 'color'
import { ensureReadability } from './colorUtils'
import type { AnsiColors } from '@/lib/types/colors'
import { ANSI_KEYS, ansiSpec, type AnsiRecipe } from '@/lib/colors/ansi'

// ANSI is generated from the background colour alone, in two passes over `ansiSpec`:
//
//   pass 1 — every non-derived row, in declaration order (this is what fixes the draw
//            sequence: the six `spunBright` rows are skipped here);
//   pass 2 — the `spunBright` rows, each derived from its base key's pass-1 value.
//
// The readability floor (4.5) then runs over the rows marked `readable`, which is
// everything except `Black` (a literal) and `BrightBlack`.
export function generateAnsiColors(backgroundColor: string): AnsiColors {
  const baseSaturation = 20 + Math.random() * 50 // 20-70
  const baseLightness = 30 + Math.random() * 30 // 30-60

  const buildRaw = (recipe: AnsiRecipe): string | null => {
    switch (recipe.kind) {
      case 'literal':
        return recipe.value
      case 'spun': {
        const hue = (recipe.hue + Math.random() * 60 - 30 + 360) % 360
        const saturation = Math.max(
          0,
          Math.min(100, baseSaturation + Math.random() * 40 - 20)
        )
        const lightness = Math.max(
          20,
          Math.min(80, baseLightness + Math.random() * 40 - 20)
        )
        return Color.hsl(hue, saturation, lightness).hex()
      }
      case 'hsl': {
        // A zero span is not drawn — BrightBlack costs one draw, White costs three.
        const h =
          recipe.h[1] > 0 ? recipe.h[0] + Math.random() * recipe.h[1] : recipe.h[0]
        const s =
          recipe.s[1] > 0 ? recipe.s[0] + Math.random() * recipe.s[1] : recipe.s[0]
        const l =
          recipe.l[1] > 0 ? recipe.l[0] + Math.random() * recipe.l[1] : recipe.l[0]
        return Color.hsl(h, s, l).hex()
      }
      case 'spunBright':
        return null // deferred to pass 2
    }
  }

  const colors = {} as AnsiColors

  // pass 1
  for (const key of ANSI_KEYS) {
    const raw = buildRaw(ansiSpec[key].recipe)
    if (raw !== null) colors[key] = raw
  }

  // pass 2 — brighten each derived key from its base
  for (const key of ANSI_KEYS) {
    const recipe = ansiSpec[key].recipe
    if (recipe.kind !== 'spunBright') continue
    const base = Color(colors[recipe.base])
    const brightSaturation = Math.min(
      base.saturationl() + 20 + Math.random() * 20,
      100
    )
    const brightLightness = Math.min(
      base.lightness() + 20 + Math.random() * 20,
      95
    )
    colors[key] = base
      .saturationl(brightSaturation)
      .lightness(brightLightness)
      .hex()
  }

  // readability floor, except Black and BrightBlack
  for (const key of ANSI_KEYS) {
    if (!ansiSpec[key].readable) continue
    colors[key] = ensureReadability(colors[key], backgroundColor, 4.5)
  }

  return colors
}
