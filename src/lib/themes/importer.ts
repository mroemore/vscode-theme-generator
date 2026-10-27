// Import: a VS Code theme file → a saved record, or a duplicate of one already saved.
//
// Identity is `propsHash` over the file's `{ type, colors }` — exactly the payload the
// canonicaliser hashes on save — so an exported theme re-imported still dedupes against
// its own record (spec §6.3). Name and `x-themegen` never enter the hash, which is what
// makes "same colours, different name" the same theme.
//
// Two routes in:
//  - `x-themegen` present → rebuild `inputs`/`locks`/`links` and re-resolve, carrying the
//    locked keys from the file, so a theme saved by this app reopens its locks (§6.1);
//  - no `x-themegen` → a *foreign* palette: map what the file's `colors` and
//    `tokenColors` actually say, and fill every key the file does not speak from a
//    neutral derived from the file's own background (§6.2). That route is
//    self-contained: an imported theme never depends on which theme happened to be
//    open when the file was read.
//
// Nothing here is user-initiated history: an import is a catalogue action, so it never
// enters the undo stack (Tasks 11–13).

import Color from 'color'

import { ansiSpec, ANSI_KEYS } from '@/lib/colors/ansi'
import { ansiTargetId } from '@/lib/colors/links'
import { applyReadability, resolveDrawable, resolveLightnessExpr } from '@/lib/colors/spec'
import { syntaxSpec, SYNTAX_KEYS, SYNTAX_LIGHTNESS } from '@/lib/colors/syntax'
import { uiSpec, UI_KEYS } from '@/lib/colors/ui'
import type { UIKey } from '@/lib/colors/ui'
import { propsHash } from '@/lib/themes/canonical'
import { openRecord, recordFromOpen } from '@/lib/themes/record'
import { resolvePalette } from '@/lib/themes/resolve'
import { parseStoredTheme, parseThemeInputs, SCHEMA_VERSION } from '@/lib/themes/schema'
import type { SavedTheme, ThemePalette } from '@/lib/themes/schema'
import type { Links } from '@/lib/colors/links'
import type { AnsiColors, SyntaxColors, UIColors } from '@/lib/types/colors'
import { ensureReadability } from '@/lib/utils/colorUtils'

/** Anything larger is refused before it is parsed. VS Code themes are tens of KB. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024

/** A file that produced a record, or one that is already in the library. */
export type ImportResult =
  | {
      kind: 'theme'
      record: SavedTheme
      /** Set when an `x-themegen` block was present but unusable and was ignored. */
      note?: string
    }
  | { kind: 'duplicate'; existing: SavedTheme }
  | { kind: 'invalid'; reason: string }

// ── reading the file ─────────────────────────────────────────────────────────

/**
 * Strip `//` and `/* *\/` comments and trailing commas, string-aware: a `//` inside a
 * quoted value survives, and so does a `}` inside one. VS Code ships JSONC themes, so a
 * strict parse is tried first and this only runs on failure.
 */
export function stripJsonc(text: string): string {
  let out = ''
  let i = 0
  let inString = false
  let escaped = false
  while (i < text.length) {
    const c = text[i]
    if (inString) {
      out += c
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      i++
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      i++
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === ',') {
      // Peek past whitespace *and* comments to see whether a closer follows.
      let j = i + 1
      for (;;) {
        while (j < text.length && /\s/.test(text[j])) j++
        if (text[j] === '/' && text[j + 1] === '/') {
          while (j < text.length && text[j] !== '\n') j++
          continue
        }
        if (text[j] === '/' && text[j + 1] === '*') {
          j += 2
          while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++
          j += 2
          continue
        }
        break
      }
      if (text[j] === '}' || text[j] === ']') {
        i++
        continue
      }
    }
    out += c
    i++
  }
  return out
}

type JsonObject = Record<string, unknown>

const isObject = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Parse strict JSON, else JSONC, else fail. A BOM is tolerated either way. */
function parseText(text: string): JsonObject | null {
  const body = text.replace(/^\uFEFF/, '')
  const candidates = [body]
  const stripped = stripJsonc(body)
  if (stripped !== body) candidates.push(stripped)
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate)
      if (isObject(value)) return value
    } catch {
      // try the next form
    }
  }
  return null
}

