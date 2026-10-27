# vsc_themegen — theme library: auto-saved themes, naming, catalogue, import/export round-trip, undo/redo

**Status:** implemented — L1–L4 landed (2026-10-26 → 2026-10-27). L4 (foreign import) was the last, droppable milestone.
**Date:** 2026-10-26 (design), 2026-10-27 (implemented)
**Repo:** `/home/krang/proj/vsc_themegen` (Next.js 15 / React 19, bun, no test framework; browser evidence via throwaway Playwright harnesses in `.tmp_files/`)
**Decisions by:** the human partner (Q&A in §0.1)
**Builder-checked:** an independent pass read this design against the source; §0.3 lists what it changed.

---

## 0. Summary

One feature, four milestones, in this order (free → risky; each is a safe stopping point):

| Milestone | What lands | Risk |
|---|---|---|
| **L1** | Theme record + localStorage library, auto-save on every change, naming, catalogue on desktop and mobile, export uses the name | Low — additive, no colour maths touched |
| **L2** | Import of this app's own exports, including mapping metadata; deterministic duplicate detection | Low–moderate — new path, no core state change |
| **L3** | Undo/redo over every control, diff-based, per-theme, persisted | **Highest** — hooks the single `commit` funnel in `ThemeContext` |
| **L4** | Foreign VS Code theme import (palette-only reference entry) | Optional — droppable without touching L1–L3 |

The colour pipeline (`uiColors` / `syntaxColors` / `ansiColors` / `assignment`) is untouched by every milestone, so `parity --diff` must stay **680 / 0 changed** throughout. That gate proves these features did not disturb generation.

---

## 0.1 Decisions recorded from the human partner

1. **Storage is `localStorage`.** No server, no database.
2. **A saved theme is both inputs and resolved palette.** Inputs keep it live and editable; the palette makes the record comparable to a file, which is what makes duplicate detection possible.
3. **Duplicate detection is content-addressed over the JSON props** — a canonical reordering, then a checksum, compared against existing entries.
4. **One theme open at a time, but a catalogue.** Previously created themes are browsable and referenceable; opening one replaces what is open.
5. **Rename and import are outside the undo stack.**
6. **Undo/redo is diff-based**, and must rewind randomized edits as one step.
7. **History is stored for every created theme**, not just the open one.
8. **Undo history is short.** A few dozen steps is plenty.
9. Reopening a saved theme **re-resolves from inputs**, so a generator fix reaches saved themes, **without discarding hand-picked colours** — resolved as option A in §1.2.

---

## 0.2 What "file" means here — confirm this matches your expectation

You asked for auto-save on any change "to a file", and for renaming to change "the name in json and the file name too". With `localStorage` as the store there is **no durable file**: the `.json` exists only when you press Export, at which point it downloads.

So in this design:

- auto-save writes the **record** continuously;
- **rename** changes the record name, the `name` field of the next exported JSON, and that export's **filename**;
- a file already exported is a **snapshot** and is not renamed.

If you want a real on-disk file that auto-saves and renames, that is the File System Access API (`showSaveFilePicker`, Chromium-only) sitting in front of this design as a *storage backend*. Not included. Say if you want it — it changes §2 and adds a permission story.

---

## 0.3 What the builder check changed

The independent pass (reading this doc against the actual source) surfaced seven things. Six are resolved here; one is yours:

1. **Re-resolve on open would destroy unlocked hand edits** → resolved as option A: the record stores the pure palette beside the real one, and open adopts fresh values only for keys that match (§1.2).
2. **Two exporters, two different payloads** → the hash is narrowed to the stable part both agree on, `{ type, colors }` (§5). It also exposed a real one-key drift between the serialisers (§5.3).
3. **"New" was undefined** → now defined (§7.1).
4. **Light/dark on open** → opening a theme adopts its mode, explicitly (§9.2).
5. **`assignment` is heavier than estimated** → measured, and the retention policy changed to a per-theme cap plus a global budget (§2.2, §4.4).
6. **L4 scope** → planned as optional and last; the record no longer carries an `origin` field for it (§6.2).
7. **WebCrypto is secure-context only** → fallbacks specified, because a phone on a plain-http LAN IP would otherwise have no ids and no hashing (§5.1).

