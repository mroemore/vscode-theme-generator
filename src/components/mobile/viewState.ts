'use client'

import { isColorFormat, type ColorFormat } from '@/lib/utils/colorUtils'

// The mobile shell's own view state. Deliberately outside ThemeContext: that context owns the
// colour pipeline, and which modules a phone has open is not a theme fact.

export const MODULE_IDS = [
  'controls',
  'themes',
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
const FORMAT_KEY = 'vsc_themegen.mobile.format'
const PICKER_LARGE_KEY = 'vsc_themegen.mobile.pickerLarge'

/** 1 = a bare array of visible ids (written before the Themes module existed); 2 = `{ v, ids }`. */
const VISIBLE_VERSION = 2

/** Modules that did not exist in the v1 record. A v1 record cannot name them as hidden — they
 *  were not in the bar yet — so they come back visible instead of vanishing for anyone who ever
 *  toggled a module in an older build. New ids go in here when they are introduced. */
const MODULES_ADDED_AFTER_V1: ReadonlySet<ModuleId> = new Set<ModuleId>(['themes'])

interface StoredVisible {
  v: number
  ids: ModuleId[]
}

const isModuleId = (value: unknown): value is ModuleId =>
  typeof value === 'string' && (MODULE_IDS as readonly string[]).includes(value)

const isStoredVisible = (value: unknown): value is StoredVisible => {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { v?: unknown; ids?: unknown }
  return record.v === VISIBLE_VERSION && Array.isArray(record.ids)
}

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
    // v1: a bare array. Kept readable, with the later modules folded in — see
    // MODULES_ADDED_AFTER_V1.
    if (Array.isArray(parsed)) {
      return MODULE_IDS.filter(
        (id) => parsed.includes(id) || MODULES_ADDED_AFTER_V1.has(id)
      )
    }
    // Current form: the list is exhaustive, so a module missing from it was hidden by the user.
    if (isStoredVisible(parsed)) {
      return MODULE_IDS.filter((id) => parsed.ids.includes(id))
    }
    // A form this build does not know (a newer version): fall back to every module shown.
    return [...MODULE_IDS]
  } catch {
    return [...MODULE_IDS]
  }
}

export function writeStoredVisible(visible: ModuleId[]): void {
  try {
    const record: StoredVisible = { v: VISIBLE_VERSION, ids: visible }
    window.localStorage.setItem(VISIBLE_KEY, JSON.stringify(record))
  } catch {
    // as above
  }
}

/** The picker's own value format (spec §3.5). Persisted like the pin: a phone's chosen readout
 * is not a theme fact, but it should survive a reload. */
export function readStoredFormat(): ColorFormat {
  try {
    const raw = window.localStorage.getItem(FORMAT_KEY)
    return isColorFormat(raw) ? raw : 'hex'
  } catch {
    return 'hex'
  }
}

export function writeStoredFormat(format: ColorFormat): void {
  try {
    window.localStorage.setItem(FORMAT_KEY, format)
  } catch {
    // as above
  }
}

/** Whether the picker is showing its original, full-bleed form rather than the compact one. */
export function readStoredPickerLarge(): boolean {
  try {
    return window.localStorage.getItem(PICKER_LARGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeStoredPickerLarge(large: boolean): void {
  try {
    window.localStorage.setItem(PICKER_LARGE_KEY, large ? 'true' : 'false')
  } catch {
    // as above
  }
}
