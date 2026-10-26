// The theme record builder and the record-opener (design §1.1–§1.2).
//
// A saved theme is both its inputs and its resolved palette. `purePalette` sits beside
// `palette` so that reopening can tell the two apart per key: a key where the two agree
// is one the user never touched, and it adopts the freshly resolved value; a key where
// they disagree is a hand edit, and it is kept exactly as saved. That comparison is the
// whole mechanism — there is no other "edited" flag.
//
// `palette` and `purePalette` are *pre-link* (base) palettes: they hold the generator's
// colours before any link is applied. Applying the links for display is the caller's
// business, so a save never writes a linked colour into a base field and "unlink" can
// always revert a target to the generator's seeded colour.

import type { Links } from '@/lib/colors/links'
import { resolvePalette } from '@/lib/themes/resolve'
import { SCHEMA_VERSION } from '@/lib/themes/schema'
import type {
  SavedTheme,
  ThemeInputs,
  ThemePalette,
} from '@/lib/themes/schema'
import type { AnsiColors, ColorScheme, SyntaxColors, UIColors } from '@/lib/types/colors'

// The subset of `ThemeState` this module consumes. Declared structurally rather than
// imported so `record.ts` stays free of a React/context dependency; `lockedColors` is
// widened to `ReadonlySet` because a record builder never mutates the live set.
export interface ThemeStateLike {
  isDark: boolean
  baseHue: number
  uiSaturation: number
  syntaxSaturation: number
  scheme: ColorScheme
  assignment: ThemeInputs['assignment']
  colors: UIColors
  baseSyntaxColors: SyntaxColors
  baseAnsiColors: AnsiColors
  syntaxColors: SyntaxColors
  ansiColors: AnsiColors
  links: Links
  lockedColors: ReadonlySet<string>
}

export interface RecordMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  propsHash: string
}

/**
 * The generator's palette with no hand edits: resolve from the inputs, carrying only the
 * locked keys through from `palette`. Locks are the *only* carried keys — everything else
 * is regenerated. Do not widen this: carrying a hand-edited key would erase the very
 * distinction `purePalette` exists to record. The result is pre-link; links are applied
 * only for display by the caller.
 */
export function pureOf(
  inputs: ThemeInputs,
  locks: ReadonlySet<string>,
  palette: ThemePalette
): ThemePalette {
  const base = resolvePalette(inputs, locks, palette)
  return { ui: base.ui, syntax: base.syntax, ansi: base.ansi }
}

/** Assemble a {@link SavedTheme} from the live theme state and its library metadata. */
export function toRecord(s: ThemeStateLike, meta: RecordMeta): SavedTheme {
  const inputs: ThemeInputs = {
    isDark: s.isDark,
    baseHue: s.baseHue,
    scheme: s.scheme,
    uiSaturation: s.uiSaturation,
    syntaxSaturation: s.syntaxSaturation,
    assignment: s.assignment,
  }
  const palette: ThemePalette = {
    ui: s.colors,
    syntax: s.baseSyntaxColors,
    ansi: s.baseAnsiColors,
  }
  const locks = [...s.lockedColors]
  return {
    schemaVersion: SCHEMA_VERSION,
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    inputs,
    palette,
    purePalette: pureOf(inputs, s.lockedColors, palette),
    locks,
    links: s.links,
    propsHash: meta.propsHash,
  }
}

/**
 * Assemble a record from an already-merged `{ inputs, palette, links, locks }` — the
 * shape `openRecord` returns. Used by import (Task 10) to rebuild a record from a file
 * without going through a live theme state.
 */
export function recordFromOpen(
  open: {
    inputs: ThemeInputs
    palette: ThemePalette
    links: Links
    locks: ReadonlySet<string>
  },
  meta: RecordMeta
): SavedTheme {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    inputs: open.inputs,
    palette: open.palette,
    purePalette: pureOf(open.inputs, open.locks, open.palette),
    locks: [...open.locks],
    links: open.links,
    propsHash: meta.propsHash,
  }
}

/** Merge one panel: adopt the fresh value only where the saved palette was untouched. */
function mergePanel<K extends string>(
  saved: Record<K, string>,
  pure: Record<K, string>,
  fresh: Record<K, string>
): Record<K, string> {
  const merged = {} as Record<K, string>
  for (const key of Object.keys(saved) as K[]) {
    merged[key] = saved[key] === pure[key] ? fresh[key] : saved[key]
  }
  return merged
}

/**
 * Reopen a record (design §1.2, option A). Re-resolve from the inputs with the locks
 * carried, keep each key the user hand-edited exactly as saved, and adopt the fresh value
 * for every key they did not. The returned palette is PRE-link (design §1.2); the caller
 * applies the links for display.
 *
 * A foreign (palette-only) record has no inputs to re-resolve from; its stored palette is
 * returned verbatim.
 */
export function openRecord(record: SavedTheme): {
  inputs: ThemeInputs | undefined
  palette: ThemePalette
  links: Links
  locks: ReadonlySet<string>
} {
  const locks = new Set(record.locks)
  if (record.inputs === undefined) {
    return {
      inputs: undefined,
      palette: record.palette,
      links: record.links,
      locks,
    }
  }

  const fresh = pureOf(record.inputs, locks, record.palette)
  const merged: ThemePalette = {
    ui: mergePanel(record.palette.ui, record.purePalette.ui, fresh.ui),
    syntax: mergePanel(record.palette.syntax, record.purePalette.syntax, fresh.syntax),
    ansi: mergePanel(record.palette.ansi, record.purePalette.ansi, fresh.ansi),
  }

  // `merged` is PRE-link (design §1.2): the caller relinks it for display. No relink here
  // — writing linked values back would make a linked target look hand-edited forever.
  return {
    inputs: record.inputs,
    palette: merged,
    links: record.links,
    locks,
  }
}
