// The 16 UI (theme) colours: one spec row per key, plus the key tuple that drives
// the `UIColors` type and the Zod schema.
//
// Declaration order is load-bearing: `generateThemeColors` iterates these rows in
// order and each row's draws land in the shared `Math.random` sequence. Do not
// reorder or regroup (see the note at the top of `spec.ts`).
//
// `sliderSat` is the saturation-slider multiplier, recorded separately only where it
// differs from the generation multiplier. It used to disagree for FG1, FG2 and INFO,
// which meant a colour's saturation depended on whether it was reached by generating
// or by dragging the slider (see `docs/.../2026-10-17-*.md` §0.1). Step A6 reconciled
// those three onto the slider's values, so no row carries `sliderSat` any more — the
// field stays in the spec vocabulary for future divergence.

import type { KeySpec } from './spec'

export const UI_KEYS = [
  'BG1',
  'BG2',
  'BG3',
  'FG1',
  'FG2',
  'FG3',
  'AC1',
  'AC2',
  'BORDER',
  'INFO',
  'ERROR',
  'WARNING',
  'SUCCESS',
  'lineHighlight',
  'selection',
  'findMatch',
] as const

export type UIKey = (typeof UI_KEYS)[number]

const FLOOR_45 = { kind: 'floor', contrast: 4.5 } as const
const NONE = { kind: 'none' } as const

