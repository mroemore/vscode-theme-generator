// The Assignment: every random choice a theme makes, drawn once and stored.
//
// This is the module that makes a theme *stable*. Before it, each generation call
// re-threw every random value, so the palette was re-dealt whenever any input moved —
// dragging Base Hue re-rolled which hue each token got, and the same inputs could
// produce two different themes in a row. Now an Assignment is drawn once and the
// generators only ever *resolve* it, consuming no randomness at all.
//
// The vocabulary: an assignment stores **normalised rolls** in [0, 1), never concrete
// hues or lightnesses. Each roll is interpreted against the spec range it belongs to at
// resolve time (`resolveDrawable`, `resolveLightnessExpr`). That keeps the assignment
// independent of the spec's literal numbers — tuning a range re-interprets the same
// roll instead of reshaping the assignment — and it is the mechanism behind the
// mode-toggle rule below.
//
// Consequences the rest of Phase B depends on:
//
//  * **Base Hue becomes a rotation.** A hue is `pool[slotIndex] + hueJitter`, and every
//    entry of a scheme pool is `baseHue + offsetₖ`, so adding δ to `baseHue` adds δ to
//    every pool-derived hue. Colour *relationships* survive; only the rotation changes.
//  * **A theme is reproducible from its `seed`.** Everything random flows from
//    `mulberry32(seed)`, including the header values in `drawTheme`.
//  * **`poolMode` lives here, not in a call argument.** The dark/light toggle reaches
//    generation without a `few` flag; if pool *length* could change while the
//    assignment stood, every slot index would point somewhere else and hue stability
//    would break on the mode toggle.
//  * **`bgRoll`/`fgRoll` are normalised, never absolute lightness.** The base is a
//    mode-chosen *range* (0-15 dark / 85-100 light), so the toggle re-ranges the same
//    "how dark" choice rather than rolling a near-black background into a light theme.

import { mulberry32 } from '@/lib/utils/math'
import { generateSchemeColors } from '@/lib/utils/colorUtils'
import { ColorScheme } from './schemes'
import { UI_KEYS } from './ui'
import { SYNTAX_GROUPS, SYNTAX_KEYS, syntaxSpec } from './syntax'
import { ANSI_KEYS } from './ansi'
import type { UIKey } from './ui'
import type { SyntaxGroup, SyntaxKey } from './syntax'
import type { AnsiKey } from './ansi'

export type PoolMode = 'full' | 'base'
export type PoolName = 'base' | 'ac1' | 'ac2'
export type Rng = () => number

/** A pool, plus an index into it. `index` is reduced modulo the pool length on use. */
export interface PoolSlot {
  pool: PoolName
  index: number
}

export interface UIEntry {
  /** Index into the scheme pool. Unused by `hue: { kind: 'fixed' }` rows. */
  slotIndex: number
  /** Roll for the lightness expression's own jitter, if it has any. */
  exprJitter: number
  /** The former `generateColor` ±5°/±10%/±5 lightness jitters, per colour. */
  hueJitter: number
  satJitter: number
  lightJitter: number
}

export interface SyntaxEntry {
  slot: PoolSlot
  lightShiftRoll: number
  hueShiftRoll: number
}

/** Three normalised rolls, interpreted per recipe (see `src/lib/colors/ansi.ts`). */
export interface AnsiEntry {
  hueRoll: number
  satRoll: number
  lightRoll: number
}

/** Per-theme shape constants for the schemes that fold a curve rather than rotate. */
export interface ShapeParams {
  nestedSides: number[]
  rosetteK: number
  torusM: number
  torusWinding: number[]
}

export interface Assignment {
  seed: number
  poolMode: PoolMode
  ui: {
    bgRoll: number
    fgRoll: number
    entries: Record<UIKey, UIEntry>
  }
  syntax: {
    groups: Record<SyntaxGroup, PoolSlot>
    entries: Record<SyntaxKey, SyntaxEntry>
  }
  ansi: {
    /** Its own seed so "Regenerate ANSI" can redraw the terminal palette alone. */
    seed: number
    satRoll: number
    lightRoll: number
    entries: Record<AnsiKey, AnsiEntry>
  }
  shape: ShapeParams
}

/**
 * How many hues a scheme produces. A function of the scheme alone — never of the hue —
 * which is what lets slot indices stay meaningful across a Base Hue change.
 */
export function schemePoolLength(scheme: ColorScheme): number {
  return generateSchemeColors(0, scheme).length
}

function pickSlot(rng: Rng, poolMode: PoolMode, poolLength: number): PoolSlot {
  const pool: PoolName =
    poolMode === 'full'
      ? (['base', 'ac1', 'ac2'] as const)[Math.floor(rng() * 3)]
      : 'base'
  return { pool, index: Math.floor(rng() * poolLength) }
}