---

## 1. Data model

### 1.1 The record

```ts
interface SavedTheme {
  schemaVersion: 1
  id: string                 // crypto.randomUUID, stable across renames
  name: string               // user-facing; the export's `name`
  createdAt: number
  updatedAt: number

  /** Absent for a foreign import — those are palette-only reference entries. */
  inputs?: {
    isDark: boolean
    baseHue: number
    scheme: ColorScheme
    uiSaturation: number
    syntaxSaturation: number
    assignment: Assignment   // shape, poolMode, seed, entry rolls — plain JSON
  }

  /** What the user saw, as last saved: displayed (post-link) palette. */
  palette: { ui: UIColors; syntax: SyntaxColors; ansi: AnsiColors }

  /** What the generator produced with no hand edits — see §1.2. */
  purePalette: { ui: UIColors; syntax: SyntaxColors; ansi: AnsiColors }

  locks: string[]            // Set<string>, serialised
  links: Links               // Record<LinkTargetId, { source, adjust }>

  propsHash: string          // §5, recomputed on every save
}
```

Measured footprints (`bun run .tmp_files/budget.ts`, one real `drawTheme`): `assignment` 8.4 KB, one full palette ≈ 2 KB, the exported `colors` map 12 KB. A record is therefore ≈ **12 KB**, or ≈ 14 KB with `purePalette`.

`palette` and `purePalette` are **displayed** (post-link) palettes, because that is what `generateThemeJSON(colors, syntaxColors, ansiColors)` consumes and therefore what the hash describes.

`assignment` is already plain JSON — orbit shape, pool mode, seed and per-entry rolls; no `Set` or `Map`. A future non-JSON field is rejected by the Zod parse (§2.3) rather than silently dropped.

### 1.2 RESOLVED — hand edits survive a reopen (option A)

Approved by the human partner.

**The problem.** `resolveAll` (`ThemeContext.tsx:173`) regenerates **every colour that is not locked**. So "re-resolve from inputs on open" would also throw away any colour picked by hand without locking it. Combined with auto-save that means: edit a colour, it saves, reload, the edit is gone. Auto-save would be preserving a state it then discards.

**The resolution — store the pure palette, and keep only hand-edited keys.**

At save time, resolve the theme from its inputs with no hand edits and store that in `purePalette` beside the real `palette`. On open:

```
fresh = relink(resolveAll(inputs, locks))          // no hand edits
for each colour key:
  palette[key] === purePalette[key]  →  adopt fresh[key]      // untouched by hand
  otherwise                          →  adopt palette[key]    // hand-edited: keep exactly as saved
```

Untouched colours pick up generator fixes; hand-edited ones survive. Links are re-applied on top of the merged result, as everywhere else.

**Merge subtlety the implementation must respect.** The per-key comparison is not against `palette` alone: `palette` already carries the *pre-link* colour for every linked target, and the pure palette carries the same value there. So for a linked target `palette[key] === purePalette[key]` holds even though the key is displaying the linked colour, and the merge adopts the fresh *pre-link* value — after which the documented re-link on top puts the linked colour back. The result is that a link added after the save still wins over the reopened palette, while every unlinked key keeps its hand edit. A merge that instead wrote the merged palette back as the link-input palette would let a stale rewritten value win over the link. **Store the pre-link palette in `palette`; do not store post-link values.** Implementations may relink for display, but the persisted `palette`/`purePalette` pair must both be pre-link.

**Rejected alternative (B).** Open restores `palette` verbatim: one field less, but no generator fix reaches a saved theme until the next control move — which is indistinguishable from "saved themes are frozen", and it would have made `purePalette` dead weight rather than the point.

