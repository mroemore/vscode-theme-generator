# vsc_themegen — Phase 2 implementation plan: mobile browser rework

Design: `docs/superpowers/specs/2026-10-18-vsc-themegen-mobile-rework.md`
Colour pipeline context: `docs/superpowers/specs/2026-10-17-vsc-themegen-color-architecture.md`

## Steps

- [x] M1 — mobile shell: modules, bottom bar, pin, breakpoint gating
- [x] M2 — colour modules: horizontal scroller + static header
- [x] M3 — compact Theme Controls
- [x] M4 — picker module
- [x] M5 — pared editor preview
- [x] M6 — polish, persistence, mobile probe, verification

One commit per step, each ending with the app runnable and testable in the browser at
`http://127.0.0.1:3100` (and over the tailnet at `https://vctg.lynsand.tricky.click/`).
M1 and M2 landed as one commit (`aa04747`): a shell whose module bodies are the strips was the first
state either could be run and verified in, and a "structure only" M1 would have been a file state
that never existed here.

## Ground rules

- **Mobile-only.** The desktop layout and markup are left alone. Where a component needs two shapes,
  the mobile shell owns the mobile shape; the desktop components are not branched (see M2).
- **Pipeline untouched.** No edits under `src/lib/colors/*`, to the generators, `assignment.ts`,
  `links.ts`, or to `ThemeContext`'s colour semantics. If `parity.ts --diff` moves, stop and revert.
- **View state stays out of `ThemeContext`.** Pin and visibility live in the shell + `localStorage`.
- **Evidence before claims.** Each step: `bun run build` clean, `.tmp_files/pw/check.ts` still 52/0 on
  desktop, and the mobile probe (`.tmp_files/pw/probe-mobile.ts`, grown as steps land) green.

## M1 — mobile shell: modules, bottom bar, pin, gating

Files: new `src/components/mobile/MobileShell.tsx` (bar + pin + visibility + persistence),
new `src/components/mobile/Module.tsx` (title bar, pin control, alternating fill, flush edges,
up-shadow), new `src/components/mobile/useIsMobile.ts` + `src/components/mobile/viewState.ts`
(localStorage read/write for `pin` and `visible`), edit `src/app/page.tsx` to render the shell
instead of the desktop row below `md`.

Deliverable: on a narrow viewport the app is one scrolling column of the five modules with the bottom
bar; the bar toggles visibility; pin lifts one module above the scroller and persists across reload.
Module bodies are the *existing* components, unmodified — this step is structure only.

Gating, as built: **one layout mounts at a time**, chosen in JS after hydration (`useIsMobile` reads
`matchMedia`), not by CSS-hiding both and hoping. The prerendered HTML is therefore only the
pre-resolve placeholder — a dark screen at either width for one paint — and a phone never mounts the
desktop tree. That is the deliberate trade (the alternative, prerendering the desktop layout and
swapping, flashes Monaco and the three desktop panels on a phone). Consequence for tooling:
`.tmp_files/dev-reset.sh` no longer greps the served HTML for palette markup (the placeholder has
none); it fetches the dev server's `app/page.js` chunk and greps *that* for a current-source marker,
which a stale production build cannot answer at all.

Verification: build clean; bar toggles; pin/gating behaviour observed in the browser at 390×844;
`check.ts` still green at desktop width; parity `--diff` a no-op.

## M2 — colour modules: horizontal scroller + static header

Files: new `src/components/mobile/ColorStrip.tsx` (static header: swatch, name, hex, link, lock;
horizontal scroller of solid boxes with the key name overlaid; 2px accent inset for selection;
corner glyphs for lock/link), new `src/components/mobile/BulkLockControls.tsx` (the panel's existing
`Unlock All` / `Lock All`, the theme panel's lock-all icon, and the link-source button, re-rendered
into the module title bar), and `src/components/mobile/MobileShell.tsx` wires both into the three
colour modules.

As built, the three panels are not branched: `MobileShell` renders `ColorStrip` for its colour
modules directly instead of the desktop `ColorList`/`SyntaxColorList`/`AnsiColorList`, which are left
completely untouched (they carry no `isMobile` prop and no dead branch). The bodies stay one-line —
`<ColorStrip domain="ui" />` — because the strip reads the pipeline through `useTheme()`, which is
what makes swapping it into `Module` or into `ThemeControls` later a one-line change.

Keep every interaction the current pills have: select → `setActiveColor`, lock → `toggleColorLock`,
theme-side link placement → `SourceLinkButton`, hover cross-highlight → `setHoveredSource`.

Verification: at 390×844 each strip scrolls horizontally (`scrollWidth > clientWidth`), the keyboard
locks the selected key and the header updates, bulk lock clears and restores from the title bar,
and a full link cycle (place → header link icon → unlink → `Escape` cancels a pending placement)
runs against the theme panel. Covered by `.tmp_files/pw/probe-mobile.ts`; screenshots land as
`.tmp_files/mobile-m2-strips.png` (strips) and `mobile-m2-picker.png` (picker module over a strip).

## M3 — compact Theme Controls

Files: edit `src/components/ThemeControls.tsx` — four action buttons become one row of four icon-only
buttons; hue keeps full width; the two saturation sliders share a 50/50 row. Desktop keeps the stacked
labels and full-width buttons.

As built: the mobile shape is a `compact` prop on `ThemeControls`, passed only by `MobileShell` —
the same shape M4 then used for the picker. The desktop component is not branched and not duplicated.

