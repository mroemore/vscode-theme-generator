import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react'
import {
  buildPools,
  updateThemeColorsWithSaturation,
} from '@/lib/utils/uiColors'
import {
  resolveSyntaxColors,
  updateSyntaxColorsWithSaturation,
} from '@/lib/utils/syntaxColors'
import { resolveAnsiColors } from '@/lib/utils/ansiColors'
import { pickLocked, relinkPalette, resolvePalette } from '@/lib/themes/resolve'
import { applyPatch } from '@/lib/themes/diff'
import type { ThemePatch } from '@/lib/themes/diff'
import { isUnchanged, openRecord } from '@/lib/themes/record'
import { foreignInputs } from '@/lib/themes/foreign'
import { MAX_IMPORT_BYTES, parseImport, parseImportAsNew } from '@/lib/themes/importer'
import type { ImportResult } from '@/lib/themes/importer'
import { useLibrary } from '@/hooks/useLibrary'
import type { ThemeSummary } from '@/hooks/useLibrary'
import { useHistory } from '@/hooks/useHistory'
import type { SavedTheme, ThemeInputs, ThemePalette } from '@/lib/themes/schema'
import { ColorScheme } from '@/lib/types/colors'
import { drawTheme, redrawAnsi } from '@/lib/colors/assignment'
import type { Assignment, PoolMode } from '@/lib/colors/assignment'
import type { UIKey } from '@/lib/colors/ui'
import {
  dropLink,
  isAnsiTarget,
  targetKey,
} from '@/lib/colors/links'
import type { LinkTargetId, Links } from '@/lib/colors/links'
import { clamp, randomSeed } from '@/lib/utils/math'
import { useTheme as useNextTheme } from 'next-themes'

import type { UIColors, SyntaxColors, AnsiColors } from '@/lib/types/colors'

// ── How state works here ──────────────────────────────────────────────────────
//
// The whole theme lives in one ref, and `version` is the only React state. Every
// action reads the ref, writes a new snapshot to it, and bumps `version`.
//
// That shape is deliberate. The previous version kept the assignment's inputs (base
// hue, scheme, saturations, assignment) as separate `useState` values and resolved
// them inside a `setTimeout`, so an action could read a *stale* closure — it is exactly
// how `generateColors` came to discard locked syntax colours on a BG1 edit. One ref
// plus one version counter makes that class of bug unrepresentable: there is one
// theme, always current, and no dependency arrays to get wrong.
//
// ── Base vs displayed ─────────────────────────────────────────────────────────
// `baseSyntaxColors` / `baseAnsiColors` are what the generator produced;
// `syntaxColors` / `ansiColors` are what the user sees. They differ exactly when a link
// overrides a target, and `commit` is the single place the second is derived from the
// first (see `links.ts` for why both are kept).

interface ThemeState {
  isDark: boolean
  baseHue: number
  uiSaturation: number
  syntaxSaturation: number
  scheme: ColorScheme
  assignment: Assignment
  colors: UIColors
  /** Generator output, before links. The lock is applied here. */
  baseSyntaxColors: SyntaxColors
  baseAnsiColors: AnsiColors
  /** What is displayed: the base, with every link applied. */
  syntaxColors: SyntaxColors
  ansiColors: AnsiColors
  links: Links
  lockedColors: Set<string>
  /**
   * True while the open theme is foreign (palette-only): the record keeps
   * `inputs === undefined`, no `x-themegen` block is written, and only a generator
   * control converts it (fix 1, 2026-10-26 round).
   */
  paletteOnly: boolean
}