// ── colours ──────────────────────────────────────────────────────────────────

/**
 * A theme file's colour token → `#RRGGBB`, or `null` when it is not one. Alpha is
 * dropped: the palette model has no alpha channel, and an opaque stand-in is more useful
 * than refusing the whole file over `#RRGGBBAA`.
 */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const m = /^#([0-9a-f]{3,8})$/i.exec(trimmed)
  if (m === null) return null
  const digits = m[1]
  const expand = (h: string): string => h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const out =
    digits.length === 3
      ? expand(digits)
      : digits.length === 4
        ? expand(digits.slice(0, 3))
        : digits.length === 6 || digits.length === 8
          ? digits.slice(0, 6)
          : null
  return out === null ? null : `#${out.toUpperCase()}`
}

/** A single colour out of a `colors` map, normalised. */
function colorAt(colors: JsonObject, key: string): string | null {
  const value = colors[key]
  return typeof value === 'string' ? normalizeColor(value) : null
}

// ── the foreign mapping (spec §6.2) ───────────────────────────────────────────
//
// Both tables are read the other way round from `exportTheme.ts`: each palette key names
// the workbench colour / TextMate scope that exporter emits for it, so a file written by
// any tool that follows the same conventions maps back. The *first* candidate of a key is
// the one the exporter emits, so an export of ours re-imports as itself; the rest are the
// keys other tools use for the same thing.
//
// First hit wins; nothing is invented — a key the file does not speak is filled from the
// neutral below, never from whatever theme happens to be open.

/** The workbench colours each UI key is read from, the exporter's own first. */
export const UI_SOURCES: Record<keyof UIColors, readonly string[]> = {
  BG1: ['editor.background', 'sideBar.background'],
  BG2: ['activityBar.background', 'titleBar.activeBackground', 'tab.activeBackground'],
  BG3: ['textBlockQuote.background', 'dropdown.background'],
  FG1: ['editor.foreground', 'foreground'],
  FG2: ['descriptionForeground', 'gitDecoration.untrackedResourceForeground'],
  FG3: ['statusBar.noFolderForeground'],
  AC1: ['progressBar.background', 'editorLineNumber.activeForeground'],
  AC2: ['activityBarBadge.background', 'button.background', 'badge.background'],
  BORDER: ['focusBorder', 'editorGroup.border'],
  INFO: ['editorInfo.foreground', 'editorGutter.modifiedBackground'],
  ERROR: ['errorForeground', 'editorError.foreground'],
  WARNING: ['editorWarning.foreground'],
  SUCCESS: ['editorGutter.addedBackground', 'gitDecoration.addedResourceForeground'],
  lineHighlight: ['editorCursor.background', 'editor.foldBackground'],
  selection: ['editor.selectionBackground', 'terminal.selectionBackground'],
  findMatch: ['editor.findMatchBackground'],
}

/**
 * The UI keys a foreign file's `colors` map actually supplies — and only those.
 *
 * A key the file does not speak is *absent* from the result: filling it is the caller's
 * business (the palette-only route fills it from the neutral), so this function never
 * invents a colour and never consults the open theme.
 */
export function mapForeignColors(colors: Record<string, string>): Partial<UIColors> {
  const out: Partial<UIColors> = {}
  for (const key of UI_KEYS) {
    for (const source of UI_SOURCES[key]) {
      const color = colorAt(colors, source)
      if (color !== null) {
        out[key] = color
        break
      }
    }
  }
  return out
}

/** The file's `colors` map, narrowed to the string values it may hold. */
function stringColors(colors: JsonObject): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

/** The syntax keys a file's `tokenColors` block actually supplies. */
function mapForeignSyntax(tokenColors: unknown[]): Partial<SyntaxColors> {
  const out: Partial<SyntaxColors> = {}
  for (const key of SYNTAX_KEYS) {
    const color = tokenColorAt(tokenColors, SYNTAX_SCOPES[key])
    if (color !== null) out[key] = color
  }
  return out
}

