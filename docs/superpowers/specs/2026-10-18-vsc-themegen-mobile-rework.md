# vsc_themegen — Phase 2: mobile browser rework

Date: 2026-10-18
Status: design settled from the interactive mockups (v2 → v5); implementation not started.
Companion docs: `docs/superpowers/specs/2026-10-17-vsc-themegen-color-architecture.md` (the colour
pipeline this rework must not disturb), `docs/superpowers/plans/2026-10-18-vsc-themegen-phase-2-mobile.md`
(the phased plan).

## 0. Scope

The app is currently laid out for a desktop window: a three-column flex row (controls + picker,
preview, colour panels) with the syntax panel full-width underneath. On a phone it is a long vertical
scroll of wide, dense blocks, the syntax grid overflows, and the editor preview is a fixed 800px
mock with a sidebar and an explorer that no phone can use.

This phase reworks **the layout for narrow viewports only**. Nothing in this document changes colour
generation, locks, links, or export.

**Assumption, stated for review:** the desktop layout is left exactly as it is; the new design lives
behind a breakpoint (Tailwind `md`, 768px). If the desktop should also adopt the flat module language,
that is a follow-up decision, not part of this phase.

## 1. Non-goals

- No change to `src/lib/colors/*`, the generators, `assignment.ts`, `links.ts`, or `ThemeContext`'s
  colour semantics. A UI-only rework must leave `.tmp_files/parity.ts` byte-identical.
- No new global state beyond what the layout itself needs (pin/visibility are view state, not theme
  state — see §5).
- No touch gestures beyond native scrolling and swipe in the horizontal scrollers.

## 2. Current state (measured against source)

| Surface | Today |
| --- | --- |
| `src/app/page.tsx` | one `flex flex-wrap lg:flex-nowrap` row: `ThemeControls` + `ActiveColorPicker` column, `ThemePreview` (flex-1), a column of `ColorList` + `AnsiColorList`; then `SyntaxColorList` full width; then the two export buttons. |
| `ColorList.tsx` | panel with `p-4 border-border border rounded-lg shadow-md`, a header row (title + Unlock All + Lock All) and a grid of pills `grid grid-rows-8 grid-flow-col-dense auto-cols-fr gap-2` — 16 theme keys in 2 columns, 32 syntax keys in 4. Each pill: coloured `h-8 rounded-md` box, key label, optional `SourceLinkButton`, lock button (`lucide-react` `Lock`/`Unlock`). |
| `ThemeControls.tsx` | vertical stack: scheme select + mode toggle; hue slider; UI saturation slider; syntax saturation slider; then stacked full-width `Randomize Full` / `Randomize with Few Colors` / `Regenerate Unlocked` / `Regenerate ANSI Colors` buttons. |
| `ActiveColorPicker.tsx` | `ColorPicker` (react-colorful, stock styling — 200px wide, 8px radii, 12px black bar between saturation and hue, 24px round handle), an 8px gap, `ColorInput` (`rounded-md`, `h-10`, bordered), then an `h3` with the colour's name, centred, below. |
| `ThemePreview.tsx` | fixed `height: 800px` VS Code mock: title bar, 25px activity bar, 150px explorer listing 8 files, Monaco (`minimap` on, `fontSize: 13`), status bar. |
| Icons | `lucide-react` (`Lock`, `Unlock` used in `ColorList`). |
| CSS | no `react-colorful` or `.color-picker` overrides anywhere — the picker renders react-colorful's stock look. |

## 3. The mobile design

### 3.1 One scrolling container of modules

The page becomes a single vertical scroll of **modules**. A module is a title bar plus a body:

- title bar: the module name in small caps, a count where it makes sense (`16`, `32`), the pin control,
  and — for the three colour modules — that panel's bulk actions (`Unlock All` / `Lock All` on syntax
  and ANSI, the lock-all icon and the link-source button on theme, since that is where links are
  placed from);
