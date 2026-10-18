# vsc_themegen — colour architecture unification, stable palettes, scheme repair, Lock All, and theme→syntax/ANSI linking

**Status:** design, awaiting review. Nothing here is implemented yet.
**Date:** 2026-10-17
**Repo:** `/home/krang/proj/vsc_themegen` (Next.js 15.0.0-rc.0 / React 19 RC, static export, bun, no test framework)
**Scope decisions by:** the human partner (Q&A recorded in §0.2)
**Reviewed by:** an independent builder-check pass; its findings are folded in throughout and summarised in §0.3

---

## 0. Summary

Five pieces of work, in this order:

| Phase | Name | Kind | Behaviour change? |
|---|---|---|---|
| A | Unify the colour key lists into per-domain spec tables | refactor | **No** output change, plus 4 declared fixes (§1.4), proven by a parity harness |
| B | Stable hue assignment ("seeded" palettes) | feature | **Yes, deliberately** |
| C | Repair 4 geometry schemes, delete 8 non-schemes | fix | Yes (only for those 12 schemes) |
| D | "Lock All" button on Theme Colors | feature | No |
| E | Theme → Syntax/ANSI colour linking | feature | No (additive) |

Explicitly **out of scope** (see §7): merging the two export tables, a presets UI, persistence/sharing, ANSI regeneration redesign, mono/preview rendering, the dead Zod saved-theme schema, a committed test framework.

---

## 0.1 Current state (verified)

Verified by reading the code and by four throwaway probes under `.tmp_files/`.

**Where a colour key is declared today — five places per key, per domain.** For syntax (`keyword` as the example):

1. `src/lib/types/colors.ts` — the `SyntaxColors` interface field.
2. `src/lib/types/colors.ts` — the `SyntaxColorsSchema` Zod field (dead at runtime; nothing imports it).
3. `src/lib/types/colors.ts` — `initialSyntaxColors` literal value.
4. `src/lib/utils/syntaxColors.ts` — the `syntaxColors` object literal in `generateSyntaxColors` (hue source, saturation multiplier, lightness shift, hue shift).
5. `src/lib/utils/syntaxColors.ts` — the `saturationMultipliers` map in `updateSyntaxColorsWithSaturation`.

A sixth if the key needs a VS Code scope: `export.ts` / `exportTheme.ts` (out of scope, §7). UI colours (`uiColors.ts`, 16 keys) have the identical five-way split. ANSI has three (type + `initialAnsiColors` + the `ansiColors` literal) because ANSI has no locks and no slider. Counts: **16 UI, 32 syntax, 16 ANSI.**

**Four properties that are inconsistent between two places today.** Each is a latent bug, not a design choice; Phase A makes them impossible by construction.

| key(s) | generator | slider `update*WithSaturation` | note |
|---|---|---|---|
| `FG1`, `FG2` | `0.45`, `0.45` (`uiColors.ts:78,85`) | `0.05`, `0.1` (`:219,221`) | ~9× apart |
| `INFO` | `1.0` (`:117`) | `0.2` (`:225`) | 5× apart |
| `controlImport` | `0.75` (`syntaxColors.ts:212`) | `1.05` (`:325`) | the only syntax mismatch out of 32 |

A key's saturation therefore depends on whether it was reached by generating or by dragging the slider. The slider's value wins in the UI for every other key, so it is the one the user sees.

`comment: 0.5` in the syntax slider map is **dead code** — `comment` is skipped by that function entirely.

**`comment` has a two-step policy, not an exemption.** In the generator (`syntaxColors.ts:253-271`) `comment` gets the same `ensureReadability(…, 5.5)` pass as every other token, and is *then* band-adjusted by `adjustCommentColor(…, 3.0–3.25 dark / 1.5–2.5 light)` which desaturates to ≤15%/≤35% saturation. The pre-pass matters: it decides the starting lightness and saturation the band-walk approaches from. `comment` is exempted only from the *saturation updater* (`syntaxColors.ts:332,344`).

**`lineHighlight`, `selection`, `findMatch` are excluded from the saturation slider** and carry alpha: `initialColors` uses 8-digit hex (`#2F313710`, `#264F7820`, `#515C6A20`, lines 91-93) and the generator appends `'70'` (`uiColors.ts:135,144,153`). `isHexColor` is `/^#[A-Fa-f0-9]{6}$/` (`colorUtils.ts:578`), so these three can be *displayed* in the hex field but never *typed* into it.

**Locks are silently discarded on a background edit.** `ThemeContext.tsx:250-255`: editing `BG1` regenerates **syntax** via `generateSyntaxColors(newColor, schemeHues, syntaxSaturation)` — passing **no `lockedColors` argument** — so every locked syntax token is clobbered. It does *not* regenerate UI colours and does *not* overwrite `colors.BG1`; the UI side simply takes the edited value. (An earlier draft of this document mis-stated this as a UI/BG1 problem. Corrected.)

**One shared lock set.** `lockedColors: Set<string>` covers UI and syntax with no key-name overlap (16 UI names vs 32 syntax names are disjoint), so both generators filter against the same set. ANSI is **not** lockable at all: `AnsiColorList.tsx` renders no lock button, and nothing ever inserts an `ansiXxx` entry into `lockedColors` — that prefix exists only as an `activeColor` namespace (`ThemeContext.tsx:240-244`).

**ANSI is re-rolled on every background change, unconditionally.** `regenerateAnsiColors` (`ThemeContext.tsx:266-268`) calls `generateAnsiColors(colors.BG1)`, which re-draws `baseSaturation`/`baseLightness` and re-jitters all 16 colours (`ansiColors.ts:6-23`); a `useEffect` on `colors.BG1` fires it (`:270-272`). There is no lock, no assignment, and no way to keep a terminal palette stable. `Black` is a literal `#000000` and `BrightBlack` is exempt from the 4.5 readability floor (`:38-41, 78-85`).