**Implementation consequences.** Every save costs one extra pure resolve (no randomness, sub-millisecond) and one extra ~2 KB field. The comparison is per-key over the displayed palette, so a link that changes a target counts as "hand-edited" only if the stored palette disagrees with the pure one, which it does not unless the link itself changed.

---

## 2. Storage

### 2.1 Keys

| Key | Contents | Written |
|---|---|---|
| `vsc_themegen.library.v1` | `{ schemaVersion: 1, currentId: string \| null, order: string[] }` | rarely (create/delete/switch) |
| `vsc_themegen.theme.v1.<id>` | one `SavedTheme` | debounced on every change |
| `vsc_themegen.history.v1.<id>` | `{ cursor: number, steps: ThemePatch[] }` | debounced on every change |

Split so a drag rewrites only the small theme key, and so a corrupt history cannot take the catalogue down with it. Startup lists by reading the index then each theme key — a few dozen small reads at most.

### 2.2 Budget (measured, not estimated)

| Item | Measured |
|---|---|
| Record | ≈ 12 KB (14 with `purePalette`) |
| One slider/colour step | ≈ 1.8 KB |
| One randomize step | ≈ **21 KB** — a whole new `assignment` (16.4 KB, counted twice: before and after) plus ~52 colour entries |
| Retention | **20 steps per theme** + **1.5 MB global history budget** |

A randomize step is 21 KB, not the 12 KB the design first projected: an invertible patch stores the assignment on both sides, and the assignment is the bulk of it. Twenty steps of a randomize-heavy history is ≈ 430 KB, so the 1.5 MB global budget buys about 70 randomize steps (≈ 3.5 such themes); slider and picker edits cost 64–100 B a step, so ordinary use is two orders of magnitude below the cap. Twenty steps, not thirty: a 30-step cap at 21 KB would put ten heavy themes past the whole 5 MB budget on history alone. The global budget is the real guard; the per-theme cap is the fair-share rule.

On any write, catch `QuotaExceededError` and respond in this order:

1. drop the oldest steps of the **current** theme, retry;
2. drop the oldest steps across all themes to fit the global budget, retry;
3. surface a non-blocking strip — *"Storage full — delete a theme or clear history"* with a *Clear history* action.

A theme record is never sacrificed to make room for history.

A read or parse failure on one theme key is skipped (catalogue shows the rest); a record failing Zod is left untouched on disk and reported once, never deleted.

### 2.3 Validation and versioning

`SavedTheme` gets a Zod schema built from the same `UI_KEYS` / `SYNTAX_KEYS` / `ANSI_KEYS` tuples as the existing colour schemas (`src/lib/types/colors.ts:81`). `schemaVersion` is checked first:

- equal → parse;
- lower → migrate (no migrations yet; the function returns the record unchanged);
- higher → do **not** load, do **not** overwrite; show *"This browser holds themes from a newer version of the app"*.

This replaces the dead `SavedThemeSchema` (`src/lib/types/colors.ts:94` — numeric id, `userId`, `Date` fields, written for a database that no longer exists, imported nowhere). The old name is retired rather than reused.

---

## 3. Auto-save

**Every mutation already funnels through `commit`** (`ThemeContext.tsx:253`) — the same property that makes links exact. Auto-save and history hook there, not in each control:

```
commit(mutate):
  before = stateRef.current
  after  = relink(mutate(before))
  stateRef.current = after
  history.record(before, after)     // §4
  scheduleSave(after)               // debounce 400 ms (trailing)
  setVersion(v => v + 1)
```

- **Debounce 400 ms** trailing: a drag writes once at rest.
- **Flush on `pagehide`** and on theme switch, so a closing tab loses nothing.
- **Unrecorded commits.** `commit` gains `{ record: false, save: true }` for the app's own commits — the deterministic bootstrap, adopting a saved theme on mount, and adopting `next-themes`' resolved mode. Otherwise every page load starts with two undoable steps and the first Ctrl+Z rewinds something the user never did. They still save.
- **Saved indicator.** A quiet `Saving…` / `Saved` chip in `ThemeControls` driven by `lastSavedAt`. No toasts.

