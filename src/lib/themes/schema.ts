import { z } from 'zod'

import { ANSI_KEYS } from '@/lib/colors/ansi'
import type { Assignment } from '@/lib/colors/assignment'
import type { Links } from '@/lib/colors/links'
import { SYNTAX_GROUPS, SYNTAX_KEYS } from '@/lib/colors/syntax'
import { UI_KEYS } from '@/lib/colors/ui'
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

// Structural validation, not blind acceptance. The resolvers dereference
// `assignment.ui.entries[key]`, `assignment.syntax.entries[key]` and
// `assignment.ansi.entries[key]` for every key, so a block missing one of those
// objects throws inside `resolvePalette`. Validate the shape the resolver actually
// reads, before anything resolves; passthrough keeps future plain-JSON fields.
const slotSchema = z.object({
  pool: z.enum(['base', 'ac1', 'ac2']),
  index: z.number(),
})

const uiEntrySchema = z
  .object({
    slotIndex: z.number(),
    exprJitter: z.number(),
    hueJitter: z.number(),
    satJitter: z.number(),
    lightJitter: z.number(),
  })
  .passthrough()

const syntaxEntrySchema = z
  .object({ slot: slotSchema, lightShiftRoll: z.number(), hueShiftRoll: z.number() })
  .passthrough()

const ansiEntrySchema = z
  .object({ hueRoll: z.number(), satRoll: z.number(), lightRoll: z.number() })
  .passthrough()

const shapeSchema = z
  .object({
    nestedSides: z.array(z.number()),
    rosetteFold: z.number(),
    torusMajor: z.number(),
    torusTwist: z.array(z.number()),
  })
  .passthrough()

/** A record that must carry every known key, each validated by `entry`. */
function keyedRecord<K extends string>(keys: readonly K[], entry: z.ZodTypeAny): z.ZodTypeAny {
  return z.record(entry).superRefine((value, ctx) => {
    for (const key of keys) {
      if (!(key in value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `missing ${key}` })
      }
    }
  })
}

const assignmentSchema = z
  .object({
    seed: z.number(),
    poolMode: z.enum(['full', 'base']),
    shape: shapeSchema,
    ui: z
      .object({
        bgRoll: z.number(),
        fgRoll: z.number(),
        entries: keyedRecord(UI_KEYS, uiEntrySchema),
      })
      .passthrough(),
    syntax: z
      .object({
        groups: keyedRecord(SYNTAX_GROUPS, slotSchema),
        entries: keyedRecord(SYNTAX_KEYS, syntaxEntrySchema),
      })
      .passthrough(),
    ansi: z
      .object({
        seed: z.number(),
        satRoll: z.number(),
        lightRoll: z.number(),
        entries: keyedRecord(ANSI_KEYS, ansiEntrySchema),
      })
      .passthrough(),
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

/**
 * Validate an `x-themegen.inputs` block before a resolver ever reads it. The resolver
 * dereferences nested entries per key, so `readInputs`-style spot checks are not enough:
 * this returns the block only when the whole shape the generator walks is present.
 */
export function parseThemeInputs(raw: unknown): ThemeInputs | null {
  const parsed = inputsSchema.safeParse(raw)
  return parsed.success ? (parsed.data as unknown as ThemeInputs) : null
}

// The schemas above are structural (records, not the interfaces' exact brands), so the
// inferred type is not assignable to `SavedTheme`; the cast states the intent without
// `any`.
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
