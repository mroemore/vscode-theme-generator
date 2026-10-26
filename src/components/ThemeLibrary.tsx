'use client'

import React, { useEffect, useRef, useState } from 'react'

import { useTheme } from '@/contexts/ThemeContext'
import { exportFileName, metadataFor } from '@/lib/themes/exporter'
import { generateThemeJSON } from '@/lib/utils/exportTheme'
import type { ThemeSummary } from '@/hooks/useLibrary'

import { Button } from '@/components/ui/button'

// The catalogue (design §8.1). One panel, two layouts: the desktop column and the mobile
// module (Task 9) differ only in row height and how much text a row shows.
//
// Three things about this component are load-bearing:
//
//  * It renders a *skeleton* until `libraryLoaded`, and the skeleton occupies the same box
//    the list will. The empty state is unreachable before the read, so nothing ever flashes
//    "No saved themes yet" while the library is still being read.
//  * A row's swatches come from `ThemeSummary.swatches`, which `useLibrary` sampled from the
//    stored palette. Nothing here runs the generator: browsing the catalogue must not be able
//    to change a theme.
//  * Export reads the *row's* record. The open theme's palette is in the context, but a row
//    is not necessarily the open theme, and exporting one theme's name over another's colours
//    would be a silent lie.

interface ThemeLibraryProps {
  /**
   * The mobile layout (spec §8.2): 48 px rows and no relative-age column, so 390 px of width
   * is spent on the name and the swatches. The actions are icon-only in both layouts.
   */
  compact?: boolean
  /**
   * Draw the panel's own "Themes · N" heading. False under a MobileShell module, whose title
   * bar already names the module and carries the count — two headings would say it twice. The
   * New/Import row stays in both cases, so New is still reachable in the mobile body.
   */
  showHeader?: boolean
}

