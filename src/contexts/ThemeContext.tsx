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

interface ThemeState {
  isDark: boolean
  baseHue: number
  uiSaturation: number
  syntaxSaturation: number
  scheme: ColorScheme
  assignment: Assignment
  colors: UIColors
  syntaxColors: SyntaxColors
  ansiColors: AnsiColors
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
  lockedColors: Set<string>
  activeColor: string | null
  setIsDark: (value: boolean) => void
  setBaseHue: (value: number) => void
  setUiSaturation: (value: number) => void
  setSyntaxSaturation: (value: number) => void
  setScheme: (value: ColorScheme) => void
  randomizeTheme: (poolMode: PoolMode) => void
  regenerateUnlocked: () => void
  regenerateAnsiColors: () => void
  toggleColorLock: (colorKey: string) => void
  setActiveColor: (colorKey: string | null) => void
  handleColorChange: (colorKey: string, newColor: string) => void
}

const SCHEMES = Object.values(ColorScheme).filter(
  (value) => typeof value === 'number'
) as ColorScheme[]

/** The locked subset of a colour record — what a resolve must carry through untouched. */
function pickLocked(
  source: Record<string, string>,
  locked: Set<string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of locked) {
    const value = source[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * Resolve every colour domain from one state snapshot. Pure and deterministic: given
 * the same state it returns the same palette, and it consumes no randomness.
 */
function resolveAll(s: ThemeState): {
  colors: UIColors
  syntaxColors: SyntaxColors
  ansiColors: AnsiColors
} {
  const input = {
    assignment: s.assignment,
    scheme: s.scheme,
    baseHue: s.baseHue,
    isDark: s.isDark,
    uiSaturation: s.uiSaturation,
  }

  const colors = resolveUiColors(
    input,
    pickLocked(s.colors, s.lockedColors) as Partial<UIColors>
  )
  const pools = buildPools(input, colors)
  const syntaxColors = resolveSyntaxColors(
    {
      assignment: s.assignment,
      pools,
      syntaxSaturation: s.syntaxSaturation,
      backgroundColor: colors.BG1,
    },
    pickLocked(s.syntaxColors, s.lockedColors) as Partial<SyntaxColors>
  )
  const ansiColors = resolveAnsiColors(s.assignment, colors.BG1)

  return { colors, syntaxColors, ansiColors }
}

/** One full theme drawn from a fresh seed — the initial snapshot, with no flash of defaults. */
function bootstrap(isDark: boolean): ThemeState {
  const theme = drawTheme(randomSeed(), 'full', SCHEMES)
  const base: ThemeState = {
    isDark,
    baseHue: theme.baseHue,
    uiSaturation: theme.uiSaturation,
    syntaxSaturation: theme.syntaxSaturation,
    scheme: theme.scheme,
    assignment: theme.assignment,
    colors: {} as UIColors,
    syntaxColors: {} as SyntaxColors,
    ansiColors: {} as AnsiColors,
    lockedColors: new Set(),
  }
  return { ...base, ...resolveAll(base) }
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export const ThemeProvider: React.FC<{
  children: React.ReactNode
  userId?: string
}> = ({ children }) => {
  const { setTheme, resolvedTheme } = useNextTheme()

  const [activeColor, setActiveColor] = useState<string | null>(null)
  const [, setVersion] = useState(0)

  const stateRef = useRef<ThemeState | null>(null)
  if (stateRef.current === null) {
    // next-themes has not resolved yet on the first render; dark is the app default.
    stateRef.current = bootstrap(resolvedTheme !== 'light')
  }

  const commit = useCallback((mutate: (s: ThemeState) => ThemeState) => {
    stateRef.current = mutate(stateRef.current as ThemeState)
    setVersion((v) => v + 1)
  }, [])

  /** Re-resolve every domain from a mutated snapshot and adopt the result. */
  const commitResolved = useCallback(
    (mutate: (s: ThemeState) => ThemeState) =>
      commit((s) => {
        const next = mutate(s)
        return { ...next, ...resolveAll(next) }
      }),
    [commit]
  )

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
  // which is what preserves hand-edited hues and the per-key lightness spread.
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
      syntaxColors: updateSyntaxColorsWithSaturation(
        s.syntaxColors,
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
    commit((s) => {
      const assignment = redrawAnsi(s.assignment, randomSeed())
      return {
        ...s,
        assignment,
        ansiColors: resolveAnsiColors(assignment, s.colors.BG1),
      }
    })

  const toggleColorLock = (colorKey: string) =>
    commit((s) => {
      const lockedColors = new Set(s.lockedColors)
      if (lockedColors.has(colorKey)) lockedColors.delete(colorKey)
      else lockedColors.add(colorKey)
      return { ...s, lockedColors }
    })

  const handleColorChange = (colorKey: string, newColor: string) =>
    commit((s) => {
      if (colorKey.startsWith('ansi')) {
        return {
          ...s,
          ansiColors: { ...s.ansiColors, [colorKey.slice(4)]: newColor },
        }
      }

      if (colorKey in s.colors) {
        const colors = { ...s.colors, [colorKey]: newColor }
        if (colorKey !== 'BG1') return { ...s, colors }

        // A background edit re-resolves the syntax and terminal palettes against the
        // new background. Locked syntax tokens are carried through, and ANSI re-reads
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
          colors,
          syntaxColors: resolveSyntaxColors(
            {
              assignment: s.assignment,
              pools,
              syntaxSaturation: s.syntaxSaturation,
              backgroundColor: newColor,
            },
            pickLocked(s.syntaxColors, s.lockedColors) as Partial<SyntaxColors>
          ),
          ansiColors: resolveAnsiColors(s.assignment, newColor),
        }
      }

      if (colorKey in s.syntaxColors) {
        return { ...s, syntaxColors: { ...s.syntaxColors, [colorKey]: newColor } }
      }
      if (colorKey in s.ansiColors) {
        return { ...s, ansiColors: { ...s.ansiColors, [colorKey]: newColor } }
      }
      return s
    })

  const s = stateRef.current as ThemeState

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
    lockedColors: s.lockedColors,
    activeColor,
    setIsDark,
    setBaseHue,
    setUiSaturation,
    setSyntaxSaturation,
    setScheme,
    randomizeTheme,
    regenerateUnlocked,
    regenerateAnsiColors,
    toggleColorLock,
    setActiveColor,
    handleColorChange,
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
