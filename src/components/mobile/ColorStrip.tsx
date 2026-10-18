'use client'

import React from 'react'
import Color from 'color'
import { IconLink, IconLock, IconLockOpen } from '@tabler/icons-react'

import { useTheme } from '@/contexts/ThemeContext'
import {
  SourceLinkButton,
  TargetLinkControls,
  contrastOn,
  highlightStyle,
} from '@/components/ColorLinkControls'
import { ansiTargetId, targetsOf } from '@/lib/colors/links'
import type { UIKey } from '@/lib/colors/ui'

import { ACCENT } from './Module'

// The mobile shape of a colour panel: a static header describing the selected colour (swatch,
// name, hex, link, lock) over a horizontal scroller of solid colour boxes.
//
// The boxes are indicators plus one action each — tap selects (or completes a link placement
// while one is open, exactly as the desktop rows do). Lock and link are corner glyphs so a
// locked or linked colour can be spotted in the strip; the *actions* live in the header, where
// the target is big enough to hit with a thumb.

export type StripDomain = 'ui' | 'syntax' | 'ansi'

interface StripBox {
  key: string
  /** what the theme context knows this colour as: bare key, or `ansi.<Key>` */
  targetId: string
  value: string
  locked: boolean
  linked: boolean
  linkSource?: string
}

const swatchOf = (value: string) => {
  try {
    return Color(value).string()
  } catch {
    return value
  }
}

const hexOf = (value: string) => {
  try {
    return Color(value).hex().toUpperCase()
  } catch {
    return value
  }
}

const clamp: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
}

const ColorStrip: React.FC<{ domain: StripDomain }> = ({ domain }) => {
  const {
    colors,
    syntaxColors,
    ansiColors,
    lockedColors,
    links,
    activeColor,
    setActiveColor,
    linkingSource,
    linkTarget,
    hoveredSource,
    setHoveredSource,
    toggleColorLock,
  } = useTheme()

  const isUi = domain === 'ui'

  const boxes: StripBox[] = Object.entries(
    isUi ? colors : domain === 'syntax' ? syntaxColors : ansiColors
  ).map(([key, value]) => {
    const targetId = domain === 'ansi' ? ansiTargetId(key) : key
    const link = links[targetId]
    return {
      key,
      targetId,
      value,
      locked: !isUi && domain === 'ansi' ? false : lockedColors.has(targetId),
      linked: isUi ? targetsOf(links, key as UIKey).length > 0 : link !== undefined,
      linkSource: link?.source,
    }
  })

  const selected =
    boxes.find((b) => b.targetId === activeColor || b.key === activeColor)?.key ??
    boxes[0]?.key
  const sel = boxes.find((b) => b.key === selected)
  const placing = linkingSource !== null

  return (
    <div>
      {sel && (
        <div
          data-strip-header={domain}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 0 8px',
          }}
        >
          <span
            style={{
              flex: '0 0 auto',
              width: 26,
              height: 22,
              background: swatchOf(sel.value),
            }}
          />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#E4E4E8' }}>
            {sel.key}
          </span>
          <span
            style={{
              fontSize: 10,
              color: '#8E8E96',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {hexOf(sel.value)}
          </span>
          <span style={{ flex: 1 }} />

          {isUi && <SourceLinkButton colorKey={sel.key} value={sel.value} />}

          {domain !== 'ansi' && (
            <button
              type="button"
              data-header-lock={domain}
              aria-label={sel.locked ? `Unlock ${sel.key}` : `Lock ${sel.key}`}
              aria-pressed={sel.locked}
              onClick={() => toggleColorLock(sel.targetId)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                border: 'none',
                background: 'transparent',
                color: sel.locked ? ACCENT : '#8E8E96',
                cursor: 'pointer',
              }}
            >
              {sel.locked ? <IconLock size={15} /> : <IconLockOpen size={15} />}
            </button>
          )}

          {!isUi && sel.linked && (
            <TargetLinkControls targetId={sel.targetId} value={sel.value} />
          )}
        </div>
      )}

      {isUi && placing && (
        <p style={{ fontSize: 10, color: '#8E8E96', padding: '0 0 6px' }}>
          Linking from <strong>{linkingSource}</strong> — tap a syntax or ANSI colour. Escape
          cancels.
        </p>
      )}

      <div
        data-strip={domain}
        style={{
          display: 'flex',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {boxes.map((box) => {
          const crossHighlighted =
            hoveredSource !== null && box.linkSource === hoveredSource
          // Only a real selection wears the outline. The header falls back to the first box so it
          // is never empty, but a fallback is not a selection and must not look like one.
          const isSelected =
            activeColor !== null &&
            (box.targetId === activeColor || box.key === activeColor)
          // The theme strip is the *source* side: while a placement is open its boxes are not
          // link targets, so a tap still selects instead of trying to link theme → theme.
          const isTargetHere = !isUi && placing

          return (
            <button
              key={box.key}
              type="button"
              data-box={box.key}
              data-selected={isSelected ? 'true' : undefined}
              data-locked={box.locked ? 'true' : undefined}
              data-linked={box.linked ? 'true' : undefined}
              title={isTargetHere ? `Link to ${linkingSource}` : box.key}
              onClick={() =>
                isTargetHere ? linkTarget(box.targetId) : setActiveColor(box.targetId)
              }
              onMouseEnter={
                isUi && !placing
                  ? () => setHoveredSource(box.key as never)
                  : undefined
              }
              onMouseLeave={isUi && !placing ? () => setHoveredSource(null) : undefined}
              style={{
                flex: '0 0 auto',
                width: 64,
                height: 52,
                boxSizing: 'border-box',
                padding: '3px 4px',
                border: 'none',
                borderRadius: 0,
                textAlign: 'left',
                position: 'relative',
                cursor: 'pointer',
                background: swatchOf(box.value),
                color: contrastOn(box.value),
                ...(isSelected ? { boxShadow: `inset 0 0 0 2px ${ACCENT}` } : {}),
                ...highlightStyle(isTargetHere || crossHighlighted, box.value),
              }}
            >
              <span style={{ fontSize: 8, lineHeight: 1.15, ...clamp }}>{box.key}</span>
              {(box.linked || box.locked) && (
                <span
                  data-glyphs={`${box.linked ? 'link' : ''}${box.locked ? ' lock' : ''}`.trim()}
                  style={{
                    position: 'absolute',
                    bottom: 2,
                    right: 3,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  {box.linked && (
                    <IconLink size={11} style={{ opacity: 0.75 }} />
                  )}
                  {box.locked && <IconLock size={11} style={{ opacity: 0.75 }} />}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default ColorStrip