- body: the module's content, unchanged in behaviour.

Modules sit **flush**: no borders, no rounded corners, no gaps. The only boundary signal is an
alternating fill — `#0D0D0F` / `#3A3A43`, ≈1.7:1 — and each module's bottom edge casts a shadow *up*
onto the module above it. (If the alternation reads too loud, `#26262C` is the dial-back point.)

The five modules: **Theme Controls**, **Theme Colors**, **Syntax Colors**, **ANSI Colors**,
**Editor Preview**.

### 3.2 The bottom bar

A fixed bottom bar carries one button per module — `Controls`, `Colors`, `Syntax`, `ANSI`, `Preview`.
Buttons have no padding, sit flush, and each carries a 2px right border (all but the last) in the bar's
own tone, so the separator reads as a hard seam against both the enabled (accent) and disabled (grey)
states.

The bar **toggles each module's visibility**. A disabled module is not rendered in the scroll.

### 3.3 Pin

- Pin is a **per-module** control in the module's title bar.
- **Nothing is pinned by default**, and **exactly one module can be pinned at a time** — pinning a
  second module unpins the first.
- A pinned module is **lifted out of the scrolling container** and drawn above it, so it stays put
  while everything else scrolls under it.
- The pinned module **casts its shadow down** onto the scroller instead of receiving one.
- Pin state **persists across reloads** (localStorage); it is not cleared by a theme reset.

### 3.4 Colour modules — horizontal scroller

Theme Colors, Syntax Colors and ANSI Colors share one shape:

- a **static header** showing the currently selected colour — swatch, name, hex, and the link and
  lock affordances, in that order;
- below it, a **horizontal scroller** of **solid colour boxes**, edge to edge with their siblings,
  each box carrying its key name written over the top in a small font. No pills, no rounded corners.
- **selection** is a 2px accent inset outline on the box; **lock** and **link** are small corner
  glyphs so a locked or linked colour in the strip can be spotted at a glance.

Selecting a box updates the static header and opens the picker module (§3.5).

Two as-built notes:

- **The selection outline marks a real selection only.** The desktop page opens with no selection and
  falls back to the first key for the picker, and the mobile strip keeps that convention rather than
  inventing a selected-on-load state.
- **The theme strip is also the link source.** Links run theme → syntax/ANSI, so the theme module's
  title bar carries the link control; a link placed there then shows up as a corner glyph on the
  target boxes in the syntax/ANSI strips.

### 3.5 The picker module

Appears when an editable colour is selected. It carries the same title bar and pin control as every
other module (`COLOR PICKER`), and does **not** take a slot in the bottom bar.

Changes from today:

1. Rounded corners removed from the picker, hue slider and hex input.
2. The gap between the picker and the hex input removed — they share an edge.
3. The name title below the picker deleted; the same word is drawn over the **right-hand end** of the
   hex field as its label.
4. The hex text is left-aligned inside the field.

Three calls made during review rather than asked, all cheap to flip:

- **(a)** the hex row sits **above** the picker, reading as a header under the module title (today's
  order is the reverse);
- **(b)** the 12px black bar react-colorful draws between saturation and hue is removed — that is the
  most visible "gap" in the stock picker;
- **(c)** the 24px round grab handle becomes a 12px square outlined handle, matching the hard edges.
  A round handle on a square surface is the one piece that would look wrong either way.

As built (M4), and the one place the drawing was not the spec: the picker goes **full-bleed**, and
react-colorful's saturation box is square, so at 390px wide it renders 374×374 — about 44% of an
844px viewport, more than the mockup suggested. That is the honest reading of "full-bleed instead of
the fixed 200px block" (the alternative, a capped non-square box, is a new call, not an inherited
one), and the hex row above it now reads as the module's header. Flagged as open item 6 rather than
quietly capped.

