// Shared spec vocabulary for the three colour domains.
//
// Why this file exists: the key lists used to be duplicated across the type, the
// initial-value map, the generator, the Zod schema and the saturation-slider map —
// five places to touch per colour. Each domain now declares one spec record
// (`uiSpec` / `syntaxSpec` / `ansiSpec`) and everything else derives from it.
//
// ── The one rule you must not break ────────────────────────────────────────────
// Generation is driven by `Math.random`, and every downstream colour depends on the
// *sequence* of draws, not just the count. The generators therefore evaluate
// hue → lightness → jitter, in that order, exactly as the original object literals
// did. Reordering two `randomInteger` calls in one spec row silently reshuffles every
// later colour. `.tmp_files/parity.ts` diffs 840 seeded combinations and records each
// combination's draw count, so a reordering shows up as a non-zero diff — keep it green.

import { randomInteger } from '@/lib/utils/math'
import { adjustCommentColor, ensureReadability } from '@/lib/utils/colorUtils'

/** An integer range drawn with `randomInteger`; `sub` negates the draw. */
export type IntRange = { min: number; max: number; sub?: boolean }

/** A literal, or an integer range drawn at generation time. */
export type Drawable = number | IntRange

export function draw(value: Drawable): number {
  if (typeof value === 'number') return value
  const n = randomInteger(value.min, value.max)
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

export function resolveHue(hue: HueExpr, pool: number[]): number {
  return hue.kind === 'fixed' ? hue.h : pool[randomInteger(0, pool.length - 1)]
}

export function resolveLightness(
  expr: LightnessExpr,
  ctx: { bgBase: number; fgBase: number }
): number {
  if (expr.kind === 'const') return expr.value
  let value = expr.base === 'bgBase' ? ctx.bgBase : ctx.fgBase
  if (expr.add !== undefined) value += expr.add
  if (expr.jitter) {
    const n = randomInteger(expr.jitter.min, expr.jitter.max)
    value += expr.jitter.sub ? -n : n
  }
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
