// Shared spec vocabulary for the three colour domains.
//
// Why this file exists: the key lists used to be duplicated across the type, the
// initial-value map, the generator, the Zod schema and the saturation-slider map —
// five places to touch per colour. Each domain now declares one spec record
// (`uiSpec` / `syntaxSpec` / `ansiSpec`) and everything else derives from it.
//
// ── Roll ranges, not drawn values ──────────────────────────────────────────────
// There is no randomness in this file, and there must be none: since Phase B every
// draw belongs to an `Assignment` (`src/lib/colors/assignment.ts`), and generation is
// a pure resolution of that assignment against these ranges. A range here only says
// *how to interpret* a stored roll in [0, 1); tuning it re-interprets the same roll
// rather than reshaping the theme. Compare `assignment.ts` for why that matters.

import { adjustCommentColor, ensureReadability } from '@/lib/utils/colorUtils'

/** An integer range; a stored roll in [0, 1) is interpreted against it. `sub` negates. */
export type IntRange = { min: number; max: number; sub?: boolean }

/** A literal, or an integer range a stored roll resolves into. */
export type Drawable = number | IntRange

/** Interpret a stored roll in [0, 1) against a literal-or-range. The only way to read a range. */
export function resolveDrawable(roll: number, value: Drawable): number {
  if (typeof value === 'number') return value
  const n = value.min + Math.floor(roll * (value.max - value.min + 1))
  return value.sub ? -n : n
}

/** UI lightness is expressed as an absolute value or an offset from a mode base. */
export type LightnessExpr =
  | { kind: 'const'; value: number }
  | { kind: 'from'; base: 'bgBase' | 'fgBase'; add?: number; jitter?: IntRange }

/** Pool-derived hue (`schemeHues[…]`) or a literal hue. */
export type HueExpr = { kind: 'pool' } | { kind: 'fixed'; h: number }

/** What the post-generation readability pass does to a key. */
export type Readability =
  | { kind: 'none' }
  | { kind: 'floor'; contrast: number }
  | {
      kind: 'floor-then-band'
      pre: number
      band: { dark: readonly [number, number]; light: readonly [number, number] }
    }

export interface KeySpec {
  /** Shown when the generator is not driving (seeded / imported themes). */
  initial: string
  hue: HueExpr
  /** Generation-time multiplier applied to the domain saturation. */
  sat: number
  /** Slider-time multiplier; falls back to `sat` when omitted (see the four known mismatches). */
  sliderSat?: number
  lightness: { dark: LightnessExpr; light: LightnessExpr }
  readability: Readability
  /** Appended to the generated hex, e.g. '70' for the translucent UI colours. */
  alphaSuffix?: string
  /** Excluded from the saturation-slider pass entirely. */
  sliderExcluded?: boolean
}

/** A fixed hue is its own value; a pool hue comes from the assignment's slot. */
export function resolveHueExpr(hue: HueExpr, poolHue: number): number {
  return hue.kind === 'fixed' ? hue.h : poolHue
}

/** `lightness` for a UI row is either a constant or an offset from a mode-chosen base. */
export function resolveLightnessExpr(
  expr: LightnessExpr,
  ctx: { bgBase: number; fgBase: number },
  roll: number
): number {
  if (expr.kind === 'const') return expr.value
  let value = expr.base === 'bgBase' ? ctx.bgBase : ctx.fgBase
  if (expr.add !== undefined) value += expr.add
  if (expr.jitter) value += resolveDrawable(roll, expr.jitter)
  return value
}

export function applyReadability(
  value: string,
  background: string,
  policy: Readability,
  isDark: boolean
): string {
  switch (policy.kind) {
    case 'none':
      return value
    case 'floor':
      return ensureReadability(value, background, policy.contrast)
    case 'floor-then-band':
      return adjustCommentColor(
        ensureReadability(value, background, policy.pre),
        background,
        isDark ? policy.band.dark[0] : policy.band.light[0],
        isDark ? policy.band.dark[1] : policy.band.light[1]
      )
  }
}

/** Build the initial-value map for a domain from its spec record. */
export function makeInitial<K extends string>(
  specs: Record<K, { initial: string }>
): Record<K, string> {
  const out = {} as Record<K, string>
  for (const key of Object.keys(specs) as K[]) out[key] = specs[key].initial
  return out
}