Verification: all four actions still fire (`randomizeTheme('full')`, `randomizeTheme('base')`,
`regenerateUnlocked`, `regenerateAnsiColors`); sliders still drive `setBaseHue`, `setUiSaturation`,
`setSyntaxSaturation`; tooltips still present on touch (they are Radix tooltips — ensure the buttons
remain usable without hover).

## M4 — picker module

Files: edit `src/components/ActiveColorPicker.tsx` (a `flat` prop and the flat markup branch) and
`src/app/globals.css` (the `.flat-picker` overrides). `ColorInput.tsx` was left alone — the flat branch
renders the hex field inline so the label can sit inside it.

Changes: hex row above the picker with the name overlaid right and the hex left-aligned; no radius;
picker and field flush; title below deleted.

As built: the overrides are scoped to `.flat-picker`, and react-colorful injects its stylesheet at
runtime, so the rules are written to win on specificity rather than on order. The picker is full-bleed,
which makes the (square) saturation box 374×374 at 390px — 44% of a phone viewport. That is the honest
reading of the spec, not an accident: it is open item 6 in the design doc, with "cap at ~240px" as the
alternative. Desktop keeps the stock rounded picker; adoption there is dropping the prop.

Verification: picker renders squared at 390×844; typing a valid hex still calls `handleColorChange`;
dragging still updates; the name label tracks the selected key. Landed as `probe-mobile.ts` section M
(106/0 overall, up from 45).

## M5 — pared editor preview

Files: edit `src/components/ThemePreview.tsx` — on mobile drop the activity bar and explorer, disable
the minimap, shorten the fixed height, and move the file selector into the title bar as a chevron
control. Desktop preview unchanged (800px, explorer, minimap).

As built: a `compact` prop, the same shape M3/M4 used. Two divergences worth recording: the preview
needs its **own snippet set** (`mobileSnippets`, one short snippet per file) rather than the desktop
tour truncated — the desktop lines clipped mid-token at 390px, which loses the token colours the
preview exists to show — and the title-bar chevron is a real menu that swaps the Monaco model, not a
decoration. Frame height 260px, font 12, `minimap` off, `File Edit View Help` row and footnote gone.

Verification: the snippet still switches languages; Monaco still re-themes on colour change; no
console errors on mount at 390×844. Landed as `probe-mobile.ts` section 1d.

## M6 — polish, probe, verification

- Tabler icons: `@tabler/icons-react` is now a dependency (`^3.49.0`, added in M1/M2) and the icons in
  use are imported from it. No inlining needed.
- Pin/visibility persistence re-confirmed across reload (it landed in M1); theme reset does not clear it.
- `.tmp_files/pw/probe-mobile.ts` grown to the full assertion list in spec §7 — 111 checks, 0 failed at
  390×844 against the live dev server. Screenshots per milestone: `mobile-m1-*`, `mobile-m2-*`,
  `mobile-m3-controls`, `mobile-m4-picker`, `mobile-m5-preview`, `mobile-m6-glyphs`.
- The corner-glyph question (spec §6 open item 4) now has a capture to judge from rather than a
  description: `mobile-m6-glyphs.png` locks one colour and links another, then selects a third, so the
  glyphs show on boxes that are *not* the selection. `ColorStrip.tsx` grew a `data-glyphs="link lock"`
  attribute so the harness asserts the glyph element, not just the `data-locked` flag (11×11px measured).
- Full evidence run: `bun run build` clean, `tsc --noEmit` clean, `next lint` **clean with no warnings**
  (the pre-existing `ThemeControls.tsx:46` exhaustive-deps warning went away with the M3 rewrite),
  `parity.ts --diff` 680 combos / 0 changed / 0 draw mismatches, `phase-b.ts` ALL PASSED,
  `pw/check.ts` 52/0, `pw/probe-mobile.ts` 111/0.
- One defect fixed on the way, found by M3's side-by-side button row: `regenerateAnsiColors` went through
  `commit`, which derives the displayed palette from the bases, so a redraw only replaced the ANSI part of
  the assignment and the new palette never reached the screen — the button read as dead. Now
  `commitResolved`. Recorded as colour-architecture spec §5.8.
- Commits: `aa04747` M1+M2, `a08d944` M3+M5 (one commit because `MobileShell` passes one prop per step and
  no intermediate file state was worth running — same reason M1+M2 were one).
- Spec §6 open items updated: item 2 (picker name — source vs target) and item 3 (desktop adoption of the
  flat language) closed in the doc; item 6 (picker box aspect at phone width) added.
- Project memory refreshed at phase close.

## Risks

1. **Panel-level logic drift.** The mobile shell renders `ColorStrip` directly rather than branching the
   desktop panels, so a behaviour added to `ColorList`/`SyntaxColorList`/`AnsiColorList` later does not
   reach mobile unless `ColorStrip.tsx` is updated too. Mitigation: the strips read the pipeline through
   `useTheme()`, so the shared surface is the context, not the panel.
2. **Radix tooltips on touch.** Tooltips carry real information today (what a button does). If they are
   unreachable by tap, use `title` attributes as the mobile fallback.
3. **The pinned region is not `position: sticky`.** The pin model lifts one module above the scroller in
   normal flow, so there is no sticky-vs-page-scroll fight to begin with; the remaining risk is a tall
   pinned module (Editor Preview) filling the viewport — spec §6 open item 1.