The flat look is **scoped to a `flat` prop** (`ActiveColorPicker flat`), passed only by
`MobileShell`; the desktop picker keeps react-colorful's stock rounded look. So §6.3's "does desktop
adopt the flat language" is now a one-line change — drop the prop — rather than a rewrite.

### 3.6 Compact Theme Controls

- The four action buttons (`Randomize Full`, `Randomize with Few Colors`, `Regenerate Unlocked`,
  `Regenerate ANSI Colors`) become **one row of four icon-only buttons**.
- **Base Hue** keeps the full row width.
- **UI Saturation** and **Syntax Saturation** share a row, **50% each**.
- The scheme select and the dark/light toggle keep their own row at the top.

### 3.7 Pared editor preview

Representative selection only: the mock **title bar**, the **Monaco editor**, and the **status bar**.
The activity bar and the file explorer are dropped, the fixed height comes down to fit a phone, and
`minimap` is disabled. The file selector moves into the title bar as a chevron control so the snippets
are still reachable.

As built (M5), behind a `compact` prop on `ThemePreview` — again the same shape as M3/M4, so desktop
keeps the 800px frame, the rail, the explorer, the minimap and the footnote.

- **A second snippet set, not the desktop one truncated.** `mobileSnippets` is one short snippet per
  file, each covering comment, keyword, type, string, number, function and punctuation in as few lines
  as the language allows. This is the point of the step: the desktop tour's long lines clipped
  mid-token at 390px, which loses the very thing the preview is for. The probe asserts no `.view-line`
  overflows its `.overflow-guard`, so "representative" means "fits", not "shorter".
- **Height 260px**, no border (the module's fill already separates it), font size 12, `minimap` off,
  `lineNumbersMinChars` 2, and the `File Edit View Help` menu row plus the footnote gone.
- **The chevron is a real menu**, not a decoration: it opens a list of the snippet files and switching
  one swaps the Monaco model. Desktop's explorer keeps doing the same job.

Two things the probe pins that a screenshot would not: the frame is under 400px tall *and* the editor
text is the compact set, so a future change that quietly reverts to the desktop snippets fails rather
than looking plausible at a glance.

### 3.8 Icons

Tabler **outline** icons, matching the mockup: `pin`, `pinned` (solid), `pin` with slash for the
unpinned hover state, `lock`, `lock-open`, `link`, `unlink`, `dice-5` (full randomize), `sparkles`
(few randomize), `refresh` (regenerate), `terminal-2` (ANSI), `chevron-down` (file selector).

## 4. Invariants this rework must not break

These are the Phase 1 contracts, and a layout change has no business touching any of them:

1. **Lock semantics** — locking is a plain write that moves nothing else; unlocking re-resolves with
   the rest of the same panel carried through; any regeneration re-resolves every unlocked colour.
2. **Link semantics** — one link per target pill, a new link replaces it, one source may feed many
   targets, direction is strictly theme → syntax/ANSI; unlink reverts to the resolved colour; a locked
   and linked target keeps its lock. `applyLinks` stays pure and stays called from `commit` only.
3. **Pipeline neutrality** — `.tmp_files/parity.ts --diff <baseline>` and `.tmp_files/phase-b.ts`
   must be unchanged by this work. If a palette value moves, a layout change has reached into the
   wrong place.
4. **Escape cancels a pending link placement** (existing behaviour, easy to lose in a rewrite).

## 5. Where view state lives

Pin and per-module visibility are **view** state, not theme state: they must not enter `ThemeContext`,
which owns the colour pipeline and nothing else. They live in the mobile shell component, seeded from
`localStorage` (`pin` and `visible` keys) with a small read/write helper, and are the only state the
mobile layout adds.

## 6. Open items

1. Pinned region height: pinning a tall module (Editor Preview) fills the screen above the scroller.
   Acceptable, or does the pinned region want a max height with its own scroll?
2. ~~The three picker calls in §3.5 (a/b/c).~~ Decided in review: the hex row sits above the picker,
   the stock black bar goes, and the handle is a 12px square outline. M4 implements them.
3. Whether the desktop layout adopts the flat module language later (§0 assumption). The picker is now
   already there — the flat look lives behind `ActiveColorPicker`'s `flat` prop, which only
   `MobileShell` passes, so desktop adoption is dropping the prop rather than a rewrite.
4. Does the strip mark a selection when the page has none? Today the fallback selection shows in the
   static header but draws no outline (see §3.4), which keeps "no selection" visually distinct from
   "selected the first key" — confirm that reads right on a phone.
5. Should the theme module let a link be *cancelled* by re-pressing its source button? §4.4 covers
   `Escape` for a pending placement, and unlinking is done from the target's header, so the source
   button currently has no toggle-off.
6. The picker's saturation box is full-bleed and therefore square (374×374 at 390px — 44% of a phone
   viewport, see §3.5 as built). Keep it square, or cap the height at ~240px and accept a
   non-square surface?

