import * as monaco from 'monaco-editor'
import { z } from 'zod'

import { ColorScheme } from '@/lib/colors/schemes'
import { ANSI_KEYS, ansiSpec } from '@/lib/colors/ansi'
import { SYNTAX_KEYS, syntaxSpec } from '@/lib/colors/syntax'
import { UI_KEYS, uiSpec } from '@/lib/colors/ui'
import { makeInitial } from '@/lib/colors/spec'
import type { AnsiKey } from '@/lib/colors/ansi'
import type { SyntaxKey } from '@/lib/colors/syntax'
import type { UIKey } from '@/lib/colors/ui'

// Re-exported for the existing importers (`@/lib/types/colors`).
export { ColorScheme }

// ── Domain types ──────────────────────────────────────────────────────────────
// Derived from the spec key tuples, so adding a colour to `src/lib/colors/<domain>.ts`
// is the only edit needed: type, initial value, generator, saturation and schema all
// follow from it. `Record<K, KeySpec>` on the spec makes a missing or misspelled row a
// compile error, so the tuple and the spec cannot drift apart.

export type UIColors = { [K in UIKey]: string }
export type AnsiColors = { [K in AnsiKey]: string }
export type SyntaxColors = { [K in SyntaxKey]: string }

export const initialColors: UIColors = makeInitial(uiSpec)
export const initialSyntaxColors: SyntaxColors = makeInitial(syntaxSpec)
export const initialAnsiColors: AnsiColors = makeInitial(ansiSpec)

export type ThemeGenerationOptions = {
  isDark: boolean
  baseHue?: number
  uiSaturation?: number
  syntaxSaturation?: number
  scheme?: ColorScheme
  few?: boolean
}

export type DisplayColors = {
  [key: string]: string
}

export const presets = {
  vscode: { baseHue: 210, scheme: ColorScheme.Analogous },
  monokai: { baseHue: 70, scheme: ColorScheme.Complementary },
  solarized: { baseHue: 45, scheme: ColorScheme.Triadic },
  nord: { baseHue: 220, scheme: ColorScheme.Analogous },
  dracula: { baseHue: 260, scheme: ColorScheme.SplitComplementary },
}

export type VSCodeTheme = {
  name?: string
  type: 'light' | 'dark'
  semanticClass: string
  semanticHighlighting: boolean
  colors: {
    [key: string]: string
  }
  tokenColors: {
    name?: string
    scope: string[] | string
    settings: {
      foreground?: string
      background?: string
      fontStyle?: string
    }
  }[]
  semanticTokenColors: {
    [key: string]: string
  }
}
export type IMonacoThemeRule = monaco.editor.ITokenThemeRule[]

// ── Schemas ───────────────────────────────────────────────────────────────────
// One `z.string()` per key, in declaration order, built from the same tuples.
const stringShape = <K extends string>(
  keys: readonly K[]
): Record<K, z.ZodString> =>
  Object.fromEntries(keys.map((key) => [key, z.string()])) as Record<
    K,
    z.ZodString
  >

export const UIColorsSchema = z.object(stringShape(UI_KEYS))
export const SyntaxColorsSchema = z.object(stringShape(SYNTAX_KEYS))
export const AnsiColorsSchema = z.object(stringShape(ANSI_KEYS))

// Update the SavedThemeSchema to match the database schema
export const SavedThemeSchema = z.object({
  id: z.number(),
  name: z.string(),
  userId: z.string(),
  uiColors: UIColorsSchema,
  syntaxColors: SyntaxColorsSchema,
  ansiColors: AnsiColorsSchema,
  isDark: z.boolean(),
  baseHue: z.number(),
  uiSaturation: z.number(),
  syntaxSaturation: z.number(),
  scheme: z.union([z.nativeEnum(ColorScheme), z.string()]), // Accept both enum and string
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type SavedTheme = z.infer<typeof SavedThemeSchema>