/** Relative age for a catalogue row. `updatedAt` is a save timestamp, not a creation one. */
function relativeAge(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/** The download the row's ⤓ performs. Identical bytes to the Export button (design §7.3). */
function downloadTheme(theme: ThemeSummary, json: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exportFileName(theme.name)
  anchor.click()
  URL.revokeObjectURL(url)
}

const iconProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

const ExportIcon = () => (
  <svg {...iconProps}>
    <path d="M8 2v8" />
    <path d="M4.5 6.5 8 10l3.5-3.5" />
    <path d="M2.5 12.5h11" />
  </svg>
)

const RenameIcon = () => (
  <svg {...iconProps}>
    <path d="M11 2.5 13.5 5 6 12.5 3 13l.5-3z" />
  </svg>
)

const DeleteIcon = () => (
  <svg {...iconProps}>
    <path d="M3 4.5h10" />
    <path d="M6.5 4.5V3h3v1.5" />
    <path d="M4.5 4.5 5 13h6l.5-8.5" />
  </svg>
)

const CancelIcon = () => (
  <svg {...iconProps}>
    <path d="M4 4l8 8" />
    <path d="M12 4l-8 8" />
  </svg>
)

const CheckIcon = () => (
  <svg {...iconProps}>
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
)

const iconButtonClass =
  'flex h-5 w-5 items-center justify-center rounded hover:opacity-70 focus-visible:outline focus-visible:outline-1'

const ThemeLibrary: React.FC<ThemeLibraryProps> = ({ compact = false, showHeader = true }) => {
  const {
    themes,
    themeId,
    libraryLoaded,
    lastError,
    colors,
    newTheme,
    openTheme,
    renameTheme,
    deleteTheme,
    readTheme,
  } = useTheme()

  /** The row whose ✎ was pressed, and the text it is holding while it is open. */
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** A ref as well as the state: Enter commits, the input then unmounts, and the blur that
   *  follows must not commit a second time. */
  const renamingRef = useRef<string | null>(null)

  /** The row whose ✕ was pressed and is asking for its one confirmation. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)

  // New and open both move the current theme, which may be below the fold of a scrolled
  // list (New appends at the end). Without this the only feedback would be the count.
  // `block: 'nearest'` keeps it a no-op when the row is already visible.
  useEffect(() => {
    if (themeId === null) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-theme-id="${themeId}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [themeId, themes.length])

  const rowHeight = compact ? 48 : 36
  const listStyle: React.CSSProperties = {
    // A fixed box, not a max-height alone: the skeleton and a one-row list are then the same
    // height, so the panel does not resize when the library arrives (design §8.3).
    minHeight: rowHeight * 3 + 4,
    maxHeight: rowHeight * 6 + 10,
    overflowY: 'auto',
  }

  const startRename = (theme: ThemeSummary) => {
    setConfirmingId(null)
    setRenamingId(theme.id)
    setDraft(theme.name)
    renamingRef.current = theme.id
  }

  const finishRename = (id: string, commit: boolean) => {
    // The field can unmount for a reason other than Enter/Escape (another row is renamed, a
    // row click switches theme). Only the row that currently owns the edit may commit it.
    if (renamingRef.current !== id) return
    renamingRef.current = null
    setRenamingId(null)
    const name = draft.trim()
    setDraft('')
    // Empty or whitespace-only falls back to the existing name (design §7.2): closing the
    // field is the whole effect, never a record with no name.
    if (commit && name !== '') renameTheme(id, name)
  }

  const exportRow = (theme: ThemeSummary) => {
    const record = readTheme(theme.id)
    // A row whose bytes no longer parse: `openTheme` would refresh the catalogue, and the
    // same call does it here, so the dead row disappears instead of exporting nothing.
    if (record === null) {
      openTheme(theme.id)
      return
    }
    const json = generateThemeJSON(
      record.palette.ui,
      record.palette.syntax,
      record.palette.ansi,
      record.name,
      record.inputs === undefined
        ? undefined
        : metadataFor(record.inputs, new Set(record.locks), record.links)
    )
    downloadTheme(theme, json)
  }

  const rowText = (current: boolean) => (current ? colors.FG1 : colors.FG2)

  return (
    <div
      data-testid="theme-library"
      data-compact={compact ? 'true' : 'false'}
      className="w-full rounded-lg border border-border p-4 shadow-md"
      style={{ backgroundColor: colors.BG1, color: colors.FG1 }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        {showHeader && (
          <h2 className="text-xl font-semibold">
            Themes ·{' '}
            <span data-testid="theme-count">{themes.length}</span>
          </h2>
        )}
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            data-testid="theme-new"
            aria-label="New theme"
            title="New theme"
            onClick={() => newTheme()}
          >
            New
          </Button>
          <Button
            size="sm"
            variant="secondary"
            data-testid="theme-import"
            aria-label="Import theme"
            title="Import a theme file (import arrives in a later step)"
            disabled
          >
            Import
          </Button>
        </div>
      </div>

      {lastError !== null && (
        <p
          data-testid="theme-error"
          className="mb-2 text-xs"
          style={{ color: colors.ERROR }}
        >
          {lastError}
        </p>
      )}

      <div
        data-testid="theme-list"
        ref={listRef}
        className="flex flex-col gap-0.5"
        style={listStyle}
      >
        {!libraryLoaded ? (
          <div data-testid="theme-skeleton" className="flex flex-col gap-0.5">
            {/* Three rows at the real row height: the panel keeps its size when the list
                replaces them, and the placeholder never says "no themes". */}
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md px-2"
                style={{ height: rowHeight, backgroundColor: colors.BG2 }}
              >
                <span
                  className="h-3 flex-1 rounded-sm opacity-40"
                  style={{ backgroundColor: colors.FG2 }}
                />
                <span
                  className="h-3 w-16 rounded-sm opacity-20"
                  style={{ backgroundColor: colors.FG2 }}
                />
              </div>
            ))}
          </div>
        ) : themes.length === 0 ? (
          <p
            data-testid="theme-empty"
            className="px-2 py-6 text-sm"
            style={{ color: colors.FG2 }}
          >
            No saved themes yet — press New to start one.
          </p>
        ) : (
          themes.map((theme) => {
            const current = theme.id === themeId
            const confirming = confirmingId === theme.id
            const renaming = renamingId === theme.id
            return (
              <div
                key={theme.id}
                data-testid="theme-row"
                data-theme-id={theme.id}
                data-current={current ? 'true' : 'false'}
                className="flex flex-shrink-0 items-center gap-1.5 rounded-md px-1"
                style={{
                  height: rowHeight,
                  backgroundColor: current ? colors.BG2 : 'transparent',
                }}
                onClick={() => {
                  if (!renaming) openTheme(theme.id)
                }}
              >
                {current ? (
                  <span
                    data-testid="theme-row-current"
                    aria-hidden
                    className="h-5 w-1 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: colors.AC1 }}
                  />
                ) : (
                  <span aria-hidden className="h-5 w-1 flex-shrink-0" />
                )}

                {renaming ? (
                  <input
                    data-testid="theme-rename-input"
                    aria-label={`Rename ${theme.name}`}
                    className="min-w-0 flex-1 rounded border bg-transparent px-1 text-sm"
                    style={{ borderColor: colors.AC1, color: colors.FG1 }}
                    value={draft}
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        finishRename(theme.id, true)
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        finishRename(theme.id, false)
                      }
                    }}
                    onBlur={() => finishRename(theme.id, true)}
                  />
                ) : (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    aria-label={`Open ${theme.name}`}
                    aria-current={current ? 'true' : undefined}
                    title={`Open ${theme.name}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      openTheme(theme.id)
                    }}
                  >
                    <span
                      className="truncate text-sm"
                      style={{
                        color: rowText(current),
                        fontWeight: current ? 600 : 400,
                      }}
                    >
                      {theme.name}
                    </span>
                    <span aria-hidden className="flex flex-shrink-0 gap-[2px]">
                      {theme.swatches.map((swatch, index) => (
                        <span
                          key={`${theme.id}-${index}`}
                          data-testid="theme-swatch"
                          className="h-3 w-3 rounded-[2px]"
                          style={{
                            backgroundColor: swatch,
                            boxShadow: `inset 0 0 0 1px ${colors.BORDER}`,
                          }}
                        />
                      ))}
                    </span>
                  </button>
                )}

                {!compact && !renaming && (
                  <span
                    className="flex-shrink-0 whitespace-nowrap text-[10px] tabular-nums"
                    style={{ color: colors.FG2 }}
                  >
                    {theme.paletteOnly ? 'palette' : relativeAge(theme.updatedAt, Date.now())}
                  </span>
                )}

                {confirming ? (
                  <span
                    data-testid="theme-delete-confirm"
                    className="flex flex-shrink-0 items-center gap-1"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="text-[10px]" style={{ color: colors.ERROR }}>
                      Delete?
                    </span>
                    <button
                      type="button"
                      data-testid="theme-delete-yes"
                      aria-label={`Confirm delete ${theme.name}`}
                      title={`Confirm delete ${theme.name}`}
                      className={iconButtonClass}
                      style={{ color: colors.ERROR }}
                      onClick={() => {
                        setConfirmingId(null)
                        deleteTheme(theme.id)
                      }}
                    >
                      <CheckIcon />
                    </button>
                    <button
                      type="button"
                      data-testid="theme-delete-no"
                      aria-label={`Cancel delete ${theme.name}`}
                      title={`Cancel delete ${theme.name}`}
                      className={iconButtonClass}
                      style={{ color: colors.FG2 }}
                      onClick={() => setConfirmingId(null)}
                    >
                      <CancelIcon />
                    </button>
                  </span>
                ) : (
                  <span
                    className="flex flex-shrink-0 items-center gap-0.5"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      data-testid="theme-export"
                      aria-label={`Export ${theme.name}`}
                      title={`Export ${theme.name}`}
                      className={iconButtonClass}
                      style={{ color: colors.FG2 }}
                      onClick={() => exportRow(theme)}
                    >
                      <ExportIcon />
                    </button>
                    <button
                      type="button"
                      data-testid="theme-rename"
                      aria-label={`Rename ${theme.name}`}
                      title={`Rename ${theme.name}`}
                      className={iconButtonClass}
                      style={{ color: colors.FG2 }}
                      onClick={() => startRename(theme)}
                    >
                      <RenameIcon />
                    </button>
                    <button
                      type="button"
                      data-testid="theme-delete"
                      aria-label={`Delete ${theme.name}`}
                      title={`Delete ${theme.name}`}
                      className={iconButtonClass}
                      style={{ color: colors.FG2 }}
                      onClick={() => setConfirmingId(theme.id)}
                    >
                      <DeleteIcon />
                    </button>
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default ThemeLibrary