export const uiSpec: Record<UIKey, KeySpec> = {
  BG1: {
    initial: '#1E1E1E',
    hue: { kind: 'pool' },
    sat: 0.1,
    sliderSat: 0.1,
    lightness: {
      dark: { kind: 'from', base: 'bgBase', jitter: { min: 0, max: 5 } },
      light: { kind: 'from', base: 'bgBase', jitter: { min: 0, max: 2, sub: true } },
    },
    readability: NONE,
  },
  BG2: {
    initial: '#252526',
    hue: { kind: 'pool' },
    sat: 0.15,
    sliderSat: 0.15,
    lightness: {
      dark: { kind: 'from', base: 'bgBase', jitter: { min: 0, max: 9 } },
      light: { kind: 'from', base: 'bgBase', jitter: { min: 0, max: 5, sub: true } },
    },
    readability: NONE,
  },
  BG3: {
    initial: '#2D2D30',
    hue: { kind: 'pool' },
    sat: 0.2,
    sliderSat: 0.2,
    lightness: {
      dark: { kind: 'from', base: 'bgBase', jitter: { min: 0, max: 13 } },
      light: { kind: 'from', base: 'bgBase', jitter: { min: 0, max: 7, sub: true } },
    },
    readability: NONE,
  },
  FG1: {
    initial: '#D4D4D4',
    hue: { kind: 'pool' },
    sat: 0.05, // A6: was 0.45 in the generator, 0.05 on the slider — unified on 0.05
    lightness: {
      dark: { kind: 'from', base: 'fgBase', jitter: { min: 0, max: 7, sub: true } },
      light: { kind: 'from', base: 'fgBase', jitter: { min: 0, max: 9 } },
    },
    readability: FLOOR_45,
  },
  FG2: {
    initial: '#CCCCCC',
    hue: { kind: 'pool' },
    sat: 0.1, // A6: was 0.45 in the generator, 0.1 on the slider — unified on 0.1
    lightness: {
      dark: { kind: 'from', base: 'fgBase', jitter: { min: 3, max: 15, sub: true } },
      light: { kind: 'from', base: 'fgBase', jitter: { min: 3, max: 15 } },
    },
    readability: FLOOR_45,
  },
  FG3: {
    initial: '#121212',
    hue: { kind: 'pool' },
    sat: 0.05,
    sliderSat: 0.05,
    lightness: {
      dark: { kind: 'from', base: 'bgBase', jitter: { min: 0, max: 5 } },
      light: { kind: 'from', base: 'bgBase', jitter: { min: 0, max: 5, sub: true } },
    },
    readability: NONE,
  },
  AC1: {
    initial: '#007ACC',
    hue: { kind: 'pool' },
    sat: 1.2,
    sliderSat: 1.2,
    lightness: {
      dark: { kind: 'const', value: 60 },
      // Anchored above the foreground band rather than at it. In light mode `fgBase` is
      // 0-15, so a jitter starting at 0 put an *accent* colour as dark as — or darker
      // than — the body text: a near-black accent on a white background. Starting 20
      // above the base keeps an accent at least 11 lightness above FG1 for the same
      // base, while still letting it vary with the theme.
      light: { kind: 'from', base: 'fgBase', jitter: { min: 20, max: 45 } },
    },
    readability: FLOOR_45,
  },
  AC2: {
    initial: '#0098FF',
    hue: { kind: 'pool' },
    sat: 1.1,
    sliderSat: 1.1,
    lightness: {
      dark: { kind: 'const', value: 65 },
      light: { kind: 'from', base: 'fgBase', jitter: { min: 24, max: 50 } },
    },
    readability: FLOOR_45,
  },
  BORDER: {
    initial: '#474747',
    hue: { kind: 'pool' },
    sat: 0.2,
    sliderSat: 0.2,
    lightness: {
      dark: { kind: 'from', base: 'bgBase', add: 10 },
      light: { kind: 'from', base: 'bgBase', add: -10 },
    },
    readability: NONE,
  },
  INFO: {
    initial: '#9CDCFE',
    hue: { kind: 'fixed', h: 210 }, // blue
    sat: 0.2, // A6: was 1.0 in the generator, 0.2 on the slider — unified on 0.2
    lightness: {
      dark: { kind: 'const', value: 65 },
      light: { kind: 'const', value: 45 },
    },
    readability: FLOOR_45,
  },
  ERROR: {
    initial: '#F48771',
    hue: { kind: 'fixed', h: 0 }, // red
    sat: 1.2,
    sliderSat: 1.2,
    lightness: {
      dark: { kind: 'const', value: 65 },
      light: { kind: 'const', value: 35 },
    },
    readability: FLOOR_45,
  },
  WARNING: {
    initial: '#CCA700',
    hue: { kind: 'fixed', h: 30 }, // orange
    sat: 1.1,
    sliderSat: 1.1,
    lightness: {
      dark: { kind: 'const', value: 65 },
      light: { kind: 'const', value: 35 },
    },
    readability: FLOOR_45,
  },
  SUCCESS: {
    initial: '#89D185',
    hue: { kind: 'fixed', h: 120 }, // green
    sat: 0.9,
    sliderSat: 0.9,
    lightness: {
      dark: { kind: 'const', value: 40 },
      light: { kind: 'const', value: 25 },
    },
    readability: FLOOR_45,
  },
  lineHighlight: {
    initial: '#2F313710',
    hue: { kind: 'pool' },
    sat: 0.3,
    lightness: {
      dark: { kind: 'from', base: 'bgBase', add: 5 },
      light: { kind: 'from', base: 'bgBase', add: -5 },
    },
    readability: NONE,
    alphaSuffix: '70',
    sliderExcluded: true,
  },
  selection: {
    initial: '#264F7820',
    hue: { kind: 'pool' },
    sat: 0.4,
    lightness: {
      dark: { kind: 'from', base: 'bgBase', add: 15 },
      light: { kind: 'from', base: 'bgBase', add: -15 },
    },
    readability: NONE,
    alphaSuffix: '70',
    sliderExcluded: true,
  },
  findMatch: {
    initial: '#515C6A20',
    hue: { kind: 'pool' },
    sat: 0.6,
    lightness: {
      dark: { kind: 'from', base: 'bgBase', add: 20 },
      light: { kind: 'from', base: 'bgBase', add: -20 },
    },
    readability: NONE,
    alphaSuffix: '70',
    sliderExcluded: true,
  },
}