**"Randomize Full" and "Randomize with Few Colors" are the same button.** `handleRandomize(few = false)` (`ThemeControls.tsx:48`) never reads its argument — line 74 hardcodes `few: true`. Both buttons (`:283`, `:303`) therefore produce base-pool-only palettes, while the Full button's own tooltip promises it "add[ds] the two accent colors to generate the Syntax colors". Every other caller is `few: true` too (`ThemeContext.tsx:171` setBaseHue, `:221` setScheme); only `setIsDark` (`:163`) omits `few`, so `!few` is *falsey* there and `uiColors.ts:182-191` — the branch that appends the AC1/AC2 harmonic pools — **runs only on a dark/light toggle**. So the AC pools are live but reachable from exactly one control that does not advertise them.

**Generation is not hue-covariant, and assignment is not stable.**

- Dragging Base Hue re-runs `generateColors` with `few: true`, which re-draws a random pool index for most keys and re-samples every jitter. Measured: with the pool held fixed (Triadic), consuming one extra `Math.random()` moved **28 of 32** syntax tokens to a different pool hue. There is no stored assignment to preserve, so this cannot be stabilised by fixing the RNG order alone.
- 12 of the 42 schemes do not produce `rotate(baseHue, offset)`. Test: shift Base Hue by 5° and check that every hue shifts by exactly 5°. Failing: `FibonacciSequence, NobleNumbers, Torus, MandelbrotSet, SierpinskiTriangle, KochSnowflake, YinYang, Hamsa, SpiralDynamics, DoubleTorus, RosettePattern, NestedPolygons`. At `baseHue = 0`:
  - `NestedPolygons` → `[0, 3, 6, 9, 12, 15]` (a 15° ramp, not a scheme)
  - `RosettePattern` → 11 entries all within ±1° of 0 (collapse)
  - `YinYang` → 2 distinct hues
  - `Torus`, `DoubleTorus` → negative hues (e.g. `-0.6`), treated as degrees downstream
  - `MandelbrotSet` → early-exits its loop, 1–3 entries
  - `SierpinskiTriangle` (`baseHue / 2ⁿ`), `KochSnowflake` (`baseHue / 3ⁿ`) → 0 at baseHue 0; at 300 the last entries are 9.375 / 1.23
  - `FibonacciSequence`, `NobleNumbers`, `Hamsa`, `SpiralDynamics` → `baseHue · k`, not `baseHue + k`
  The other 30 pass exactly under `Math.abs(baseHue + k) % 360`.

**Component duplication.** `ColorList.tsx` (141 lines, theme panel) and `SyntaxColorList.tsx` (134, syntax panel) are near-identical copies differing in grid classes and button variant; `AnsiColorList.tsx` (96) is a third variant with a `ColorBox`. All three render a copy-to-clipboard button.

**Contrast machinery** (`colorUtils.ts`):

- `ensureReadability(fg, bg, minContrast = 5.5)` — loop: if `contrast < min`, `isLight ? darken(0.05).saturate(0.05) : lighten(0.05).saturate(0.05)`, max 100 iterations. Monotone in lightness; hue preserved exactly. Floors in use: **5.5** syntax (`syntaxColors.ts:255`), **4.5** UI (`uiColors.ts:172`, but `1.5` for `BG*`) and **4.5** ANSI.
- `adjustCommentColor(fg, bg, min, max)` — walks contrast into `[min, max]`, then desaturates to ≤15% (dark) / ≤35% (light). Has an early-exit guard (`luminosity < 0.05`) that can return a colour **below its own floor**: measured `BG3 = #2D2D30` → `#36363A`, contrast **1.39** against a 3.0 floor.

**Measured linking numbers** (probe 3; contrast against `BG1 = #1E1E1E`), for a theme colour feeding a syntax token:

| source | raw alias | `ensureReadability` 5.5 | then `adjustCommentColor` 3.0–3.25 |
|---|---|---|---|
| `FG1  #D4D4D4` | 11.25 | 11.25 (unchanged) | `#6D6D6D` — 3.22 |
| `AC1  #007ACC` | **3.70** | `#009CFF` — 5.72 (hue 204→203) | `#586B77` — 3.00 |
| `BG3  #2D2D30` | **1.21** | `#8989FF` — 5.63 (hue 240→240) | `#36363A` — **1.39** |
| `SUCCESS #89D185` | 9.15 | 9.15 (unchanged) | `#637062` — 3.19 |

A raw alias can therefore produce unreadable code (1.21:1) and violates the theme's own contrast floors. That is the whole reason for the Q3d decision.

---

## 0.2 Decisions taken by the human partner

1. **Q1 (stable palettes).** Dragging Base Hue must rotate the whole palette coherently: each token keeps a fixed hue *relationship* chosen once per theme; Randomize draws a new one. A visible seed/reproducibility feature was offered and not requested; the mechanism must not preclude it.
2. **Q2 = (c).** Repair `Torus`, `DoubleTorus`, `RosettePattern`, `NestedPolygons`. Delete `FibonacciSequence`, `NobleNumbers`, `MandelbrotSet`, `SierpinskiTriangle`, `KochSnowflake`, `YinYang`, `Hamsa`, `SpiralDynamics` (each collapses into an existing scheme). Dropdown 42 → 34.
3. **Q3a.** The theme colour pill's **Copy button becomes a Link button**; Copy is removed from **all** pills (theme, syntax, ANSI). The active-link indicator is a **slightly changed colour** on the link icon (not layout-affecting); **hovering a link icon highlights every item linked to it**. The existing hex field under the picker stays as-is (not always visible).
4. **Q3b.** One link per target; a source may feed **several** targets; direction is strictly **theme → syntax and/or ANSI** (never syntax→syntax, never ANSI→anything, never into a theme colour). Links are state and survive Randomize/Regenerate.
5. **Q3c.** Unlinking **reverts to the generator's seeded colour** — the generated value is the base, the link is an override.
6. **Q3d.** A linked target takes a **readability-adjusted copy** of the source by default, with a **per-colour toggle** to take the raw alias instead.
7. **Q3 (extra).** Editing a linked target (picker, hex field, or hex entry) **unlinks it and applies the edit**.
8. **Q4 = (a).** The refactor is contained to the per-domain key lists; the two export tables stay as they are.
9. Copy-button removal and Lock All were both explicitly approved.

