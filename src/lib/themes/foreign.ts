// The generator inputs a *foreign* (palette-only) theme honestly admits.
//
// A palette-only record carries colours, not generator settings: it has no `inputs`,
// so the sliders must not describe the theme that was open when it was imported
// (that was defect 1 of the 2026-10-26 fix round — the previous theme's hue and
// mode leaked into the live state and from there into exports and saves).
//
// What can be synthesised from the palette itself:
//   * `isDark`   — the imported background's own polarity (same rule the importer
//                  used when it built the neutral: `Color(bg1).isDark()`),
//   * `baseHue`  — the imported background's own hue, rounded to an integer.
//
// What cannot honestly be synthesised and is left as-is (until the user converts
// the theme with a generator control): the two saturations and the assignment.
// Those are rolls, not colours — a colour alone does not admit them — and a
// palette-only theme never writes them anywhere (no metadata block, no `inputs`)
// until conversion makes them real.

import Color from 'color'

export interface ForeignInputs {
  isDark: boolean
  baseHue: number
}

/** Read `isDark` and `baseHue` off one background hex. Never throws: junk → dark/0. */
export function foreignInputs(bg1: string): ForeignInputs {
  try {
    const base = Color(bg1)
    // `hue()` returns [0, 360); rounding can land on 360 exactly, so normalise.
    return {
      isDark: base.isDark(),
      baseHue: Math.round(base.hue()) % 360,
    }
  } catch {
    return { isDark: true, baseHue: 0 }
  }
}