/** The ANSI keys a file's `colors` map actually supplies. */
function mapForeignAnsi(colors: JsonObject): Partial<AnsiColors> {
  const out: Partial<AnsiColors> = {}
  for (const key of ANSI_KEYS) {
    const color = colorAt(colors, ANSI_SOURCES[key])
    if (color !== null) out[key] = color
  }
  return out
}

/** Each palette key's representative scope in the exporter's token block. */
const SYNTAX_SCOPES: Record<keyof SyntaxColors, readonly string[]> = {
  keyword: ['keyword'],
  comment: ['comment'],
  function: ['entity.name.function', 'meta.function-call.generic'],
  functionCall: ['support.function'],
  variable: ['variable'],
  variableDeclaration: ['variable.other.readwrite'],
  variableProperty: ['variable.object.property'],
  type: ['entity.name.type'],
  typeParameter: ['entity.name.type.type-parameter', 'entity.name.type.module'],
  constant: ['constant'],
  class: ['entity.name.class', 'entity.name.type.class'],
  parameter: ['variable.parameter', 'entity.name.variable.parameter'],
  property: ['entity.other.attribute-name'],
  operator: ['keyword.operator'],
  storage: ['storage', 'storage.modifier'],
  punctuation: ['punctuation'],
  // The exporter writes these three under their concrete sub-scopes, not the bare family.
  punctuationQuote: ['punctuation.definition.string', 'punctuation.definition.string.begin'],
  punctuationBrace: ['punctuation.section', 'punctuation.section.scope.begin'],
  punctuationComma: ['punctuation.separator', 'punctuation.separator.list.comma.css'],
  selector: ['meta.selector', 'entity.name.tag.css'],
  modifier: ['storage.modifier'],
  other: ['constant.other.color', 'variable.other.object'],
  language: ['constant.language'],
  control: ['keyword.control'],
  controlFlow: ['keyword.control.flow', 'keyword.control.conditional', 'keyword.control.loop'],
  controlImport: ['keyword.control.import', 'keyword.control.from'],
  tag: ['entity.name.tag'],
  tagPunctuation: ['punctuation.definition.tag'],
  attribute: ['entity.other.attribute-name'],
  support: ['support'],
  unit: ['keyword.other.unit'],
  datetime: ['constant.other.date', 'constant.other.timestamp'],
}

const ANSI_SOURCES: Record<keyof AnsiColors, string> = {
  Black: 'terminal.ansiBlack',
  Red: 'terminal.ansiRed',
  Green: 'terminal.ansiGreen',
  Yellow: 'terminal.ansiYellow',
  Blue: 'terminal.ansiBlue',
  Magenta: 'terminal.ansiMagenta',
  Cyan: 'terminal.ansiCyan',
  White: 'terminal.ansiWhite',
  BrightBlack: 'terminal.ansiBrightBlack',
  BrightRed: 'terminal.ansiBrightRed',
  BrightGreen: 'terminal.ansiBrightGreen',
  BrightYellow: 'terminal.ansiBrightYellow',
  BrightBlue: 'terminal.ansiBrightBlue',
  BrightMagenta: 'terminal.ansiBrightMagenta',
  BrightCyan: 'terminal.ansiBrightCyan',
  BrightWhite: 'terminal.ansiBrightWhite',
}

/** One token rule's `scope` values, flattened, as exact selector strings. */
function scopesOf(rule: JsonObject): string[] {
  const scope = rule.scope
  const list = typeof scope === 'string' ? [scope] : Array.isArray(scope) ? scope : []
  return list
    .filter((s): s is string => typeof s === 'string')
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
}

/** First foreground any `tokenColors` rule sets for one of `scopes`, normalised. */
function tokenColorAt(tokenColors: unknown[], scopes: readonly string[]): string | null {
  for (const scope of scopes) {
    for (const rule of tokenColors) {
      if (!isObject(rule) || !scopesOf(rule).includes(scope)) continue
      const settings = rule.settings
      if (!isObject(settings)) continue
      const color = typeof settings.foreground === 'string'
        ? normalizeColor(settings.foreground)
        : null
      if (color !== null) return color
    }
  }
  return null
}