---

## 0.3 Findings from the builder-check pass

The review contradicted this document in three places and surfaced two bugs. All are folded in above; this is the index, so the reviewer's questions are not lost.

| # | finding | where it now lives | settles how |
|---|---|---|---|
| 1 | `comment` is *not* exempt from the 5.5 floor; it is `ensureReadability(5.5)` **then** a 3.0–3.25 band | §0.1, §1.2, §5.2 | settled: spec must express floor-then-band |
| 2 | the `BG1`-edit bug is discarded **syntax** locks, not a UI/BG1 overwrite | §0.1, §1.4 | settled: §9 item 1 |
| 3 | `controlImport` is a fourth generator/slider mismatch (0.75 vs 1.05) | §0.1, §1.4 | settled: §9 item 2 |
| 4 | "Randomize Full" ignores its own `few` argument; the AC pools are reachable only via the mode toggle | §0.1, §2.2, §9 item 4 | **user decision** |
| 5 | `poolMode` must be stored on the assignment, or a mode toggle changes the pool *length* and breaks hue stability | §2.2 | settled |
| 6 | `ui.bgBase`/`fgBase` in the assignment would break the mode toggle (dark rolls in a light theme) | §2.2, §2.3 | settled: store normalised rolls |
| 7 | links must re-resolve on **source edits**, not only on generation — `handleColorChange` is the common path | §5.1 | settled |
| 8 | the three alpha keys as link sources (16 vs 13); alpha would leak into a token | §5.2, §9 item 5 | **user decision** |
| 9 | ANSI has no lock buttons and no `ansiXxx` lock entries, so §5.5 only ever applies to syntax | §2.4, §5.5 | settled |
| 10 | `ColorScheme` lives in `types/colors.ts`, which has a top-level `import * as monaco from 'monaco-editor'` | §1.2, §8 | **corrected**: measured — a plain `bun` process imports the generators *and* `types/colors.ts` fine, alias and all (see §1.5). The move is decoupling hygiene, not a prerequisite |
| 11 | `.tmp_files/*.ts` matches tsconfig's `include`, so `next build` type-checks the scratch harness | §1.5, §8 | settled: exclude + gitignore |

---

## 1. Phase A — one spec table per domain

### 1.1 Goal

A key's full definition lives in **one** place. Adding a key = one table row. No generated palette or exported JSON changes, apart from the four declared fixes in §1.4.

### 1.2 Layout and row shape

New folder `src/lib/colors/`:

```
src/lib/colors/schemes.ts     ColorScheme enum + the scheme table (moved out of types/colors.ts, §0.3 #10)
src/lib/colors/spec.ts        types + makeInitial() + applyReadabilityPolicy()
src/lib/colors/ui.ts          uiSpec:     16 rows
src/lib/colors/syntax.ts      syntaxSpec: 32 rows
src/lib/colors/ansi.ts        ansiSpec:   16 rows
src/lib/colors/assignment.ts  Phase B: drawAssignment / resolveSlots   (added in B)
src/lib/colors/index.ts       re-exports
```

`types/colors.ts` re-exports `ColorScheme` from `schemes.ts` so every existing import path keeps working.

```ts
type LightnessSpec =
  | { base: 'bgBase' | 'fgBase'; plus: [number, number] }  // plus = jitter range
  | { base: 'const'; value: number }

type Readability =
  | { kind: 'none' }                                  // BG1-3, FG3, BORDER, ansi Black/BrightBlack
  | { kind: 'floor'; contrast: number | { dark: number; light: number } }   // 5.5 syntax, 4.5 ui/ansi
  | { kind: 'floor-then-band'; pre: number; band: { dark: [number, number]; light: [number, number] } } // comment only

interface KeySpec {
  key: string
  initial: string                    // drives initialColors / initialSyntaxColors / initialAnsiColors
  group?: string                     // syntax only: keys sharing a group share a pool slot
  hue: { kind: 'base' }              // draw a slot from the base pool (every UI key, and most syntax keys)
     | { kind: 'fixed'; h: number }  // INFO 210, ERROR 0, WARNING 30, SUCCESS 120
  satMultiplier: number              // ONE value, used by BOTH the generator and the slider
  lightness: { dark: LightnessSpec; light: LightnessSpec }
  hueShiftRange?: [number, number]   // syntax: the per-token hueShift (e.g. [13, 26])
  lightShift?: { sign: 1 | -1; range: [number, number] }
  sliderExcluded?: boolean           // lineHighlight, selection, findMatch, comment
  readability: Readability
}
```

Note `hue.kind` has no `ac1`/`ac2` variant: the accent pools exist only for *syntax* slots, never for UI keys (an AC-rooted UI slot would be circular, since AC1/AC2 are themselves resolved from the base pool).

Groups in `syntaxSpec`, matching `syntaxColors.ts:42-47` exactly: `function`(`function`,`functionCall`), `variable`(`variable`,`variableDeclaration`,`variableProperty`), `type`(`type`,`typeParameter`), `punctuation`(`punctuation`,`punctuationQuote`,`punctuationBrace`,`punctuationComma`), `tag`(`tag`,`tagPunctuation`), `control`(`control`,`controlFlow`,`controlImport`). `keyword, constant, class, parameter, property, operator, storage, selector, modifier, other, language, attribute, support, unit, datetime` each draw their own slot today.

### 1.3 Derived consumers

