# vsc_themegen — Phase 2 implementation plan: mobile browser rework

Design: `docs/superpowers/specs/2026-10-18-vsc-themegen-mobile-rework.md`
Colour pipeline context: `docs/superpowers/specs/2026-10-17-vsc-themegen-color-architecture.md`

## Steps

- [x] M1 — mobile shell: modules, bottom bar, pin, breakpoint gating
- [x] M2 — colour modules: horizontal scroller + static header
- [ ] M3 — compact Theme Controls
- [ ] M4 — picker module
- [ ] M5 — pared editor preview
- [ ] M6 — polish, persistence, mobile probe, verification

One commit per step, each ending with the app runnable and testable in the browser at
`http://127.0.0.1:3100` (and over the tailnet at `https://vctg.lynsand.tricky.click/`).

## Ground rules

- **Mobile-only.** Everything sits behind Tailwind `md` (768px). Desktop markup and classes are left
  alone; where a component needs two shapes, the mobile shell owns the mobile shape and the desktop
  branch keeps today's markup.
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

Verification: all four actions still fire (`randomizeTheme('full')`, `randomizeTheme('base')`,
`regenerateUnlocked`, `regenerateAnsiColors`); sliders still drive `setBaseHue`, `setUiSaturation`,
`setSyntaxSaturation`; tooltips still present on touch (they are Radix tooltips — ensure the buttons
remain usable without hover).

## M4 — picker module

Files: edit `src/components/ActiveColorPicker.tsx` and `src/components/ColorInput.tsx`;
new `src/components/ui/colorful.css` (or `globals.css` additions) with the react-colorful overrides —
squared saturation/hue, no black bar, 12px square handle.

Changes: hex row above the picker with the name overlaid right and the hex left-aligned; no radius;
picker and field flush; title below deleted.

Verification: picker renders squared at 390×844; typing a valid hex still calls
`handleColorChange`; dragging still updates; the name label tracks the selected key.

## M5 — pared editor preview

Files: edit `src/components/ThemePreview.tsx` — on mobile drop the activity bar and explorer, disable
the minimap, shorten the fixed height, and move the file selector into the title bar as a chevron
control. Desktop preview unchanged (800px, explorer, minimap).

Verification: the snippet still switches languages; Monaco still re-themes on colour change; no
console errors on mount at 390×844.

## M6 — polish, persistence, probe, verification

- Tabler icons: prefer `@tabler/icons-react`; if the registry is unreachable, inline the twelve Tabler
  outline paths in `src/components/ui/tabler.tsx`. The eleven names are listed in spec §3.8.
- Pin/visibility persistence confirmed across reload; theme reset does not clear it.
- `.tmp_files/pw/probe-mobile.ts` grown to the full assertion list in spec §7.
- Full evidence run: `bun run build`, `parity.ts --diff`, `phase-b.ts`, `pw/check.ts`,
  `pw/probe-mobile.ts`.
- Update the spec doc's §6 open items as they close, and refresh project memory at phase close.

## Risks

1. **Two shapes in one component tree** doubles the markup in the colour panels and the preview. Mitigate
   by keeping mobile-only markup in `src/components/mobile/*` and the existing files as thin branches.
2. **Radix tooltips on touch.** Tooltips carry real information today (what a button does). If they are
   unreachable by tap, use `title` attributes as the mobile fallback.
3. **`position: sticky` inside a scrolling page.** If the pinned region fights the page scroll, the shell
   can own the scroller (`overflow-y: auto` on a full-height container) instead of relying on the document.