interface ThemeContextType {
  isDark: boolean
  baseHue: number
  uiSaturation: number
  syntaxSaturation: number
  scheme: ColorScheme
  /** The open theme's inputs, for the export metadata block. */
  inputs: ThemeInputs
  /** False when the open theme is a foreign (palette-only) record. */
  paletteOnly: boolean
  poolMode: PoolMode
  seed: number
  colors: UIColors
  syntaxColors: SyntaxColors
  ansiColors: AnsiColors
  links: Links
  linkedSources: Set<UIKey>
  lockedColors: Set<string>
  activeColor: string | null
  /** The theme colour currently awaiting a target, or null when not placing a link. */
  linkingSource: UIKey | null
  /** The source whose targets are being cross-highlighted, driven by hover. */
  hoveredSource: UIKey | null
  setIsDark: (value: boolean) => void
  setBaseHue: (value: number) => void
  setUiSaturation: (value: number) => void
  setSyntaxSaturation: (value: number) => void
  setScheme: (value: ColorScheme) => void
  randomizeTheme: (poolMode: PoolMode) => void
  regenerateUnlocked: () => void
  regenerateAnsiColors: () => void
  toggleColorLock: (colorKey: string) => void
  setColorLocks: (colorKeys: readonly string[], locked: boolean) => void
  setActiveColor: (colorKey: string | null) => void
  handleColorChange: (colorKey: string, newColor: string) => void
  startLinking: (source: UIKey) => void
  cancelLinking: () => void
  linkTarget: (target: LinkTargetId) => void
  unlinkTarget: (target: LinkTargetId) => void
  setLinkAdjust: (target: LinkTargetId, adjust: boolean) => void
  setHoveredSource: (source: UIKey | null) => void
  /** The open record's id, or null before the library has been read / when it is empty. */
  themeId: string | null
  themeName: string
  lastSavedAt: number | null
  /** A non-fatal storage condition (currently quota exhaustion), cleared by the next save. */
  lastError: string | null
  /**
   * What the saved indicator may truthfully claim. Derived once, here, so the desktop chip
   * cannot drift from the library: a pending write is `saving`, a refused one is `error`
   * (never `saved`), and `unsaved` means nothing has been written yet — which is the
   * state of an app whose library has not been read, and of one whose very first record
   * was refused. A library error that is *not* a failed save (a refused create, a rename
   * the library turned down) leaves the chip alone: the theme on disk is untouched.
   */
  saveState: 'saving' | 'saved' | 'error' | 'unsaved'
  /** False until the index has been read after mount; the catalogue renders a skeleton. */
  libraryLoaded: boolean
  themes: ThemeSummary[]
  /**
   * Read one stored record, or null when its bytes are missing or unreadable. The catalogue
   * exports the row it is on, which is not necessarily the open theme, so it needs the record
   * rather than the live palette.
   */
  readTheme: (id: string) => SavedTheme | null
  openTheme: (id: string) => void
  newTheme: () => void
  /**
   * Read a theme file and add it to the library. `duplicate` comes back with the record
   * already saved, so the caller can offer "open" or "import as new"; `asNew` skips that
   * check and always creates a row. Never enters undo history — an import is not an edit.
   */
  importFile: (file: File, options?: { asNew?: boolean }) => Promise<ImportResult>
  renameTheme: (id: string, name: string) => void
  deleteTheme: (id: string) => void
  /** Step back one edit of the open theme. A no-op when `canUndo` is false. */
  undo: () => void
  /** Reapply the step an undo moved back over. A no-op when `canRedo` is false. */
  redo: () => void
  /** An earlier step exists for the *open* theme; another theme's steps are never reachable. */
  canUndo: boolean
  /** An undone step is still redoable for the open theme. */
  canRedo: boolean
  /** Drop the open theme's whole history. */
  clearHistory: () => void
  /** Open a gesture: every commit until the matching `endGesture` becomes one step. */
  beginGesture: () => void
  /** Close the open gesture, recording its accumulated edit as one step. */
  endGesture: () => void
}

/** What a commit may do besides mutating the state. Both default to on. */
interface CommitOptions {
  /**
   * Record a history step. `false` marks a programmatic correction (the resolved-mode
   * adoption) or an adoption: it pushes nothing AND closes any gesture still open, so a
   * missed `pointerup` cannot leak into it.
   */
  record?: boolean
  /** Schedule the debounced auto-save. */
  save?: boolean
}

/** The merged shape `openRecord` returns, named here so adoption can take it as an argument. */
type OpenedTheme = ReturnType<typeof openRecord>

const SCHEMES = Object.values(ColorScheme).filter(
  (value) => typeof value === 'number'
) as ColorScheme[]

/** The carry set for an *unlock*: the locks, plus every other key in the same panel. The
 * unlocked colours therefore regenerate while their neighbours keep what they are
 * showing — so unlocking one colour cannot sweep away a manual edit elsewhere.
 *
 * Deliberately scoped to one panel. Unlocking a theme colour can change `BG1`, and the
 * syntax palette must then re-resolve against the new background; carrying syntax keys
 * here would leave them adjusted for a background that no longer exists.
 */
function carryExcept(s: ThemeState, unlocked: readonly string[]): ReadonlySet<string> {
  const skip = new Set(unlocked)
  const carry = new Set(s.lockedColors)
  const source = unlocked.every((k) => k in s.colors)
    ? Object.keys(s.colors)
    : unlocked.every((k) => k in s.baseSyntaxColors)
      ? Object.keys(s.baseSyntaxColors)
      : []
  for (const k of source) if (!skip.has(k)) carry.add(k)
  return carry
}