---

## 4. Undo / redo

### 4.1 The patch

Only **authoritative** state is diffed. `syntaxColors` / `ansiColors` are derived by `relink`, so storing them would duplicate every entry and could drift:

| Path | Notes |
|---|---|
| `isDark`, `baseHue`, `uiSaturation`, `syntaxSaturation`, `scheme` | scalars |
| `assignment` | whole object, one path |
| `colors.<UIKey>` | 16 possible |
| `baseSyntaxColors.<SyntaxKey>` | 32 possible |
| `baseAnsiColors.<AnsiKey>` | 16 possible |
| `links.<LinkTargetId>` | added / removed / `adjust` flipped |
| `locks.<key>` | added / removed |

```ts
interface ThemePatch {
  at: number                                        // for coalescing
  entries: [path: string, before: unknown, after: unknown][]
}
```

A randomize is one patch: inputs plus three base palettes plus the whole assignment (~21 KB measured), not 112 steps.

**Known optimisation, deliberately deferred:** a `regenerateAnsiColors` step stores the whole 8.4 KB assignment for a change confined to `assignment.ansi`. Structural diffing of the assignment would shrink that. It is not worth the diff-engine complexity until the global budget actually bites — and it is the first thing to do if it does.

### 4.2 Step boundaries

This decides whether undo feels right. Two rules, in order:

1. **One pointer gesture = one step.** A document-level `pointerdown` opens a transaction; `pointerup` / `pointercancel` closes it; every commit while open merges into it. Cause-agnostic: slider drags, `react-colorful` drags, a lock click, a scheme change all behave correctly without touching each control. Empty transactions are discarded on close.
2. **Fallback coalescing.** With no open gesture (keyboard repeat, programmatic burst), merge into the previous step when it is **≤ 500 ms old** and the new patch's path set is a **subset** of the previous step's. A held `ArrowRight` becomes one step; an unrelated edit 300 ms later does not.

Randomized edits undo atomically for free: one randomize is one `commit`, hence one patch.

### 4.3 Applying

`steps: ThemePatch[]` + `cursor` (0 = nothing applied). Undo applies the inverse of `steps[cursor - 1]`, `cursor--`; redo applies `steps[cursor]`, `cursor++`. A new edit while `cursor < steps.length` truncates the tail.

Applying writes each `before`/`after` at its path, rebuilds `lockedColors` as a `Set`, runs `relink`, writes the ref, bumps version, saves. Two details:

- if `isDark` is in the patch, the applier also calls `next-themes`' `setTheme`, or the document class and the palette disagree;
- undo and redo **do not record new steps** — they move the cursor.

### 4.4 Retention and lifetime

- **20 steps per theme**, oldest dropped (cursor adjusted), enforced also by the 1.5 MB global budget (§2.2).
- **Per theme, persisted.** Switching themes flushes the outgoing history and loads the incoming one — decision 7.
- **Cleared** by *Clear history* and by deleting the theme.
- **Not cleared** by rename or import (decision 5).

### 4.5 Surfaces

- Keyboard: `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` redo. Ignored while focus is in a text input, textarea or contenteditable, so the browser's text undo keeps working.
- Desktop: an undo/redo icon pair in the `ThemeControls` header row.
- Mobile: the same pair as `actions` on the `controls` `Module` — the slot already exists and draws before the pin (`Module.tsx:37`). Disabled states follow the cursor.

---

## 5. Duplicate detection

### 5.1 What is hashed

```
canonical(value):
  objects  → keys sorted ascending, recursively
  arrays   → order preserved (tokenColors is semantically ordered)
  scalars  → as-is

propsHash = hex(FNV-1a-64(JSON.stringify(canonical({ type, colors }))))
            // `name` and `x-themegen` excluded
```

`{ type, colors }` — not the whole file — for three reasons:

