# vsc_themegen — Phase 1 implementation plan

**Spec:** `docs/superpowers/specs/2026-10-17-vsc-themegen-color-architecture.md` (authoritative; read it before starting any task here).
**Goal:** fulfil Phase 1 in the partner's stated order — de-dup the colour key lists → stable hue assignment → scheme repair/delete → Lock All → theme→syntax/ANSI linking. Five phases, five commits, each phase ends runnable and visually verifiable in the browser.
**Tech:** Next.js 15.0.0-rc.0 / React 19 RC, static export, bun, TypeScript, Tailwind, radix-ui, `color`. **No test framework in the repo** — verification is throwaway harnesses in `.tmp_files/` (gitignored, tsconfig-excluded) plus `bun run build`.

## Steps

- [x] **A — one spec table per domain.** `src/lib/colors/{schemes,spec,ui,syntax,ansi,index}.ts`; generators and saturation updaters and Zod all derive from the tables; four declared behaviour fixes land. Parity harness gates it.
- [x] **B — stable hue assignment.** `src/lib/colors/assignment.ts`; hue/lightness/roll values drawn once per theme; Base Hue becomes a coherent rotation; `few` wired honestly; ANSI stabilised.
- [ ] **C — scheme repair.** 8 schemes deleted, 4 repaired to `rotate(baseHue, offsetₖ)`; dropdown 42 → 34; commented-out code removed.
- [ ] **D — Lock All.** One button in the theme panel header; 16 UI keys; no-op disabled.
- [ ] **E — theme→syntax/ANSI linking.** Link button replaces Copy everywhere; placement mode; one link per target; readability-adjusted by default with a per-colour raw toggle; unlink reverts to the seeded base; hover cross-highlights.

---

## The standing gate

Every phase is checked the same way. Set this up once in A1 and reuse it verbatim afterwards.

```sh
cd /home/krang/proj/vsc_themegen
bun run .tmp_files/parity.ts --out .tmp_files/after.json   # seeded palette dump
bun run .tmp_files/parity.ts --diff .tmp_files/before.json # compare, assert expected-only diffs
bun run build                                             # typecheck + lint + static export
```

`bun run build` is expected to be clean apart from one pre-existing warning: `react-hooks/exhaustive-deps` at `ThemeControls.tsx:46`. Any *new* warning or error is a failure.

**Harness access, measured and confirmed:** a plain `bun` process imports the generators directly — relative paths and the `@/` alias both resolve, and `types/colors.ts`'s `monaco-editor` import does not obstruct it (so the enum move in A2 is hygiene, never a precondition). A seeded `Math.random` patch makes generation byte-identical across repeats. Do not add a bundler, a test runner, or a dependency for this.

**Commits.** One per phase, phase-relevant files only. The worktree already carries unrelated dirty state (`.gitignore`, `tsconfig.json`, `bun.lockb`, untracked `.cortexkit/`, `docs/`, `service/`) — stage explicitly, never `git add -A`. `bun.lockb` is dirty for reasons unrelated to this work; leave it out of every commit.

---

# Phase A — one spec table per domain

**Files:** new `src/lib/colors/{schemes,spec,ui,syntax,ansi,index}.ts`; modify `src/lib/types/colors.ts`, `src/lib/utils/{uiColors,syntaxColors,ansiColors,colorUtils}.ts`, `src/contexts/ThemeContext.tsx`.

**Invariant:** apart from the four declared fixes (A6), every generated palette and every exported JSON is byte-identical to before. The harness proves it.

### A1 — the parity harness (do this first, before touching any source)

New `.tmp_files/parity.ts`. It must:

1. Import the three generators directly.
2. Patch `Math.random` with a seeded `mulberry32(seed)` and **reset the seed before each combination**, so both sides of the refactor consume an identical random sequence.
3. Loop `baseHue ∈ {0, 37, 120, 210, 359} × {dark, light} × {all schemes} × {few: true, false}` = 5 × 2 × 42 × 2 = 840 combinations; record the 16 UI + 32 syntax + 16 ANSI hexes for each, keyed by a stable id such as `210|dark|Triadic|few`.
4. Write JSON to `--out`, and with `--diff` compare against a recorded baseline, printing only differing keys.
5. Record a `drawCount` per combination (a counter incremented in the patched `Math.random`) — a differing draw count is itself a finding, since it means the refactor reordered RNG calls.

