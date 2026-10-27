# Theme Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a localStorage-backed catalogue of named themes that auto-save on every change, survive a reload with hand edits intact, round-trip through export/import with their generator inputs, and carry a short diff-based undo/redo history per theme.

**Architecture:** The colour pipeline is untouched. A new pure core under `src/lib/themes/` (record, resolve, canonical hash, diff) sits beside the existing generators; `ThemeContext` gains three controllers (library, history, gesture) that all hook the single existing `commit` funnel, so every control is covered without editing any control. Storage is three kinds of localStorage key, written through one module that owns quota escalation.

**Tech Stack:** Next.js 15, React 19, TypeScript, Zod (already a dependency), Tailwind, bun as the script runner. No test framework — evidence is throwaway harnesses in `.tmp_files/`, per the project's standing rule.

**Spec:** `docs/superpowers/specs/2026-10-26-theme-library-design.md`

## Global Constraints

- **Never run `bun run build` while `next dev` is live on port 3100** — they share `.next`. Use `bunx tsc --noEmit` + `bun run lint` as the build gate, or run `sh .tmp_files/dev-reset.sh` afterwards.
- **`parity --diff` must report 680 combos, 0 changed, at every commit.** Any movement means the colour pipeline was disturbed, which is never intended here.
- **No new dependencies.** Zod, `color` and the existing UI kit cover everything.
- **No test framework, no bundler, no test runner.** Harnesses live in `.tmp_files/` (gitignored, tsconfig-excluded) and run with `bun run .tmp_files/<name>.ts`, using `node:assert/strict` and exiting non-zero on failure.
- **`.tmp_files/` is tsconfig-excluded and `bun run` does not type-check.** A harness that references a nonexistent colour key passes vacuously. Every harness that names colour keys asserts the key counts: UI 16, syntax 32, ANSI 16.
- **`.tmp_files/` is gitignored** — never `git add` a harness, and never `git add -f` one. The plan's commit blocks list harness paths for reference only; commit only the source files. Harnesses are throwaway evidence, not repo content.
- **Storage keys:** `vsc_themegen.library.v1`, `vsc_themegen.theme.v1.<id>`, `vsc_themegen.history.v1.<id>` — exactly, no variation.
- **Retention:** 20 steps per theme, 1.5 MB global history budget, 400 ms save debounce, 500 ms coalescing window.
- **Existing view-state keys stay untouched:** `vsc_themegen.mobile.{pin,visible,format,pickerLarge}`.
- **`syntaxColors` / `ansiColors` are derived** (`relink`), never stored in a patch, never persisted as authoritative.
- **Retire `SavedThemeSchema`** (`src/lib/types/colors.ts:93-108`) — numeric id, `userId`, `Date` fields, imported nowhere. Delete it; do not reuse the name.

## Review Focus

Inputs and conditions the spec implies but no happy-path task exercises. Each has a test in the task named.

1. **localStorage unavailable or throwing** (Safari private mode, storage disabled, quota 0) — the app must run unsaved, never crash, never show a broken catalogue. → Task 5.
2. **A corrupt or partially written record** (hand-edited localStorage, interrupted write) — that one theme is skipped, the rest of the catalogue loads, nothing is deleted. → Task 5.
3. **A record from a newer schema version** — refuse to load it, never overwrite it. → Tasks 1 and 5.
4. **Two tabs open on the same library** — last write wins without corrupting either record, and a tab that lost a theme does not resurrect it over a delete. → Tasks 7 and 8.
5. **Importing something that is not a theme** (arbitrary JSON, an HTML error page saved as `.json`, a 3 MB file) — a clear rejection, no state change, no freeze. → Task 10.

---

## Shared types

Defined once in Task 1 (`src/lib/themes/schema.ts`), used by every later task. Reproduced here so all tasks agree:

```ts
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
  inputs?: ThemeInputs          // absent only for a foreign (palette-only) import
  palette: ThemePalette         // displayed, post-link
  purePalette: ThemePalette     // generator output with no hand edits
  locks: string[]
  links: Links
  propsHash: string
}
```

---

### Task 1: Record schema and version check

**Files:**
- Create: `src/lib/themes/schema.ts`
- Modify: `src/lib/types/colors.ts:93-108` (delete the dead `SavedThemeSchema` and its `SavedTheme` type)
- Test: `.tmp_files/themes-schema.ts`

**Interfaces:**
- Consumes: `UIColorsSchema`, `SyntaxColorsSchema`, `AnsiColorsSchema`, `ColorScheme` from `@/lib/types/colors`; `Assignment` from `@/lib/colors/assignment`; `Links` from `@/lib/colors/links`.
- Produces:
  - the types in **Shared types** above, plus `export const SCHEMA_VERSION = 1`
  - `export const SavedThemeSchema: z.ZodType<SavedTheme>`
  - `export type ParseResult = { ok: true; theme: SavedTheme } | { ok: false; reason: 'invalid' } | { ok: false; reason: 'newer'; version: number }`
  - `export function parseStoredTheme(raw: unknown): ParseResult`

- [ ] **Step 1: Write the failing test** in `.tmp_files/themes-schema.ts`

`makeValid()` builds a record via the real generators (seed a `drawTheme`, resolve the three palettes), so the fixture cannot drift from the true shape. Assertions:

```ts
assert.equal(keys(c.ui).length, 16); assert.equal(keys(c.syntax).length, 32); assert.equal(keys(c.ansi).length, 16)
assert.equal(parseStoredTheme(valid).ok, true)
assert.deepEqual(parseStoredTheme({ ...valid, schemaVersion: 2 }), { ok: false, reason: 'newer', version: 2 })
assert.equal(parseStoredTheme({ ...valid, palette: { ...valid.palette, ui: omit(valid.palette.ui, 'BG1') } }).ok, false)
assert.equal(parseStoredTheme({ ...valid, purePalette: undefined }).ok, false)
assert.equal(parseStoredTheme('not an object').ok, false)
assert.equal(parseStoredTheme({ ...valid, locks: ['BG1', 'staleKeyFromAnOldVersion'] }).ok, true)
assert.equal(parseStoredTheme({ ...valid, inputs: undefined }).ok, true)   // foreign, palette-only
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run .tmp_files/themes-schema.ts`
Expected: `Cannot find module '@/lib/themes/schema'`