function drawAssignmentWith(
  rng: Rng,
  seed: number,
  scheme: ColorScheme,
  poolMode: PoolMode
): Assignment {
  const poolLength = schemePoolLength(scheme)

  const ui: Assignment['ui'] = {
    bgRoll: rng(),
    fgRoll: rng(),
    entries: {} as Record<UIKey, UIEntry>,
  }
  for (const key of UI_KEYS) {
    ui.entries[key] = {
      slotIndex: Math.floor(rng() * poolLength),
      exprJitter: rng(),
      hueJitter: rng(),
      satJitter: rng(),
      lightJitter: rng(),
    }
  }

  const groups = {} as Record<SyntaxGroup, PoolSlot>
  for (const group of SYNTAX_GROUPS) {
    groups[group] = pickSlot(rng, poolMode, poolLength)
  }

  const syntax: Assignment['syntax'] = {
    groups,
    entries: {} as Record<SyntaxKey, SyntaxEntry>,
  }
  for (const key of SYNTAX_KEYS) {
    const spec = syntaxSpec[key]
    syntax.entries[key] = {
      slot: spec.ownIndex ? pickSlot(rng, poolMode, poolLength) : groups[spec.group!],
      lightShiftRoll: rng(),
      hueShiftRoll: rng(),
    }
  }

  const ansi: Assignment['ansi'] = {
    seed,
    satRoll: rng(),
    lightRoll: rng(),
    entries: {} as Record<AnsiKey, AnsiEntry>,
  }
  for (const key of ANSI_KEYS) {
    ansi.entries[key] = { hueRoll: rng(), satRoll: rng(), lightRoll: rng() }
  }

  return {
    seed,
    poolMode,
    ui,
    syntax,
    ansi,
    shape: {
      nestedSides: [rng(), rng(), rng()].map((r) => 3 + Math.floor(r * 5)),
      rosetteK: 3 + Math.floor(rng() * 8),
      torusM: 5 + Math.floor(rng() * 7),
      torusWinding: [1 + Math.floor(rng() * 4), 1 + Math.floor(rng() * 4)],
    },
  }
}

function drawAnsiOnly(rng: Rng, seed: number): Assignment['ansi'] {
  const ansi: Assignment['ansi'] = {
    seed,
    satRoll: rng(),
    lightRoll: rng(),
    entries: {} as Record<AnsiKey, AnsiEntry>,
  }
  for (const key of ANSI_KEYS) {
    ansi.entries[key] = { hueRoll: rng(), satRoll: rng(), lightRoll: rng() }
  }
  return ansi
}

/** Draw a fresh assignment from a seed. */
export function drawAssignment(params: {
  seed: number
  scheme: ColorScheme
  poolMode: PoolMode
}): Assignment {
  return drawAssignmentWith(
    mulberry32(params.seed),
    params.seed,
    params.scheme,
    params.poolMode
  )
}

export interface ThemeSeed {
  seed: number
  baseHue: number
  uiSaturation: number
  syntaxSaturation: number
  scheme: ColorScheme
  poolMode: PoolMode
  assignment: Assignment
}

/**
 * Draw a whole new theme from one seed: the header values the Randomize buttons used to
 * scatter across `ThemeControls`, plus the assignment. One seed therefore reproduces a
 * complete theme — the ground Phase E's "revert to the seeded colour" stands on.
 */
export function drawTheme(
  seed: number,
  poolMode: PoolMode,
  schemes: ColorScheme[]
): ThemeSeed {
  const rng = mulberry32(seed)
  const baseHue = Math.floor(rng() * 360)
  const uiSaturation = 15 + Math.floor(rng() * 51) // was randomInteger(15, 65)
  const syntaxSaturation = 20 + Math.floor(rng() * 46) // was randomInteger(20, 65)
  const scheme = schemes[Math.floor(rng() * schemes.length)]
  const assignment = drawAssignmentWith(rng, seed, scheme, poolMode)
  return {
    seed,
    baseHue,
    uiSaturation,
    syntaxSaturation,
    scheme,
    poolMode,
    assignment,
  }
}

/**
 * Redraw only the ANSI block under a fresh seed, keeping UI and syntax untouched — the
 * "Regenerate ANSI Colors" button.
 */
export function redrawAnsi(assignment: Assignment, seed: number): Assignment {
  return { ...assignment, ansi: drawAnsiOnly(mulberry32(seed), seed) }
}

/**
 * Resolve a slot against a set of pools. A slot naming a pool that does not exist (base
 * mode has no ac1/ac2) falls back to the base pool at the same index, so a pool-mode
 * change never loses a hue outright.
 */
export function resolvePoolHue(
  pools: Partial<Record<PoolName, number[]>>,
  slot: PoolSlot
): number {
  const pool = pools[slot.pool] ?? pools.base
  if (!pool || pool.length === 0) return 0
  return pool[slot.index % pool.length]
}
