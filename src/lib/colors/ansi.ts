// The 16 ANSI/terminal colours.
//
// The recipes are deliberately irregular — the original was a 16-row object literal
// with six follow-up "brighten" passes — so each row names its own recipe rather than
// filling in shared columns. Two things are worth knowing:
//
//  * Draw order matters exactly as elsewhere. Generation runs two passes over this
//    record: pass 1 builds every non-derived row in declaration order (Black is a
//    literal and draws nothing), pass 2 derives each `spunBright` from its base. That
//    reproduces the original draw sequence, including the fact that BrightRed…
//    BrightCyan draw *after* White, BrightBlack and BrightWhite.
//  * A `hsl` channel with a span of 0 draws nothing (recorded as `[value, 0]`), which
//    is why BrightBlack costs one draw while White costs three.
//
// `initial` values below are VS Code's default dark terminal palette. Nothing consults
// them during generation; they exist so the domain has a single declared source for
// seeded/imported themes (see `initialAnsiColors`).

export const ANSI_KEYS = [
  'Black',
  'Red',
  'Green',
  'Yellow',
  'Blue',
  'Magenta',
  'Cyan',
  'White',
  'BrightBlack',
  'BrightRed',
  'BrightGreen',
  'BrightYellow',
  'BrightBlue',
  'BrightMagenta',
  'BrightCyan',
  'BrightWhite',
] as const

export type AnsiKey = (typeof ANSI_KEYS)[number]

export type AnsiRecipe =
  | { kind: 'literal'; value: string }
  /** Hue jittered ±30° around `hue`, saturation/lightness jittered around the theme base. */
  | { kind: 'spun'; hue: number }
  /** Derived from another key by lightening and saturating — evaluated in pass 2. */
  | { kind: 'spunBright'; base: AnsiKey }
  /** `Color.hsl(lo + rand·span, …)`; a zero span is not drawn. */
  | {
      kind: 'hsl'
      h: readonly [number, number]
      s: readonly [number, number]
      l: readonly [number, number]
    }

export interface AnsiSpecRow {
  initial: string
  recipe: AnsiRecipe
  /** Participates in the post-generation readability floor (4.5). */
  readable: boolean
}

export const ansiSpec: Record<AnsiKey, AnsiSpecRow> = {
  Black: { initial: '#000000', recipe: { kind: 'literal', value: '#000000' }, readable: false },
  Red: { initial: '#CD3131', recipe: { kind: 'spun', hue: 0 }, readable: true },
  Green: { initial: '#0DBC79', recipe: { kind: 'spun', hue: 120 }, readable: true },
  Yellow: { initial: '#E5E510', recipe: { kind: 'spun', hue: 45 }, readable: true }, // orange-yellow centre
  Blue: { initial: '#2472C8', recipe: { kind: 'spun', hue: 240 }, readable: true },
  Magenta: { initial: '#BC3FBC', recipe: { kind: 'spun', hue: 300 }, readable: true },
  Cyan: { initial: '#11A8CD', recipe: { kind: 'spun', hue: 180 }, readable: true },
  White: {
    initial: '#E5E5E5',
    recipe: { kind: 'hsl', h: [30, 30], s: [10, 15], l: [92, 8] }, // beige variation
    readable: true,
  },
  BrightBlack: {
    initial: '#666666',
    recipe: { kind: 'hsl', h: [0, 0], s: [0, 0], l: [20, 10] }, // darker grey
    readable: false,
  },
  BrightRed: { initial: '#F14C4C', recipe: { kind: 'spunBright', base: 'Red' }, readable: true },
  BrightGreen: { initial: '#23D18B', recipe: { kind: 'spunBright', base: 'Green' }, readable: true },
  BrightYellow: { initial: '#F5F543', recipe: { kind: 'spunBright', base: 'Yellow' }, readable: true },
  BrightBlue: { initial: '#3B8EEA', recipe: { kind: 'spunBright', base: 'Blue' }, readable: true },
  BrightMagenta: { initial: '#D670D6', recipe: { kind: 'spunBright', base: 'Magenta' }, readable: true },
  BrightCyan: { initial: '#29B8DB', recipe: { kind: 'spunBright', base: 'Cyan' }, readable: true },
  BrightWhite: {
    initial: '#FFFFFF',
    recipe: { kind: 'hsl', h: [30, 30], s: [5, 10], l: [97, 3] }, // slight beige tint
    readable: true,
  },
}
