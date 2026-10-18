// Leaf module: the colour-scheme enum and the shape parameters its curves need live
// here rather than in `types/colors.ts`, so importing them does not drag in the
// `monaco-editor` type import that `types/colors.ts` carries for `IMonacoThemeRule`.
//
// `types/colors.ts` re-exports `ColorScheme`, so every existing import path
// (`@/lib/types/colors`) keeps working unchanged.
//
// ── Phase C: the covariant contract ────────────────────────────────────────────
// Every scheme must be *covariant in the base hue*: its entry k is
// `(baseHue + offsetₖ) mod 360` with `offsetₖ` independent of `baseHue`. That is what
// makes Base Hue a rotation and lets a token keep its colour relationship when the
// hue moves (see `assignment.ts`).
//
// Eight schemes used to violate this by *multiplying* the base hue instead of rotating
// it (`baseHue · k`, `baseHue / 2ⁿ`, `cos`/`sin` of it, …), which collapsed the whole
// pool into a few degrees near 0 — `NestedPolygons` produced [0,3,6,9,12] at any hue.
// They were removed in Phase C rather than repaired, because each was already
// reproducible by a scheme that does satisfy the contract:
//
//   FibonacciSequence  baseHue·k            → GoldenRatio
//   NobleNumbers       baseHue·k            → Fibonacci
//   MandelbrotSet      early-exits, 1-3 hues, no angular reading → FareySequence
//   SierpinskiTriangle baseHue / 2ⁿ         → Triadic (120°)
//   KochSnowflake      baseHue / 3ⁿ         → Hexagram (60°)
//   YinYang            2 distinct hues      → Complementary (0°/180°)
//   Hamsa              baseHue·{0.5,0.6,0.7} → PentagramStar (72°)
//   SpiralDynamics     baseHue·1.5ⁿ         → GoldenSpiral
//
// Four more were repaired, because the visual idea is real and has a covariant reading:
// Torus, DoubleTorus, RosettePattern, NestedPolygons. They fold a curve *around* the
// base hue, so they need shape constants — see `ShapeParams`.
//
// Enum values are plain numbers, persisted nowhere and used only as in-session `Select`
// values, so the deletion renumbered them compactly.

export enum ColorScheme {
  Monochromatic,
  Analogous,
  Complementary,
  SplitComplementary,
  Triadic,
  Tetradic,
  GoldenRatio,
  GoldenRatio3,
  Fibonacci,
  PentagramStar,
  VesicaPiscis,
  FlowerOfLife,
  PlatonicSolids,
  SpiralOfTheodorus,
  MetatronsCube,
  SeedOfLife,
  GoldenSpiral,
  MetallicMeans,
  ContinuedFraction,
  GoldenTrisection,
  FareySequence,
  GoldenTriangle,
  SriYantra,
  KabbalahTreeOfLife,
  Torus,
  CelticKnot,
  Labirinth,
  StarTetrahedron,
  Enneagram,
  Hexagram,
  ChakraSymbols,
  DoubleTorus,
  RosettePattern,
  NestedPolygons,
}

/**
 * The shape constants the four folded schemes need, drawn once per theme.
 *
 * These live on the `Assignment` rather than in the scheme code so that a scheme stays
 * a pure function of `(baseHue, shape)`: the same theme keeps the same Torus winding
 * while the hue moves, and a Randomize is what picks a new one.
 */
export interface ShapeParams {
  /** `NestedPolygons`: the side count of each nested layer, outer layer first. */
  nestedSides: number[]
  /** `RosettePattern`: the fold order — how many petals the rosette has. */
  rosetteFold: number
  /** `Torus` / `DoubleTorus`: segments around the major ring. */
  torusMajor: number
  /** `Torus` / `DoubleTorus`: the winding twist in degrees, one per winding. */
  torusTwist: number[]
}

/** The sets the shape draws from. Sizes here decide pool lengths — see `schemePoolLength`. */
export const SHAPE_CHOICES = {
  nestedSides: [3, 4, 5, 6, 8, 12],
  nestedLayerCount: 5,
  rosetteFold: [5, 7, 8, 9, 10, 11],
  torusMajor: [5, 7, 9],
  torusTwist: [30, 45, 60, 72, 90],
} as const

/** Wrap any angle into [0, 360). The single place a hue is normalised. */
export function normaliseHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

/** `n` offsets, `f` called with i = 1..n. */
function repeat(n: number, f: (i: number) => number): number[] {
  return Array.from({ length: n }, (_, i) => f(i + 1))
}

const GOLDEN_RATIO = 0.618033988749895
/** (3 - √5) · 180 */
const GOLDEN_ANGLE = 137.5077640500378

/**
 * Each scheme as **offsets from the base hue**, never as hues.
 *
 * This is the whole point of Phase C: the table cannot express a covariant *violation*,
 * because `baseHue` is not in scope. The wrapper below adds it and normalises. A scheme
 * that used to multiply the base hue is now unrepresentable.
 *
 * Offset count decides pool length and must not depend on `shape` (see
 * `schemePoolLength`) — a slot index drawn against one length would otherwise point
 * somewhere else under another shape.
 */