1. **The two exporters disagree by design elsewhere.** `generateThemeJSON` (`exportTheme.ts`) and `generateSemanticThemeJSON` (`export.ts`) carry different `tokenColors` blocks and the semantic one adds `semanticTokenColors`. Hashing the full file would make a classic and a semantic export of *the same theme* hash differently, which defeats the purpose.
2. **Cost.** The whole file is only 30 KB and the `colors` map 12 KB, so this is not a performance argument — it is an identity argument: the colours are what "the same theme" means.
3. It still satisfies decision 3 literally: canonicalised JSON props, checksummed.

`type` is included so a dark and a light theme with coincidentally identical colours are distinguishable.

**Accepted consequence:** two foreign themes sharing a `colors` map but differing in token rules read as duplicates. The prompt offers **Import as new**, so it informs rather than blocks.

**WebCrypto is not used, on purpose.** `crypto.subtle` is secure-context only: the app is normally on `127.0.0.1` (secure) or the tailnet HTTPS host (secure), but a phone pointed at a plain-http LAN IP would lack it. A hash that alternates between SHA-256 and FNV depending on context produces two incompatible value spaces for the same theme, so a duplicate saved from one context would not be recognised from the other. The digest is therefore **always** 64-bit FNV-1a over the canonical string — synchronous, context-independent, and identical everywhere. Collision resistance at 293 keys against a local catalogue of human-named themes is not a concern; consistency is worth more than 256 bits here. (`crypto.randomUUID` still falls back to a timestamp+random string for ids, where mismatch is harmless.)

### 5.2 When it is computed

On **every save**, at the end of the debounce: the exporter runs (≈30 KB string build) and the 12 KB colours map is hashed — low single-digit milliseconds once per gesture. No stale/null state, no background recomputation, and the hash always describes the record as it currently is.

### 5.3 A real bug the check found: the exporters disagree on one colour key

`diffEditor.diagonalFill` is `colors.ERROR` in `exportTheme.ts:451` and `colors.INFO` in `export.ts:459`. It is the **only** differing key out of 293; everything else in the `colors` map agrees across both serialisers, and was verified over five seeded themes.

Consequence for this design: without a fix, a classic and a semantic export of the same theme hash differently by exactly this key. The fix is one line, and `INFO` looks like the intended value (its neighbours are `insertedLineBackground = INFO` / `removedLineBackground = ERROR`; an error-red diagonal fill in a diff view reads as a bug). **This is an export change, so I am not making it unasked** — say the word and it lands with L2.

---

## 6. Import

### 6.1 This app's own exports (L2)

The export gains a top-level `x-themegen` object:

```json
"x-themegen": {
  "schemaVersion": 1,
  "id": "…", "name": "…", "createdAt": …, "updatedAt": …,
  "inputs": { "isDark": true, "baseHue": 214, "scheme": 3,
              "uiSaturation": 62, "syntaxSaturation": 58, "assignment": { … } },
  "locks": ["BG1", "AC1"],
  "links": { "keyword": { "source": "AC1", "adjust": true } }
}
```

VS Code's theme loader ignores unknown top-level keys, so the file still drops into an extension. On import the record is rebuilt with inputs, locks and links, then resolved per §1.2's answer, and the imported theme is editable exactly like a generated one.

If `x-themegen` is absent or unparseable, the file takes the foreign path (§6.2) rather than being rejected.

### 6.2 Foreign VS Code themes (L4, optional)

Deliberately lossy and labelled as such:

- extract the `colors` map; map well-known keys onto our 16 UI keys (`editor.background` → `BG1`, `editor.foreground` → `FG1`, `activityBarBadge.background` → `AC1`, …);
- **self-contained, not relative to the open theme** (the builder check caught this): unmapped UI keys fall back to a fixed neutral derived from the mapped background, never to whatever the current theme happens to hold;
- `inputs` absent, so the record is palette-only and the catalogue badges it;
- **the raw `tokenColors` block is not stored** — re-exporting a foreign theme reproduces its colours, not its token rules, and the UI says so;
- `propsHash` is carried from the file.