`mulberry32`, verified working:

```ts
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

**Steps:** write it → `bun run .tmp_files/parity.ts --out .tmp_files/before.json` on unmodified source → run it twice and confirm the two dumps are identical (proves determinism) → commit nothing (harness is scratch).

**Expect:** ~840 keys; repeat run byte-identical. If two runs of the *same* source differ, stop and fix the harness before continuing — a non-deterministic baseline cannot gate anything.

### A2 — move `ColorScheme` to a leaf module

New `src/lib/colors/schemes.ts`: the `ColorScheme` enum, moved verbatim. `src/lib/types/colors.ts` re-exports it (`export { ColorScheme } from '@/lib/colors/schemes'`) so all five existing importers (`ThemeControls`, `ThemeContext`, `colorUtils`, `uiColors`, and `types/colors.ts` itself) keep working unchanged.

**Why:** decoupling hygiene, nothing more. Verified that bun imports `types/colors.ts` happily today, so this is not a blocker for A1.

**Verify:** `bun run build` clean; `bun run .tmp_files/parity.ts --diff .tmp_files/before.json` → zero diffs.

### A3 — `spec.ts`: types and the two shared helpers

```ts
type LightnessSpec =
  | { base: 'bgBase' | 'fgBase'; plus: [number, number] }
  | { base: 'const'; value: number }

type Readability =
  | { kind: 'none' }
  | { kind: 'floor'; contrast: number | { dark: number; light: number } }
  | { kind: 'floor-then-band'; pre: number; band: { dark: [number, number]; light: [number, number] } }

interface KeySpec {
  key: string
  initial: string
  group?: string                       // syntax only
  hue: { kind: 'base' } | { kind: 'fixed'; h: number }
  satMultiplier: number
  lightness: { dark: LightnessSpec; light: LightnessSpec }
  hueShiftRange?: [number, number]     // syntax only
  lightShift?: { sign: 1 | -1; range: [number, number] }
  sliderExcluded?: boolean
  readability: Readability
}
```

Plus `makeInitial(specs) → Record<Key, string>` and `applyReadabilityPolicy(value, bg, spec, isDark) → string` in the same file. The latter must reproduce today's policy exactly, including:

- UI exclusion set (`uiColors.ts:157-175`): `lineHighlight`, `selection`, `findMatch`, `BORDER`, `BG1-3`, `FG3` get **no** adjustment; everything else `ensureReadability(…, BG1, key.startsWith('BG') ? 1.5 : 4.5)`.
- Syntax (`syntaxColors.ts:253-271`): **every** key gets `ensureReadability(…, BG1, 5.5)` first — `comment` included — then `comment` additionally gets `adjustCommentColor(…, 3/1.5, 3.25/2.5)`. The floor is *not* skipped for comment; that misconception is the doc's finding #1.
- ANSI (`ansiColors.ts:38-41,78-85`): all except `Black` and `BrightBlack` get `ensureReadability(…, BG1, 4.5)`; `Black` keeps its literal `#000000` short-circuit.

**Verify:** build clean.

### A4 — `ui.ts`, `syntax.ts`, `ansi.ts`: the three tables

One row per key, values transcribed from the current source. UI rows from `uiColors.ts:52-153` (hue, lightness, satMultiplier) and `:215-229` (the slider multipliers — **note the four mismatches**, resolved in A6); syntax rows from `syntaxColors.ts:49-250` and `:296-329`; ANSI rows from `ansiColors.ts:43-68`.

Group list for `syntaxSpec`, matching `syntaxColors.ts:42-47`: `function`(`function`,`functionCall`), `variable`(`variable`,`variableDeclaration`,`variableProperty`), `type`(`type`,`typeParameter`), `punctuation`(`punctuation`,`punctuationQuote`,`punctuationBrace`,`punctuationComma`), `tag`(`tag`,`tagPunctuation`), `control`(`control`,`controlFlow`,`controlImport`). All other syntax keys draw their own slot.

**Verify:** build clean; harness diff still zero (tables are inert until A5 uses them).

### A5 — generators and updaters iterate the tables

