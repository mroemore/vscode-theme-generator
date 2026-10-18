// The 32 syntax colours: one spec row per key, plus the key tuple that drives the
// `SyntaxColors` type and the Zod schema.
//
// Accumulated knowledge this table encodes (previously scattered across the type,
// the initial map, the generator, the slider map and the Zod schema):
//
//  * Six "groups" share one pool slot per generation: function, variable, type,
//    punctuation, tag, control. The six group indices are drawn up-front, in the
//    order of `SYNTAX_GROUPS`, before any per-key row is evaluated.
//  * `comment` is the only row that draws its own pool index *and* reads the
//    inverse (low-contrast) lightness base.
//  * Every key draws in the order hue-index → lightness-shift → hue-shift, mirroring
//    the argument evaluation order of the original `generateColor(...)` call.
//  * `comment` is exempt from the saturation-slider pass (`sliderExcluded`) but is
//    *not* exempt from the readability floor: it is floored at 5.5 first and only
//    then pushed into its 3.0–3.25 (dark) / 1.5–2.5 (light) band.
//  * `controlImport`'s slider multiplier disagrees with its generation multiplier
//    (1.05 vs 0.75). Recorded as-is for the parity gate; reconciled in step A6.

import type { Drawable, KeySpec } from './spec'

export const SYNTAX_KEYS = [
  'keyword',
  'comment',
  'function',
  'functionCall',
  'variable',
  'variableDeclaration',
  'variableProperty',
  'type',
  'typeParameter',
  'constant',
  'class',
  'parameter',
  'property',
  'operator',
  'storage',
  'punctuation',
  'punctuationQuote',
  'punctuationBrace',
  'punctuationComma',
  'selector',
  'modifier',
  'other',
  'language',
  'control',
  'controlFlow',
  'controlImport',
  'tag',
  'tagPunctuation',
  'attribute',
  'support',
  'unit',
  'datetime',
] as const

export type SyntaxKey = (typeof SYNTAX_KEYS)[number]

/** Pool slots shared by related tokens. Order is the index draw order. */
export const SYNTAX_GROUPS = [
  'function',
  'variable',
  'type',
  'punctuation',
  'tag',
  'control',
] as const

export type SyntaxGroup = (typeof SYNTAX_GROUPS)[number]

export interface SyntaxKeySpec extends Omit<KeySpec, 'hue' | 'lightness'> {
  /** Shared pool slot; omitted on keys that draw their own index. */
  group?: SyntaxGroup
  /** Draw a fresh pool index for this key instead of reusing the group's. */
  ownIndex?: boolean
  lightShift: Drawable
  hueShift: Drawable
  /** Read the low-contrast lightness base instead of the high-contrast one. */
  inverseLightness?: boolean
}

const FLOOR_55 = { kind: 'floor', contrast: 5.5 } as const