- The three generators iterate their spec instead of a hand-written literal: same formulas, same draw order.
- `updateThemeColorsWithSaturation` / `updateSyntaxColorsWithSaturation` read `spec[key].satMultiplier`; `sliderExcluded` replaces the hard-coded `key !== 'comment'` / `key !== 'lineHighlight'` chains.
- `readability` replaces the `if/else` chain at `uiColors.ts:157-175` and the two loops at `syntaxColors.ts:253-271`.
- `types/colors.ts` re-exports derived types (`UIColors = { [K in UIKey]: string }`, `SyntaxColors`, `AnsiColors`), `initialColors`, `initialSyntaxColors`, `initialAnsiColors`, and derives the Zod schemas from the key tuples, preserving today's exact shapes (`z.string()`; the `.nullable()` variants if any). `presets` is left untouched (ignored by request).
- `ThemeGenerationOptions.few` (a boolean meaning "base pool only") is superseded by `Assignment.poolMode` in Phase B; Phase A keeps `few` as the generator's parameter so the harness can exercise both branches.

### 1.4 The four declared behaviour fixes

Behaviour changes, called out so they are not mistaken for refactor noise. Each needs its own assertion. Items 1 and 3 are settled by recommendation; items 2 and 4 are user decisions (§9).

1. **`FG1`/`FG2`/`INFO`** unify on the slider's multipliers (`0.05 / 0.1 / 0.2`), on the grounds that the slider value is what the user sees while dragging and the generator's `0.45/0.45/1.0` are outliers against every sibling.
2. **`controlImport`** unifies on one value. Recommendation: **the generator's `0.75`** — "imports are dimmer" is a plausible deliberate choice and it is the only outlier in 32 syntax keys, unlike the UI case where the generator was the outlier. Either way it must be one value (the doc cannot leave both).
3. **`comment`'s floor guarantee**: after `adjustCommentColor`'s loop, if contrast is still below `min` (the `luminosity < 0.05` early exit), run a floor pass with `min`. Fixes the measured 1.39-contrast case, and Phase E needs it because a linked comment colour must be legible.
4. **The `BG1`-edit syntax regeneration discards syntax locks** (`ThemeContext.tsx:250-255` never passes `lockedColors`). Recommendation: **pass them**, so a locked token survives a background edit.

### 1.5 Verification — the parity harness

There is no test framework in the repo, so Phase A's first deliverable is a throwaway harness, not a committed suite.

