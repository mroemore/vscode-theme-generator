'use client'

import React from 'react'

import { useTheme } from '@/contexts/ThemeContext'

import { ACCENT } from './Module'

// The colour panels' bulk lock actions, moved from the desktop panels' header into the mobile
// module's title bar — the mockups gave the panel body over to the static header and the strip,
// and a bulk action belongs to the module, not to the selected colour.
//
// Same rules as desktop: theme colours can be locked and unlocked in bulk, syntax can only be
// unlocked in bulk (there is no Lock All for syntax), and ANSI has no locks at all.

type BulkDomain = 'ui' | 'syntax'

const BulkLockControls: React.FC<{ domain: BulkDomain }> = ({ domain }) => {
  const { colors, syntaxColors, lockedColors, setColorLocks } = useTheme()

  const keys = Object.keys(domain === 'ui' ? colors : syntaxColors)
  const lockedCount = keys.filter((key) => lockedColors.has(key)).length
  const noneLocked = lockedCount === 0
  const allLocked = lockedCount === keys.length

  const action = (
    label: string,
    disabled: boolean,
    onClick: () => void,
    title: string
  ) => (
    <button
      type="button"
      data-bulk={`${domain}-${label === 'Lock All' ? 'lock' : 'unlock'}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        border: 'none',
        background: 'transparent',
        padding: '0 4px',
        height: 22,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '.02em',
        color: disabled ? '#5A5A62' : ACCENT,
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {action(
        'Unlock All',
        noneLocked,
        () => setColorLocks(keys, false),
        'Unlock every colour in this panel'
      )}
      {domain === 'ui' &&
        action(
          'Lock All',
          allLocked,
          () => setColorLocks(keys, true),
          'Lock every colour in this panel'
        )}
    </span>
  )
}

export default BulkLockControls
