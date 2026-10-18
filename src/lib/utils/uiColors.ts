import Color from 'color'

import { generateSchemeColors } from '@/lib/colors/schemes'
import type { ColorScheme } from '@/lib/colors/schemes'
import type { UIColors } from '@/lib/types/colors'
import { UI_KEYS, uiSpec } from '@/lib/colors/ui'
import {
  applyReadability,
  resolveHueExpr,
  resolveLightnessExpr,
} from '@/lib/colors/spec'
import type { Assignment } from '@/lib/colors/assignment'

// UI (theme) colours are a pure function of the assignment plus the header values —
// no randomness is consumed here. See `src/lib/colors/assignment.ts` for why: the
// randomness belongs to the theme, not to the moment of generation, so re-resolving
// with a new Base Hue rotates the palette instead of re-dealing it.
//
// A key supplied in `locked` short-circuits before anything is computed, and is also
// skipped by the readability pass — exactly as the previous generator treated its
// `initialColors` overrides.

export interface ThemeResolveInput {
  assignment: Assignment
  scheme: ColorScheme
  baseHue: number
  isDark: boolean
  uiSaturation: number
}

/** The harmonic pools the syntax side draws from. */
export interface Pools {
  base: number[]
  ac1?: number[]
  ac2?: number[]
}

/**
 * The mode chooses a *range* for each base lightness, and the assignment supplies a
 * normalised roll inside it: dark → background 0-15 / foreground 85-100, light → the
 * reverse. Storing the roll rather than the value is what lets the dark/light toggle
 * re-range the same "how dark" choice instead of rolling a near-black background into
 * a light theme.
 */
function baseLightnessFromRoll(
  roll: number,
  isDark: boolean,
  isBackground: boolean
): number {
  const low = isDark === isBackground
  return low ? Math.floor(roll * 16) : 85 + Math.floor(roll * 16)
}

function generateColor(
  hue: number,
  saturation: number,
  lightness: number,
  jitter: { hueJitter: number; satJitter: number; lightJitter: number }
): string {
  const h = (hue + (jitter.hueJitter * 10 - 5) + 360) % 360
  const s = Math.max(2, Math.min(100, saturation + (jitter.satJitter * 20 - 10)))
  const l = Math.max(0, Math.min(100, lightness + (jitter.lightJitter * 10 - 5)))
  return Color.hsl(h, s, l).hex()
}

/** Resolve the 16 UI colours from an assignment. Consumes no randomness. */
export function resolveUiColors(
  input: ThemeResolveInput,
  locked: Partial<UIColors> = {}
): UIColors {
  const { assignment, scheme, baseHue, isDark, uiSaturation } = input
  const mode = isDark ? 'dark' : 'light'
  const base = generateSchemeColors(baseHue, scheme, assignment.shape)

  const bgBase = baseLightnessFromRoll(assignment.ui.bgRoll, isDark, true)
  const fgBase = baseLightnessFromRoll(assignment.ui.fgRoll, isDark, false)

  const colors = {} as UIColors

  for (const key of UI_KEYS) {
    const provided = locked[key]
    if (provided) {
      colors[key] = provided
      continue
    }

    const spec = uiSpec[key]
    const entry = assignment.ui.entries[key]

    const poolHue = base[entry.slotIndex % base.length]
    const hue = resolveHueExpr(spec.hue, poolHue)
    const lightness = resolveLightnessExpr(
      spec.lightness[mode],
      { bgBase, fgBase },
      entry.exprJitter
    )

    const generated = generateColor(
      hue,
      uiSaturation * spec.sat,
      lightness,
      entry
    )

    colors[key] = spec.alphaSuffix
      ? Color(generated).hex() + spec.alphaSuffix
      : generated
  }

  // Readability pass. `readability: { kind: 'none' }` is how the exclusion set
  // (lineHighlight, selection, findMatch, BORDER, BG1-3, FG3) is expressed.
  for (const key of UI_KEYS) {
    if (locked[key]) continue
    const policy = uiSpec[key].readability
    if (policy.kind === 'none') continue
    colors[key] = applyReadability(colors[key], colors.BG1, policy, isDark)
  }

  return colors
}

/**
 * Build the syntax pools. In `full` mode the accent colours contribute their own
 * harmonic pools on top of the base one; note this reads the *post-readability*
 * AC1/AC2, which is what the previous generator did too. In `base` mode there is one
 * pool, and slots naming `ac1`/`ac2` fall back into it at the same index.
 */
export function buildPools(input: ThemeResolveInput, colors: UIColors): Pools {
  const base = generateSchemeColors(
    input.baseHue,
    input.scheme,
    input.assignment.shape
  )
  if (input.assignment.poolMode !== 'full') return { base }

  const ac1Hue = Color(colors.AC1).hue()
  const ac2Hue = Color(colors.AC2).hue()
  const fromAccent = (h: number) =>
    generateSchemeColors(
      Number.isFinite(h) ? h : 0,
      input.scheme,
      input.assignment.shape
    )

  return { base, ac1: fromAccent(ac1Hue), ac2: fromAccent(ac2Hue) }
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
    const newSaturation = Math.max(
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
