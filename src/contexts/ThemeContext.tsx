import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react'
import {
  resolveUiColors,
  buildPools,
  updateThemeColorsWithSaturation,
} from '@/lib/utils/uiColors'
import {
  resolveSyntaxColors,
  updateSyntaxColorsWithSaturation,
} from '@/lib/utils/syntaxColors'
import { resolveAnsiColors } from '@/lib/utils/ansiColors'
import { ColorScheme } from '@/lib/types/colors'
import { drawTheme, redrawAnsi } from '@/lib/colors/assignment'
import type { Assignment, PoolMode } from '@/lib/colors/assignment'
import type { UIKey } from '@/lib/colors/ui'
import {
  applyLinks,
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
}

interface ThemeContextType {
  isDark: boolean
  baseHue: number
  uiSaturation: number
  syntaxSaturation: number
  scheme: ColorScheme
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
}

const SCHEMES = Object.values(ColorScheme).filter(
  (value) => typeof value === 'number'
) as ColorScheme[]

/** The locked subset of a colour record — what a resolve must carry through untouched. */
function pickLocked(
  source: Record<string, string>,
  locked: ReadonlySet<string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of locked) {
    const value = source[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * The carry set for an *unlock*: the locks, plus every other key in the same panel. The
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

/**
 * Re-derive the displayed palettes from the stored bases plus the links. The single
 * point every state transition passes through, which is what makes "links follow their
 * source" true for *every* edit affordance rather than only for regeneration.
 */
function relink(s: ThemeState): ThemeState {
  const { syntaxColors, ansiColors } = applyLinks({
    colors: s.colors,
    baseSyntaxColors: s.baseSyntaxColors,
    baseAnsiColors: s.baseAnsiColors,
    links: s.links,
    isDark: s.isDark,
  })
  return { ...s, syntaxColors, ansiColors }
}

/**
 * Re-resolve every *base* colour from one state snapshot. Pure and deterministic: given
 * the same state it returns the same palette, and it consumes no randomness. Links are
 * applied by the caller (`commit`), so there is exactly one place they are resolved.
 *
 * `carry` names the keys whose present value survives the resolve untouched. It is
 * normally the lock set — but see `carryExcept`: unlocking one colour must re-resolve
 * *that* colour without disturbing its neighbours.
 */
function resolveAll(s: ThemeState, carry: ReadonlySet<string> = s.lockedColors): ThemeState {
  const input = {
    assignment: s.assignment,
    scheme: s.scheme,
    baseHue: s.baseHue,
    isDark: s.isDark,
    uiSaturation: s.uiSaturation,
  }

  const colors = resolveUiColors(
    input,
    pickLocked(s.colors, carry) as Partial<UIColors>
  )
  const pools = buildPools(input, colors)
  const baseSyntaxColors = resolveSyntaxColors(
    {
      assignment: s.assignment,
      pools,
      syntaxSaturation: s.syntaxSaturation,
      backgroundColor: colors.BG1,
    },
    pickLocked(s.baseSyntaxColors, carry) as Partial<SyntaxColors>
  )
  const baseAnsiColors = resolveAnsiColors(s.assignment, colors.BG1)

  return { ...s, colors, baseSyntaxColors, baseAnsiColors }
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

  const commit = useCallback((mutate: (s: ThemeState) => ThemeState) => {
    stateRef.current = relink(mutate(stateRef.current as ThemeState))
    setVersion((v) => v + 1)
  }, [])

  /**
   * Re-resolve every base from a mutated snapshot and adopt the result. `carryIn` names
   * the keys whose present value must survive the resolve — normally just the locks, but
   * an unlock passes its own panel's keys so that only the unlocked colours regenerate.
   */
  const commitResolved = useCallback(
    (
      mutate: (s: ThemeState) => ThemeState,
      carryIn?: (next: ThemeState) => ReadonlySet<string>
    ) =>
      commit((s) => {
        const next = mutate(s)
        return resolveAll(next, carryIn ? carryIn(next) : next.lockedColors)
      }),
    [commit]
  )

  // The first render was deterministic so the server and client agree. Now that we are
  // definitely in the browser, draw a fresh random theme — every visit still starts
  // somewhere new, and Randomize remains the way to ask for another.
  const bootstrapped = useRef(false)
  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    commitResolved((s) => bootstrap(s.isDark, randomSeed()))
  }, [commitResolved])

  // Adopt the mode next-themes actually resolved, once it knows. The bootstrap above
  // has to guess; this corrects it without touching the assignment, so the palette
  // merely re-ranges rather than being re-dealt.
  useEffect(() => {
    if (!resolvedTheme) return
    const dark = resolvedTheme === 'dark'
    if (dark !== (stateRef.current as ThemeState).isDark) {
      commitResolved((s) => ({ ...s, isDark: dark }))
    }
  }, [resolvedTheme, commitResolved])

  // Escape cancels link placement, so the mode is always escapable without moving focus.
  useEffect(() => {
    if (linkingSource === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLinkingSource(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [linkingSource])

  const setIsDark = (value: boolean) => {
    setTheme(value ? 'dark' : 'light')
    commitResolved((s) => ({ ...s, isDark: value }))
  }

  // Assignment kept: hue is a rotation, so the palette moves as a whole and every
  // colour keeps its relationship to every other.
  const setBaseHue = (value: number) =>
    commitResolved((s) => ({ ...s, baseHue: value }))

  const setScheme = (value: ColorScheme) =>
    commitResolved((s) => ({ ...s, scheme: value }))

  // The saturation sliders scale the colours that are on screen rather than re-resolving,
  // which is what preserves hand-edited hues and the per-key lightness spread. They act
  // on the *bases*; a linked target's display is re-derived from its source by `commit`.
  const setUiSaturation = (value: number) =>
    commit((s) => ({
      ...s,
      uiSaturation: value,
      colors: updateThemeColorsWithSaturation(s.colors, value, s.lockedColors),
    }))

  const setSyntaxSaturation = (value: number) =>
    commit((s) => ({
      ...s,
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
      return {
        ...s,
        baseHue: theme.baseHue,
        uiSaturation: theme.uiSaturation,
        syntaxSaturation: theme.syntaxSaturation,
        scheme: theme.scheme,
        assignment: theme.assignment,
      }
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

  const regenerateAnsiColors = () =>
    commit((s) => ({
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