const SCHEME_OFFSETS: Record<ColorScheme, (shape: ShapeParams) => number[]> = {
  [ColorScheme.Monochromatic]: () => [0, 0, 0],
  [ColorScheme.Analogous]: () => [30, 60, -30, -60],
  [ColorScheme.Complementary]: () => [180],
  [ColorScheme.SplitComplementary]: () => [150, 210],
  [ColorScheme.Triadic]: () => [60, 120],
  [ColorScheme.Tetradic]: () => [90, 180, 270],
  [ColorScheme.GoldenRatio]: () => [2, 5, 7].map((k) => 360 * GOLDEN_RATIO * k),
  [ColorScheme.GoldenRatio3]: () => [3, 6, 9].map((k) => 360 * GOLDEN_RATIO * k),
  [ColorScheme.Fibonacci]: () =>
    [2, 3, 5, 8, 13, 21, 34, 55, 89].map((d) => 360 / d),
  [ColorScheme.PentagramStar]: () => [72, 144, 216, 288],
  [ColorScheme.VesicaPiscis]: () => [33, 66],
  [ColorScheme.FlowerOfLife]: () => [60, 120, 180, 240, 300],
  [ColorScheme.PlatonicSolids]: () => [72, 144, 216, 288],
  [ColorScheme.SpiralOfTheodorus]: () =>
    [2, 3, 5, 6, 7, 8].map((n) => Math.sqrt(n) * 180),
  [ColorScheme.MetatronsCube]: () => [
    60, 120, 180, 240, 300, 30, 90, 150, 210, 270, 330,
  ],
  [ColorScheme.SeedOfLife]: () => [51.4, 102.8, 154.2, 205.6, 257, 308.4],
  [ColorScheme.GoldenSpiral]: () => repeat(3, (i) => i * GOLDEN_ANGLE),
  [ColorScheme.MetallicMeans]: () =>
    [1.618, 2.414, 3.303, 4.236].map((r) => 360 / r),
  [ColorScheme.ContinuedFraction]: () =>
    [22 / 7, 333 / 106, 355 / 113, 103993 / 33102].map((f) => f * 360),
  [ColorScheme.GoldenTrisection]: () => [360 * 0.4656, 360 * 0.6823],
  [ColorScheme.FareySequence]: () => [0, 1 / 3, 1 / 2, 2 / 3, 1].map((f) => f * 360),
  [ColorScheme.GoldenTriangle]: () => {
    const angle = Math.atan(1 / GOLDEN_RATIO) * (180 / Math.PI)
    return [angle, -angle]
  },
  [ColorScheme.SriYantra]: () => repeat(9, (i) => i * 20),
  [ColorScheme.KabbalahTreeOfLife]: () => repeat(10, (i) => i * 15),
  // i·(360/m) + φ·i — a ring of `m` segments with a winding twist per step, so the
  // offsets climb the circle `m` times while the twist carries them around.
  [ColorScheme.Torus]: ({ torusMajor, torusTwist }) =>
    repeat(6, (i) => i * (360 / torusMajor) + torusTwist[0] * i),
  [ColorScheme.CelticKnot]: () => repeat(8, (i) => i * 45),
  [ColorScheme.Labirinth]: () => repeat(7, (i) => i * 10),
  [ColorScheme.StarTetrahedron]: () => [0, 90, 180, 270],
  [ColorScheme.Enneagram]: () => repeat(9, (i) => (i - 1) * 40),
  [ColorScheme.Hexagram]: () => repeat(6, (i) => (i - 1) * 60),
  [ColorScheme.ChakraSymbols]: () => repeat(7, (i) => i * 30),
  // Two rings, one per winding, set half a turn apart so the pair reads as two tori
  // rather than one clumped ring.
  [ColorScheme.DoubleTorus]: ({ torusMajor, torusTwist }) =>
    [0, 1].flatMap((j) =>
      repeat(3, (i) => j * 180 + i * (360 / torusMajor) + torusTwist[j])
    ),
  // i·(360/k) — a k-fold petal. `k` may divide into the count, so a duplicate of the
  // base is possible for small k; that is the same as every other cyclical scheme.
  [ColorScheme.RosettePattern]: ({ rosetteFold }) =>
    repeat(8, (i) => (i * 360) / rosetteFold),
  // Layer i is a regular nᵢ-gon, so its offset is one of its own vertices.
  [ColorScheme.NestedPolygons]: ({ nestedSides }) =>
    nestedSides.map((n, i) => (i + 1) * (360 / n)),
}

const DEFAULT_SHAPE: ShapeParams = {
  nestedSides: [3, 4, 5, 6, 8],
  rosetteFold: 7,
  torusMajor: 7,
  torusTwist: [45, 72],
}

/** The offsets a scheme folds around the base hue. Never depends on the hue. */
export function schemeOffsets(
  scheme: ColorScheme,
  shape: ShapeParams = DEFAULT_SHAPE
): number[] {
  return (SCHEME_OFFSETS[scheme] ?? (() => []))(shape)
}

/** Pool length per scheme. Fixed by construction — offset counts are shape-independent. */
const SCHEME_POOL_LENGTH: Record<string, number> = Object.fromEntries(
  Object.entries(SCHEME_OFFSETS).map(([name, offsets]) => [
    name,
    1 + offsets(DEFAULT_SHAPE).length,
  ])
)

/**
 * How many hues a scheme produces. A function of the scheme alone — never of the hue
 * or the shape — which is what lets slot indices stay meaningful across a Base Hue
 * change and across a shape redraw.
 */
export function schemePoolLength(scheme: ColorScheme): number {
  return SCHEME_POOL_LENGTH[scheme] ?? 1
}

/**
 * The scheme's hue pool, entry k = `(baseHue + offsetₖ) mod 360`.
 *
 * Entry 0 is always the base hue itself. Every entry is a rotation of the base, so a
 * Base Hue change rotates the whole pool and preserves every relationship inside it.
 */
export function generateSchemeColors(
  baseHue: number,
  scheme: ColorScheme,
  shape: ShapeParams = DEFAULT_SHAPE
): number[] {
  return [0, ...schemeOffsets(scheme, shape)].map((offset) =>
    normaliseHue(baseHue + offset)
  )
}