Lands last and is droppable without touching L1–L3. If it is dropped, nothing else changes: the record has no `origin` field, and "palette-only" is simply the absence of `inputs`.

### 6.3 Import UX

`<input type="file" accept="application/json,.json">` behind an **Import** button in the catalogue header. Parse → validate → hash → duplicate check → (open existing | import as new) → name prefilled from the file's `name` or its filename → insert, make current.

Reject files over 2 MB with a clear message instead of freezing the tab.

---

## 7. Naming, export, and New

### 7.1 New

**A new theme is a fresh random draw**, the same operation as Randomize, written into a new record (`Theme N`, first free N) that becomes current. The outgoing theme is saved first.

Undo consequence, decided deliberately: the new record starts with an **empty** history, so Ctrl+Z immediately after New does nothing. The random draw is *not* recorded into the outgoing theme's history and does not appear in the new one — it is the new theme's starting state, not an edit to it.

### 7.2 Rename

Inline in the catalogue. Empty or whitespace-only is rejected. Duplicate names are allowed — `id` is the identity — and the catalogue disambiguates with a display-only `(2)` suffix that is never written into the record.

### 7.3 Export

- `slug(name)`: lowercase, non-alphanumerics → `-`, collapsed, trimmed; empty → `theme`.
- Filename `<slug>.json`; JSON `name` = record name.
- `generateThemeJSON` (`exportTheme.ts:11`) hardcodes `name: 'Generated Color Theme'` and gains a `name` parameter (defaulted, so existing calls are unaffected). `generateSemanticThemeJSON` (`export.ts:11`) already takes one.
- Both gain an optional `metadata` argument, inserted as `x-themegen` before stringifying.
- Both export buttons (`page.tsx:81-84`, `MobileShell.tsx`) use the open record's name and metadata.

---

## 8. UI

### 8.1 Desktop

A **Themes** panel in the left column, above `ThemeControls`:

```
┌ Themes · 7                         [New] [Import] ┐
│ ▸ Aurora          ▓▓▓▓▓▓   2m ago   ⤓ ✎ ✕        │   ← current, highlighted
│   Ember            ▓▓▓▓▓▓  1h ago    ⤓ ✎ ✕        │
│   …                                              │
└──────────────────────────────────────────────────┘
```

Row click opens (saving the outgoing theme). `⤓` export, `✎` rename inline, `✕` delete with one confirmation. The swatch strip is six colours sampled across UI/syntax/ANSI from `palette` — no generator run. The list scrolls at a fixed max height so the panel does not grow with the catalogue.

### 8.2 Mobile

A new module id `themes` in `MODULE_IDS`, title `Themes`, `count` = catalogue size, placed after `controls`. Body is the same list in `compact` mode (48 px rows, icon-only actions). Undo/redo ride as `actions` on the `controls` module (§4.5).

Adding a module id means updating `LABELS`, the bottom bar (generated from `MODULE_IDS`), and the mobile probe's hardcoded counts (`probe-mobile.ts:131` expects 5 bar buttons, `:506` expects 4 pin controls) **in the same commit**.

### 8.3 Empty and loading states

- Empty library: *"No saved themes yet"* plus New. Unreachable after first load, reachable after deleting everything.
- Before localStorage has been read, the panel renders a skeleton and the app keeps the deterministic bootstrap palette. It never flashes a different theme.

---

## 9. `ThemeContext` integration

Three new responsibilities in the provider, all in one place:

1. **History controller** (`useRef`) — `record`, `undo`, `redo`, `beginGesture`, `endGesture`, `clear`. Patch computation and application live in `src/lib/themes/diff.ts`, pure, testable from a harness without React.
2. **Library controller** — current id, catalogue metadata, `openTheme`, `newTheme`, `renameTheme`, `deleteTheme`, `importFile`, `exportCurrent`. Persistence in `src/lib/themes/storage.ts`.
3. **New context values** — `themeId`, `themeName`, `canUndo`, `canRedo`, `undo`, `redo`, `themes`, `openTheme`, `newTheme`, `renameTheme`, `deleteTheme`, `importFile`, `lastSavedAt`.

