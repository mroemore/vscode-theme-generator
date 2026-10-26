// The pure palette resolver (spec §2.1–§2.3). Moved verbatim from ThemeContext's
// `pickLocked` / `relink` / `resolveAll`: a relocation, not a rewrite, so the parity
// baseline holds (680 combos / 0 changed).
//
// The bodies are unchanged. In particular the carry set still applies to `colors` and
// `baseSyntaxColors` only, and ANSI is always `resolveAnsiColors(assignment, colors.BG1)`
// with no carry — that is what `resolveAll` did, and a locked ANSI not surviving a
// re-resolve is existing behaviour tracked separately. Do not "improve" it here.

import { resolveUiColors, buildPools } from '@/lib/utils/uiColors'
import { resolveSyntaxColors } from '@/lib/utils/syntaxColors'
import { resolveAnsiColors } from '@/lib/utils/ansiColors'
import { applyLinks } from '@/lib/colors/links'
import type { Links } from '@/lib/colors/links'
import type { AnsiColors, SyntaxColors, UIColors } from '@/lib/types/colors'

import type { ThemeInputs, ThemePalette } from '@/lib/themes/schema'

/** The locked subset of a colour record — what a resolve must carry through untouched. */
export function pickLocked(
  source: Record<string, string>,
  locked: ReadonlySet<string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of locked) {
    const value = source[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * Re-resolve every *base* colour from the inputs. Pure and deterministic: given the same
 * inputs it returns the same palette, and it consumes no randomness. Links are applied by
 * the caller, so there is exactly one place they are resolved.
 *
 * `carry` names the keys whose present value survives the resolve untouched. It is
 * normally the lock set — but an unlock passes the rest of the panel so that only the
 * unlocked colours regenerate.
 */
export function resolvePalette(
  inputs: ThemeInputs,
  carry: ReadonlySet<string>,
  carryFrom: ThemePalette
): ThemePalette {
  const input = {
    assignment: inputs.assignment,
    scheme: inputs.scheme,
    baseHue: inputs.baseHue,
    isDark: inputs.isDark,
    uiSaturation: inputs.uiSaturation,
  }

  const ui = resolveUiColors(input, pickLocked(carryFrom.ui, carry) as Partial<UIColors>)
  const pools = buildPools(input, ui)
  const syntax = resolveSyntaxColors(
    {
      assignment: inputs.assignment,
      pools,
      syntaxSaturation: inputs.syntaxSaturation,
      backgroundColor: ui.BG1,
    },
    pickLocked(carryFrom.syntax, carry) as Partial<SyntaxColors>
  )
  const ansi = resolveAnsiColors(inputs.assignment, ui.BG1)

  return { ui, syntax, ansi }
}

/**
 * Re-derive the displayed palettes from the stored bases plus the links. The single point
 * every state transition passes through, which is what makes "links follow their source"
 * true for *every* edit affordance rather than only for regeneration.
 */
export function relinkPalette(args: {
  colors: UIColors
  baseSyntax: SyntaxColors
  baseAnsi: AnsiColors
  links: Links
  isDark: boolean
}): { syntax: SyntaxColors; ansi: AnsiColors } {
  const { syntaxColors, ansiColors } = applyLinks({
    colors: args.colors,
    baseSyntaxColors: args.baseSyntax,
    baseAnsiColors: args.baseAnsi,
    links: args.links,
    isDark: args.isDark,
  })
  return { syntax: syntaxColors, ansi: ansiColors }
}
