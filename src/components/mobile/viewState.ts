'use client'

// The mobile shell's own view state. Deliberately outside ThemeContext: that context owns the
// colour pipeline, and which modules a phone has open is not a theme fact.

export const MODULE_IDS = [
  'controls',
  'colors',
  'syntax',
  'ansi',
  'preview',
] as const

export type ModuleId = (typeof MODULE_IDS)[number]

/** The conditional picker module can be pinned like the others but has no toggle in the bar. */
export type PinTarget = ModuleId | 'picker'

const PIN_KEY = 'vsc_themegen.mobile.pin'
const VISIBLE_KEY = 'vsc_themegen.mobile.visible'

const isModuleId = (value: unknown): value is ModuleId =>
  typeof value === 'string' && (MODULE_IDS as readonly string[]).includes(value)

export function readStoredPin(): PinTarget | null {
  try {
    const raw = window.localStorage.getItem(PIN_KEY)
    if (raw === 'picker') return 'picker'
    return isModuleId(raw) ? raw : null
  } catch {
    return null
  }
}

export function writeStoredPin(pin: PinTarget | null): void {
  try {
    if (pin === null) window.localStorage.removeItem(PIN_KEY)
    else window.localStorage.setItem(PIN_KEY, pin)
  } catch {
    // storage unavailable (private mode, blocked cookies): the shell still works, unpersisted
  }
}

/** Visible modules, in bar order. An absent or unreadable record means everything is visible. */
export function readStoredVisible(): ModuleId[] {
  try {
    const raw = window.localStorage.getItem(VISIBLE_KEY)
    if (!raw) return [...MODULE_IDS]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...MODULE_IDS]
    const kept = MODULE_IDS.filter((id) => parsed.includes(id))
    return kept
  } catch {
    return [...MODULE_IDS]
  }
}

export function writeStoredVisible(visible: ModuleId[]): void {
  try {
    window.localStorage.setItem(VISIBLE_KEY, JSON.stringify(visible))
  } catch {
    // as above
  }
}