```
src/lib/themes/schema.ts        Zod record + version check
src/lib/themes/canonical.ts     deep key sort + digest (with fallback)
src/lib/themes/diff.ts          diffStates / applyPatch  (pure)
src/lib/themes/storage.ts       localStorage read/write, quota, migration
src/lib/themes/exporter.ts      name/slug/metadata plumbing
src/components/ThemeLibrary.tsx catalogue (desktop + compact)
src/hooks/useGestureBoundary.ts document-level pointer transaction
```

### 9.1 Bootstrap (SSR-safe)

The existing constraint survives: a server-rendered random palette would hydrate-mismatch, so the first paint is deterministic and the random draw happens after mount (`ThemeContext.tsx:201-231`).

1. first paint — deterministic bootstrap, unchanged;
2. after mount — read the library;
3. `currentId` present → adopt the record (**unrecorded**) and save;
4. no library → draw a random theme as today, then create `Theme 1` from it (unrecorded).

The catalogue shows a skeleton until step 2 finishes.

### 9.2 Mode on open

`layout.tsx` runs next-themes with `enableSystem`, and `ThemeContext.tsx:288-294` commits `isDark` back whenever `resolvedTheme` disagrees. So opening a light theme while the system is dark would be overridden a tick later unless the open path **also calls `setTheme`**.

Decision: **opening a theme adopts its mode.** A theme is a dark theme or a light theme; showing one in the other mode is showing something else. This writes next-themes' own preference key, which is the same thing the mode toggle already does. The alternative — treat the record's mode as advisory and re-range its palette into the current mode — is defensible but produces a theme that is not the one saved.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| A diff/apply bug silently corrupts the open theme | `applyPatch` is pure and symmetric; a harness asserts `applyPatch(applyPatch(s, p), inverse(p)) === s` over 500 generated patches plus a 200-edit round-trip |
| Undo fires mid-drag and fights the gesture | Gesture transactions make undo a no-op while a pointer is open |
| Auto-save writes during hydration or adoption and duels with the load | The load is the first writer; saves gate on `libraryLoaded` |
| Unlocked hand edits lost on reload | Closed by design: `purePalette` + per-key comparison on open (§1.2); `pw/probe-library.ts` asserts a hand-edited unlocked colour survives a reload while an untouched colour picks up a changed input |
| Quota exhaustion | Per-theme cap + global budget + prune-order that never drops records (§2.2) |
| Module count breaks the M8 mobile probes | Same-commit update of the probe's bar/pin counts |
| Export identity drifts (the `diagonalFill` case) | §5.3 — the hash is narrowed; the drift itself is a separate one-line fix awaiting your word |

---

## 11. Verification

No test framework; evidence is throwaway harnesses, as in every prior phase.

**Standing gates, every milestone:**

| Gate | Command | Expected |
|---|---|---|
| Types | `bunx tsc --noEmit` | clean |
| Lint | `bun run lint` | clean |
| Palette parity | `bun run .tmp_files/parity.ts --diff <baseline>` | 680 combos, **0 changed** |
| Live invariants | `bun run .tmp_files/phase-b.ts` | ALL PASSED |
| Desktop suite | `bun run .tmp_files/pw/check.ts` | N / 0 |
| Mobile probe | `bun run .tmp_files/pw/probe-mobile.ts` | N / 0 (N changes with the new module) |
| Shadow probe | `bun run .tmp_files/pw/probe-shadow.ts` | 10 / 0 |

Do **not** run `bun run build` while `next dev` is live on 3100 — they share `.next`. Use `tsc` + `lint`, or `sh .tmp_files/dev-reset.sh` afterwards.

**New harnesses (`.tmp_files/`, throwaway):**

