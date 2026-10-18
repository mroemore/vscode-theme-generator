'use client'

import React, { useState } from 'react'
import { IconPin, IconPinFilled, IconPinnedOff } from '@tabler/icons-react'

// One module in the mobile scroll: a title bar (name, count, pin control) over a body.
// Modules sit flush: no border, no radius, no gap — the only boundary signal is the alternating
// fill plus a shadow in the seam, cast *up* from the module below onto the module above.

export const FILL_A = '#0D0D0F'
export const FILL_B = '#3A3A43'
export const ACCENT = '#4EC9B0'

const SHADOW_UP = '0 -8px 9px -5px rgba(0,0,0,.9)'
const SHADOW_DOWN = '0 8px 9px -5px rgba(0,0,0,.9)'

interface ModuleProps {
  /** Stable hook for the mobile harness (`.tmp_files/pw/probe-mobile.ts`). */
  moduleId: string
  title: string
  count?: number
  pinned: boolean
  onTogglePin: () => void
  /** False for modules that hold no pinned slot (the editor preview). No pin control is drawn. */
  pinnable?: boolean
  /** Module-level actions (the colour panels' bulk lock controls), drawn before the pin. */
  actions?: React.ReactNode
  /** 'up' receives the shadow from the module below; 'down' is a pinned module casting onto the scroller */
  cast?: 'up' | 'down' | 'none'
  fill: string
  children: React.ReactNode
}

const Module: React.FC<ModuleProps> = ({
  moduleId,
  title,
  count,
  pinned,
  onTogglePin,
  pinnable = true,
  actions,
  cast = 'up',
  fill,
  children,
}) => {
  const [hovered, setHovered] = useState(false)

  const pinIcon = pinned ? (
    <IconPinFilled size={15} />
  ) : hovered ? (
    <IconPinnedOff size={15} />
  ) : (
    <IconPin size={15} />
  )

  return (
    <section
      data-module={moduleId}
      data-pinned={pinned ? 'true' : 'false'}
      style={{
        background: fill,
        position: 'relative',
        boxShadow:
          cast === 'up' ? SHADOW_UP : cast === 'down' ? SHADOW_DOWN : undefined,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 8px 6px',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.03em',
            textTransform: 'uppercase',
            color: '#C8C8CE',
          }}
        >
          {title}
        </span>
        {count !== undefined && (
          <span style={{ fontSize: 9, color: '#8E8E96' }}>{count}</span>
        )}
        <span style={{ flex: 1 }} />
        {actions}
        {pinnable && (
          <button
            type="button"
            data-pin={moduleId}
            aria-label={`${pinned ? 'Unpin' : 'Pin'} ${title}`}
            aria-pressed={pinned}
            onClick={onTogglePin}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              border: 'none',
              background: pinned ? ACCENT : 'transparent',
              color: pinned ? FILL_A : '#8E8E96',
              cursor: 'pointer',
            }}
          >
            {pinIcon}
          </button>
        )}
      </div>
      <div style={{ padding: '0 8px 8px' }}>{children}</div>
    </section>
  )
}

export default Module