- [ ] **Step 3: Implement `src/lib/themes/schema.ts`**

`SavedThemeSchema` built from the existing per-key schemas. `assignment` must be validated structurally, not accepted blindly: `z.object({ seed: z.number(), poolMode: z.string(), shape: z.unknown(), ui: z.unknown(), syntax: z.unknown(), ansi: z.unknown() }).passthrough()` — so a record missing `assignment.seed` is rejected. `links: z.record(z.object({ source: z.string(), adjust: z.boolean() }))`. `locks: z.array(z.string())`. `parseStoredTheme` reads `schemaVersion` **before** parsing the body and returns `'newer'` for anything above `SCHEMA_VERSION`. Delete `SavedThemeSchema`/`SavedTheme` from `src/lib/types/colors.ts`.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run .tmp_files/themes-schema.ts` → no output, exit 0.
Run: `bunx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/themes/schema.ts src/lib/types/colors.ts .tmp_files/themes-schema.ts
git commit -m "feat(themes): saved-theme record schema with version gating"
```

---

### Task 2: Canonical props hash

**Files:**
- Create: `src/lib/themes/canonical.ts`
- Modify (conditional, see Step 0): `src/lib/utils/exportTheme.ts:451` — `'diffEditor.diagonalFill': colors.ERROR` → `colors.INFO`
- Test: `.tmp_files/themes-hash.ts`

**Interfaces:**
- Consumes: `generateThemeJSON` from `@/lib/utils/exportTheme`; `generateSemanticThemeJSON` from `@/lib/utils/export`.
- Produces:
  - `export function canonicalise(value: unknown): unknown`
  - `export function canonicalString(value: unknown): string`
  - `export function fnv1a64(input: string): string` (16 hex chars)
  - `export function digest(input: string): string` — always FNV-1a-64, never WebCrypto (see the design doc's "WebCrypto is not used, on purpose")
  - `export function propsHash(theme: string | object): string` — **synchronous**

- [ ] **Step 0: Precondition — the `diagonalFill` drift fix needs the human partner's go-ahead.**

Design §5.3. If declined, skip the edit in **Files** and skip the cross-format assertion in Step 1; duplicates are then detected per export format rather than across both. Do not land it silently.

- [ ] **Step 1: Write the failing test** in `.tmp_files/themes-hash.ts`

```ts
assert.equal(canonicalString({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}')
assert.equal(canonicalString({ a: [3, 1, 2] }), '{"a":[3,1,2]}')          // arrays keep order
assert.equal(fnv1a64('abc'), '<pin the value on first run, then assert literally>')
assert.equal(digest(canonicalString({ a: 1 })), digest(canonicalString({ a: 1 })))
const base = JSON.parse(generateThemeJSON(colors, syntax, ansi))
assert.equal(propsHash(base), propsHash({ ...base, name: 'Renamed' }))
assert.equal(propsHash(base), propsHash({ ...base, 'x-themegen': { anything: true } }))
assert.notEqual(propsHash(base), propsHash({ ...base, colors: { ...base.colors, 'editor.background': '#123456' } }))
// NOT asserted: cross-format equality. Classic and semantic exports still differ on
// diffEditor.diagonalFill, so identity is per export format until that drift is fixed.
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run .tmp_files/themes-hash.ts`
Expected: `Cannot find module '@/lib/themes/canonical'`

- [ ] **Step 3: Implement `src/lib/themes/canonical.ts`**

`canonicalise` recurses: arrays map but keep order, plain objects sort keys, everything else returns as-is. `propsHash` parses when given a string, then hashes `canonicalise({ type, colors })` — **only those two keys**, so the two exporters' differing token blocks and `semanticTokenColors` cannot split an identity. `digest` is `fnv1a64(canonicalString(...))` and nothing else: **no `crypto.subtle` path**, because a hash that switches algorithm by browsing context cannot be compared across contexts. Document that in one line above `digest`.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run .tmp_files/themes-hash.ts` → exit 0.
Run: `bun run .tmp_files/parity.ts --diff <baseline>` → 680, 0 changed (the exporters are not on the parity path; this confirms it).

- [ ] **Step 5: Commit**

```bash
git add src/lib/themes/canonical.ts .tmp_files/themes-hash.ts
git commit -m "feat(themes): canonical props hash for duplicate detection"
```

---

### Task 3: Extract the pure resolver

**Files:**
- Create: `src/lib/themes/resolve.ts`
- Modify: `src/contexts/ThemeContext.tsx:114-199` (`pickLocked`, `relink`, `resolveAll` become thin wrappers over the module)
- Test: `.tmp_files/themes-resolve.ts`

**Interfaces:**
- Consumes: `resolveUiColors`, `buildPools` from `@/lib/utils/uiColors`; `resolveSyntaxColors` from `@/lib/utils/syntaxColors`; `resolveAnsiColors` from `@/lib/utils/ansiColors`; `applyLinks` from `@/lib/colors/links`.
- Produces:
  - `export function resolvePalette(inputs: ThemeInputs, carry: ReadonlySet<string>, carryFrom: ThemePalette): ThemePalette`
  - `export function relinkPalette(args: { colors: UIColors; baseSyntax: SyntaxColors; baseAnsi: AnsiColors; links: Links; isDark: boolean }): { syntax: SyntaxColors; ansi: AnsiColors }`

The bodies move verbatim from `resolveAll` / `relink` — a relocation, not a rewrite. **Carry semantics are copied exactly:** the carry set applies to `colors` and `baseSyntaxColors` only; ANSI is always `resolveAnsiColors(assignment, colors.BG1)` with no carry, because that is what `resolveAll` does today. Do not "improve" this — a behaviour change here moves the parity baseline.

- [ ] **Step 1: Write the failing test** in `.tmp_files/themes-resolve.ts`

```ts
const a = resolvePalette(inputs, new Set(), emptyPalette())
const b = resolvePalette(inputs, new Set(), emptyPalette())
assert.deepEqual(a, b)                                   // deterministic
const hand = { ...a.ui, BG1: '#123456' }
const relocked = resolvePalette(inputs, new Set(['BG1']), { ...a, ui: hand })
assert.equal(relocked.ui.BG1, '#123456')                 // carry survives
assert.equal(keys(a.ui).length, 16); assert.equal(keys(a.syntax).length, 32); assert.equal(keys(a.ansi).length, 16)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run .tmp_files/themes-resolve.ts` → `Cannot find module '@/lib/themes/resolve'`

- [ ] **Step 3: Implement** by moving the code.

- [ ] **Step 4: Run it to verify it passes, then prove the relocation changed nothing**

Run: `bun run .tmp_files/themes-resolve.ts` → exit 0
Run: `bun run .tmp_files/parity.ts --diff <baseline>` → 680, 0 changed
Run: `bun run .tmp_files/phase-b.ts` → ALL PASSED
Run: `bunx tsc --noEmit && bun run lint` → clean

- [ ] **Step 5: Commit**

```bash
git add src/lib/themes/resolve.ts src/contexts/ThemeContext.tsx .tmp_files/themes-resolve.ts
git commit -m "refactor(theme): extract the pure palette resolver"
```

---

### Task 4: Record build and open

**Files:**
- Create: `src/lib/themes/record.ts`
- Test: `.tmp_files/themes-record.ts`

**Interfaces:**
- Consumes: `resolvePalette`, `relinkPalette` (Task 3); types from Task 1.
- Produces:
  - `export function pureOf(inputs: ThemeInputs, locks: ReadonlySet<string>, palette: ThemePalette, links: Links): ThemePalette`
  - `export function toRecord(s: ThemeStateLike, meta: { id: string; name: string; createdAt: number; propsHash: string }): SavedTheme` where `ThemeStateLike` is declared in this file as: `isDark`, `baseHue`, `uiSaturation`, `syntaxSaturation`, `scheme`, `assignment`, `colors`, `baseSyntaxColors`, `baseAnsiColors`, `syntaxColors`, `ansiColors`, `links`, `lockedColors: ReadonlySet<string>`
  - `export function recordFromOpen(open: { inputs: ThemeInputs; palette: ThemePalette; links: Links; locks: ReadonlySet<string> }, meta: { id: string; name: string; createdAt: number; propsHash: string }): SavedTheme` — assembles a record from an already-merged palette (used by import in Task 10)
  - `export function openRecord(record: SavedTheme): { inputs: ThemeInputs; palette: ThemePalette; links: Links; locks: ReadonlySet<string> }` — the merge of design §1.2

- [ ] **Step 1: Write the failing test** in `.tmp_files/themes-record.ts`

This test *is* decision A; it is the reason the field exists.

```ts
// 1. a hand-edited unlocked key is recorded as differing from pure
const state = stateFrom(inputs)                       // resolve, no edits
const edited = { ...state, colors: { ...state.colors, AC1: '#AA0000' } }
const rec = toRecord(edited, meta)
assert.equal(rec.palette.ui.AC1, '#AA0000')
assert.notEqual(rec.purePalette.ui.AC1, '#AA0000')
assert.equal(rec.purePalette.ui.BG1, rec.palette.ui.BG1)

// 2. open keeps the hand edit and freshens everything else
const freshInputs = { ...inputs, baseHue: (inputs.baseHue + 40) % 360 }
const opened = openRecord({ ...rec, inputs: freshInputs })
assert.equal(opened.palette.ui.AC1, '#AA0000')                     // hand edit survives
assert.notEqual(opened.palette.ui.BG1, rec.palette.ui.BG1)         // untouched key moved

// 3. a locked key survives verbatim and is never treated as an edit
const locked = toRecord({ ...state, lockedColors: new Set(['BG1']) }, meta)
assert.equal(openRecord(locked).palette.ui.BG1, locked.palette.ui.BG1)

// 4. links re-apply over the merged palette
assert.equal(openRecord(withLink).palette.syntax.keyword, expectedLinkedValue)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run .tmp_files/themes-record.ts` → `Cannot find module '@/lib/themes/record'`

- [ ] **Step 3: Implement `src/lib/themes/record.ts`**

`pureOf` = `relinkPalette(resolvePalette(inputs, locks, palette))` with `carryFrom = palette` — the locks are the only carried keys. `toRecord` assembles the record, taking `propsHash` from the caller. `openRecord` computes `fresh = pureOf(inputs, locks, record.palette, links)` and returns, per key across all three palettes, `record.palette[key] === record.purePalette[key] ? fresh[key] : record.palette[key]`, then re-applies `links` through `relinkPalette` so a link added after the save still wins.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run .tmp_files/themes-record.ts` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/themes/record.ts .tmp_files/themes-record.ts
git commit -m "feat(themes): record build and open with hand-edit preservation"
```

---

### Task 5: Storage with quota escalation

**Files:**
- Create: `src/lib/themes/storage.ts`
- Test: `.tmp_files/themes-storage.ts`

**Interfaces:**
- Consumes: `SavedTheme`, `parseStoredTheme` (Task 1).
- Produces:
  - `export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }`
  - `export const LIBRARY_KEY`, `export const themeKey(id)`, `export const historyKey(id)`
  - `export interface LibraryIndex { schemaVersion: 1; currentId: string | null; order: string[] }`
  - `export interface StoredHistory { cursor: number; steps: unknown[] }` — Task 12 narrows this to `History`
  - `export function readIndex(store?: KeyValueStore | null): LibraryIndex`
  - `export function writeIndex(index: LibraryIndex, store?): void`
  - `export function readTheme(id: string, store?): SavedTheme | null`
  - `export function readAllThemes(index: LibraryIndex, store?): SavedTheme[]`
  - `export function writeTheme(theme: SavedTheme, store?): 'ok' | 'quota'`
  - `export function removeTheme(id: string, store?): void`
  - `export function readHistory(id: string, store?): StoredHistory`
  - `export function writeHistory(id: string, history: StoredHistory, store?): 'ok' | 'quota'`
  - `export function pruneToBudget(index: LibraryIndex, store?): void`
  - `export const browserStore: () => KeyValueStore | null` — resolved lazily from `globalThis.localStorage`

Every function must work with the store absent-and-unavailable (returns empty / no-ops), which is Review Focus 1.

- [ ] **Step 1: Write the failing test** in `.tmp_files/themes-storage.ts` with a fake store

```ts
class Fake implements KeyValueStore { /* Map + optional byteLimit throwing a DOMException('QuotaExceededError') */ }
// round-trip
const idx = { schemaVersion: 1 as const, currentId: 'a', order: ['a'] }
writeIndex(idx, store); assert.deepEqual(readIndex(store), idx)
writeTheme(recA, store); assert.deepEqual(readTheme('a', store), recA)
// Review Focus 2: corrupt record is skipped, neighbours survive
store.setItem(themeKey('a'), '{"broken":')
assert.equal(readTheme('a', store), null)
writeTheme(recB, store); assert.deepEqual(readAllThemes({ ...idx, order: ['a','b'] }, store).map(t => t.id), ['b'])
// Review Focus 3: a newer record is never overwritten
store.setItem(themeKey('c'), JSON.stringify({ ...recA, id: 'c', schemaVersion: 9 }))
const before = store.getItem(themeKey('c'))
writeTheme({ ...recA, id: 'c' }, store); assert.equal(store.getItem(themeKey('c')), before)
// Review Focus 1: no store at all
assert.deepEqual(readIndex(null), { schemaVersion: 1, currentId: null, order: [] })
assert.equal(writeTheme(recA, null), 'quota')
// quota escalation: history is pruned, records are not
const tight = new Fake(14_000); writeTheme(recA, tight)
const h = { cursor: 20, steps: Array.from({ length: 20 }, () => ({ at: 0, entries: [] })) }
assert.equal(writeHistory('a', h, tight), 'ok')
assert.equal(readHistory('a', tight).steps.length < 20, true)
assert.equal(readTheme('a', tight)?.id, 'a')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run .tmp_files/themes-storage.ts` → `Cannot find module '@/lib/themes/storage'`

- [ ] **Step 3: Implement `src/lib/themes/storage.ts`**

`readTheme` catches parse errors **and** returns `null` for any non-`ok` parse result. `writeTheme` refuses to overwrite a stored record whose `schemaVersion` is higher than the incoming one. `writeHistory` on quota drops the oldest steps, retries, then drops the oldest steps of *every other* theme, retries, then returns `'quota'`. `pruneToBudget` walks `index.order`, sums history bytes, drops oldest steps until under 1.5 MB.

- [ ] **Step 4: Run it to verify it passes**, then `bunx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/themes/storage.ts .tmp_files/themes-storage.ts
git commit -m "feat(themes): localStorage layer with quota escalation"
```

---

### Task 6: Export naming and slug

**Files:**
- Modify: `src/lib/utils/exportTheme.ts:5-13` — add `name` and `metadata` parameters
- Modify: `src/lib/utils/export.ts:10-18` — add a `metadata` parameter
- Create: `src/lib/themes/exporter.ts`
- Test: `.tmp_files/themes-export.ts`

**Interfaces:**
- Produces:
  - `export function slug(name: string): string` — `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme'`
  - `export function exportFileName(name: string): string` → `` `${slug(name)}.json` ``
  - `export function metadataFor(inputs: ThemeInputs, locks: ReadonlySet<string>, links: Links): object` → `{ schemaVersion: 1, inputs, locks: [...locks].sort(), links }` — the `x-themegen` payload (design §6.1)
  - `generateThemeJSON(colors, syntaxColors, ansiColors, name = 'Generated Color Theme', metadata?: object): string`
  - `generateSemanticThemeJSON(name = 'Generated Color Theme', colors, syntaxColors, ansiColors, metadata?: object): { themeJSON: string; themeObject: VSCodeTheme }`

Call sites in `ExportButton.tsx` / `ExportSemanticButton.tsx` are **not** rewired here — they are wired to the record in Task 7, once a record exists.

- [ ] **Step 1: Write the failing test** in `.tmp_files/themes-export.ts`

```ts
assert.equal(slug('Aurora Night'), 'aurora-night')
assert.equal(slug('  '), 'theme')
assert.equal(slug('C++ / Rust!'), 'c-rust')
assert.equal(exportFileName('My Theme (2)'), 'my-theme-2.json')
assert.equal(JSON.parse(generateThemeJSON(c, s, a, 'Aurora')).name, 'Aurora')
assert.equal(JSON.parse(generateThemeJSON(c, s, a)).name, 'Generated Color Theme')   // default keeps old behaviour
assert.deepEqual(JSON.parse(generateThemeJSON(c, s, a, 'A', { schemaVersion: 1 }))['x-themegen'], { schemaVersion: 1 })
assert.deepEqual(JSON.parse(generateSemanticThemeJSON('A', c, s, a, { schemaVersion: 1 }).themeJSON)['x-themegen'], { schemaVersion: 1 })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run .tmp_files/themes-export.ts` → `Cannot find module '@/lib/themes/exporter'`

- [ ] **Step 3: Implement** — new parameters appended with defaults that preserve every existing call; metadata spread in only when defined.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run .tmp_files/themes-export.ts` → exit 0
Run: `bun run .tmp_files/parity.ts --diff <baseline>` → 680, 0 changed

- [ ] **Step 5: Commit**

```bash
git add src/lib/themes/exporter.ts src/lib/utils/exportTheme.ts src/lib/utils/export.ts .tmp_files/themes-export.ts
git commit -m "feat(export): named exports with optional metadata block"
```

---

### Task 7: Library controller and auto-save

**Files:**
- Modify: `src/contexts/ThemeContext.tsx` (the `commit` funnel at `:253`, the bootstrap effects at `:278-294`, the provider value at `:512`)
- Create: `src/hooks/useLibrary.ts`
- Modify: `src/components/ExportButton.tsx`, `src/components/ExportSemanticButton.tsx` (use the open record's name)
- Test: `bunx tsc --noEmit` + `parity` + `phase-b` (the browser probe lands in Task 8)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces (added to `ThemeContextType`):
  - `themeId: string | null`, `themeName: string`, `lastSavedAt: number | null`
  - `themes: ThemeSummary[]` where `ThemeSummary = { id: string; name: string; updatedAt: number; swatches: string[]; paletteOnly: boolean }`
  - `openTheme(id: string): void`, `newTheme(): void`, `renameTheme(id: string, name: string): void`, `deleteTheme(id: string): void`
  - `commit` internal options: `{ record?: boolean; save?: boolean }`

- [ ] **Step 1: Add the save path**

`commit` becomes:

```ts
const commit = useCallback(
  (mutate, opts: { record?: boolean; save?: boolean } = {}) => {
    const before = stateRef.current as ThemeState
    const after = relink(mutate(before))
    stateRef.current = after
    setVersion((v) => v + 1)
    if (opts.save !== false) scheduleSave(after)
    // history wiring lands in Task 12
  },
  []
)
```

`scheduleSave` debounces 400 ms then calls `persist(after)`: `pureOf` (Task 4) → build the export object → `propsHash` (synchronous) → `toRecord` → `writeTheme`. Gate on `libraryLoaded`. Flush on `pagehide`.

- [ ] **Step 2: Wire the bootstrap**

`bootstrap()` and the two post-mount effects (`:282`, `:292`) pass `{ record: false }`. After mount: read the index; if `currentId` resolves to a theme, adopt it via `openRecord` (unrecorded, saved once); else draw a random theme and create `Theme 1` from it (unrecorded).

- [ ] **Step 3: Implement open / new / rename / delete**

- `openTheme` — flush the outgoing theme, `openRecord` the incoming, adopt, call `setTheme(record.inputs.isDark ? 'dark' : 'light')` so `next-themes` does not override the adopted mode a tick later, then write `currentId`.
- `newTheme` — flush, then reuse the existing bootstrap path: `commitResolved((s) => bootstrap(s.isDark, randomSeed()))` with `{ record: false }`, then persist that state as a new record named `Theme N` (first free N), make it current, **empty history**. Do not call `drawTheme` directly — `bootstrap` is the funnel that already handles mode.
- `renameTheme` — writes the record name only (never the display disambiguation); re-saves immediately.
- `deleteTheme` — removes the record and its history; if it was current, opens the next by `order`, or creates `Theme 1` when the library is empty.

`themes` is recomputed by re-reading the index and records on every library mutation (never from a stale in-memory copy), with `swatches` sampled at six fixed keys (`BG1`, `FG1`, `AC1`, `AC2`, `keyword`, `ansiRed`) — no generator run.

- [ ] **Step 4: Verify**

Run: `bunx tsc --noEmit` → clean
Run: `bun run lint` → clean
Run: `bun run .tmp_files/parity.ts --diff <baseline>` → 680, 0 changed
Run: `bun run .tmp_files/phase-b.ts` → ALL PASSED
Run: `bun run .tmp_files/pw/probe-mobile.ts` → N / 0 (unchanged N — no module added yet)

- [ ] **Step 5: Commit**

```bash
git add src/contexts/ThemeContext.tsx src/hooks/useLibrary.ts src/components/ExportButton.tsx src/components/ExportSemanticButton.tsx
git commit -m "feat(themes): library controller with debounced auto-save"
```

---

### Task 8: Desktop catalogue and the library probe

**Files:**
- Create: `src/components/ThemeLibrary.tsx`
- Modify: `src/app/page.tsx:60-66` (panel above `ThemeControls`)
- Create: `.tmp_files/pw/probe-library.ts`
- Test: the probe

**Interfaces:**
- Consumes: `useTheme()` values from Task 7.
- Produces: `ThemeLibrary` — default export, props `{ compact?: boolean }`, used by both layouts.

- [ ] **Step 1: Write the failing probe** `.tmp_files/pw/probe-library.ts`

Same harness shape as `pw/check.ts` (Playwright against `127.0.0.1:3100`, viewport 1440×900, `data-testid` selectors). Sections:

```
A  catalogue renders: panel exists, row count === library size, current row marked
B  auto-save: change BG1 via the hex input, wait 700ms, reload, BG1 === new value
C  hand edit survives (Review Focus: design §1.2): pick an unlocked colour, reload, value unchanged
D  untouched colour follows its input: note AC2, change Base Hue, reload, AC2 moved
E  rename: type a new name, assert the row shows it; export, assert filename + JSON name
F  new: click New, assert a new row and a palette that differs from the previous one
G  delete: delete a theme, assert the row goes and the current theme recovers
H  two tabs (Review Focus 4): change theme A in tab 1, delete A in tab 2, reload tab 1;
   assert tab 1 does not resurrect A
I  storage unavailable: block localStorage before load, assert the app still renders and edits apply
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run .tmp_files/pw/probe-library.ts`
Expected: section A fails on a missing selector.

- [ ] **Step 3: Implement `ThemeLibrary.tsx`**

Layout per design §8.1: header `Themes · N` with `[New] [Import]` (Import disabled until Task 10), rows with swatch strip, relative age, `⤓ ✎ ✕`. Row click opens; rename is an inline input committed on Enter/blur with empty rejected; delete confirms once. Fixed max height with scroll. Before the library has loaded, render the skeleton (design §8.3) rather than an empty list, and show *"No saved themes yet"* only once loading has completed with zero records. `data-testid`s: `theme-library`, `theme-row`, `theme-row-current`, `theme-new`, `theme-import`, `theme-rename`, `theme-delete`, `theme-swatch`, `theme-skeleton`.

- [ ] **Step 4: Run the probe to verify it passes**, then `bunx tsc --noEmit && bun run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/components/ThemeLibrary.tsx src/app/page.tsx .tmp_files/pw/probe-library.ts
git commit -m "feat(themes): desktop catalogue panel"
```

---

### Task 9: Mobile themes module

**Files:**
- Modify: `src/components/mobile/viewState.ts:8-16` (`MODULE_IDS` gains `'themes'` after `'controls'`)
- Modify: `src/components/mobile/MobileShell.tsx:36-42` (`LABELS`) and `bodies`
- Test: `.tmp_files/pw/probe-mobile.ts` (existing hardcoded counts)

**Interfaces:**
- Consumes: `ThemeLibrary` (Task 8).
- Produces: nothing for later tasks.

- [ ] **Step 1: Update the probe first, so it fails for the right reason**

In `pw/probe-mobile.ts`: bar button count 5 → 6 (`:131`), pin control count 4 → 5 (`:506`), plus a section asserting the `themes` module body renders the catalogue and that tapping a row changes the current theme.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run .tmp_files/pw/probe-mobile.ts` → bar count fails (5 observed, 6 expected).

- [ ] **Step 3: Implement** — add the id, label `Themes`, `count: themes.length`, body `<ThemeLibrary compact />` (48 px rows, icon-only actions).

- [ ] **Step 4: Run it to verify it passes**

Run: `bun run .tmp_files/pw/probe-mobile.ts` → N / 0
Run: `bun run .tmp_files/pw/probe-shadow.ts` → 10 / 0
Run: `bun run .tmp_files/pw/check.ts` → N / 0

- [ ] **Step 5: Commit**

```bash
git add src/components/mobile/viewState.ts src/components/mobile/MobileShell.tsx .tmp_files/pw/probe-mobile.ts
git commit -m "feat(mobile): themes module"
```

**L1 ends here.** Gates: tsc, lint, parity 680/0, phase-b, check, probe-mobile, probe-shadow, probe-library.

---

### Task 10: Import with duplicate detection

**Files:**
- Create: `src/lib/themes/importer.ts`
- Modify: `src/contexts/ThemeContext.tsx` (`importFile`)
- Modify: `src/components/ThemeLibrary.tsx` (Import button + duplicate dialog)
- Test: `.tmp_files/themes-import.ts`, `.tmp_files/pw/probe-import.ts`

**Interfaces:**
- Consumes: `propsHash` (Task 2), `parseStoredTheme` (Task 1), `writeTheme` / `readAllThemes` (Task 5), `openRecord` / `recordFromOpen` (Task 4), exporters (Task 6).
- Produces:
  - `export type ImportResult = { kind: 'theme'; record: SavedTheme } | { kind: 'duplicate'; existing: SavedTheme } | { kind: 'invalid'; reason: string }`
  - `export async function parseImport(fileName: string, text: string, existing: SavedTheme[]): Promise<ImportResult>`

- [ ] **Step 1: Write the failing pure test** in `.tmp_files/themes-import.ts`

```ts
const exported = generateThemeJSON(c, s, a, 'Aurora', metadataFor(inputs, locks, links))
const r1 = await parseImport('aurora.json', exported, [])
assert.equal(r1.kind, 'theme')
assert.deepEqual(r1.record.inputs, inputs)
assert.deepEqual(r1.record.locks, [...locks])
assert.deepEqual(r1.record.links, links)
assert.equal(r1.record.name, 'Aurora')
const r2 = await parseImport('aurora-copy.json', exported, [r1.record])
assert.equal(r2.kind, 'duplicate'); assert.equal(r2.existing.id, r1.record.id)
const renamed = JSON.stringify({ ...JSON.parse(exported), name: 'Other' })
assert.equal((await parseImport('x.json', renamed, [r1.record])).kind, 'duplicate')  // name is not identity
// Review Focus 5
assert.equal((await parseImport('x.json', 'not json', [])).kind, 'invalid')
assert.equal((await parseImport('x.json', JSON.stringify({ foo: 1 }), [])).kind, 'invalid')
assert.equal((await parseImport('big.json', 'x'.repeat(3_000_000), [])).kind, 'invalid')
// an export with the metadata block stripped is still a theme, on the palette-only path
assert.equal((await parseImport('nx.json', JSON.stringify({ ...JSON.parse(exported), 'x-themegen': undefined }), [])).kind, 'theme')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run .tmp_files/themes-import.ts` → `Cannot find module '@/lib/themes/importer'`

- [ ] **Step 3: Implement `src/lib/themes/importer.ts`**

Order of operations, exactly: size guard (2 MB) → `JSON.parse` in a `try` → require `colors` to be an object with `editor.background` → `propsHash` → compare against `existing.map(t => t.propsHash)` → if `x-themegen` parses and validates, `openRecord` the candidate and hand the result to `recordFromOpen`; otherwise build a palette-only record (`inputs: undefined`) whose unmapped UI keys come from the fixed neutral in Task 14 (or the current theme's values while Task 14 is unstarted).

- [ ] **Step 4: Wire the UI and write `.tmp_files/pw/probe-import.ts`**

Sections: export → clear library → import → assert inputs/locks/links restored and the palette matches the export; import the same file twice → duplicate dialog, exercising both **Open existing** and **Import as new**; import a theme with the metadata block removed → palette-only row with the reference badge; import a 3 MB file → rejection message, no state change.

- [ ] **Step 5: Run to verify**, then the full standing gate set.

- [ ] **Step 6: Commit**

```bash
git add src/lib/themes/importer.ts src/contexts/ThemeContext.tsx src/components/ThemeLibrary.tsx .tmp_files/themes-import.ts .tmp_files/pw/probe-import.ts
git commit -m "feat(themes): import with deterministic duplicate detection"
```

**L2 ends here.**

---

### Task 11: Diff engine

**Files:**
- Create: `src/lib/themes/diff.ts`
- Modify: `src/lib/themes/storage.ts` (replace `StoredHistory` with an import of `History`)
- Test: `.tmp_files/themes-diff.ts`

**Interfaces:**
- Produces:
  - `export interface PatchableState { isDark: boolean; baseHue: number; uiSaturation: number; syntaxSaturation: number; scheme: ColorScheme; assignment: Assignment; colors: UIColors; baseSyntaxColors: SyntaxColors; baseAnsiColors: AnsiColors; links: Links; lockedColors: Set<string> }`
  - `export interface PatchEntry { path: string; before: unknown; after: unknown }`
  - `export interface ThemePatch { at: number; entries: PatchEntry[] }`
  - `export interface History { cursor: number; steps: ThemePatch[] }`
  - `export const HISTORY_CAP = 20`
  - `export function diffThemes(before: PatchableState, after: PatchableState, at?: number): ThemePatch`
  - `export function invertPatch(patch: ThemePatch): ThemePatch`
  - `export function applyPatch<T extends PatchableState>(state: T, patch: ThemePatch): T`
  - `export function recordStep(h: History, patch: ThemePatch): History`
  - `export function undoStep(h: History): { history: History; patch: ThemePatch } | null`
  - `export function redoStep(h: History): { history: History; patch: ThemePatch } | null`

- [ ] **Step 1: Write the failing test** in `.tmp_files/themes-diff.ts`

```ts
// 1. inverse round-trip over 500 random mutations
for (let i = 0; i < 500; i++) {
  const after = randomMutation(state)
  const p = diffThemes(state, after)
  assert.deepEqual(applyPatch(applyPatch(state, p), invertPatch(p)), state)
}
// 2. a randomize is one patch covering inputs and the three base palettes
const rz = diffThemes(a, randomize(a))
assert.ok(rz.entries.some((e) => e.path === 'assignment'))
assert.ok(rz.entries.filter((e) => e.path.startsWith('colors.')).length >= 12)
assert.ok(rz.entries.length >= 100)
// 3. derived palettes are never stored
assert.equal(rz.entries.some((e) => e.path.startsWith('syntaxColors.') || e.path.startsWith('ansiColors.')), false)
// 4. locks round-trip as a Set
const lp = diffThemes(a, { ...a, lockedColors: new Set([...a.lockedColors, 'BG1']) })
assert.equal(applyPatch(a, lp).lockedColors.has('BG1'), true)
// 5. history: cap, cursor, truncation
assert.equal(recordStep(h, p).steps.length <= 20, true)
assert.equal(undoStep(recordStep(h, p)).history.cursor, h.cursor)
assert.equal(redoStep({ ...h, cursor: 0 }).patch.entries.length, h.steps[0].entries.length)
assert.equal(recordStep({ ...h, cursor: 0 }, p).steps.length, 1)          // tail truncated
// 6. coalescing: subset within 500 ms merges, disjoint does not
const t0 = 1_000_000
const s1 = recordStep({ cursor: 0, steps: [] }, diffThemes(a, { ...a, baseHue: 10 }, t0))
const s2 = recordStep(s1, diffThemes({ ...a, baseHue: 10 }, { ...a, baseHue: 20 }, t0 + 300))
assert.equal(s2.steps.length, 1)                                          // merged
const s3 = recordStep(s2, diffThemes({ ...a, baseHue: 20 }, { ...a, scheme: ColorScheme.Analogous }, t0 + 900))
assert.equal(s3.steps.length, 2)                                          // window elapsed
assert.equal(recordStep(s3, diffThemes({ ...a, scheme: ColorScheme.Analogous }, { ...a, scheme: ColorScheme.Triadic }, t0 + 1000)).steps.length, 3) // disjoint path, not merged
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run .tmp_files/themes-diff.ts` → `Cannot find module '@/lib/themes/diff'`

- [ ] **Step 3: Implement `src/lib/themes/diff.ts`**

`diffThemes` walks the eleven fields; for the three palette records it emits one entry per changed key; for `links` one entry per added / removed / changed target; for `lockedColors` one entry per key with a boolean `before` / `after` (applying adds or removes). `applyPatch` clones shallowly, writes each value, rebuilds `lockedColors` as a `Set`, and never touches `syntaxColors` / `ansiColors`.

`recordStep` truncates at the cursor, appends, drops the oldest past `HISTORY_CAP`, and merges a step whose path set is a subset of the previous step's **and** whose `at` is within 500 ms into the previous step (`before` from the earlier, `after` from the later).

- [ ] **Step 4: Run it to verify it passes**, then `bunx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/themes/diff.ts src/lib/themes/storage.ts .tmp_files/themes-diff.ts
git commit -m "feat(themes): diff-based undo patches"
```

---

### Task 12: History controller, gestures and keyboard

**Files:**
- Create: `src/hooks/useGestureBoundary.ts`
- Create: `src/hooks/useHistory.ts`
- Modify: `src/contexts/ThemeContext.tsx` (`commit` records; new context values)
- Test: `.tmp_files/pw/probe-undo.ts`

**Interfaces:**
- Consumes: `diffThemes`, `invertPatch`, `applyPatch`, `recordStep`, `undoStep`, `redoStep` (Task 11); `readHistory` / `writeHistory` (Task 5).
- Produces (added to `ThemeContextType`):
  - `undo(): void`, `redo(): void`, `canUndo: boolean`, `canRedo: boolean`, `clearHistory(): void`
  - `beginGesture(): void`, `endGesture(): void`

- [ ] **Step 1: Write the failing probe** `.tmp_files/pw/probe-undo.ts`

```
A  slider drag → exactly one undo step
   Base Hue / UI Saturation / Syntax Saturation, each:
     12 intermediate mouse moves, release, Ctrl+Z once → aria-valuenow === value before the drag
B  picker drag → one step (same shape, inside the ActiveColorPicker box)
C  randomize → one step restores every colour and every input
     snapshot all 64 colours, click Randomize, Ctrl+Z, compare all 64 plus baseHue/scheme
D  lock / unlock → one step each
E  link / unlink → one step each
F  theme switch keeps histories: undo after switching affects only the new theme
G  redo truncates: undo twice, make an unrelated edit, assert redo is disabled
H  Ctrl+Z inside the hex input leaves the field's text alone
I  history survives a reload (persisted per theme)
```

- [ ] **Step 2: Run it to verify it fails** (Ctrl+Z does nothing yet)

- [ ] **Step 3: Implement `useGestureBoundary`** — one document-level `pointerdown` listener (capture, passive) calls `beginGesture`; `pointerup` / `pointercancel` call `endGesture`. Mounted for the provider's whole life.

- [ ] **Step 4: Implement `useHistory` and wire `commit`**

`commit` records `diffThemes(before, after)` unless `{ record: false }`; while a gesture is open the patch accumulates into a pending patch; `endGesture` commits it as one step and drops it if empty. `undo` / `redo` apply the patch via `applyPatch`, `relink`, write the ref, bump version, persist, and — when `isDark` is in the patch — call `next-themes`' `setTheme`. History saves debounce 400 ms and flush on `pagehide`.

Keyboard, in the same hook: a `keydown` listener on `window` handling `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y`, returning early when `document.activeElement` is an `input`, `textarea` or `[contenteditable]`.

- [ ] **Step 5: Run the probe to verify it passes**

Run: `bun run .tmp_files/pw/probe-undo.ts` → all sections PASS
Run: `bun run .tmp_files/pw/probe-library.ts` → still passing (a reload must not create undo steps)

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useGestureBoundary.ts src/hooks/useHistory.ts src/contexts/ThemeContext.tsx .tmp_files/pw/probe-undo.ts
git commit -m "feat(themes): per-theme undo/redo with gesture boundaries"
```

---

### Task 13: Undo/redo surfaces and clear-history

**Files:**
- Modify: `src/components/ThemeControls.tsx` (header row: undo/redo pair + `Saved` chip)
- Modify: `src/components/mobile/MobileShell.tsx` (`bodies.controls.actions`)
- Modify: `src/components/ThemeLibrary.tsx` (*Clear history* action)
- Modify: `.tmp_files/pw/check.ts`, `.tmp_files/pw/probe-mobile.ts`
- Test: both probes

**Interfaces:**
- Consumes: `undo`, `redo`, `canUndo`, `canRedo`, `lastSavedAt`, `clearHistory` (Tasks 7, 12).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing assertions** in both probes — `[data-testid=undo]` disabled at cursor 0 and enabled after an edit; clicking it moves the palette back; the same on mobile inside the controls module's `actions`. Plus a catalogue assertion that *Clear history* leaves the palette untouched and empties the stack.

- [ ] **Step 2: Run both to verify they fail.**

- [ ] **Step 3: Implement** — Tabler outline icons inlined as in the rest of the app, `aria-label` "Undo" / "Redo". The `Saved` chip shows `Saving…` while a debounce is outstanding and `Saved` after, driven by `lastSavedAt`. *Clear history* sits in the catalogue header as a quiet text action with one confirmation.

- [ ] **Step 4: Run to verify**, plus the full standing gate set.

- [ ] **Step 5: Commit**

```bash
git add src/components/ThemeControls.tsx src/components/mobile/MobileShell.tsx src/components/ThemeLibrary.tsx .tmp_files/pw/check.ts .tmp_files/pw/probe-mobile.ts
git commit -m "feat(themes): undo/redo controls and saved indicator"
```

**L3 ends here.** Gates: tsc, lint, parity 680/0, phase-b, check, probe-mobile, probe-shadow, probe-library, probe-undo.

---

### Task 14: Foreign theme mapping (optional — droppable)

**Files:**
- Modify: `src/lib/themes/importer.ts` (the palette-only branch)
- Test: `.tmp_files/themes-foreign.ts`

**Interfaces:**
- Consumes: `parseImport` from Task 10.
- Produces: `export function mapForeignColors(colors: Record<string, string>): Partial<UIColors>`

- [ ] **Step 1: Write the failing test**

```ts
const mapped = mapForeignColors({
  'editor.background': '#101010', 'editor.foreground': '#DDDDDD',
  'activityBarBadge.background': '#3366FF', 'focusBorder': '#2255EE',
  'sideBar.background': '#151515', 'editorLineNumber.foreground': '#555555',
})
assert.equal(mapped.BG1, '#101010'); assert.equal(mapped.FG1, '#DDDDDD')
assert.equal(mapped.AC1, '#3366FF'); assert.equal(mapped.BG2, '#151515')
assert.equal(mapped.BORDER, undefined)                      // unmapped stays absent
// self-contained: unmapped keys fall back to a neutral derived from BG1, not to the open theme
const rec = (await parseImport('f.json', JSON.stringify({ name: 'F', type: 'dark', colors: { 'editor.background': '#101010' } }), [])).record
assert.equal(rec.inputs, undefined)
assert.equal(rec.palette.ui.BG3, '<the neutral derived from #101010, pinned literally>')
```

- [ ] **Step 2: Run to fail → implement `mapForeignColors` and the neutral fallback.**
- [ ] **Step 3: Run to pass**, then the standing gates.
- [ ] **Step 4: Commit**

```bash
git add src/lib/themes/importer.ts .tmp_files/themes-foreign.ts
git commit -m "feat(themes): map foreign VS Code theme colours"
```

---

## Final verification

- [ ] `bunx tsc --noEmit` → clean
- [ ] `bun run lint` → clean
- [ ] `bun run .tmp_files/parity.ts --diff <baseline>` → 680 combos, 0 changed
- [ ] `bun run .tmp_files/phase-b.ts` → ALL PASSED
- [ ] `bun run .tmp_files/pw/check.ts` → N / 0
- [ ] `bun run .tmp_files/pw/probe-mobile.ts` → N / 0
- [ ] `bun run .tmp_files/pw/probe-shadow.ts` → 10 / 0
- [ ] `bun run .tmp_files/pw/probe-library.ts` → all sections PASS
- [ ] `bun run .tmp_files/pw/probe-undo.ts` → all sections PASS
- [ ] `bun run .tmp_files/pw/probe-import.ts` → all sections PASS
- [ ] All pure harnesses exit 0: `themes-schema`, `themes-hash`, `themes-resolve`, `themes-record`, `themes-storage`, `themes-export`, `themes-import`, `themes-diff`, `themes-foreign`
- [ ] Capture `mobile-m9-themes.png` and `themes-desktop.png` for the milestone record
- [ ] Update the design doc's status line and record the milestone in `docs/superpowers/specs/`