/** The spec defaults, used when the caller supplies no fallback of its own. */
function initialPalette(): ThemePalette {
  const ui = {} as UIColors
  for (const key of UI_KEYS) ui[key] = normalizeColor(uiSpec[key].initial) ?? uiSpec[key].initial
  const syntax = {} as SyntaxColors
  for (const key of SYNTAX_KEYS) {
    syntax[key] = normalizeColor(syntaxSpec[key].initial) ?? syntaxSpec[key].initial
  }
  const ansi = {} as AnsiColors
  for (const key of ANSI_KEYS) ansi[key] = normalizeColor(ansiSpec[key].initial) ?? ansiSpec[key].initial
  return { ui, syntax, ansi }
}

/**
 * Build a complete palette out of a foreign file: every key the file answers for comes
 * from the file, every key it does not comes from `fallback`. Complete by construction,
 * so a palette-only import is a real theme rather than a half-filled row.
 *
 * This is the *carried* palette of the metadata route: it fills a locked key the file
 * does not carry. The palette-only route does not use it — that route is self-contained
 * and fills from the neutral instead (see `paletteOnlyPalette`).
 */
export function foreignPaletteFrom(raw: JsonObject, fallback?: ThemePalette): ThemePalette {
  const filled = fallback ?? initialPalette()
  const colors = isObject(raw.colors) ? raw.colors : {}
  const tokenColors: unknown[] = Array.isArray(raw.tokenColors) ? raw.tokenColors : []
  const mappedUi = mapForeignColors(stringColors(colors))
  const mappedSyntax = mapForeignSyntax(tokenColors)
  const mappedAnsi = mapForeignAnsi(colors)

  const ui = {} as UIColors
  for (const key of UI_KEYS) ui[key] = mappedUi[key] ?? filled.ui[key]
  const syntax = {} as SyntaxColors
  for (const key of SYNTAX_KEYS) syntax[key] = mappedSyntax[key] ?? filled.syntax[key]
  const ansi = {} as AnsiColors
  for (const key of ANSI_KEYS) ansi[key] = mappedAnsi[key] ?? filled.ansi[key]

  return { ui, syntax, ansi }
}

// ── the neutral (spec §6.2) ───────────────────────────────────────────────────
//
// "Self-contained, not relative to the open theme": a foreign record's colours come
// from the file and from the file's own background — never from whatever theme
// happened to be open when the file was read.
//
// The neutral below is that background turned into a complete palette, resolved against
// the app's own spec (`uiSpec`, `syntaxSpec`, `ansiSpec`), so a foreign theme that says
// nothing about a key still lands on a palette the app would recognise: every jitter
// resolves at its mid-point, the surfaces keep the background's own tint, the text
// colours sit at the far pole, and the accents and semantic colours carry the hues the
// spec fixes for them.

/** The middle of the generator's own UI saturation band (15–65). */
const NEUTRAL_UI_SATURATION = 40
/** The middle of the generator's own syntax saturation band (20–65). */
const NEUTRAL_SYNTAX_SATURATION = 42
/** The middle of the generator's own ANSI saturation band (20–70). */
const NEUTRAL_ANSI_SATURATION = 45
/** The middle of the generator's own ANSI lightness band (30–60). */
const NEUTRAL_ANSI_LIGHTNESS = 45
/** The roll every jitter resolves against: the middle of [0, 1). */
const NEUTRAL_ROLL = 0.5
/** The hue a neutral accent falls back to when the file names none. */
const NEUTRAL_ACCENT_HUE = 210

const clamp = (value: number, min = 0, max = 100): number =>
  Math.max(min, Math.min(max, value))

/** An HSL colour as the app writes them: `#RRGGBB`, upper case. */
function hsl(hue: number, saturation: number, lightness: number): string {
  return Color.hsl(((hue % 360) + 360) % 360, clamp(saturation), clamp(lightness))
    .hex()
    .toUpperCase()
}

/**
 * The hue the neutral speaks in: the file's own accent when it has one, else the
 * background's own hue when the background is tinted, else the app's accent hue. A
 * grey background has no hue of its own, so it borrows one rather than inventing red.
 */