0. Before anything else: add `.tmp_files/` to `.gitignore` and to tsconfig's `exclude` (§0.3 #11, done in this pass), so `next build` does not type-check the harness.
1. **Baseline.** `bun run .tmp_files/parity.ts --out .tmp_files/before.json` imports the three generators directly and loops `baseHue ∈ {0, 37, 120, 210, 359} × {dark, light} × {all 42 schemes} × {few: true, few: false}`, recording the 16 UI + 32 syntax + 16 ANSI hexes per combination, with a deterministic PRNG (a seeded `mulberry32`) and a recorded draw count so both sides consume randomness identically. **Measured**: a plain `bun` process imports the generators (including `types/colors.ts` and its monaco import) and honours the `@/` alias, so the harness needs no bundler; and a seeded run is byte-identical across repeats (`ui identical = true | syn identical = true`). The enum move (§0.3 #10) is therefore hygiene, not a precondition.
2. **Gate.** Re-run after the refactor with the same seed. Requirement: byte-identical across all 42 schemes × 10 base configs, **except** the four declared fixes, which are asserted as expected diffs. Any other diff is a bug, not "close enough".
3. The harness is referenced in the phase's commit message and kept in `.tmp_files/` (now ignored).

### 1.6 Risk

Rebuilding generation around a table can silently reorder `Math.random` calls, which *is* an output change under the parity harness. The seeded diff is the gate. If exact seeding proves impossible for the UI generator (it calls `randomInteger` inside nested ternaries, `uiColors.ts:53-153`), the fallback is per-key set/statistical equivalence, recorded as a known deviation for the partner to accept — not silently assumed.

---

## 2. Phase B — stable hue assignment

### 2.1 Goal

Dragging Base Hue rotates the palette coherently: identical hue *relationships*, new rotation. Randomize draws new relationships. Nothing else about a palette depends on `baseHue`.

### 2.2 The assignment

```ts
type SyntaxSlot = { pool: 'base' | 'ac1' | 'ac2'; index: number }

type Assignment = {
  poolMode: 'full' | 'base'        // 'base' = today's `few: true`
  seed: number                     // for reproducibility / debugging; not UI-exposed
  ui: {
    bgRoll: number; fgRoll: number // NORMALISED [0,1) — see mode handling below
    entries: Record<UIKey, { slot: { index: number }; hueJitter: number; satJitter: number; lightJitter: number }>
  }
  syntax: {
    groups: Record<string, SyntaxSlot>                      // function, variable, type, punctuation, tag, control
    entries: Record<SyntaxKey, { slot: SyntaxSlot; hueShift: number; lightShift: number }>
  }
  ansi: { satRoll: number; lightRoll: number; entries: Record<AnsiKey, { hueJitter: number; satJitter: number; lightJitter: number }> }  // only if §2.5 is answered "yes"
  shape: { nestedSides: number[]; rosetteK: number; torusM: number; torusWinding: number[] }   // Phase C
}
```

- `drawAssignment(baseHue, scheme, isDark, poolMode, rng)` samples every random value **once**, replacing the per-call `randomInteger`/`Math.random` draws in all three generators.
- `resolveHue(slot, pools)` where `pools = { base: generateSchemeColors(baseHue, scheme), ac1?, ac2? }`. The AC pools exist **iff `assignment.poolMode === 'full'`**, rooted at AC1/AC2's own *resolved* hues (no circularity: AC1/AC2 resolve from the base pool). A slot referring to a missing pool falls back to `base` at the same index.
- **The pool is a pure function of `(baseHue, scheme, assignment.poolMode, ac1Hue, ac2Hue)`** — *not* of the `few` argument of whatever call is in flight. This is load-bearing (§0.3 #5): the mode toggle reaches generation with `few` undefined, which today appends the AC pools; if that changed the pool *length* while keeping the assignment, every syntax slot's `index % pool.length` would point somewhere new and hue stability — the entire point of Phase B — would break on the dark/light toggle.
- Because every scheme is `rotate(baseHue, offsetₖ)` after Phase C, the whole palette is a pure function of `(baseHue, scheme, isDark, uiSaturation, syntaxSaturation, assignment)`.

**Mode handling (§0.3 #6).** `bgBase` is `randomInteger(0,15)` in dark and `randomInteger(85,100)` in light (`uiColors.ts:27-28`), i.e. a *range* selected by mode, not an independent random. Storing an absolute lightness would produce near-black backgrounds in a light theme. So the assignment stores `bgRoll`/`fgRoll ∈ [0,1)` and resolution derives `bgBase = isDark ? floor(bgRoll*16) : 85 + floor(bgRoll*16)` — which also gives the mode toggle a pleasant, deterministic property: the same "how dark is the background" roll, re-ranged. Syntax's `baseLightness`/`inverseBaseLightness` (`syntaxColors.ts:15-16`) stay derived from BG1 as they are today.

**`isDark` authority, stated once.** The `isDark` *option* governs generation ranges (the direction of `bgBase`/`fgBase`). The **actual BG1 luminance** governs everything readability-related: syntax base lightness, the 5.5/4.5/1.5 floors, the comment band, and the `isDark` argument to `adjustCommentColor`. Today the syntax generator already derives its own `isDark` from the BG1 hex (`syntaxColors.ts:13-14`) while the UI generator trusts the option; that split is correct and is preserved, because legibility depends on the real background, not on the toggle. A hand-edited `BG1` that flips polarity therefore flips syntax lightness (as it already does) while UI generation stays on the option.

**The extended `schemeHues` array in context is retired.** `generateThemeColors` currently returns the pool it built, `ThemeContext` stores it (`:86,141`), and `handleColorChange` re-uses it for the BG1 edit (`:253`). All three call sites switch to `resolveHue` over the assignment, so the pool is derived on demand and cannot drift from the state that produced it.

### 2.3 Which action does what

| action | assignment | baseHue | saturations | scheme | bg/fg rolls |
|---|---|---|---|---|---|
| Base Hue slider | kept | new | kept | kept | kept |
| UI/Syntax Saturation slider | kept | kept | new | kept | kept |
| Scheme dropdown | kept | kept | kept | new | kept |
| Dark/light toggle | kept | kept | kept | kept | **re-ranged** (same rolls) |
| **Randomize Full** | new (`full`) | new | new | new | new |
| **Randomize with Few Colors** | new (`base`) | new | new | new | new |
| Regenerate Unlocked | kept | ±15° | ±10 | kept | kept |
| Regenerate ANSI | kept | kept | kept | kept | — |
| lock / Lock All | irrelevant — locks never re-draw the assignment | | | | |

`poolMode` becomes a property of the theme rather than a flag in a call site, and "Randomize Full" finally means what it says (§9 item 4).

### 2.4 Locks

Per-key locks keep their meaning and their single shared namespace (§0.1). A locked key is not recomputed and does not participate in hue rotation. Locks and the assignment are orthogonal: the assignment says what a key *would* be, locks say whether it is recomputed. ANSI stays unlockable, as today.

### 2.5 ANSI stability

Recommended: **stabilise ANSI here too**, by the same mechanism. Reasons: (a) ANSI currently re-rolls its entire palette on every BG1 touch via the `useEffect` (`ThemeContext.tsx:270-272`), which is a user-visible instability of the same class we are fixing; (b) Phase E's ANSI links need a defined "underlying" colour to revert to, exactly as syntax does, and "revert to the seeded colour" is meaningless if the seeded colour is thrown away on the next background edit. If the answer is "no", Phase E's ANSI revert must be specified as "revert to a colour we cannot reproduce", which I do not recommend. See §9 item 6.

### 2.6 Verification

1. **Rotation invariance** (the property that provably fails today): with a fixed assignment, scheme, mode and saturations, every pool-derived key satisfies `hue(hex at baseHue+δ) == hue(hex at baseHue) + δ (mod 360)`, and saturation/lightness are unchanged by `baseHue`.
2. **Mode-toggle pool stability**: the hue multiset is identical before and after a dark/light toggle; only lightness ranges change. (This is the assertion that catches §0.3 #5.)
3. **Jitter stability**: two generations with identical state produce identical palettes — no hidden RNG.
4. **Randomize disjointness**: two Randomize presses inside one assignment differ in *relationships*, not just rotation.
5. Manual: drag the slider and the palette should move as a whole, with "the green one" staying the green one.

---

## 3. Phase C — scheme repair (Q2c)

### 3.1 The contract

Every entry of `generateSchemeColors(baseHue, scheme, shape)` must be `(baseHue + offsetₖ) mod 360` with `offsetₖ` independent of `baseHue`. Enforced by a property test over `baseHue ∈ 0..359` for every scheme: `hue(baseHue+5) - hue(baseHue) == 5 (mod 360)`, plus `≥ 2` distinct hues except for `Monochromatic`, whose single hue *is* its contract.

As built, the contract is structural rather than tested: the scheme table holds `(shape) => number[]` **offsets**, and `baseHue` is not in scope inside it, so a covariant violation is not expressible. Offsets need not be non-negative — they are wrapped once at emit by `normaliseHue`. The test then checks the wrapper, not the table.

Phase C moved the table out of `src/lib/utils/colorUtils.ts` into `src/lib/colors/schemes.ts` (the enum's leaf module), which is also what removed the circular-import question: `colorUtils` no longer knows about schemes at all. `schemeOffsets` and `schemePoolLength` live there with it.

`shape` is a third parameter, defaulted, and comes from `assignment.shape` at every call site — see §3.3.

### 3.2 Delete eight

| deleted | reason | existing equivalent |
|---|---|---|
| `FibonacciSequence` | `baseHue · k` | `GoldenRatio` (`360·φ·n`) |
| `NobleNumbers` | `baseHue · k` | `Fibonacci` |
| `MandelbrotSet` | early-exits, 1–3 entries, no angular reading | `FareySequence` |
| `SierpinskiTriangle` | `baseHue / 2ⁿ` | `Triadic` (120°) |
| `KochSnowflake` | `baseHue / 3ⁿ` | `Hexagram` (60°) |
| `YinYang` | 2 distinct hues | `Complementary` (0°/180°) |
| `Hamsa` | `baseHue · {0.5,0.6,0.7}` | `PentagramStar` (72°) |
| `SpiralDynamics` | `baseHue · 1.5ⁿ` | `GoldenSpiral` (golden angle) |

Also delete the commented-out `GoldenRatio` lines, the commented-out `SierpinskiCarpet` case, the commented-out `typeDeclaration` in `initialSyntaxColors`, and any now-unused `degreesToRadians` callers. Enum values are **renumbered compactly** — they are plain numbers, persisted nowhere, used as in-session `Select` values only.

### 3.3 Repair four

Names kept; offsets become independent of `baseHue`. Constants are indicative — the covariant form is the contract, and the shape parameters come from `Assignment.shape` (Phase B), drawn once per theme.

| scheme | today | repaired |
|---|---|---|
| `NestedPolygons` | `sides = floor(baseHue/30)+3`, ramp `sides·i` | nested regular polygons: `offsetᵢ = i · 360/nᵢ` for `nᵢ ∈ {3,4,5,6,8}` layers |
| `RosettePattern` | `k` from `baseHue`, `cos(kθ) % 360` | `k`-fold petal: `offsetᵢ = i · 360/k` |
| `Torus` | `cos/sin` of `baseHue`, negatives | `offsetᵢ = (i · 360/m + φ·i) mod 360`, `m` major segments, winding twist `φ` |
| `DoubleTorus` | two shifted tori, negatives | both windings: `offsetᵢ = (i · 360/m + φᵢ·j) mod 360`, `j ∈ {1,2}` |

Recommended shape draws: `m ∈ {5,7,9}`; `k ∈ {5,7,8,9,10,11}`; the `n` set = five consecutive entries of `{3,4,5,6,8,12}` from a drawn start; `φ ∈ {30,45,60,72,90}`. Where a pool is shorter than the code needs, entries repeat (as today). These constants are the difference between "Torus looks like a torus" and "Torus is a 7-step wheel" (§9 item 7) — delegating them is fine, but they should be *seen* once on screen.

---

## 4. Phase D — Lock All

- A `Lock All` button beside the existing `Unlock All` in the theme panel header (`ColorList.tsx:66-71`; rendered as `isThemeColors={true}` at `page.tsx:58`).
- Locks all 16 UI keys; already-locked keys are left alone; `Unlock All` keeps its behaviour.
- **No** matching button for Syntax or ANSI (explicitly answered).
- Disabled when every UI key is already locked, so it is never a no-op. Exact affordance is the builder's.
- `ColorList.tsx` mixes UI and syntax behind its `isThemeColors` prop even though `page.tsx` only ever uses it as the theme panel; Phase D should add the button without restructuring. Collapsing `ColorList`/`SyntaxColorList` into one parameterised component belongs with Phase E's pill work — note it, do not bundle it silently.

---

## 5. Phase E — theme → syntax/ANSI linking

### 5.1 State and resolution points

```ts
// As built. A target is named by a flat id following the app's existing convention for
// `lockedColors` and `activeColor`: a syntax key is bare (`keyword`) and an ANSI key is
// prefixed (`ansiRed`). One link per target is therefore structural — `Links` is a
// record keyed by that id, so there is no array a duplicate could grow into.
type LinkTargetId = string
type Link = {
  source: UIKey   // theme colour only; direction is strictly top-down
  adjust: boolean // true = readability-adjusted copy (default), false = raw alias
}
type Links = Record<LinkTargetId, Link>
```

- **Cardinality:** at most one link per target (a new link replaces the old and the old reverts); one source may feed many targets. Structural, not enforced.
- **Direction:** source ∈ UI keys only; target ∈ syntax ∪ ANSI.
- **One central `applyLinks` step** runs after **any** change to a source value — generation (Randomize, Regenerate, scheme change, hue drag), the saturation sliders, and direct edits through `handleColorChange`. In the build this is not a call site convention but a single funnel: `ThemeState` holds the generator's output (`baseSyntaxColors`/`baseAnsiColors`) beside the displayed palette, and `commit` is the only place the second is derived from the first. Every transition goes through `commit`, so "after every generation" cannot miss the common path — a rule that a hand-maintained list of call sites would eventually break.
- **Linked targets are exempt** from the syntax saturation rewrite and from the syntax readability rewrite, because they do not own a saturation or their own contrast policy — they re-derive from the source. "Survives a saturation drag" therefore means *the link persists and the target follows its source*, not *the target is frozen*. Mechanically: the sliders act on the **base**, so a linked colour's stored value stays current underneath its link and unlink still lands on the right colour.
- **Source edits propagate** for free: editing a theme colour changes the base the links read from, and `commit` re-derives. No per-source bookkeeping.
- **Survives:** Randomize Full/Few, Regenerate Unlocked, scheme change, both saturation drags, mode toggle, ANSI regeneration, a BG1 edit (which re-resolves the bases through the locks).

### 5.2 Resolution

For target `t`, source `s`, toggle `adjust`:

```
raw = Color(uiColors[s]).hex()              // alpha stripped once, here (§0.3 #8)
adjusted, by target, with the policy READ FROM THE SPEC TABLES the generator uses:
  syntax : syntaxSpec[t].readability
             kind 'floor'          → ensureReadability(raw, BG1, policy.contrast)
             kind 'floor-then-band'→ adjustCommentColor(
                                       ensureReadability(raw, BG1, policy.pre),
                                       BG1, policy.band[dark|light][0..1])   // comment
             kind 'none'           → raw
  ansi   : ansiSpec[t].readable ? ensureReadability(raw, BG1, 4.5) : raw
           // false for Black AND BrightBlack — two rows, not one
displayed = adjust ? adjusted : raw
```

- Deriving the floors from the spec tables rather than restating them is the point: change a floor in one place and both the generated colour and its linked copy move together. Restating them would let a link silently diverge from the colour it stands in for — and the first draft of this spec did get it wrong, naming only `Black`.
- `comment` uses the generator's **two-step** policy (§0.1, §0.3 #1), so a linked comment looks like a comment rather than like a type token.
- Both adjusters preserve hue for free (they only move lightness/saturation).
- Alpha is stripped at `raw`, so `adjust` toggles readability only and never alpha. This is what makes all 16 sources usable (§9 item 5).
- `adjust` defaults to `true`; the toggle sits on the target pill beside the unlink icon and is visible only while linked.
- A raw alias that is unreadable is the user's explicit choice; **no warning UI** was requested.

### 5.3 Revert

The base (generated) value of every key is retained alongside the displayed value, so unlink re-displays the base and never re-generates. That is what makes "revert to the seeded colour" exact and instant — and it is why Phase B is a hard prerequisite for Phase E: without stable assignment, "the seeded colour" would not be reproducible after a Randomize.

### 5.4 Interaction

1. **Theme pills** (`ColorList.tsx`): Copy → Link (lucide `Link`). Clicking enters **link-placement mode**. The icon is drawn at reduced opacity until the colour has a link, then at full strength in the pill's contrasting colour — the "slightly changed colour when actively linked" the human partner asked for.
2. **Placement mode:** every linkable target (all syntax pills, all ANSI rows) is outlined; the source pill's Link button wears an inset ring and its tooltip names the count of targets; a hint line in the theme panel names the source and says Escape cancels. Escape, or a second click on the same button, cancels; another source's Link button switches the mode.
3. **Targets** (`SyntaxColorList.tsx`, `AnsiColorList.tsx`): clicking an outlined target creates/replaces the link and exits placement mode. While placing, the row's own selection is suppressed — one click, one meaning.
4. **Linked targets** render two right-aligned affordances inside the row's label area: the **adjust toggle** (lucide `Contrast`) and the **unlink** icon (lucide `Unlink`, tooltip naming the source key). Both stop propagation so neither selects the colour.
5. **Cross-highlighting:** hovering a theme pill's Link button, or a linked target's controls, sets `hoveredSource` in context; all three panels outline the source pill and every target fed by it. Rendered as a box-shadow ring only — never a colour mutation, so hover cannot affect the exported palette.
6. **Unlink:** click removes the link and re-displays the base.
7. **Editing a linked target** (picker, hex field, hex entry) unlinks it and applies the edit — `handleColorChange` drops the link before writing, so every affordance is covered by construction rather than by each one remembering to.
8. `Copy` is removed from all three panels; the hex field under the picker is the replacement. Verified absent from `src/`.

### 5.5 Locks

Linking a **locked** syntax target: recommendation **(a) link overrides the lock, lock retained** — the link is the stronger statement, and retaining the lock means unlocking later does not silently re-link. Linking does **not** auto-lock. Note this is only reachable for syntax targets: ANSI has no lock UI and no `ansiXxx` lock entries (§0.1), and Phase E adds none.

### 5.6 Verification

- Harness (`.tmp_files/phase-e.ts`, 18473 checks, all passing): across the full `source × target × {adjust on, off}` space (9216 combinations) `adjust: true` meets the target's floor, `adjust: false` is byte-exact to the source with alpha stripped, and both are always `#RRGGBB`; unlink returns exactly the pre-link hex **including when the base came from a lock**, which is the assertion that proves the base/display split; 36/36 links survive a redraw, a saturation change and a BG1 edit; a linked target holds while an unlinked sibling follows the slider; a theme with no links is byte-identical to the base.
- Regression: the exported JSON is byte-identical to a no-links export when no links exist (the same assertion as above, at the palette level).
- Manual: link `FG3 → type`, drag Base Hue, confirm both move and the relationship holds; link `AC1 → comment` and confirm the muted ramp; toggle adjust off for the raw hex; edit the linked pill and confirm it unlinks; hover and confirm cross-highlighting.
- Two harness bugs were found by this pass and are worth remembering: an earlier draft used a `string` syntax key that **does not exist** (string literals are `punctuationQuote`), making an assertion compare `undefined` to `undefined` and pass vacuously; and `ensureReadability`'s floor was being judged on an internal float that `hex()` rounding could push back under (see §5.7). Both were fixed; the harness now pins the key counts so a phantom key fails loudly.

### 5.7 A floor that wasn't: `ensureReadability`'s rounding boundary

Found while writing §5.6, and fixed in the same commit. The loop compared `color.contrast(bg)` on the `color` library's internal float, then returned `color.hex()`. Eight-bit rounding can move the result back under the floor: measured `5.4999 → 5.4857` (79 of 18355 link assertions failed their floor, 5.4949 in a direct probe). The loop now judges the rounded colour it actually returns, so the floor is a guarantee rather than a near-miss.

Blast radius, measured by dumping the 680-combination baseline with and without the fix (`.tmp_files/parity.ts`, then `analyse-round.ts`): 416 values move across 256 combinations, 1–2 steps per channel (max 22/255), and **202 colours that were below their floor now meet it**. The moves run in both directions because the adjustment step is not contrast-monotone — `lighten().saturate()` can lower relative luminance for a saturated colour, since green carries most of the luminance weight. That is not a defect in itself (the loop still only stops once the floor is met) but it explains why a fix described as "tighten the floor" also brightens and darkens in equal measure.

---

## 6. Phase order and dependencies

```
A  spec tables ─────────► everything after is easier; A also lands the 4 declared fixes
B  assignment ──────────► C needs B's shape params; E needs B for exact revert
C  scheme repair/delete ► needs B (shape params), needs A's spec for the scheme table move
D  Lock All ────────────► independent; interleave anywhere after A
E  linking ─────────────► needs B (revert); touches the same panels as D
```

The partner's stated order — de-dup, then stability, then schemes, then Lock All, then linking — is preserved exactly. Each phase ends runnable and visually verifiable so the partner can test in the browser between phases, and each phase commits separately.

---

## 7. Out of scope (decided)

- Merging the two export tables (`export.ts` / `exportTheme.ts`): Q4a. The `tokenColors` duplication stays, and neither file is touched by any phase.
- Any presets UI; `presets` stays declared and unreferenced.
- Deleting the dead `SavedThemeSchema`. If Phase A derives the Zod schema from the spec, the derived schema's shape must stay identical.
- Persistence, URL/JSON sharing, seed display. Phase B makes this possible; it was not requested.
- ANSI palette *redesign*. Only stability (§2.5) and linkability (§5) touch ANSI.
- `ThemePreview` / Monaco / TextMate rendering.
- A committed test framework; verification is throwaway harnesses in `.tmp_files/`.
- Mobile/responsive layout.
- Adding ANSI lock controls.

---

## 8. Files touched

| file | A | B | C | D | E |
|---|---|---|---|---|---|
| `src/lib/colors/schemes.ts` | new (enum moved) | — | offsets table, repaired/removed, `schemeOffsets`, `schemePoolLength` | — | — |
| `src/lib/colors/{spec,ui,syntax,ansi,index}.ts` | new | — | via schemes | — | re-export link types |
| `src/lib/colors/assignment.ts` | — | new | shape params drawn | — | — |
| `src/lib/colors/links.ts` | — | — | — | — | new — link types + pure `applyLinks`, floors read from the spec tables |
| `src/lib/types/colors.ts` | derive from spec; re-export `ColorScheme` | assignment type re-export | — | — | re-export link types |
| `src/lib/utils/uiColors.ts` | iterate spec | resolve assignment | pass `assignment.shape` | — | — |
| `src/lib/utils/syntaxColors.ts` | iterate spec | resolve assignment | — | — | — |
| `src/lib/utils/ansiColors.ts` | iterate spec | stability (§2.5) | — | — | — |
| `src/lib/utils/colorUtils.ts` | comment floor guarantee | polarity + floor-at-the-boundary fix (§5.7) | scheme table moved out; `degreesToRadians` deleted | — | — |
| `src/contexts/ThemeContext.tsx` | BG1-edit lock fix | assignment state; retire `schemeHues`; base/display split + `commit` | — | `toggleAllLocks` | `links`, `hoveredSource`, link actions, link dropping on edit |
| `src/components/ColorList.tsx` | — | — | — | Lock All; one-pass Unlock All | Link button + placement-hint line; remove Copy |
| `src/components/SyntaxColorList.tsx` | — | — | — | — | placement + link affordances, hover ring |
| `src/components/AnsiColorList.tsx` | — | — | — | — | same |
| `src/components/ColorLinkControls.tsx` | — | — | — | — | new — the two target affordances, shared by both target panels |
| `src/components/ThemeControls.tsx` | — | Randomize draws an assignment; wire `few` honestly | — | — | — |
| `src/app/page.tsx` | — | — | — | — | one `TooltipProvider` for the tree |
| `.gitignore`, `tsconfig.json` | exclude `.tmp_files` (done) | | | | |

---

## 9. Open questions

All seven are settled. Recorded with the outcome as built, so the doc and the code agree.

1. **`BG1`-edit discarding syntax locks** (§0.1, §1.4 item 4). **Done — fixed in A.** `ThemeContext` now passes `lockedColors` through every regeneration path.
2. **`controlImport`'s single value** (§1.4 item 2). **Done — the generator's `0.75`,** per the recommendation. The UI trio `FG1`/`FG2`/`INFO` were unified on the *slider's* values. Both changes landed in step A6 and are itemised in the phase-A commit.
3. **Linking a locked syntax target** (§5.5). **Link overrides the lock, lock retained** — implemented in Phase E.
4. **The `few` bug** (§2.2). **Done — wired honestly in B.** `poolMode` moved onto the `Assignment`, so both buttons differ and the initial load is a Full draw. The lying tooltip is now true.
5. **The three alpha keys as link sources** (§5.2). **All 16 allowed, alpha stripped at resolution** — implemented in Phase E.
6. **ANSI stability in Phase B** (§2.5). **Done — yes.** ANSI resolves from the assignment's own seed and re-rolls only on `Regenerate ANSI`.
7. **Repaired scheme constants** (§3.3). **Built; awaiting one on-screen review.** Shape constants now come from `ShapeParams` on the assignment (five consecutive side counts from a choice ring for `NestedPolygons`, a fold order for `RosettePattern`, a major-segment count and two windings for the torus pair). Measured: `Torus` 2→7 distinct hues and 89°→289° arc spread, `DoubleTorus` 3→7 / 90°→256°, `RosettePattern` 2→7 / 90°→309°, `NestedPolygons` 113°→240°.
8. **`ensureReadability`'s polarity/termination bug** (§0.1, §5.7). **Done — fixed across B and E.** B flipped the direction to be taken from the *background* (`goDarker = bgColor.isLight()`) and added a pole fallback, taking floored UI keys below their floor from 666/6720 to 0. E then fixed the second, subtler half: the floor was judged on the internal float and `hex()` rounding could push the returned value back under it (5.4999 → 5.4857). Floors and bands are now read from the spec tables by both the generator and the link layer.

