'use client'

import React, { useEffect, useRef, useState } from 'react'
import { IconFileImport, IconPlus } from '@tabler/icons-react'

import { useTheme } from '@/contexts/ThemeContext'
import { exportFileName, metadataFor } from '@/lib/themes/exporter'
import { displayedPalette } from '@/lib/themes/record'
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
   *
   * `compact` is also the whole flat-language switch. A module in the mobile shell draws no
   * border, no radius and no shadow, and its fill is the alternating module fill — so the body
   * must not re-draw a card of its own (see `ThemeControls` compact for the same rule). The
   * heading is keyed off `compact` too, the way `ThemeControls` does it, so a compact caller
   * cannot end up with two titles.
   */
  compact?: boolean
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

// The shell's icon-control idiom, borrowed from Module/ColorStrip: 24 px, borderless, square,
// transparent until it carries a state. Kept as a style object rather than classes so `compact`
// never inherits the desktop button chrome.
const flatIconButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  padding: 0,
  border: 'none',
  borderRadius: 0,
  background: 'transparent',
  cursor: 'pointer',
}

const ThemeLibrary: React.FC<ThemeLibraryProps> = ({ compact = false }) => {
  const {
    themes,
    themeId,
    themeName,
    libraryLoaded,
    lastError,
    colors,
    newTheme,
    importFile,
    openTheme,
    renameTheme,
    deleteTheme,
    readTheme,
    clearHistory,
    canUndo,
    canRedo,
  } = useTheme()

  /** The row whose ✎ was pressed, and the text it is holding while it is open. */
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** A ref as well as the state: Enter commits, the input then unmounts, and the blur that
   *  follows must not commit a second time. */
  const renamingRef = useRef<string | null>(null)

  /** The row whose ✕ was pressed and is asking for its one confirmation. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  /**
   * The catalogue-level *Clear history* is asking its one question. It is not a row action:
   * history belongs to the open theme, and the catalogue is where that theme is named.
   */
  const [clearing, setClearing] = useState(false)
  const hasHistory = canUndo || canRedo

  // Import. The file is kept, not just its parse: "Import as new" re-reads the same bytes
  // without asking for the file again, and the input's value is cleared on every pick so
  // choosing the same file twice still fires `change` (a stale File would be invisible).
  const fileRef = useRef<HTMLInputElement>(null)
  const [duplicate, setDuplicate] = useState<{
    file: File
    id: string
    name: string
  } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  // A successful import can still have something to say — a malformed metadata block
  // that was ignored — and that is not an error.
  const [importNote, setImportNote] = useState<string | null>(null)

  const runImport = async (file: File, asNew = false) => {
    setImportError(null)
    setImportNote(null)
    const result = await importFile(file, { asNew })
    if (result.kind === 'theme') {
      setDuplicate(null)
      if (result.note !== undefined) setImportNote(result.note)
      return
    }
    if (result.kind === 'invalid') {
      setDuplicate(null)
      setImportError(result.reason)
      return
    }
    setDuplicate({ file, id: result.existing.id, name: result.existing.name })
  }

  const pickFile = () => {
    setImportError(null)
    setImportNote(null)
    if (fileRef.current === null) return
    // Cleared *before* the picker opens: a repeat import of the same file must produce a
    // change event, and a cancelled picker must not leave yesterday's file armed.
    fileRef.current.value = ''
    fileRef.current.click()
  }

  const listRef = useRef<HTMLDivElement>(null)

  // New and open both move the current theme, which may be below the fold of a scrolled
  // list (New appends at the end). Without this the only feedback would be the count.
  // `block: 'nearest'` keeps it a no-op when the row is already visible.
  useEffect(() => {
    // A pending "clear this theme's history?" belongs to the theme that was open when it
    // was asked; a switch makes it a question about a different theme, so it is dropped.
    // The reset runs *before* the early return: an emptied library leaves no open theme,
    // and a question about a theme that no longer exists must not outlive it.
    setClearing(false)
    if (themeId === null) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-theme-id="${themeId}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [themeId, themes.length])

  const rowHeight = compact ? 48 : 36
  // Desktop keeps the fixed box: the skeleton and a one-row list are then the same height, so
  // the panel does not resize when the library arrives (design §8.3). Compact does not: a
  // fixed max height there is a scroller nested in the page scroller, with dead space under a
  // short list — the module grows and the page is the only thing that scrolls.
  const listStyle: React.CSSProperties = compact
    ? { display: 'flex', flexDirection: 'column', gap: 8 }
    : {
        minHeight: rowHeight * 3 + 4,
        maxHeight: rowHeight * 6 + 10,
        overflowY: 'auto',
      }

  // A row is a flat band in compact: no radius, no box of its own, no inset beyond the module's
  // own 8 px. The current row's fill is the only boundary the list draws.
  const rowClass = compact
    ? 'flex flex-shrink-0 items-center gap-1.5'
    : 'flex flex-shrink-0 items-center gap-1.5 rounded-md px-1'

  // Row controls are the shell's 24 px icon buttons in compact, the existing 20 px ones on
  // desktop (whose appearance must not change).
  const iconButton = (color: string) =>
    compact
      ? { className: 'flex-shrink-0', style: { ...flatIconButtonStyle, color } }
      : { className: iconButtonClass, style: { color } }

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
    // The *displayed* palette, not the stored bases: the main Export button exports what
    // is on screen, and a row's ⤓ is the same download for the same record — the two
    // used to disagree by the linked keys whenever the record had links (fix 4). The
    // displayed palettes are derived here, from the stored bases plus the record's
    // links, because a row is not necessarily the open theme.
    const displayed = displayedPalette(record)
    const json = generateThemeJSON(
      displayed.ui,
      displayed.syntax,
      displayed.ansi,
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
      className={
        compact ? 'w-full' : 'w-full rounded-lg border border-border p-4 shadow-md'
      }
      style={compact ? { color: colors.FG1 } : { backgroundColor: colors.BG1, color: colors.FG1 }}
    >
      {compact ? (
        // New and Import as one flat strip: the shell's borderless 24 px icon controls, joined
        // by the bottom bar's 2 px separator and sitting at the body's top edge. New is the
        // accent because it is the action; Import is the quiet secondary beside it. Keeping
        // them here rather than in a heading means New stays one tap away without a second
        // title.
        //
        // *Clear history* shares the strip's left edge as a quiet text action: that is the
        // catalogue's header in this layout, and history belongs to the theme the catalogue
        // names. It is disabled (as a control, not just dimmed) while there is nothing to
        // clear — the same rule the undo pair follows.
        <div className="mb-2 flex items-center justify-between gap-2" data-testid="theme-actions">
          <button
            type="button"
            data-testid="theme-clear-history"
            aria-label="Clear history"
            title={
              hasHistory
                ? 'Clear this theme\u2019s undo history. The colours are not touched.'
                : 'No history to clear'
            }
            disabled={!hasHistory}
            onClick={() => setClearing(true)}
            style={{
              border: 'none',
              background: 'transparent',
              padding: '0 4px',
              height: 24,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '.02em',
              whiteSpace: 'nowrap',
              color: hasHistory ? colors.FG2 : '#5A5A62',
              cursor: hasHistory ? 'pointer' : 'default',
            }}
          >
            Clear history
          </button>
          <span className="flex">
            <button
              type="button"
              data-testid="theme-new"
              aria-label="New theme"
              title="New theme"
              onClick={() => newTheme()}
              style={{
                ...flatIconButtonStyle,
                borderRight: `2px solid ${colors.BORDER}`,
                color: colors.AC1,
              }}
            >
              <IconPlus size={15} />
            </button>
            <button
              type="button"
              data-testid="theme-import"
              aria-label="Import theme"
              title="Import a theme file"
              onClick={pickFile}
              style={{ ...flatIconButtonStyle, color: colors.FG2 }}
            >
              <IconFileImport size={15} />
            </button>
          </span>
        </div>
      ) : (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">
            Themes ·{' '}
            <span data-testid="theme-count">{themes.length}</span>
          </h2>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              data-testid="theme-clear-history"
              aria-label="Clear history"
              title={
                hasHistory
                  ? 'Clear this theme\u2019s undo history. The colours are not touched.'
                  : 'No history to clear'
              }
              disabled={!hasHistory}
              onClick={() => setClearing(true)}
              className="mr-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:text-muted-foreground"
            >
              Clear history
            </button>
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
              title="Import a theme file"
              onClick={pickFile}
            >
              Import
            </Button>
          </div>
        </div>
      )}

      {/* One confirmation, inline — the same shape as a row's delete confirmation. It says
          what it does and what it does not: the colours are untouched, and only the open
          theme's history goes. */}
      {clearing && (
        <div
          data-testid="theme-clear-confirm"
          role="group"
          aria-label="Clear undo history"
          className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          style={{ color: colors.FG2 }}
        >
          <span>
            Clear the undo history for{' '}
            <span style={{ color: colors.FG1, fontWeight: 600 }}>{themeName}</span>? Its
            colours stay as they are.
          </span>
          <button
            type="button"
            data-testid="theme-clear-yes"
            title={`Clear the history for ${themeName}`}
            className="underline"
            style={{ color: colors.ERROR }}
            onClick={() => {
              setClearing(false)
              clearHistory()
            }}
          >
            Clear history
          </button>
          <button
            type="button"
            data-testid="theme-clear-no"
            title="Keep the history"
            className="underline"
            style={{ color: colors.FG2 }}
            onClick={() => setClearing(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* One input for both layouts. Hidden rather than in a label: the two Import controls
          are different shapes, and a `<label>` could only dress one of them. */}
      <input
        ref={fileRef}
        type="file"
        data-testid="theme-import-input"
        accept=".json,.jsonc,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          // Cleared now, so the next pick of the same file is a new `change` event.
          event.target.value = ''
          if (file !== null) void runImport(file)
        }}
      />

      {/* The duplicate dialog is inline, not a modal (spec §6.3): the catalogue stays
          readable behind it, nothing is unmounted, and the chosen file is still in state
          for the second action. */}
      {duplicate !== null && (
        <div
          data-testid="theme-duplicate"
          role="group"
          aria-label="Theme already in library"
          className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          style={{ color: colors.FG2 }}
        >
          <span>
            <span style={{ color: colors.FG1, fontWeight: 600 }}>{duplicate.name}</span> is
            already in your library.
          </span>
          <button
            type="button"
            data-testid="theme-duplicate-open"
            title={`Open ${duplicate.name}`}
            className="underline"
            style={{ color: colors.AC1 }}
            onClick={() => {
              const { id } = duplicate
              setDuplicate(null)
              openTheme(id)
            }}
          >
            Open existing
          </button>
          <button
            type="button"
            data-testid="theme-duplicate-new"
            title="Add the file as a second theme"
            className="underline"
            style={{ color: colors.AC1 }}
            onClick={() => void runImport(duplicate.file, true)}
          >
            Import as new
          </button>
        </div>
      )}

      {importError !== null && (
        <p
          data-testid="theme-import-error"
          className="mb-2 text-xs"
          style={{ color: colors.ERROR }}
        >
          {importError}
        </p>
      )}

      {importNote !== null && (
        <p
          data-testid="theme-import-note"
          className="mb-2 text-xs"
          style={{ color: colors.FG2 }}
        >
          {importNote}
        </p>
      )}

      {lastError !== null && (
        <div
          data-testid="theme-error"
          className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          style={{ color: colors.ERROR }}
        >
          <span>{lastError}</span>
          {/* The message names the remedy, so the strip has to offer it (spec §2.2 step 3).
              The same action and the same one-question confirmation as the catalogue
              header — one "clear history" in this panel, not two that disagree. */}
          <button
            type="button"
            data-testid="theme-error-clear-history"
            aria-label="Clear history"
            title={
              hasHistory
                ? `Clear ${themeName}\u2019s undo history. The colours are not touched.`
                : 'No history to clear'
            }
            disabled={!hasHistory}
            onClick={() => setClearing(true)}
            className="underline disabled:cursor-default disabled:no-underline disabled:opacity-60"
            style={{ color: colors.ERROR }}
          >
            Clear history
          </button>
        </div>
      )}

      <div
        data-testid="theme-list"
        ref={listRef}
        className={compact ? 'flex flex-col' : 'flex flex-col gap-0.5'}
        style={listStyle}
      >
        {!libraryLoaded ? (
          <div
            data-testid="theme-skeleton"
            className={compact ? 'flex flex-col gap-2' : 'flex flex-col gap-0.5'}
          >
            {/* Three rows at the real row height: the panel keeps its size when the list
                replaces them, and the placeholder never says "no themes". */}
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={
                  compact ? 'flex items-center gap-2' : 'flex items-center gap-2 rounded-md px-2'
                }
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
            className={compact ? 'py-6 text-sm' : 'px-2 py-6 text-sm'}
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
                className={rowClass}
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
                    className={
                      compact ? 'h-5 w-1 flex-shrink-0' : 'h-5 w-1 flex-shrink-0 rounded-full'
                    }
                    style={{ backgroundColor: colors.AC1 }}
                  />
                ) : (
                  <span aria-hidden className="h-5 w-1 flex-shrink-0" />
                )}

                {renaming ? (
                  <input
                    data-testid="theme-rename-input"
                    aria-label={`Rename ${theme.name}`}
                    className={
                      compact
                        ? 'min-w-0 flex-1 border-0 border-b bg-transparent px-0 text-sm'
                        : 'min-w-0 flex-1 rounded border bg-transparent px-1 text-sm'
                    }
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
                          className="h-3 w-3"
                          style={{
                            borderRadius: compact ? 0 : 2,
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
                    data-testid="theme-row-meta"
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
                      {...iconButton(colors.ERROR)}
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
                      {...iconButton(colors.FG2)}
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
                      {...iconButton(colors.FG2)}
                      onClick={() => exportRow(theme)}
                    >
                      <ExportIcon />
                    </button>
                    <button
                      type="button"
                      data-testid="theme-rename"
                      aria-label={`Rename ${theme.name}`}
                      title={`Rename ${theme.name}`}
                      {...iconButton(colors.FG2)}
                      onClick={() => startRename(theme)}
                    >
                      <RenameIcon />
                    </button>
                    <button
                      type="button"
                      data-testid="theme-delete"
                      aria-label={`Delete ${theme.name}`}
                      title={`Delete ${theme.name}`}
                      {...iconButton(colors.FG2)}
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