/** The resolver's input view of a state snapshot (spec §2.1). */
function toInputs(s: ThemeState): ThemeInputs {
  return {
    isDark: s.isDark,
    baseHue: s.baseHue,
    scheme: s.scheme,
    uiSaturation: s.uiSaturation,
    syntaxSaturation: s.syntaxSaturation,
    assignment: s.assignment,
  }
}

/** The resolver's palette view of a state snapshot. */
function toPalette(s: ThemeState): ThemePalette {
  return { ui: s.colors, syntax: s.baseSyntaxColors, ansi: s.baseAnsiColors }
}

/**
 * Re-derive the displayed palettes from the stored bases plus the links. Thin wrapper
 * over `relinkPalette` — the pure derivation lives in `@/lib/themes/resolve`.
 */
function relink(s: ThemeState): ThemeState {
  const { syntax, ansi } = relinkPalette({
    colors: s.colors,
    baseSyntax: s.baseSyntaxColors,
    baseAnsi: s.baseAnsiColors,
    links: s.links,
    isDark: s.isDark,
  })
  return { ...s, syntaxColors: syntax, ansiColors: ansi }
}

/**
 * Re-resolve every *base* colour from one state snapshot. Thin wrapper over
 * `resolvePalette`; the pure resolve lives in `@/lib/themes/resolve`. Links are applied
 * by the caller (`commit`), so there is exactly one place they are resolved.
 */
function resolveAll(s: ThemeState, carry: ReadonlySet<string> = s.lockedColors): ThemeState {
  const { ui, syntax, ansi } = resolvePalette(toInputs(s), carry, toPalette(s))
  return { ...s, colors: ui, baseSyntaxColors: syntax, baseAnsiColors: ansi }
}

/**
 * One full theme drawn from a seed.
 *
 * The seed is a parameter, not always random, because the *first* render is server-side
 * rendered too: a random seed here would draw one palette on the server and a different
 * one in the browser, and React would report a hydration mismatch and regenerate the
 * whole tree. `BOOTSTRAP_SEED` keeps the first paint identical on both sides; the
 * provider then draws a fresh random theme once, after mount.
 */
function bootstrap(isDark: boolean, seed: number): ThemeState {
  const theme = drawTheme(seed, 'full', SCHEMES)
  const base: ThemeState = {
    isDark,
    baseHue: theme.baseHue,
    uiSaturation: theme.uiSaturation,
    syntaxSaturation: theme.syntaxSaturation,
    scheme: theme.scheme,
    assignment: theme.assignment,
    colors: {} as UIColors,
    baseSyntaxColors: {} as SyntaxColors,
    baseAnsiColors: {} as AnsiColors,
    syntaxColors: {} as SyntaxColors,
    ansiColors: {} as AnsiColors,
    links: {},
    lockedColors: new Set(),
    // A bootstrap theme is the generator's own product.
    paletteOnly: false,
  }
  return relink(resolveAll(base))
}

