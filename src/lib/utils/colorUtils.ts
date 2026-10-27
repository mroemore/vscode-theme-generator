// Colour maths: contrast repair, HSL <-> hex, and the small clamps the sliders use.
//
// The scheme tables used to live here; they moved to `src/lib/colors/schemes.ts` in
// Phase C, which is where the covariant-offset contract is enforced (see the note at the
// top of that file). This module now holds no scheme knowledge.

import Color from 'color'

/**
 * How many steps the band walk may take.
 *
 * The walk is the historical search and it stays the primary path: every generated
 * palette was tuned against the colours it lands on, so replacing it outright would move
 * every theme in the corpus. What changes is that it can no longer spin — the budget is
 * what stops an oscillation and the cycle guard is what stops a fixed point. The longest
 * walk in the parity corpus is 26 steps, so 64 leaves room without letting a loop run
 * long.
 */
const WALK_BUDGET = 64

/** The bisection's fixed iteration count — enough to reach the 8-bit colour floor. */
const BISECT_ITERATIONS = 24

/**
 * The colour's exact state — hue, saturation and lightness as floats.
 *
 * The hex is not the state: `lighten` on a saturated red can leave the hex unchanged
 * for a step while the lightness keeps moving (`#FF0000` at 50% → 52.5% is still
 * `#FF0000`, and only the next step shows). A guard built on the hex would call that
 * "no progress" and stop a walk that was making headway, so the guard reads the floats
 * the walk actually moves.
 */
function colorState(color: Color): string {
  return `${color.hue()}|${color.saturationl()}|${color.lightness()}`
}

/**
 * Walk the colour towards the band, one 20% lightness step at a time.
 *
 * This is the search every generated palette was tuned against, so it is kept exactly:
 * the step size, the direction, and the saturation that comes with each step all decide
 * the colours the corpus is made of.
 *
 * What is new is that the walk cannot spin. It stops when it reaches the band, when a
 * step leaves the colour exactly where it was (a fixed point — the same step would be
 * taken again, for ever), when it comes back to a colour it has already been through (a
 * cycle), or when the budget runs out. In each of those last three cases the walk has no
 * answer and `bisectIntoBand` takes over.
 */
function walkToBand(
  start: Color,
  background: Color,
  minContrast: number,
  maxContrast: number,
  isDarkTheme: boolean
): { color: Color; inBand: boolean } {
  let comment = start
  const seen = new Set<string>([colorState(comment)])

  for (let step = 0; step < WALK_BUDGET; step++) {
    const contrast = comment.contrast(background)
    if (contrast >= minContrast && contrast <= maxContrast) {
      return { color: comment, inBand: true }
    }

    const next = isDarkTheme
      ? contrast > maxContrast
        ? comment.darken(0.2).desaturate(0.5)
        : comment.lighten(0.2).saturate(0.2)
      : contrast < minContrast
        ? comment.darken(0.2).saturate(0.2)
        : comment.lighten(0.2).desaturate(0.5)

    const state = colorState(next)
    // A step that does not move the colour is a fixed point; a state already seen is a
    // cycle. Either way the walk would run for ever, so it stops here and lets the
    // bisection answer.
    if (state === colorState(comment) || seen.has(state)) {
      return { color: next, inBand: false }
    }
    seen.add(state)
    comment = next

    if (isDarkTheme && comment.luminosity() < 0.05) {
      return { color: comment, inBand: false }
    }
    if (!isDarkTheme && comment.luminosity() > 0.95) {
      return { color: comment, inBand: false }
    }
  }

  return { color: comment, inBand: false }
}

/**
 * The lightness that puts the colour inside the band.
 *
 * The contrast of a fixed hue and saturation is a continuous function of the lightness,
 * and it is V-shaped: it falls to its minimum where the colour meets the background and
 * rises again on the far side. So the band is either out of reach — the background and
 * the hue cannot produce it — or a pair of intervals, one on each side of the
 * background's own lightness.
 *
 * The scan is over 101 lightness values, so it costs a fixed amount and cannot spin; the
 * refinement is a bisection with a fixed iteration count, so it ends whatever the colours
 * are. Neither can step over the band and come back, which is what the fixed 20% walk
 * did on a mid-tone background.
 *
 * When the band is out of reach the closest achievable colour is returned — the one
 * whose contrast comes nearest to the band — and `inBand` says so, so the caller can
 * tell "in the band" from "as close as this hue and background get".
 */