function neutralHue(mapped: Partial<UIColors>, bgHue: number, bgSaturation: number): number {
  for (const key of ['AC1', 'AC2'] as const) {
    const value = mapped[key]
    if (value === undefined) continue
    const accent = Color(value)
    if (accent.saturationl() >= 8) return accent.hue()
  }
  if (bgSaturation >= 8) return bgHue
  return NEUTRAL_ACCENT_HUE
}

/**
 * A complete palette derived from one background colour — the neutral a foreign file's
 * missing keys are filled from.
 *
 * `mapped` is the palette the file *does* supply; it is consulted for the accent hue
 * only, so a file that names an accent keeps its own accent in the neutral too.
 */
export function neutralPaletteFrom(bg1: string, mapped: Partial<UIColors> = {}): ThemePalette {
  const base = Color(bg1)
  const isDark = base.isDark()
  // The background's own lightness is the base the surfaces step off; the foreground
  // base is its mirror, so the text lands at the far pole of the same polarity.
  const bgBase = base.lightness()
  const fgBase = 100 - bgBase
  const bgHue = base.hue()
  const bgSaturation = base.saturationl()
  const accentHue = neutralHue(mapped, bgHue, bgSaturation)

  const ui = {} as UIColors
  for (const key of UI_KEYS) {
    const spec = uiSpec[key]
    const expr = isDark ? spec.lightness.dark : spec.lightness.light
    const lightness = resolveLightnessExpr(expr, { bgBase, fgBase }, NEUTRAL_ROLL)
    const hueExpr = spec.hue
    const keyHue = hueExpr.kind === 'fixed'
      ? hueExpr.h
      : key === 'AC1'
        ? accentHue
        : key === 'AC2'
          ? accentHue + 30
          : bgHue
    // The surfaces keep the background's own tint; everything else follows the app's
    // own saturation relationships.
    const surface =
      key === 'BG2' ||
      key === 'BG3' ||
      key === 'BORDER' ||
      key === 'lineHighlight' ||
      key === 'selection' ||
      key === 'findMatch'
    const saturation = surface ? bgSaturation : NEUTRAL_UI_SATURATION * spec.sat
    ui[key] = hsl(keyHue, saturation, lightness)
  }
  // The background is the file's own, not the neutral's.
  ui.BG1 = bg1

  const syntax = {} as SyntaxColors
  const syntaxBase = isDark ? SYNTAX_LIGHTNESS.dark : SYNTAX_LIGHTNESS.light
  for (const key of SYNTAX_KEYS) {
    const spec = syntaxSpec[key]
    const shift = resolveDrawable(NEUTRAL_ROLL, spec.lightShift)
    const hueShift = resolveDrawable(NEUTRAL_ROLL, spec.hueShift)
    const lightness = spec.inverseLightness
      ? syntaxBase.inverse - shift
      : syntaxBase.base + shift
    syntax[key] = hsl(
      accentHue + hueShift,
      NEUTRAL_SYNTAX_SATURATION * spec.sat,
      lightness
    )
  }

  const ansi = {} as AnsiColors
  for (const key of ANSI_KEYS) {
    const recipe = ansiSpec[key].recipe
    switch (recipe.kind) {
      case 'literal':
        ansi[key] = recipe.value.toUpperCase()
        break
      case 'spun':
        ansi[key] = hsl(recipe.hue, NEUTRAL_ANSI_SATURATION, NEUTRAL_ANSI_LIGHTNESS)
        break
      case 'hsl':
        // The recipe's second number is a span, not a bound: the mid-point of the span
        // is the generator's own "no roll" value.
        ansi[key] = hsl(
          recipe.h[0] + recipe.h[1] / 2,
          recipe.s[0] + recipe.s[1] / 2,
          recipe.l[0] + recipe.l[1] / 2
        )
        break
      case 'spunBright': {
        const from = Color(ansi[recipe.base])
        ansi[key] = from
          .saturationl(Math.min(from.saturationl() + 20, 100))
          .lightness(Math.min(from.lightness() + 20, 95))
          .hex()
          .toUpperCase()
        break
      }
    }
  }

  return { ui, syntax, ansi }
}