Rewrite the three generators to loop their spec **in the same order as today** and make the same `Math.random` calls in the same sequence. This is the whole risk of Phase A: a reordering is an output change. `generateThemeColors`'s draw order is `BG1, BG2, BG3, FG1, FG2, FG3, AC1, AC2, BORDER, INFO, ERROR, WARNING, SUCCESS, lineHighlight, selection, findMatch`, with the readability pass afterwards and the AC-pool append last (`uiColors.ts:182-191`).

`updateThemeColorsWithSaturation` / `updateSyntaxColorsWithSaturation` read `spec[key].satMultiplier`; `sliderExcluded` replaces the hard-coded `key !== 'comment'` (`syntaxColors.ts:332,344`) and `key !== 'lineHighlight' && …` (`uiColors.ts:232`) chains.

**Verify:** `bun run .tmp_files/parity.ts --diff .tmp_files/before.json` → **zero diffs**, and `drawCount` identical per combination. A non-zero diff here means the draw order changed — fix it, do not accept it. If exact seeding genuinely cannot survive the restructuring, stop and report the per-key deltas; do not silently accept a "close enough" result (doc §1.6).

### A6 — the four declared behaviour fixes

Land them *after* A5 proves parity, so each shows up as an isolated, expected diff.

1. **`FG1`/`FG2`/`INFO`** unify on the slider's multipliers: `0.05`, `0.1`, `0.2`.
2. **`controlImport`** unifies on `0.75` (the generator's value; imports reading dimmer is the plausible deliberate choice).
3. **`comment` floor guarantee**: after `adjustCommentColor`'s loop, if contrast is still below `min`, run a `ensureReadability`-style floor pass at `min`. Fixes the measured `#2D2D30 → #36363A` (contrast 1.39 against a 3.0 floor).
4. **`BG1`-edit keeps syntax locks**: `ThemeContext.tsx:250-255` must pass the locked syntax entries into `generateSyntaxColors`, as the generation path at `:127-137` already does.

**Verify:** harness diff shows *exactly* the keys these four affect and nothing else. Items 1/2 shift a slider-reached colour only (generation path unchanged for 1 and 3; item 2 changes the generator's `controlImport` output). Item 4 is context-only, so it must show **no** harness diff.

### A7 — derive `types/colors.ts` from the tables

`UIColors`/`SyntaxColors`/`AnsiColors` as mapped types over the key tuples; `initialColors`/`initialSyntaxColors`/`initialAnsiColors` via `makeInitial`; the three Zod schemas derived from the key tuples while keeping today's exact shape (`z.string()` per key). Add `initialAnsiColors` (new — ANSI has no initial-value export today; derive it from the spec's `initial` column). Leave `presets` and `SavedThemeSchema` exactly as they are (out of scope).

**Verify:** `bun run build` clean; harness diff unchanged from A6.

### A8 — commit

`git add` the new `src/lib/colors/*`, the modified `src/lib/types/colors.ts` and `src/lib/utils/*`, `src/contexts/ThemeContext.tsx`, `.gitignore`, `tsconfig.json`. Message records the harness result, e.g. `refactor(colors): one spec table per domain; parity harness green (840/840, 4 declared diffs)`.

---

# Phase B — stable hue assignment

**Files:** new `src/lib/colors/assignment.ts`; modify `uiColors.ts`, `syntaxColors.ts`, `ansiColors.ts`, `ThemeContext.tsx`, `ThemeControls.tsx`.

**Invariant:** with a fixed assignment, scheme, mode and saturations, `hue(key, baseHue+δ) == hue(key, baseHue) + δ (mod 360)` for every pool-derived key, and saturation/lightness are unchanged by `baseHue`.

### B1 — the assignment type and `drawAssignment`

```ts
type SyntaxSlot = { pool: 'base' | 'ac1' | 'ac2'; index: number }

type Assignment = {
  poolMode: 'full' | 'base'
  seed: number
  ui: {
    bgRoll: number; fgRoll: number            // normalised [0,1) — never absolute lightness
    entries: Record<UIKey, { slotIndex: number; hueJitter: number; satJitter: number; lightJitter: number }>
  }
  syntax: {
    groups: Record<string, SyntaxSlot>
    entries: Record<SyntaxKey, { slot: SyntaxSlot; hueShift: number; lightShift: number }>
  }
  ansi: { satRoll: number; lightRoll: number; entries: Record<AnsiKey, { hueJitter: number; satJitter: number; lightJitter: number }> }
  shape: { nestedSides: number[]; rosetteK: number; torusM: number; torusWinding: number[] }
}
```

`drawAssignment(baseHue, scheme, isDark, poolMode, rng)` samples every random value **once**, replacing the per-call `randomInteger`/`Math.random` draws across all three generators.

Two traps, both from the builder check and both load-bearing:

- **`poolMode` lives on the assignment, not in a call argument.** The dark/light toggle reaches generation with `few` undefined; if that changed the pool *length* while the assignment stood, every slot's `index % pool.length` would point somewhere new and hue stability would break on the mode toggle.
- **`bgRoll`/`fgRoll` are normalised, not absolute.** `bgBase` is `randomInteger(0,15)` dark / `randomInteger(85,100)` light — a *range* chosen by mode. Store `roll ∈ [0,1)` and resolve `bgBase = isDark ? floor(roll*16) : 85 + floor(roll*16)`, so the mode toggle re-ranges the same "how dark" roll instead of rolling a near-black background into a light theme.

`resolveHue(slot, pools)` where `pools = { base, ac1?, ac2? }`; `ac1`/`ac2` exist **iff `poolMode === 'full'`**, rooted at AC1/AC2's resolved hues (no circularity — AC1/AC2 resolve from the base pool). A slot naming an absent pool falls back to `base` at the same index.

### B2 — retire `schemeHues` from context; resolve on demand

`generateThemeColors` stops returning its pool; `ThemeContext` stops storing it (`:63,86,141`) and `handleColorChange` stops re-using it (`:253`). All three call sites go through `resolveHue` over the assignment, so the pool is derived on demand and cannot drift from the state that produced it.

### B3 — the action table

Implement exactly the doc's §2.3 table. The two that change behaviour:

- **Base Hue slider** → new `baseHue`, assignment **kept** (this is the fix: coherent rotation, "the green one stays the green one").
- **Dark/light toggle** → re-range `bgBase`/`fgBase` from the same rolls.

Everything else (saturation sliders, scheme dropdown, Regenerate, locks) keeps the assignment, as tabulated.

### B4 — wire `few` honestly

`handleRandomize(few)` currently hardcodes `few: true` (`ThemeControls.tsx:74`) while its callers pass `false` and `true` — so both buttons behave identically and the "adds the two accent colours" tooltip lies. Make `few` mean `poolMode`: `Randomize Full` → `'full'` (base + AC harmonics), `Randomize with Few Colors` → `'base'`. Consequence, intended: Full palettes get richer, and initial page load (`useEffect → handleRandomize()`, `ThemeControls.tsx:44-46`) becomes a Full draw.

### B5 — ANSI stability

Give ANSI the same treatment: `satRoll`/`lightRoll` on the assignment, resolved per theme; re-resolve on BG1 change instead of re-rolling. Remove the unconditional re-roll effect (`ThemeContext.tsx:270-272` becomes a resolve, not a regenerate). Needed because Phase E's ANSI revert must land on a reproducible base.

### B6 — verification

Harness:
1. **Rotation invariance** — for a fixed assignment, `hue(baseHue+δ) - hue(baseHue) == δ (mod 360)` for all pool-derived keys, δ ∈ {1, 5, 90, 359}.
2. **Mode-toggle pool stability** — hue multiset identical before/after a dark↔light switch; only lightness ranges move. (This is the assertion that catches the `poolMode` trap.)
3. **Jitter stability** — two generations from identical state are identical.
4. **Randomize disjointness** — two Randomizes differ in relationships, not merely rotation.

Manual: drag Base Hue; the palette moves as a whole.

**Commit.**

---

# Phase C — scheme repair (Q2c)

**Files:** `src/lib/colors/schemes.ts`, `src/lib/utils/colorUtils.ts`, `src/lib/colors/assignment.ts` (shape params), `src/lib/types/colors.ts` (commented-out `typeDeclaration`).

**Contract (property-tested):** every entry of `generateSchemeColors(baseHue, scheme)` must be `(baseHue + offsetₖ) mod 360` with `offsetₖ` independent of `baseHue` and non-negative. Assert for every scheme and `baseHue ∈ 0..359`: `hue(baseHue+5) - hue(baseHue) == 5 (mod 360)`, and at least 2 distinct hues.

### C1 — delete eight

`FibonacciSequence`, `NobleNumbers`, `MandelbrotSet`, `SierpinskiTriangle`, `KochSnowflake`, `YinYang`, `Hamsa`, `SpiralDynamics` — each collapses into an existing scheme (doc §3.2 table). Renumber the enum compactly: values are plain numbers, persisted nowhere, used only as in-session `Select` values.

### C2 — repair four

Keep the names; make the offsets baseHue-independent:

| scheme | repaired |
|---|---|
| `NestedPolygons` | `offsetᵢ = i · 360/nᵢ`, `nᵢ` five consecutive entries of `{3,4,5,6,8,12}` from a drawn start |
| `RosettePattern` | `k`-fold petal: `offsetᵢ = i · 360/k`, `k ∈ {5,7,8,9,10,11}` |
| `Torus` | `offsetᵢ = (i · 360/m + φ·i) mod 360`, `m ∈ {5,7,9}` |
| `DoubleTorus` | both windings: `offsetᵢ = (i · 360/m + φᵢ·j) mod 360`, `j ∈ {1,2}` |

Constants drawn once per theme in `Assignment.shape`; where a pool is shorter than needed, repeat entries as today. These constants are the difference between "Torus looks like a torus" and "Torus is a 7-step wheel" — I review the four on screen once before sign-off.

### C3 — strip the dead code

The commented-out `GoldenRatio` lines, the commented-out `SierpinskiCarpet` case, the commented-out `typeDeclaration` in `initialSyntaxColors`, and any `degreesToRadians` callers now unused (`Torus`/`DoubleTorus`/`YinYang`/`MandelbrotSet` all drop out). Keep `degreesToRadians` only if `GoldenSpiral` or another survivor still uses it — check, don't assume.

### C4 — verification

Property test (rotation covariance) green for all 34 schemes; at least 2 distinct hues each; `bun run build` clean. Harness: expect diffs **only** for the four repaired schemes; the 8 deletions must not change any other scheme's output.

Manual: open the dropdown, step through the four repaired schemes, confirm each reads as its name.

**Commit.**

---

# Phase D — Lock All

**Files:** `src/components/ColorList.tsx`.

- Add a `Lock All` button beside `Unlock All` in the theme panel header (`ColorList.tsx:66-71`; rendered `isThemeColors={true}` at `page.tsx:58`).
- Locks all 16 UI keys; already-locked keys untouched; `Unlock All` unchanged.
- **Disabled when every UI key is already locked**, so it is never a no-op.
- No matching button for Syntax or ANSI.
- Implement via `toggleColorLock` (as `handleUnlockAll` does) or a batch context action — either is fine; do not restructure `ColorList`. Collapsing `ColorList`/`SyntaxColorList` into one parameterised component belongs with Phase E's pill work; if done, do it there and say so.

**Verify:** build clean; manual — click, confirm 16 locks appear, click again (disabled), `Unlock All` clears. Confirm only the theme panel gained a button.

**Commit.**

---

# Phase E — theme → syntax/ANSI linking

**Files:** new `src/lib/colors/links.ts`; modify `ThemeContext.tsx`, `ColorList.tsx`, `SyntaxColorList.tsx`, `AnsiColorList.tsx`, `types/colors.ts` (link types).

### E1 — types and state

```ts
type LinkTarget = { kind: 'syntax'; key: SyntaxKey } | { kind: 'ansi'; key: AnsiKey }
type Link = { source: UIKey; target: LinkTarget; adjust: boolean }
```

- **Cardinality:** at most one link per target, structurally — store as a keyed directory (`Record<TargetId, Link>`), never an array, so "one per target" cannot be violated. One source may feed many targets.
- **Direction:** `source ∈ UIKey`; `target ∈ syntax ∪ ANSI`. Nothing else expressible in the type.
- Links live in `ThemeContext` and survive Randomize/Regenerate/scheme change/saturation drags/mode toggle.

### E2 — the base/displayed split (the revert mechanism)

Retain each key's **generated base** value alongside the **displayed** value. Unlink re-displays the base — instant, exact, and never a re-generate. This is precisely why B is a hard prerequisite for E: without stable assignment, "the seeded colour" is not reproducible after a Randomize.

### E3 — `applyLinks`

One `applyLinks(ui, ansi, links, bg) → { syntax, ansi }` step, run after **any** change to a source value — generation, both saturation sliders, and direct edits via `handleColorChange`. Every edit affordance funnels through `handleColorChange` (`ThemeContext.tsx:238-264`), so "after every generation" would miss the common path: a UI-saturation drag changes a source's saturation, so a link fed by that source must re-resolve.

Resolution per target:

```
raw = Color(ui[source]).hex()                     // alpha stripped here, once
syntax, t !== 'comment' : ensureReadability(raw, BG1, 5.5)
syntax, t === 'comment' : adjustCommentColor(ensureReadability(raw, BG1, 5.5), BG1, 3/1.5, 3.25/2.5)
ansi,   t !== 'Black'   : ensureReadability(raw, BG1, 4.5)
ansi,   t === 'Black'   : raw
displayed = adjust ? adjusted : raw               // adjust defaults true
```

Both adjusters preserve hue for free (lightness/saturation only). Alpha is stripped at `raw`, so `adjust` toggles readability and never alpha — which is what makes all 16 theme pills usable as sources. A raw alias that is unreadable is the user's explicit choice; no warning UI.

**Linked targets are exempt** from the syntax saturation rewrite and the syntax readability rewrite: they re-derive from the source. So "survives a saturation drag" means *the link persists and the target follows its source*, not *the target is frozen*.

### E4 — interaction

1. **Theme pills** (`ColorList.tsx`): Copy → Link (lucide `Link`). Click enters **placement mode**.
2. **Placement mode:** every linkable target (all syntax pills, all ANSI rows) highlighted; the source pill's Link button shows its active state; `Escape` or a second click on the same button cancels; another source's Link button switches the mode.
3. **Targets:** clicking a highlighted target creates/replaces the link and exits placement mode. Linked targets show a **right-aligned link icon with a slightly changed colour**.
4. **Tooltips:** hovering a linked target's icon names the source key (e.g. `FG3`). Hovering a link icon **highlights every item linked to that source** — hovered pill, source pill, every sibling target. Implement as a `hoveredSource` id in context rendered as an outline/ring; **never a colour mutation**, so hover cannot affect exported colours.
5. **Unlink:** clicking the link icon removes the link and re-displays the base.
6. **Editing a linked target** (picker, hex field, hex entry) unlinks it, then applies the edit.
7. Copy removed from all three panels; the hex field under the picker is the replacement.
8. The `adjust` toggle sits on the target pill beside the link icon, visible only while linked.

### E5 — locks

Linking a **locked** syntax target: the link overrides the lock, the lock is retained (so unlocking later does not silently re-link). Linking never auto-locks. Only reachable for syntax — ANSI has no lock UI and gets none.

### E6 — verification

Harness over the full `source × target × {adjust on, off}` space:
- `adjust: true` meets the target's floor, except `ansi/Black`;
- both settings preserve the source's hue within `color`-library rounding;
- **unlink returns exactly the pre-link hex — including after a Randomize** (this is the assertion that proves the B dependency);
- with no links present, exported JSON is byte-identical to a links-free build.

Manual: link `FG3 → type`, drag Base Hue, confirm both move and the relationship holds; link `AC1 → comment`, confirm the muted ramp; toggle `adjust` off for the raw hex; edit a linked pill and confirm it unlinks; hover and confirm cross-highlighting; confirm Copy is gone everywhere.

**Commit.**

---

## Deviations and notes

- **Not committed:** the parity harness and any probe (`.tmp_files/`, gitignored, tsconfig-excluded). Referenced in each phase's commit message.
- **Untouched by design:** `export.ts` / `exportTheme.ts` (Q4a), `presets`, `SavedThemeSchema`, `ThemePreview`/Monaco/TextMate, mobile layout, ANSI lock controls.
- **Phase B changes generated palettes** (stable assignment replaces per-call draws) — that is the point of the phase, and it is not a parity failure. Phase A is the only phase that must be byte-identical.
- **Phase A draw-order risk** is the single largest hazard in the whole plan: restructuring generation can silently reorder `Math.random` calls, which a seeded diff *does* catch. If exact seeding cannot survive, stop and report per-key deltas as a known deviation — never assume equivalence.
- The doc's §9 open questions 1–7 are answered (1 pass locks, 2 unify on `0.75`, 3 link overrides lock, 4 wire `few` honestly, 5 allow all 16 sources and strip alpha, 6 stabilise ANSI, 7 I review the four schemes on screen).