function bisectIntoBand(
  hue: number,
  saturation: number,
  background: Color,
  minContrast: number,
  maxContrast: number
): { color: Color; inBand: boolean } {
  const safeHue = Number.isFinite(hue) ? hue : 0
  const safeSaturation = Number.isFinite(saturation) ? saturation : 0
  const target = (minContrast + maxContrast) / 2

  const samples: Array<{ color: Color; contrast: number; distance: number }> = []
  for (let lightness = 0; lightness <= 100; lightness++) {
    const color = Color.hsl(safeHue, safeSaturation, lightness)
    const contrast = color.contrast(background)
    const distance =
      contrast < minContrast
        ? minContrast - contrast
        : contrast > maxContrast
          ? contrast - maxContrast
          : 0
    samples.push({ color, contrast, distance })
  }

  // The closest achievable: the smallest distance to the band anywhere on the axis.
  let closest = samples[0]
  let hit = -1
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    if (sample.distance < closest.distance) closest = sample
    if (sample.distance === 0) {
      if (hit === -1 || Math.abs(sample.contrast - target) < Math.abs(samples[hit].contrast - target)) {
        hit = i
      }
    }
  }

  if (hit === -1) {
    // The band is unreachable for this hue and background. The closest achievable
    // colour is the honest answer; the caller's floor check still has the last word.
    return { color: closest.color, inBand: false }
  }

  // Refine: bisect towards the middle of the band between the hit and the neighbour
  // that brackets it, so the result sits as close to the middle as 8 bits allow. The
  // interval is narrowed by the sign of the midpoint's contrast, and the best colour
  // seen is kept, so the bisection ends even if the contrast is not perfectly monotone
  // across the interval.
  let best = samples[hit]
  const previousIndex = hit > 0 ? hit - 1 : -1
  const nextIndex = hit + 1 < samples.length ? hit + 1 : -1
  const neighbourIndex =
    previousIndex >= 0 &&
    (nextIndex < 0 ||
      Math.abs(samples[previousIndex].contrast - target) <
        Math.abs(samples[nextIndex].contrast - target))
      ? previousIndex
      : nextIndex
  if (neighbourIndex >= 0) {
    let lo = Math.min(hit, neighbourIndex)
    let hi = Math.max(hit, neighbourIndex)
    for (let i = 0; i < BISECT_ITERATIONS; i++) {
      const mid = (lo + hi) / 2
      const color = Color.hsl(safeHue, safeSaturation, mid)
      const contrast = color.contrast(background)
      if (Math.abs(contrast - target) < Math.abs(best.contrast - target)) {
        best = { color, contrast, distance: 0 }
      }
      if (contrast < target) lo = mid
      else hi = mid
    }
  }

  return { color: best.color, inBand: true }
}

export function adjustCommentColor(
  commentColor: string,
  backgroundColor: string,
  minContrast: number,
  maxContrast: number
): string {
  const bgColor = Color(backgroundColor)
  const isDarkTheme = bgColor.isDark()
  const maxSaturation = isDarkTheme ? 15 : 35

  const walk = walkToBand(
    Color(commentColor),
    bgColor,
    minContrast,
    maxContrast,
    isDarkTheme
  )
  // The walk is kept because every generated palette was tuned against it. When it
  // cannot answer — a fixed point, a cycle, the luminosity guard or the budget — the
  // bisection finds the lightness whose contrast lands inside the band instead.
  //
  // The repair searches at the *capped* saturation, because the cap below runs
  // afterwards: a bisection at full saturation would hand the cap a colour to
  // desaturate, and the desaturated colour would no longer be in the band.
  const comment = walk.inBand
    ? walk.color
    : bisectIntoBand(
        walk.color.hue(),
        Math.min(walk.color.saturationl(), maxSaturation),
        bgColor,
        minContrast,
        maxContrast
      ).color

  // Ensure maxSaturation
  let capped = comment
  while (Color(capped).hsl().saturationl() > maxSaturation) {
    capped = capped.desaturate(0.01)
  }

  // The walk above can bail out while the result is still *below* `minContrast` —
  // measured: #2D2D30 becomes #36363A, contrast ≈1.4 against a 3.0 floor, because one
  // `lighten` step still leaves luminosity under 0.05. The saturation cap is cosmetic;
  // an unreadable comment is a bug, so the floor wins.
  const result = capped.hex()
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

  // The walk may not revisit a state: a step that leaves the colour exactly where it
  // was is a fixed point, and a state already seen is a cycle. Either way the same
  // step would be taken again for ever, so the walk stops and the pole below answers.
  // The budget is the outer bound; neither guard can change the colour the walk lands
  // on, because a walk that cannot progress was going to spin on that colour anyway.
  const seen = new Set<string>([colorState(color)])

  while (!meetsFloor(color) && iterations < maxIterations) {
    const next = goDarker
      ? color.darken(0.05).saturate(0.05)
      : color.lighten(0.05).saturate(0.05)
    const state = colorState(next)
    if (state === colorState(color) || seen.has(state)) break
    seen.add(state)
    color = next
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