/**
 * The palette of a foreign file: what the file says, and the neutral for everything it
 * does not.
 *
 * Self-contained by construction (spec §6.2): the only inputs are the file and its own
 * background. The theme that happens to be open is not consulted, so the same file
 * always imports to the same palette.
 *
 * The readability pass is the generator's own, against the imported background: a
 * foreign theme whose foreground is invisible on its own background is corrected
 * rather than imported unreadable.
 */
export function paletteOnlyPalette(raw: JsonObject): ThemePalette {
  const colors = isObject(raw.colors) ? raw.colors : {}
  const tokenColors: unknown[] = Array.isArray(raw.tokenColors) ? raw.tokenColors : []
  const mappedUi = mapForeignColors(stringColors(colors))
  const bg1 = mappedUi.BG1 ?? uiSpec.BG1.initial
  const neutral = neutralPaletteFrom(bg1, mappedUi)

  const ui = { ...neutral.ui, ...mappedUi }
  const syntax = { ...neutral.syntax, ...mapForeignSyntax(tokenColors) }
  const ansi = { ...neutral.ansi, ...mapForeignAnsi(colors) }

  const isDark = Color(bg1).isDark()
  for (const key of UI_KEYS) {
    const policy = uiSpec[key].readability
    if (policy.kind === 'none') continue
    ui[key] = applyReadability(ui[key], bg1, policy, isDark).toUpperCase()
  }
  for (const key of SYNTAX_KEYS) {
    syntax[key] = applyReadability(
      syntax[key],
      bg1,
      syntaxSpec[key].readability,
      isDark
    ).toUpperCase()
  }
  for (const key of ANSI_KEYS) {
    if (!ansiSpec[key].readable) continue
    ansi[key] = ensureReadability(ansi[key], bg1, 4.5).toUpperCase()
  }

  return { ui, syntax, ansi }
}

// ── metadata ─────────────────────────────────────────────────────────────────

// The file is untrusted, so a metadata key is only honoured when it names a real
// palette key: a lock on `BG99` (or `__proto__`) is dropped rather than stored, and a
// link target must be a syntax key or an `ansi`-prefixed ANSI key. Assigning an
// unchecked `__proto__` key would otherwise change the object's prototype and lose the
// whole record downstream.
const UI_KEY_SET: ReadonlySet<string> = new Set(UI_KEYS)
const LOCK_KEYS: ReadonlySet<string> = new Set([
  ...UI_KEYS,
  ...SYNTAX_KEYS,
  ...ANSI_KEYS.map(ansiTargetId),
])
const LINK_TARGETS: ReadonlySet<string> = new Set([
  ...SYNTAX_KEYS,
  ...ANSI_KEYS.map(ansiTargetId),
])

function readLocks(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && LOCK_KEYS.has(v))
    : []
}

function readLinks(value: unknown): Links {
  if (!isObject(value)) return {}
  const out: Links = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!LINK_TARGETS.has(key) || !isObject(entry)) continue
    // A link's source is always a theme (UI) colour — direction is top-down.
    if (typeof entry.source !== 'string' || !UI_KEY_SET.has(entry.source)) continue
    if (typeof entry.adjust !== 'boolean') continue
    out[key] = { source: entry.source as UIKey, adjust: entry.adjust }
  }
  return out
}

function timestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** A fresh id, with `crypto.randomUUID` where it exists and a counter-shaped fallback. */
export function newThemeId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c !== undefined && typeof c.randomUUID === 'function') {
    return `t_${c.randomUUID().replace(/-/g, '').slice(0, 20)}`
  }
  return `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** `Aurora`, or `Aurora (2)` when that name is taken. Never a silent second Aurora. */
export function uniqueName(name: string, existing: readonly { name: string }[]): string {
  const taken = new Set(existing.map((t) => t.name))
  if (!taken.has(name)) return name
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`
    if (!taken.has(candidate)) return candidate
  }
}

