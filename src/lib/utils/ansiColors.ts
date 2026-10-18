import Color from 'color'
import { ensureReadability } from './colorUtils'
import type { AnsiColors } from '@/lib/types/colors'
import { ANSI_KEYS, ansiSpec, type AnsiRecipe } from '@/lib/colors/ansi'
import type { Assignment } from '@/lib/colors/assignment'

// ANSI is generated from the background colour plus the assignment, in two passes over
// `ansiSpec`:
//
//   pass 1 — every non-derived row (the six `spunBright` rows are skipped here);
//   pass 2 — the `spunBright` rows, each derived from its base key's pass-1 value.
//
// The readability floor (4.5) then runs over the rows marked `readable`, which is
// everything except `Black` (a literal) and `BrightBlack`.
//
// Consumes no randomness: before Phase B this function re-rolled its whole palette —
// including new base saturation/lightness — on every change of BG1, so the terminal
// colours were never stable and "revert to the seeded colour" would have had nothing
// to revert to. The rolls now live on the assignment and only the *interpretation*
// moves when BG1 moves.
//
// Each row reads a uniform three rolls (hue/sat/light). Recipes with fewer moving
// parts simply leave some unread — the original drew a variable number per row, which
// bought nothing once the draws stopped sharing one global sequence.

export function resolveAnsiColors(
  assignment: Assignment,
  backgroundColor: string
): AnsiColors {
  const baseSaturation = 20 + assignment.ansi.satRoll * 50 // 20-70
  const baseLightness = 30 + assignment.ansi.lightRoll * 30 // 30-60

  const buildRaw = (recipe: AnsiRecipe, key: (typeof ANSI_KEYS)[number]): string | null => {
    const rolls = assignment.ansi.entries[key]
    switch (recipe.kind) {
      case 'literal':
        return recipe.value
      case 'spun': {
        const hue = (recipe.hue + rolls.hueRoll * 60 - 30 + 360) % 360
        const saturation = Math.max(
          0,
          Math.min(100, baseSaturation + rolls.satRoll * 40 - 20)
        )
        const lightness = Math.max(
          20,
          Math.min(80, baseLightness + rolls.lightRoll * 40 - 20)
        )
        return Color.hsl(hue, saturation, lightness).hex()
      }
      case 'hsl': {
        // A zero span draws nothing in the original; here it simply reads as the centre.
        const h = recipe.h[1] > 0 ? recipe.h[0] + rolls.hueRoll * recipe.h[1] : recipe.h[0]
        const s = recipe.s[1] > 0 ? recipe.s[0] + rolls.satRoll * recipe.s[1] : recipe.s[0]
        const l = recipe.l[1] > 0 ? recipe.l[0] + rolls.lightRoll * recipe.l[1] : recipe.l[0]
        return Color.hsl(h, s, l).hex()
      }
      case 'spunBright':
        return null // deferred to pass 2
    }
  }

  const colors = {} as AnsiColors

  // pass 1
  for (const key of ANSI_KEYS) {
    const raw = buildRaw(ansiSpec[key].recipe, key)
    if (raw !== null) colors[key] = raw
  }

  // pass 2 — brighten each derived key from its base
  for (const key of ANSI_KEYS) {
    const recipe = ansiSpec[key].recipe
    if (recipe.kind !== 'spunBright') continue
    const rolls = assignment.ansi.entries[key]
    const base = Color(colors[recipe.base])
    const brightSaturation = Math.min(base.saturationl() + 20 + rolls.satRoll * 20, 100)
    const brightLightness = Math.min(base.lightness() + 20 + rolls.lightRoll * 20, 95)
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
