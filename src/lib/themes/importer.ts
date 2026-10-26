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
//    `tokenColors` actually say and fill the rest from `fallback` (§6.2). Task 14 refines
//    this mapping; the tables below are the seed, derived by hand from `exportTheme.ts`.
//
// Nothing here is user-initiated history: an import is a catalogue action, so it never
// enters the undo stack (Tasks 11–13).

import { ansiSpec, ANSI_KEYS } from '@/lib/colors/ansi'
import { syntaxSpec, SYNTAX_KEYS } from '@/lib/colors/syntax'
import { uiSpec, UI_KEYS } from '@/lib/colors/ui'
import { propsHash } from '@/lib/themes/canonical'
import { openRecord, recordFromOpen } from '@/lib/themes/record'
import { resolvePalette } from '@/lib/themes/resolve'
import { parseStoredTheme, SCHEMA_VERSION } from '@/lib/themes/schema'
import type { SavedTheme, ThemeInputs, ThemePalette } from '@/lib/themes/schema'
import type { Links } from '@/lib/colors/links'
import { ColorScheme } from '@/lib/types/colors'
import type { AnsiColors, SyntaxColors, UIColors } from '@/lib/types/colors'

/** Anything larger is refused before it is parsed. VS Code themes are tens of KB. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024

/** A file that produced a record, or one that is already in the library. */
export type ImportResult =
  | { kind: 'theme'; record: SavedTheme }
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

// ── the foreign mapping (sec §6.2; Task 14 refines it) ────────────────────────
//
// Both tables are read the other way round from `exportTheme.ts`: each palette key names
// the workbench colour / TextMate scope that exporter emits for it, so a file written by
// any tool that follows the same conventions maps back. First hit wins; nothing is
// invented — a key the file does not speak falls back to `fallback`.

const UI_SOURCES: Record<keyof UIColors, readonly string[]> = {
  BG1: ['editor.background', 'sideBar.background'],
  BG2: ['activityBar.background', 'titleBar.activeBackground', 'tab.activeBackground'],
  BG3: ['textBlockQuote.background', 'dropdown.background'],
  FG1: ['editor.foreground', 'foreground'],
  FG2: ['descriptionForeground', 'gitDecoration.untrackedResourceForeground'],
  FG3: ['statusBar.noFolderForeground'],
  AC1: ['progressBar.background', 'editorLineNumber.activeForeground'],
  AC2: ['activityBarBadge.background', 'button.background', 'badge.background'],
  BORDER: ['focusBorder', 'editorGroup.border', 'panel.border'],
  INFO: ['editorInfo.foreground', 'editorGutter.modifiedBackground'],
  ERROR: ['errorForeground', 'editorError.foreground'],
  WARNING: ['editorWarning.foreground'],
  SUCCESS: ['editorGutter.addedBackground', 'gitDecoration.addedResourceForeground'],
  lineHighlight: ['editorCursor.background', 'editor.foldBackground'],
  selection: ['editor.selectionBackground', 'terminal.selectionBackground'],
  findMatch: ['editor.findMatchBackground'],
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
 */
export function foreignPaletteFrom(raw: JsonObject, fallback?: ThemePalette): ThemePalette {
  const filled = fallback ?? initialPalette()
  const colors = isObject(raw.colors) ? raw.colors : {}
  const tokenColors: unknown[] = Array.isArray(raw.tokenColors) ? raw.tokenColors : []

  const ui = {} as UIColors
  for (const key of UI_KEYS) {
    let color: string | null = null
    for (const source of UI_SOURCES[key]) {
      color = colorAt(colors, source)
      if (color !== null) break
    }
    ui[key] = color ?? filled.ui[key]
  }

  const syntax = {} as SyntaxColors
  for (const key of SYNTAX_KEYS) {
    syntax[key] = tokenColorAt(tokenColors, SYNTAX_SCOPES[key]) ?? filled.syntax[key]
  }

  const ansi = {} as AnsiColors
  for (const key of ANSI_KEYS) {
    ansi[key] = colorAt(colors, ANSI_SOURCES[key]) ?? filled.ansi[key]
  }

  return { ui, syntax, ansi }
}

// ── metadata ─────────────────────────────────────────────────────────────────

function readInputs(value: unknown): ThemeInputs | null {
  if (!isObject(value)) return null
  const { isDark, baseHue, scheme, uiSaturation, syntaxSaturation, assignment } = value
  if (typeof isDark !== 'boolean' || typeof baseHue !== 'number') return null
  if (typeof uiSaturation !== 'number' || typeof syntaxSaturation !== 'number') return null
  if (typeof scheme !== 'number' || ColorScheme[scheme] === undefined) return null
  if (!isObject(assignment) || typeof assignment.seed !== 'number') return null
  return value as unknown as ThemeInputs
}

function readLocks(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function readLinks(value: unknown): Links {
  if (!isObject(value)) return {}
  const out: Record<string, { source: string; adjust: boolean }> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isObject(entry)) continue
    if (typeof entry.source !== 'string' || typeof entry.adjust !== 'boolean') continue
    out[key] = { source: entry.source, adjust: entry.adjust }
  }
  return out as Links
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
  const version = meta.schemaVersion
  if (typeof version === 'number' && version > SCHEMA_VERSION) return null
  const inputs = readInputs(meta.inputs)
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
  fallback: ThemePalette | undefined,
  now: number,
  hash: string,
  meta: JsonObject | null
): SavedTheme | null {
  const palette = foreignPaletteFrom(raw, fallback)
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
  if (!isObject(colors) || typeof colors['editor.background'] !== 'string') {
    return { reason: 'Not a VS Code colour theme (no colors.editor.background).' }
  }
  return { raw, hash: hashOf(raw) }
}

/** Turn a read file into a record, or explain why it cannot become one. */
function buildRecord(
  read: { raw: JsonObject; hash: string },
  fileName: string,
  existing: readonly SavedTheme[],
  fallback: ThemePalette | undefined
): ImportResult {
  const meta = isObject(read.raw['x-themegen']) ? read.raw['x-themegen'] : null
  const now = Date.now()
  const record =
    meta === null
      ? recordFromPalette(read.raw, fileName, existing, fallback, now, read.hash, null)
      : recordFromMetadata(read.raw, meta, fileName, existing, fallback, now, read.hash)

  if (record === null) {
    return {
      kind: 'invalid',
      reason:
        meta === null
          ? 'The file has no usable colours.'
          : 'The file was written by a newer version of this app.',
    }
  }
  return { kind: 'theme', record }
}

/**
 * Read a theme file. A file whose colours match a saved theme is a `duplicate`; anything
 * else becomes a `theme` record with a name that does not collide.
 *
 * `fallback` supplies the palette keys a foreign file leaves out — pass the current
 * theme's palette. Without it the app's spec defaults are used.
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