function nameBase(raw: JsonObject, meta: JsonObject | null, fileName: string): string {
  for (const candidate of [meta?.name, raw.name]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  const stem = fileName.replace(/^.*[/\\]/, '').replace(/\.jsonc?$/i, '').trim()
  return stem !== '' ? stem : 'Imported theme'
}

/** The colour payload both import routes dedupe on. */
function hashOf(raw: JsonObject): string {
  return propsHash({ type: raw.type, colors: raw.colors ?? {} })
}

// ── the two routes ───────────────────────────────────────────────────────────

/** Rebuild a record from an `x-themegen` block, re-resolving so locks stay locked. */
function recordFromMetadata(
  raw: JsonObject,
  meta: JsonObject,
  fileName: string,
  existing: readonly SavedTheme[],
  fallback: ThemePalette | undefined,
  now: number,
  hash: string
): SavedTheme | null {
  // The caller has already ruled out a genuinely newer `schemaVersion`. Anything else
  // that fails the schema is malformed, and the caller falls back to the palette route.
  const inputs = parseThemeInputs(meta.inputs)
  if (inputs === null) return null

  const locks = new Set(readLocks(meta.locks))
  // The file's own colours are the carry source: locked keys keep the value the export
  // wrote, unlocked ones regenerate from the inputs (spec §6.1).
  const carried = foreignPaletteFrom(raw, fallback)
  const palette = resolvePalette(inputs, locks, carried)

  const candidate: SavedTheme = {
    schemaVersion: SCHEMA_VERSION,
    id: newThemeId(),
    name: uniqueName(nameBase(raw, meta, fileName), existing),
    createdAt: timestamp(meta.createdAt, now),
    updatedAt: timestamp(meta.updatedAt, now),
    inputs,
    palette,
    purePalette: palette,
    locks: [...locks],
    links: readLinks(meta.links),
    propsHash: hash,
  }
  const parsed = parseStoredTheme(candidate)
  if (!parsed.ok) return null
  const open = openRecord(parsed.theme)
  const openedInputs = open.inputs
  if (openedInputs === undefined) return null
  return recordFromOpen(
    { inputs: openedInputs, palette: open.palette, links: open.links, locks: open.locks },
    {
      id: candidate.id,
      name: candidate.name,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      propsHash: candidate.propsHash,
    }
  )
}

/** Build a record whose palette is only what the file says — no inputs to resolve from. */
function recordFromPalette(
  raw: JsonObject,
  fileName: string,
  existing: readonly SavedTheme[],
  now: number,
  hash: string,
  meta: JsonObject | null
): SavedTheme | null {
  const palette = paletteOnlyPalette(raw)
  const candidate: SavedTheme = {
    schemaVersion: SCHEMA_VERSION,
    id: newThemeId(),
    name: uniqueName(nameBase(raw, meta, fileName), existing),
    createdAt: now,
    updatedAt: now,
    palette,
    purePalette: {
      ui: { ...palette.ui },
      syntax: { ...palette.syntax },
      ansi: { ...palette.ansi },
    },
    locks: [],
    links: {},
    propsHash: hash,
  }
  const parsed = parseStoredTheme(candidate)
  return parsed.ok ? parsed.theme : null
}

// ── the entry points ─────────────────────────────────────────────────────────

/** A background that is a colour, not merely a string: `#RGB`, `#RRGGBB` or `#RRGGBBAA`. */
const BACKGROUND_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function readImport(
  fileName: string,
  text: string
): { raw: JsonObject; hash: string } | { reason: string } {
  const bytes = new TextEncoder().encode(text).length
  if (bytes > MAX_IMPORT_BYTES) {
    return { reason: `File is larger than 2 MB (${Math.round(bytes / 1024)} KB).` }
  }
  const raw = parseText(text)
  if (raw === null) {
    return { reason: 'Not a readable theme file (expected JSON or JSONC).' }
  }
  const colors = raw.colors
  // A theme must say what its background is, and it must be a hex colour: `"red"` or
  // `"#GGGGGG"` would otherwise import with BG1 silently taken from the fallback.
  // 8-digit hex is accepted and its alpha dropped (see `normalizeColor`).
  const background = isObject(colors) ? colors['editor.background'] : undefined
  if (typeof background !== 'string' || !BACKGROUND_HEX.test(background.trim())) {
    return {
      reason: 'Not a VS Code colour theme (colors.editor.background must be a hex colour).',
    }
  }
  return { raw, hash: hashOf(raw) }
}

const NO_COLOURS = 'The file has no usable colours.'
const NEWER_VERSION = 'The file was written by a newer version of this app.'
const MALFORMED_METADATA =
  "The file's x-themegen block is malformed and its colours could not be read."
const IGNORED_METADATA =
  "The file's x-themegen block is malformed, so its colours were imported without it."

/**
 * Turn a read file into a record, or explain why it cannot become one.
 *
 * The metadata route is best-effort: only a `schemaVersion` *newer* than this build
 * declines the file, because that is the one case where the palette may legitimately
 * mean something we cannot reproduce. A malformed block (bad inputs, junk lock or link
 * keys, a block that is not even an object) falls back to the palette route instead of
 * blaming the app version. The whole body is guarded: nothing a file says may throw out
 * of the importer.
 */
function buildRecord(
  read: { raw: JsonObject; hash: string },
  fileName: string,
  existing: readonly SavedTheme[],
  fallback: ThemePalette | undefined
): ImportResult {
  const blockPresent = Object.prototype.hasOwnProperty.call(read.raw, 'x-themegen')
  const rawMeta = read.raw['x-themegen']
  const meta = isObject(rawMeta) ? rawMeta : null
  // A block that is present but not an object is malformed like any other bad block.
  const malformedBlock = blockPresent && meta === null
  const now = Date.now()
  try {
    if (meta !== null) {
      const version = meta.schemaVersion
      if (typeof version === 'number' && version > SCHEMA_VERSION) {
        return { kind: 'invalid', reason: NEWER_VERSION }
      }
      const fromMetadata = recordFromMetadata(
        read.raw,
        meta,
        fileName,
        existing,
        fallback,
        now,
        read.hash
      )
      if (fromMetadata !== null) return { kind: 'theme', record: fromMetadata }
    }

    // No block, or a block that did not validate: the file's colours are still a theme.
    // The palette route never consults the open theme — a foreign record is
    // self-contained (spec §6.2).
    const fromPalette = recordFromPalette(
      read.raw,
      fileName,
      existing,
      now,
      read.hash,
      meta
    )
    const ignored = meta !== null || malformedBlock
    if (fromPalette !== null) {
      return ignored
        ? { kind: 'theme', record: fromPalette, note: IGNORED_METADATA }
        : { kind: 'theme', record: fromPalette }
    }
    return { kind: 'invalid', reason: ignored ? MALFORMED_METADATA : NO_COLOURS }
  } catch {
    // Belt and braces: a shape the schema did not anticipate must not reach the UI as a
    // thrown promise rejection (which a `void runImport` would leave as a silent no-op).
    const ignored = malformedBlock || meta !== null
    return { kind: 'invalid', reason: ignored ? MALFORMED_METADATA : NO_COLOURS }
  }
}

/**
 * Read a theme file. A file whose colours match a saved theme is a `duplicate`; anything
 * else becomes a `theme` record with a name that does not collide.
 *
 * `fallback` fills a *locked* key a file carrying an `x-themegen` block does not spell
 * out — the block's own inputs regenerate everything else. A file with no block is a
 * foreign theme, and its palette never consults the fallback: it is self-contained
 * (spec §6.2), so the same file always imports to the same colours.
 */
export async function parseImport(
  fileName: string,
  text: string,
  existing: readonly SavedTheme[],
  fallback?: ThemePalette
): Promise<ImportResult> {
  const read = readImport(fileName, text)
  if ('reason' in read) return { kind: 'invalid', reason: read.reason }

  const same = existing.find((theme) => theme.propsHash === read.hash)
  if (same !== undefined) return { kind: 'duplicate', existing: same }

  return buildRecord(read, fileName, existing, fallback)
}

/**
 * Read a theme file as a *new* theme regardless of what is already saved: the same file
 * imported twice gives two rows. The duplicate dialog's "import as new" is this call.
 */
export async function parseImportAsNew(
  fileName: string,
  text: string,
  existing: readonly SavedTheme[],
  fallback?: ThemePalette
): Promise<ImportResult> {
  const read = readImport(fileName, text)
  if ('reason' in read) return { kind: 'invalid', reason: read.reason }
  return buildRecord(read, fileName, existing, fallback)
}
