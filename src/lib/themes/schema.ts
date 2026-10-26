import { z } from 'zod'

import type { Assignment } from '@/lib/colors/assignment'
import type { Links } from '@/lib/colors/links'
import {
  AnsiColorsSchema,
  ColorScheme,
  SyntaxColorsSchema,
  UIColorsSchema,
} from '@/lib/types/colors'
import type { AnsiColors, SyntaxColors, UIColors } from '@/lib/types/colors'

// The stored record for one saved theme (spec §1.1). `palette` is the pre-link (base)
// palette as edited — links are applied only for display, never stored — and
// `purePalette` is what the generator produced with no hand edits; the pair is what lets
// a reopen adopt generator fixes without discarding hand-edited colours. `inputs` is
// absent for a foreign (palette-only) import.

export const SCHEMA_VERSION = 1

export interface ThemeInputs {
  isDark: boolean
  baseHue: number
  scheme: ColorScheme
  uiSaturation: number
  syntaxSaturation: number
  assignment: Assignment
}

export interface ThemePalette {
  ui: UIColors
  syntax: SyntaxColors
  ansi: AnsiColors
}

export interface SavedTheme {
  schemaVersion: 1
  id: string
  name: string
  createdAt: number
  updatedAt: number
  inputs?: ThemeInputs
  palette: ThemePalette
  purePalette: ThemePalette
  locks: string[]
  links: Links
  propsHash: string
}

const paletteSchema = z.object({
  ui: UIColorsSchema,
  syntax: SyntaxColorsSchema,
  ansi: AnsiColorsSchema,
})

// Structural validation, not blind acceptance: a record missing `assignment.seed`
// is rejected. The inner blocks stay `z.unknown()` — the per-key palettes above are
// what actually guards the colours — and passthrough keeps future plain-JSON fields.
const assignmentSchema = z
  .object({
    seed: z.number(),
    poolMode: z.string(),
    shape: z.unknown(),
    ui: z.unknown(),
    syntax: z.unknown(),
    ansi: z.unknown(),
  })
  .passthrough()

const inputsSchema = z.object({
  isDark: z.boolean(),
  baseHue: z.number(),
  scheme: z.nativeEnum(ColorScheme),
  uiSaturation: z.number(),
  syntaxSaturation: z.number(),
  assignment: assignmentSchema,
})

const linksSchema = z.record(
  z.object({ source: z.string(), adjust: z.boolean() })
)

// `poolMode: z.string()` above widens past the `PoolMode` union, so the inferred type
// is not assignable to `SavedTheme`; the cast states the intent without `any`.
export const SavedThemeSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  inputs: inputsSchema.optional(),
  palette: paletteSchema,
  purePalette: paletteSchema,
  locks: z.array(z.string()),
  links: linksSchema,
  propsHash: z.string(),
}) as unknown as z.ZodType<SavedTheme>

export type ParseResult =
  | { ok: true; theme: SavedTheme }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'newer'; version: number }

// `schemaVersion` is read before the body is parsed (spec §2.3): a newer record is
// never loaded and never overwritten; anything else that fails to parse is invalid.
export function parseStoredTheme(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'invalid' }
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion
  if (typeof version === 'number' && version > SCHEMA_VERSION) {
    return { ok: false, reason: 'newer', version }
  }
  const parsed = SavedThemeSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, reason: 'invalid' }
  }
  return { ok: true, theme: parsed.data }
}