## 7. Verification

- `bun run build` clean.
- `bun run .tmp_files/parity.ts --diff <baseline>` and `bun run .tmp_files/phase-b.ts`: unchanged.
- `bun run .tmp_files/pw/check.ts` (desktop, 52 checks): still green — the desktop layout is untouched.
- A new mobile probe, `.tmp_files/pw/probe-mobile.ts`, driving a 390×844 viewport: bottom bar toggles
  module visibility; pinning a second module unpins the first; a pinned module stays put while the
  scroller moves; horizontal scrollers report `scrollWidth > clientWidth`; the picker renders squared
  with the name over the hex field; selecting a box updates the static header. M3 adds the compact
  controls assertions (one icon row, full-width hue, two half-width saturations), M4 the picker's
  flat-language assertions (radii `0px`, the stock black bar suppressed, saturation/hue and
  hex/picker flush to the pixel, square 12px handle, the label inside the hex field's right half),
  and M5 the pared-preview assertions (compact section, no rail / explorer / menu row / footnote,
  frame under 400px, no line clipped off the right edge, and the title-bar chevron opening a file menu
  that swaps the Monaco model). M6 adds the corner-glyph capture (§6 item 4): a locked and a linked
  colour are put in the strip, a third is selected, and the glyph elements are asserted by attribute
  and measured size rather than by the lock flag alone.

## 8. As built (M1–M6)

Where the implementation diverged from the plan above, and why.

**Gating: one layout mounts, chosen in JS after hydration.** `useIsMobile` reads `matchMedia` in an
effect, so the prerendered HTML is a placeholder and exactly one of the two layouts ever mounts.
The plan's alternative — prerender the desktop tree and hide it below `md` — was rejected on review
because a phone would then mount the whole desktop surface (Monaco plus three full panels) before
swapping, which is the expensive half of the load on the device that can least afford it. Two
consequences worth knowing:

- the swap is a layout shift of one paint, accepted deliberately;
- `.tmp_files/dev-reset.sh` can no longer grep the served HTML for palette markup (the placeholder
  has none), so it now greps the dev server's `app/page.js` chunk for a current-source marker — a
  check a stale production build cannot satisfy at all.

**The desktop panels are not branched.** `MobileShell` renders `ColorStrip` for its colour modules
directly; `ColorList` / `SyntaxColorList` / `AnsiColorList` are untouched and carry no mobile prop
and no dead branch. Each mobile body is one line (`<ColorStrip domain="ui" />`) because the strip
reads the pipeline through `useTheme()`, which also means a later `ThemeControls`, `ThemePreview` or
`ActiveColorPicker` swap is a one-line change of the same shape. The cost is that panel-level logic
added to a desktop panel later does not reach mobile unless `ColorStrip.tsx` is updated too; the
benefit is that this step could not break desktop, and the evidence below is the proof.

**Files as built.** `src/components/mobile/`: `MobileShell.tsx`, `Module.tsx`, `ColorStrip.tsx`,
`BulkLockControls.tsx`, `useIsMobile.ts`, `viewState.ts` (the plan's `useViewState.ts` split into the
breakpoint hook and the storage helper).

**Pin and visibility both persist** across reloads in `localStorage` — the plan only promised pin.

**AC1/AC2 are lockable and show up as pins.** They were keyboard-reachable from the start of M1; the
"Lock All" wording deliberately does not apply to them (matching desktop: no bulk lock on theme), but
per-key locking and theme pinning do.

**M3 — the compact controls are a `compact` prop on `ThemeControls`.** The four actions become one
icon-only row, the hue slider keeps full width, and the two saturations share a 50/50 row; desktop
keeps the stacked labels and full-width buttons. Same shape as the picker: the mobile shape is a prop
the shell passes, so the desktop component is not branched and not duplicated.

**M5 — the pared preview is a `compact` prop on `ThemePreview`**, and its snippet set is a second one
(`mobileSnippets`), not the desktop tour truncated. See §3.7 as built: the point is that every snippet
fits 390px without clipping mid-token, which is what the desktop lines did.

**M3–M6 evidence** (390×844, against the live dev server):

| Check | Result |
| --- | --- |
| `.tmp_files/pw/probe-mobile.ts` | 111 passed / 0 failed |
| `.tmp_files/pw/check.ts` (desktop, 52) | 52 passed / 0 failed |
| `bun run build` | clean, no lint warnings |
| `bun run tsc --noEmit` | clean |
| `bun run lint` | clean, no warnings |
| `.tmp_files/parity.ts --diff <baseline>` | 680 combos, 0 changed, 0 draw mismatches |
| `.tmp_files/phase-b.ts` | ALL PASSED |

The corner-glyph question (§6 item 4) has a capture rather than an argument: `mobile-m6-glyphs.png`
locks one theme colour and links another to a syntax target, then selects a third, so the glyphs are
visible on boxes that are *not* the selection. `ColorStrip.tsx` carries `data-glyphs="link lock"` so the
harness asserts the glyph element and its measured size (11×11px), not only the `data-locked` flag.

Measured rather than asserted: saturation radius `0px`, hue radius `0px`, handle `12×12` at `0px`
radius, saturation `border-bottom` `0px` (the stock black bar), saturation→hue seam `676 → 676`, hex
row→picker seam `302 → 302`, input `text-align: left`, and the `INFO` label at x 349..374 inside the
hex field's 8..382. Typing `#ff0000` moved the strip header from `INFO #4695FF` to `INFO #FF0000`,
so the field still funnels through `handleColorChange`.

**M1–M2 evidence** (all against the live dev server at 390×844 or desktop width):

| Check | Result |
| --- | --- |
| `bun run tsc --noEmit` | clean |
| `bun run build` | clean, 23/23 static pages |
| `.tmp_files/parity.ts --diff <baseline>` | 0 changed / 0 draw mismatches |
| `.tmp_files/phase-b.ts` | ALL PASSED |
| `.tmp_files/pw/check.ts` (desktop, 52) | 52 passed / 0 failed |
| `.tmp_files/pw/probe-mobile.ts` | 45 passed / 0 failed |

One harness fix fell out of this pass and is worth recording: `check.ts` section K compared dark-vs-
light hues and previously relied on the random per-load draw happening to leave ≥5 chromatic syntax
tokens. A low-saturation draw made the comparison measure nothing while still reporting a pass, so the
section now drives both saturation sliders to 100 first and asserts the count it actually compared
(29 tokens, 7 theme colours) — non-vacuous by construction rather than by luck.

A second one, from M4: **Monaco renders whitespace as `U+00A0`**, not a regular space, so any probe
marker with a space in it never byte-matches the editor's text. Normalize both sides
(`.replace(/\u00a0/g, ' ')`) at the comparison boundary.