/** Fixed, so the server-rendered palette and the first client render agree. */
const BOOTSTRAP_SEED = 0

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export const ThemeProvider: React.FC<{
  children: React.ReactNode
  userId?: string
}> = ({ children }) => {
  const { setTheme, resolvedTheme } = useNextTheme()
  const {
    libraryLoaded,
    themes,
    themeId,
    themeName,
    lastSavedAt,
    lastError,
    saveError,
    saving,
    scheduleSave,
    flush,
    loadCurrent,
    readRecord,
    refreshCatalogue,
    hasOpenRecord,
    adoptCurrent,
    writeCurrentId,
    createRecord,
    addRecord,
    renameRecord,
    deleteRecord,
    reportHistoryRefused,
  } = useLibrary()

  const [activeColor, setActiveColor] = useState<string | null>(null)
  const [linkingSource, setLinkingSource] = useState<UIKey | null>(null)
  const [hoveredSource, setHoveredSource] = useState<UIKey | null>(null)
  const [, setVersion] = useState(0)

  const stateRef = useRef<ThemeState | null>(null)
  if (stateRef.current === null) {
    // next-themes has not resolved yet on the first render; dark is the app default.
    // Deterministic, so this render matches the server's (see `bootstrap`).
    stateRef.current = bootstrap(resolvedTheme !== 'light', BOOTSTRAP_SEED)
  }

  // ── History ─────────────────────────────────────────────────────────────────
  // The stack lives in the hook; the provider supplies the two things only it can: the
  // live snapshot a gesture anchors at, and the adoption of an applied patch.

  /**
   * Adopt the state one history patch produces (design §4.3). The patch restored the
   * *base* palettes, so the displayed ones are re-derived by `relink`; the record is
   * saved (debounced, through the same path every edit uses); and a patch that flips
   * `isDark` must reach next-themes or <html> keeps the old class and the restored
   * palette is unreadable in the new mode.
   */
  const restoreSnapshot = useCallback(
    (patch: ThemePatch) => {
      const next = relink(applyPatch(stateRef.current as ThemeState, patch))
      stateRef.current = next
      setVersion((v) => v + 1)
      if (patch.entries.some((entry) => entry.path === 'isDark')) {
        setTheme(next.isDark ? 'dark' : 'light')
      }
      scheduleSave(next)
    },
    [scheduleSave, setTheme]
  )

  // Stable: the hook calls it at `pointerdown`, and a new identity every render would
  // re-register the gesture listeners mid-drag.
  const snapshotTheme = useCallback(() => stateRef.current as ThemeState, [])

  const {
    recordEdit,
    beginGesture,
    endGesture,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
    forgetTheme,
  } = useHistory({
    themeId,
    snapshot: snapshotTheme,
    restore: restoreSnapshot,
    // A refused history write goes to the same channel a refused record save uses, so
    // "saved" never means "the history of that save is silently missing its last step".
    reportRefused: reportHistoryRefused,
  })

  const commit = useCallback(
    (mutate: (s: ThemeState) => ThemeState, opts: CommitOptions = {}) => {
      const before = stateRef.current as ThemeState
      const after = relink(mutate(before))
      stateRef.current = after
      setVersion((v) => v + 1)
      // The save is the *only* writer of a record; it no-ops until the library is read,
      // so this cannot overwrite a saved theme with the bootstrap palette.
      if (opts.save !== false) scheduleSave(after)
      // `record: false` is a programmatic correction, not an edit: push nothing, and close
      // any gesture still open so its stale anchor cannot swallow this commit.
      if (opts.record === false) endGesture()
      else recordEdit(before, after)
    },
    [scheduleSave, endGesture, recordEdit]
  )

  /**
   * Re-resolve every base from a mutated snapshot and adopt the result. `carryIn` names
   * the keys whose present value must survive the resolve — normally just the locks, but
   * an unlock passes its own panel's keys so that only the unlocked colours regenerate.
   */
  const commitResolved = useCallback(
    (
      mutate: (s: ThemeState) => ThemeState,
      carryIn?: (next: ThemeState) => ReadonlySet<string>,
      opts?: CommitOptions
    ) =>
      commit((s) => {
        const next = mutate(s)
        return resolveAll(next, carryIn ? carryIn(next) : next.lockedColors)
      }, opts),
    [commit]
  )

  /**
   * Adopt a record's merged state. A plain write rather than `commitResolved`: the merge
   * in `openRecord` already resolved every untouched key, so resolving again would drop
   * exactly the hand edits it was built to keep. Not recorded (the adoption is one step,
   * not an edit) and not saved — the caller decides whether an adopted record needs the
   * one write that lets generator fixes reach it.
   */
  const adoptOpenTheme = useCallback((open: OpenedTheme) => {
    // An adoption is not an edit: it pushes no step. Closing any open gesture first keeps a
    // stale anchor from spanning the adoption into the next edit.
    endGesture()
    const live = stateRef.current as ThemeState
    // The header the theme shows. A generated record owns its six inputs; a foreign
    // (palette-only) record's mode and base hue are read off the *imported background
    // itself*, so the sliders do not describe the theme that was open before (fix 1,
    // 2026-10-26 round). The saturations and the assignment cannot honestly be
    // synthesised from colours alone, so a foreign theme keeps what it had — and while
    // `paletteOnly` is true they are written nowhere (no metadata block, no record
    // `inputs`), which is also what keeps `setTheme` and the mode toggle honest for
    // foreign records, where the old code skipped telling next-themes entirely.
    const inputs = open.inputs
    const { isDark, baseHue } = inputs ?? foreignInputs(open.palette.ui.BG1)
    const base: ThemeState = {
      ...live,
      isDark,
      baseHue,
      ...(inputs ?? {}),
      colors: open.palette.ui,
      baseSyntaxColors: open.palette.syntax,
      baseAnsiColors: open.palette.ansi,
      syntaxColors: open.palette.syntax,
      ansiColors: open.palette.ansi,
      links: open.links,
      lockedColors: new Set(open.locks),
      paletteOnly: inputs === undefined,
    }
    stateRef.current = relink(base)
    setVersion((v) => v + 1)
  }, [endGesture])

  // Adopt the mode next-themes actually resolved, once it knows. The bootstrap above has
  // to guess; this corrects it without touching the assignment, so the palette merely
  // re-ranges rather than being re-dealt. Declared before the library effect on purpose:
  // an adopted record's mode must be the last word on mount, not corrected a tick later.
  useEffect(() => {
    if (!resolvedTheme) return
    const dark = resolvedTheme === 'dark'
    if (dark !== (stateRef.current as ThemeState).isDark) {
      commitResolved((s) => ({ ...s, isDark: dark }), undefined, { record: false })
    }
  }, [resolvedTheme, commitResolved])

  // The first render was deterministic so the server and client agree. Now that we are
  // definitely in the browser, the library — not a random seed — decides what to show:
  // adopt the record `currentId` points at, or draw a fresh theme and create `Theme 1`.
  // Either way the first paint above kept the bootstrap palette and touched no storage.
  const libraryBootstrapped = useRef(false)
  useEffect(() => {
    if (libraryBootstrapped.current) return
    libraryBootstrapped.current = true

    const record = loadCurrent()
    if (record !== null) {
      const open = openRecord(record)
      adoptOpenTheme(open)
      // The state's `isDark` is the record's own (a foreign record's comes from its
      // imported background, via `adoptOpenTheme`), so telling next-themes unconditionally
      // is honest for foreign records too — the old code skipped them and left the
      // document in the previous theme's mode.
      setTheme((stateRef.current as ThemeState).isDark ? 'dark' : 'light')
      adoptCurrent({ id: record.id, name: record.name, createdAt: record.createdAt })
      writeCurrentId(record.id)
      // Saved once — but only if something changed. `openRecord` re-resolves the record,
      // so a theme whose generator output has not moved comes back exactly as it went
      // in, and writing that again is churn against a quota that may already be full
      // (and it put the chip into `Saving…` on every load). A record that *has* moved —
      // a generator fix reaching an old theme — still gets its write.
      if (!isUnchanged(record, stateRef.current as ThemeState)) {
        scheduleSave(stateRef.current as ThemeState)
      }
      return
    }

    commitResolved((s) => bootstrap(s.isDark, randomSeed()), undefined, { record: false })
    createRecord(stateRef.current as ThemeState)
  }, [
    loadCurrent,
    adoptOpenTheme,
    setTheme,
    adoptCurrent,
    writeCurrentId,
    scheduleSave,
    commitResolved,
    createRecord,
  ])

  // Escape cancels link placement, so the mode is always escapable without moving focus.
  useEffect(() => {
    if (linkingSource === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLinkingSource(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [linkingSource])

  // ── Generator controls, and the one-way conversion ──────────────────────────
  // A palette-only theme is a real theme: exports and saves treat it as colour-only.
  // The moment shown on screen as `imported-palette-note` — a generator control that
  // re-resolves the palette from the inputs — is the conversion moment (fix 1). Every
  // setter below is such a control; colour edits (hex, lock, link) are not and must
  // not flip the flag.

  /** A generator control ran: from here the theme owns honest generator inputs. */
  const generated = (s: ThemeState): ThemeState =>
    s.paletteOnly ? { ...s, paletteOnly: false } : s

  const setIsDark = (value: boolean) => {
    setTheme(value ? 'dark' : 'light')
    commitResolved((s) => ({ ...generated(s), isDark: value }))
  }

  // Assignment kept: hue is a rotation, so the palette moves as a whole and every
  // colour keeps its relationship to every other.
  const setBaseHue = (value: number) =>
    commitResolved((s) => ({ ...generated(s), baseHue: value }))

  const setScheme = (value: ColorScheme) =>
    commitResolved((s) => ({ ...generated(s), scheme: value }))

  // The saturation sliders scale the colours that are on screen rather than re-resolving,
  // which is what preserves hand-edited hues and the per-key lightness spread. They act
  // on the *bases*; a linked target's display is re-derived from its source by `commit`.
  const setUiSaturation = (value: number) =>
    commit((s) => ({
      ...generated(s),
      uiSaturation: value,
      colors: updateThemeColorsWithSaturation(s.colors, value, s.lockedColors),
    }))

  const setSyntaxSaturation = (value: number) =>
    commit((s) => ({
      ...generated(s),
      syntaxSaturation: value,
      baseSyntaxColors: updateSyntaxColorsWithSaturation(
        s.baseSyntaxColors,
        value,
        s.colors.BG1,
        s.lockedColors
      ),
    }))

  /** A whole new theme: new header values *and* a new assignment, from one seed. */
  const randomizeTheme = (poolMode: PoolMode) =>
    commitResolved((s) => {
      const theme = drawTheme(randomSeed(), poolMode, SCHEMES)
      return generated({
        ...s,
        baseHue: theme.baseHue,
        uiSaturation: theme.uiSaturation,
        syntaxSaturation: theme.syntaxSaturation,
        scheme: theme.scheme,
        assignment: theme.assignment,
      })
    })

  /** Nudge hue and saturation, keep every relationship. Locks are carried through. */
  const regenerateUnlocked = () =>
    commitResolved((s) => {
      const hueVariation = Math.floor(Math.random() * 31) - 15
      const saturationVariation = Math.floor(Math.random() * 21) - 10
      return {
        ...s,
        baseHue: (s.baseHue + hueVariation + 360) % 360,
        uiSaturation: clamp(s.uiSaturation + saturationVariation, 0, 100),
        syntaxSaturation: clamp(s.syntaxSaturation + saturationVariation, 0, 100),
      }
    })

  // A redraw only replaces the ANSI part of the assignment, so the panel has to be
  // re-resolved for it to reach the screen — `commit` alone would leave `baseAnsiColors`
  // untouched and the button would look dead. Locks ride through the resolve as usual.
  const regenerateAnsiColors = () =>
    commitResolved((s) => ({
      ...s,
      assignment: redrawAnsi(s.assignment, randomSeed()),
    }))

  // Locking freezes the value that is on screen right now (`commit` — a plain write, so
  // nothing else in the palette is disturbed). Unlocking *regenerates* that colour, which
  // needs a resolve with the rest of the panel carried through (`carryExcept`). Without
  // that asymmetry an unlock would appear to do nothing until the next unrelated change,
  // while an unlink already reverts immediately — the two should behave alike.
  const toggleColorLock = (colorKey: string) =>
    stateRef.current?.lockedColors.has(colorKey)
      ? commitResolved(
          (s) => {
            const lockedColors = new Set(s.lockedColors)
            lockedColors.delete(colorKey)
            return { ...s, lockedColors }
          },
          (next) => carryExcept(next, [colorKey])
        )
      : commit((s) => {
          const lockedColors = new Set(s.lockedColors)
          lockedColors.add(colorKey)
          return { ...s, lockedColors }
        })

  const setColorLocks = (colorKeys: readonly string[], locked: boolean) =>
    locked
      ? commit((s) => {
          const lockedColors = new Set(s.lockedColors)
          for (const key of colorKeys) lockedColors.add(key)
          return { ...s, lockedColors }
        })
      : commitResolved(
          (s) => {
            const lockedColors = new Set(s.lockedColors)
            for (const key of colorKeys) lockedColors.delete(key)
            return { ...s, lockedColors }
          },
          (next) => carryExcept(next, colorKeys)
        )

  const startLinking = (source: UIKey) =>
    setLinkingSource((current) => (current === source ? null : source))

  const cancelLinking = () => setLinkingSource(null)

  const linkTarget = (target: LinkTargetId) => {
    const source = linkingSource
    if (source === null) return
    commit((s) => ({
      ...s,
      links: {
        ...s.links,
        // Keeping any existing `adjust` choice means re-pointing a target at a new
        // source does not silently reset the readability toggle.
        [target]: { source, adjust: s.links[target]?.adjust ?? true },
      },
    }))
    setLinkingSource(null)
  }

  const unlinkTarget = (target: LinkTargetId) =>
    commit((s) => ({ ...s, links: dropLink(s.links, target) }))

  const setLinkAdjust = (target: LinkTargetId, adjust: boolean) =>
    commit((s) => {
      const link = s.links[target]
      if (!link) return s
      return { ...s, links: { ...s.links, [target]: { ...link, adjust } } }
    })

  const handleColorChange = (colorKey: string, newColor: string) =>
    commit((s) => {
      // Editing a linked target unlinks it first, then applies the edit. Every edit
      // affordance (picker, hex field, hex entry) funnels through here.
      const links = dropLink(s.links, colorKey)

      if (isAnsiTarget(colorKey)) {
        const key = targetKey(colorKey) as keyof AnsiColors
        return {
          ...s,
          links,
          baseAnsiColors: { ...s.baseAnsiColors, [key]: newColor },
          ansiColors: { ...s.ansiColors, [key]: newColor },
        }
      }

      if (colorKey in s.colors) {
        const colors = { ...s.colors, [colorKey]: newColor }
        if (colorKey !== 'BG1') return { ...s, links, colors }

        // A background edit re-resolves the syntax and terminal *bases* against the new
        // background. Locked syntax tokens are carried through from the bases (not from
        // the displayed colours, which a link may have overridden), and ANSI re-reads
        // its stored rolls rather than rolling a new palette.
        const input = {
          assignment: s.assignment,
          scheme: s.scheme,
          baseHue: s.baseHue,
          isDark: s.isDark,
          uiSaturation: s.uiSaturation,
        }
        const pools = buildPools(input, colors)
        return {
          ...s,
          links,
          colors,
          baseSyntaxColors: resolveSyntaxColors(
            {
              assignment: s.assignment,
              pools,
              syntaxSaturation: s.syntaxSaturation,
              backgroundColor: newColor,
            },
            pickLocked(s.baseSyntaxColors, s.lockedColors) as Partial<SyntaxColors>
          ),
          baseAnsiColors: resolveAnsiColors(s.assignment, newColor),
        }
      }

      if (colorKey in s.baseSyntaxColors) {
        return {
          ...s,
          links,
          baseSyntaxColors: { ...s.baseSyntaxColors, [colorKey]: newColor },
          syntaxColors: { ...s.syntaxColors, [colorKey]: newColor },
        }
      }

      return { ...s, links }
    })

  // ── Library operations ──────────────────────────────────────────────────────
  // Each one flushes the debounce first: a pending save carries the outgoing record's
  // id, and letting it fire after the switch would write this palette into that record.

  /**
   * Switch to a stored record. Flushes, adopts, tells next-themes the record's mode.
   * `save: false` skips the closing write — import uses it because the record it just
   * wrote is already exactly what a reopen would produce, and a palette-only record must
   * not be rewritten with inputs it does not have.
   */
  const openTheme = useCallback(
    (id: string, options: { save?: boolean } = {}) => {
      flush()
      const record = readRecord(id)
      if (record === null) {
        // The row named bytes that no longer parse (or vanished). Drop it from the
        // catalogue instead of leaving a row that can never be opened.
        refreshCatalogue()
        return
      }
      const open = openRecord(record)
      adoptOpenTheme(open)
      // Tell next-themes the open theme's own polarity. The state's `isDark` is the
      // record's, or — on a foreign record — the polarity read off the imported
      // background (`adoptOpenTheme`); without this, next-themes re-commits the
      // system-resolved mode a tick later and the adopted choice is immediately undone,
      // and a foreign record stayed in the mode of the theme that was open before.
      setTheme((stateRef.current as ThemeState).isDark ? 'dark' : 'light')
      adoptCurrent({ id: record.id, name: record.name, createdAt: record.createdAt })
      writeCurrentId(record.id)
      // One write so the reopened (possibly re-resolved) palette is what reloads next.
      if (options.save !== false) scheduleSave(stateRef.current as ThemeState)
    },
    [
      flush,
      readRecord,
      refreshCatalogue,
      adoptOpenTheme,
      setTheme,
      adoptCurrent,
      writeCurrentId,
      scheduleSave,
    ]
  )

  /**
   * A brand-new theme. Reuses the bootstrap funnel so the mode is carried the same way a
   * first visit carries it, then persists that state as a new record (never through
   * `commit`'s save, which would target the outgoing id).
   */
  const newTheme = useCallback(() => {
    flush()
    const before = stateRef.current as ThemeState
    // Read from the ref, not `themeId`: `deleteTheme` clears the open record earlier in
    // this same tick, before React has re-rendered.
    const hadRecord = hasOpenRecord()
    commitResolved((s) => bootstrap(s.isDark, randomSeed()), undefined, {
      record: false,
      save: false,
    })
    if (createRecord(stateRef.current as ThemeState) !== null) return

    // The write was refused — quota, or a library from a newer version — so nothing was
    // stored and no record is open. The outgoing record must not stay "current": its id
    // still names a saved palette, and the next debounce would rewrite that key with this
    // new palette (a silent corruption, since a same-key rewrite of similar size fits).
    if (hadRecord) {
      // The outgoing palette is still on disk under its own record; put it back so the
      // screen does not show a theme that was never saved.
      stateRef.current = before
      setVersion((v) => v + 1)
    }
    // Clears the identity, drops any queued save, and leaves the app running unsaved:
    // `scheduleSave` no-ops while there is no id.
    adoptCurrent(null)
  }, [flush, commitResolved, createRecord, hasOpenRecord, adoptCurrent])

  /**
   * Read a theme file and add it as a new record. The file's text is read here rather
   * than by the caller so the panel never holds a half-parsed blob; the duplicate case
   * hands back the record that already exists, and the caller offers its two actions.
   *
   * Not an edit: nothing enters undo history, and the imported record is written once,
   * already resolved, then adopted without a second save.
   */
  const importFile = useCallback(
    async (file: File, options: { asNew?: boolean } = {}): Promise<ImportResult> => {
      // Fold a queued edit in first: the duplicate check hashes what is stored, so a save
      // still sitting in the debounce would otherwise be compared against stale bytes.
      flush()

      // Refuse on `file.size` before materialising the bytes: `file.text()` would pull a
      // multi-megabyte blob into memory just so the importer could reject it.
      if (file.size > MAX_IMPORT_BYTES) {
        return {
          kind: 'invalid',
          reason: `File is larger than 2 MB (${Math.round(file.size / 1024)} KB).`,
        }
      }

      let text: string
      try {
        text = await file.text()
      } catch {
        return { kind: 'invalid', reason: 'That file could not be read.' }
      }

      const existing = themes
        .map((summary) => readRecord(summary.id))
        .filter((record): record is SavedTheme => record !== null)
      // Unmapped colours in a foreign file come from the theme the user is looking at,
      // not from a neutral invented here (spec §6.2).
      const fallback = toPalette(stateRef.current as ThemeState)

      const result = options.asNew
        ? await parseImportAsNew(file.name, text, existing, fallback)
        : await parseImport(file.name, text, existing, fallback)
      if (result.kind !== 'theme') return result

      const id = addRecord(result.record)
      if (id === null) {
        return {
          kind: 'invalid',
          reason: 'The library refused the imported theme — storage full or read-only.',
        }
      }
      openTheme(id, { save: false })
      return result
    },
    [flush, themes, readRecord, addRecord, openTheme]
  )

  /** Rename one record. The catalogue's display disambiguation is not stored. */
  const renameTheme = useCallback(
    (id: string, name: string) => {
      // Fold any queued edit in first, so a debounce still carrying the old name cannot
      // land on top of the rename.
      flush()
      renameRecord(id, name)
    },
    [flush, renameRecord]
  )

  /** Delete a record + history. Deleting the open one opens the next, or creates Theme 1. */
  const deleteTheme = useCallback(
    (id: string) => {
      flush()
      // The history controller may still hold a write for this id inside its 400 ms
      // debounce. Forget it before the keys go: once the record is gone nothing may
      // re-create `vsc_themegen.history.v1.<id>` — that one orphan was invisible to the
      // catalogue and grew without bound (fix 3, 2026-10-26 round).
      forgetTheme(id)
      const { wasCurrent, nextId } = deleteRecord(id)
      if (!wasCurrent) return
      if (nextId !== null) openTheme(nextId)
      else newTheme()
    },
    [flush, forgetTheme, deleteRecord, openTheme, newTheme]
  )

  const s = stateRef.current as ThemeState

  // Derived, so a panel does not have to scan the link table on every render.
  const linkedSources = new Set(
    Object.values(s.links).map((link) => link.source)
  ) as Set<UIKey>

  const value: ThemeContextType = {
    isDark: s.isDark,
    baseHue: s.baseHue,
    uiSaturation: s.uiSaturation,
    syntaxSaturation: s.syntaxSaturation,
    scheme: s.scheme,
    inputs: toInputs(s),
    paletteOnly: s.paletteOnly,
    poolMode: s.assignment.poolMode,
    seed: s.assignment.seed,
    colors: s.colors,
    syntaxColors: s.syntaxColors,
    ansiColors: s.ansiColors,
    links: s.links,
    linkedSources,
    lockedColors: s.lockedColors,
    activeColor,
    linkingSource,
    hoveredSource,
    setIsDark,
    setBaseHue,
    setUiSaturation,
    setSyntaxSaturation,
    setScheme,
    randomizeTheme,
    regenerateUnlocked,
    regenerateAnsiColors,
    toggleColorLock,
    setColorLocks,
    setActiveColor,
    handleColorChange,
    startLinking,
    cancelLinking,
    linkTarget,
    unlinkTarget,
    setLinkAdjust,
    setHoveredSource,
    themeId,
    themeName,
    lastSavedAt,
    lastError,
    saveState: saving
      ? 'saving'
      : saveError !== null
        ? 'error'
        : lastSavedAt !== null
          ? 'saved'
          : 'unsaved',
    libraryLoaded,
    themes,
    readTheme: readRecord,
    openTheme,
    newTheme,
    importFile,
    renameTheme,
    deleteTheme,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
    beginGesture,
    endGesture,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