export const syntaxSpec: Record<SyntaxKey, SyntaxKeySpec> = {
  keyword: {
    initial: '#569CD6',
    ownIndex: true,
    sat: 1.1,
    lightShift: { min: 0, max: 13 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  comment: {
    initial: '#6A9955',
    ownIndex: true,
    sat: 0.5,
    lightShift: 0,
    hueShift: 0,
    inverseLightness: true,
    sliderExcluded: true,
    readability: {
      kind: 'floor-then-band',
      pre: 5.5,
      band: { dark: [3, 3.25], light: [1.5, 2.5] },
    },
  },
  function: {
    initial: '#DCDCAA',
    group: 'function',
    sat: 1.05,
    lightShift: { min: 0, max: 7 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  functionCall: {
    initial: '#DCDCAA',
    group: 'function',
    sat: 1,
    lightShift: { min: 5, max: 13 },
    hueShift: { min: 13, max: 26 },
    readability: FLOOR_55,
  },
  variable: {
    initial: '#9CDCFE',
    group: 'variable',
    sat: 0.9,
    lightShift: { min: 0, max: 3 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  variableDeclaration: {
    initial: '#9CDCFE',
    group: 'variable',
    sat: 0.95,
    lightShift: { min: 0, max: 9 },
    hueShift: { min: 13, max: 26 },
    readability: FLOOR_55,
  },
  variableProperty: {
    initial: '#9CDCFE',
    group: 'variable',
    sat: 0.85,
    lightShift: { min: 0, max: 6 },
    hueShift: { min: 17, max: 39 },
    readability: FLOOR_55,
  },
  type: {
    initial: '#4EC9B0',
    group: 'type',
    sat: 1.05,
    lightShift: { min: 0, max: 5 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  typeParameter: {
    initial: '#4EC9B0',
    group: 'type',
    sat: 1,
    lightShift: { min: 0, max: 5, sub: true },
    hueShift: { min: 15, max: 27 },
    readability: FLOOR_55,
  },
  constant: {
    initial: '#4FC1FF',
    ownIndex: true,
    sat: 1.15,
    lightShift: { min: 0, max: 9 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  class: {
    initial: '#4EC9B0',
    ownIndex: true,
    sat: 1.1,
    lightShift: { min: 0, max: 3 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  parameter: {
    initial: '#9CDCFE',
    ownIndex: true,
    sat: 0.9,
    lightShift: { min: 0, max: 7 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  property: {
    initial: '#9CDCFE',
    ownIndex: true,
    sat: 0.95,
    lightShift: { min: 3, max: 9 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  operator: {
    initial: '#D4D4D4',
    ownIndex: true,
    sat: 0.7,
    lightShift: { min: 0, max: 13 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  storage: {
    initial: '#C586C0',
    ownIndex: true,
    sat: 1.05,
    lightShift: { min: 0, max: 5 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  punctuation: {
    initial: '#D4D4D4',
    group: 'punctuation',
    sat: 0.4,
    lightShift: { min: 3, max: 15 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  punctuationQuote: {
    initial: '#D4D4D4',
    group: 'punctuation',
    sat: 0.45,
    lightShift: { min: 5, max: 23 },
    hueShift: { min: 9, max: 17 },
    readability: FLOOR_55,
  },
  punctuationBrace: {
    initial: '#D4D4D4',
    group: 'punctuation',
    sat: 0.4,
    lightShift: { min: 6, max: 19 },
    hueShift: { min: 13, max: 21 },
    readability: FLOOR_55,
  },
  punctuationComma: {
    initial: '#D4D4D4',
    group: 'punctuation',
    sat: 0.45,
    lightShift: { min: 5, max: 23 },
    hueShift: { min: 0, max: 15 },
    readability: FLOOR_55,
  },
  selector: {
    initial: '#D7BA7D',
    ownIndex: true,
    sat: 1.05,
    lightShift: { min: 0, max: 7 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  modifier: {
    initial: '#C586C0',
    ownIndex: true,
    sat: 1,
    lightShift: { min: 0, max: 5 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  other: {
    initial: '#D4D4D4',
    ownIndex: true,
    sat: 1.1,
    lightShift: { min: 0, max: 6, sub: true },
    hueShift: 0,
    readability: FLOOR_55,
  },
  language: {
    initial: '#D4D4D4',
    ownIndex: true,
    sat: 1.2,
    lightShift: { min: 0, max: 9, sub: true },
    hueShift: 0,
    readability: FLOOR_55,
  },
  control: {
    initial: '#C586C0',
    group: 'control',
    sat: 1.15,
    lightShift: { min: 0, max: 13, sub: true },
    hueShift: 0,
    readability: FLOOR_55,
  },
  controlFlow: {
    initial: '#C586C0',
    group: 'control',
    sat: 1.1,
    lightShift: { min: 0, max: 5, sub: true },
    hueShift: { min: 15, max: 27 },
    readability: FLOOR_55,
  },
  controlImport: {
    initial: '#C586C0',
    group: 'control',
    // A6: was 1.05 on the slider — unified on the generator's 0.75, so imports read
    // dimmer than `control`/`controlFlow` consistently in both paths.
    sat: 0.75,
    lightShift: { min: 0, max: 7, sub: true },
    hueShift: { min: 9, max: 17 },
    readability: FLOOR_55,
  },
  tag: {
    initial: '#C586C0',
    group: 'tag',
    sat: 1.1,
    lightShift: { min: 3, max: 9 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  tagPunctuation: {
    initial: '#C586C0',
    group: 'tag',
    sat: 1,
    lightShift: { min: 0, max: 6 },
    hueShift: { min: 9, max: 17 },
    readability: FLOOR_55,
  },
  attribute: {
    initial: '#C586C0',
    ownIndex: true,
    sat: 0.95,
    lightShift: { min: 0, max: 10 },
    hueShift: 0,
    readability: FLOOR_55,
  },
  support: {
    initial: '#C586C0',
    ownIndex: true,
    sat: 1.15,
    lightShift: { min: 0, max: 7, sub: true },
    hueShift: 0,
    readability: FLOOR_55,
  },
  unit: {
    initial: '#D4D4D4',
    ownIndex: true,
    sat: 1.1,
    lightShift: { min: 0, max: 5, sub: true },
    hueShift: 0,
    readability: FLOOR_55,
  },
  datetime: {
    initial: '#D4D4D4',
    ownIndex: true,
    sat: 1.05,
    lightShift: { min: 0, max: 5 },
    hueShift: 0,
    readability: FLOOR_55,
  },
}