1. `themes-diff.ts` — pure, no browser. `applyPatch` inverse round-trips over 500 generated patches; a randomize patch carries all three base palettes and the assignment; displayed palettes never appear in a patch.
2. `pw/probe-library.ts` — create, edit, wait past the debounce, reload, assert the edit survived; rename, then assert the export filename and JSON `name`; delete and assert the catalogue and `currentId` recover.
3. `pw/probe-undo.ts` — one undo step per drag on each slider; one randomize → one undo restores every colour and every input; separate histories survive a theme switch; redo truncates after a mid-history edit; `Ctrl+Z` inside a hex input leaves the field alone.
4. `pw/probe-import.ts` — export, clear the library, re-import, assert inputs/locks/links restored and the palette matches; import the same file twice and assert the duplicate prompt; (L4) import a foreign theme and assert a palette-only entry.

Each milestone ends with the gates green, its own probe passing, and a commit.

**Final state (L1–L4 landed):** `tsc` clean · `lint` clean · parity **680 / 0 changed** · `phase-b` ALL PASSED · `check` 129/0 · `probe-mobile` 208/0 · `probe-shadow` 10/0 · `probe-library` 68/0 · `probe-undo` 87/0 · `probe-import` 86/0 · the nine pure `themes-*` harnesses exit 0.

**Durability rule learned in L4:** a measurement taken on a dirty working tree is not evidence. The first review of the foreign mapping reported a freeze on a mid-tone background, the orchestrator measured the symptom against a tree that already carried the in-flight fix and wrongly called it a false positive, and the freeze was real at the reviewed commit (`editor.background` `#808080` / `#828282` never returned; `#7C7C7C` / `#909090` were fine). `adjustCommentColor`'s ±20% walk could straddle the comment band for ever on a mid-tone background — now a 64-step budget plus a colour-state cycle guard, with a fixed-iteration bisection over lightness when the walk cannot answer and the closest achievable colour when the band is unreachable. The in-band walk is untouched, so the corpus did not move.

---

## 12. Milestones

### L1 — record, library, auto-save, naming, catalogue

`schema.ts`, `storage.ts`, `canonical.ts`, `exporter.ts` (name/slug), `ThemeLibrary.tsx`, context additions, auto-save in `commit`, both layouts. Export uses the record name. No history, no import.

Done when: an edit survives a reload; the catalogue lists, opens, renames and deletes; the export filename and `name` follow the record; gates green.

**Done (2026-10-26).**

### L2 — import of our own exports + duplicate detection

`x-themegen` in both exporters, `importFile`, hashing, duplicate prompt, import UX.

Done when: export → clear → import restores inputs, locks and links; a second import of the same file is flagged; gates green.

**Done (2026-10-26).**

### L3 — undo/redo

`diff.ts`, the history controller, gesture boundary, keyboard, buttons, per-theme persistence, retention.

Done when: every control is undoable in one step per gesture; randomize undoes atomically; history survives reload and theme switch; gates green.

**Done (2026-10-27).**

### L4 — foreign import (optional)

Heuristic mapping, palette-only records, the import dialog's foreign branch.

Done when: a stock VS Code theme imports as a labelled reference entry without disturbing generator state; gates green.

**Done (2026-10-27).** The mapping is the exporter's own table read backwards (`mapForeignColors`), and a foreign record is *self-contained*: every key the file does not speak is filled from a neutral derived from the file's own background, never from the theme that happened to be open (§6.2). The readability pass is the generator's own, run against the imported background.

---

## 13. Out of scope

- Real on-disk auto-save / rename (File System Access API) — §0.2.
- Cross-tab synchronisation (`storage` events). One tab owns the library; last write wins. Worth a follow-up.
- Cloud sync, sharing, accounts, any server.
- Merging the two export serialisers (still deliberately separate — see the colour-architecture doc). §5.3's one-key drift is a fix, not a merge.
- Changing the generator, the pickers, or the saturation maths.
