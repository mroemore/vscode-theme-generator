// Theme → syntax/ANSI linking.
//
// A link makes a syntax or ANSI colour *derive from* a theme colour: the target is
// always a copy of the source, optionally readability-adjusted. Direction is strictly
// top-down — a theme colour can feed many targets, a target cannot be a source, and a
// syntax or ANSI colour can never feed anything.
//
// ── Why this module is the only place links are applied ───────────────────────
// Every link is resolved in one pure function, `applyLinks`, which takes the *base*
// (generator-produced) colours and returns the *displayed* ones. Base and display are
// held separately by `ThemeContext` for two reasons the design requires:
//
//  * Unlink is exact and instant — it re-displays the base, which was never discarded
//    and never re-generated, so "revert to the seeded colour" cannot drift. This is
//    what Phase B (a stable assignment) was a prerequisite for.
//  * A link may override a *locked* target (§5.5). The lock applies to the base; if the
//    displayed value were the only copy, unlinking would restore the linked colour as
//    though it were the locked one.
//
// ── Target identity ───────────────────────────────────────────────────────────
// A target is named by a flat id, following the convention the app already uses for
// `lockedColors` and `activeColor`: a syntax key is bare (`keyword`) and an ANSI key
// carries the `ansi` prefix (`ansiRed`). `Links` is a `Record` keyed by that id, so
// "at most one link per target" is structural rather than enforced — a new link
// overwrites, and there is no array to grow a duplicate into.

import Color from 'color'
import { adjustCommentColor, ensureReadability } from '@/lib/utils/colorUtils'
import { ansiSpec } from './ansi'
import { syntaxSpec } from './syntax'
import type { AnsiColors, SyntaxColors, UIColors } from '@/lib/types/colors'
import type { UIKey } from './ui'

/** `keyword` for syntax, `ansiRed` for ANSI — the app's existing flat-key convention. */
export type LinkTargetId = string

export interface Link {
  /** Theme colours only. Direction is top-down. */
  source: UIKey
  /**
   * `true` — readability-adjusted copy, the default. `false` — raw alias, the hex
   * exactly as the source has it. See the contrast floors below.
   */
  adjust: boolean
}

/** One link per target by construction. */
export type Links = Record<LinkTargetId, Link>

export const isAnsiTarget = (target: LinkTargetId): boolean =>
  target.startsWith('ansi')

/** The bare colour key behind a target id. */
export const targetKey = (target: LinkTargetId): string =>
  isAnsiTarget(target) ? target.slice(4) : target

/** The flat target id for an ANSI colour key. */
export const ansiTargetId = (key: string): LinkTargetId => `ansi${key}`

/** Remove a target's link, returning the same object when there was none. */
export function dropLink(links: Links, target: LinkTargetId): Links {
  if (!(target in links)) return links
  const next = { ...links }
  delete next[target]
  return next
}

/**
 * Every target fed by a source. Cheap: the link count is at most 48.
 */
export function targetsOf(links: Links, source: UIKey): LinkTargetId[] {
  return Object.keys(links).filter((id) => links[id].source === source)
}

/**
 * The contrast floors and the comment band, read from the *same spec tables the
 * generator uses*. Deriving them rather than restating them is what keeps a link from
 * drifting away from the colour it stands in for: change a floor in one place and both
 * the generated colour and its linked copy move together.
 */
function adjustForTarget(
  raw: string,
  target: LinkTargetId,
  background: string,
  isDark: boolean
): string {
  if (isAnsiTarget(target)) {
    // `Black` and `BrightBlack` are the two rows the generator exempts — the terminal's
    // darkest end is meant to be near-invisible against a dark background.
    const key = targetKey(target) as keyof typeof ansiSpec
    if (!ansiSpec[key]?.readable) return raw
    return ensureReadability(raw, background, 4.5)
  }

  const key = targetKey(target) as keyof typeof syntaxSpec
  const policy = syntaxSpec[key]?.readability
  if (!policy || policy.kind === 'none') return raw
  if (policy.kind === 'floor') {
    return ensureReadability(raw, background, policy.contrast)
  }
  // `floor-then-band`, i.e. `comment`: floor at the pre value, then pull into the
  // low-contrast band so a linked comment reads like a comment rather than a token.
  return adjustCommentColor(
    ensureReadability(raw, background, policy.pre),
    background,
    isDark ? policy.band.dark[0] : policy.band.light[0],
    isDark ? policy.band.dark[1] : policy.band.light[1]
  )
}

export interface LinkResolutionInput {
  /** The theme colours, post-readability — the source values. */
  colors: UIColors
  /** The generator's syntax palette, before any link is applied. */
  baseSyntaxColors: SyntaxColors
  /** The generator's terminal palette, before any link is applied. */
  baseAnsiColors: AnsiColors
  links: Links
  isDark: boolean
}

/**
 * Derive the displayed syntax and terminal palettes from the bases.
 *
 * When `links` is empty this returns copies of the bases unchanged, which is what keeps
 * a link-free theme byte-identical to one generated before linking existed.
 */
export function applyLinks(input: LinkResolutionInput): {
  syntaxColors: SyntaxColors
  ansiColors: AnsiColors
} {
  const { colors, baseSyntaxColors, baseAnsiColors, links, isDark } = input

  const syntaxColors = { ...baseSyntaxColors }
  const ansiColors = { ...baseAnsiColors }
  const background = colors.BG1

  for (const [target, link] of Object.entries(links)) {
    const source = colors[link.source]
    if (source === undefined) continue

    // Alpha is stripped here, once, so `adjust` toggles readability only and never
    // alpha — which is what makes all 16 theme colours usable as sources.
    const raw = Color(source).hex()
    const displayed = link.adjust
      ? adjustForTarget(raw, target, background, isDark)
      : raw

    const key = targetKey(target)
    if (isAnsiTarget(target)) {
      if (key in ansiColors) ansiColors[key as keyof AnsiColors] = displayed
    } else if (key in syntaxColors) {
      syntaxColors[key as keyof SyntaxColors] = displayed
    }
  }

  return { syntaxColors, ansiColors }
}
