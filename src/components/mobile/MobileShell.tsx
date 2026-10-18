'use client'

import React, { useEffect, useState } from 'react'

import { useTheme } from '@/contexts/ThemeContext'

import ActiveColorPicker from '@/components/ActiveColorPicker'
import ExportButton from '@/components/ExportButton'
import ExportSemanticButton from '@/components/ExportSemanticButton'
import ThemeControls from '@/components/ThemeControls'
import ThemePreview from '@/components/ThemePreview'

import BulkLockControls from './BulkLockControls'
import ColorStrip from './ColorStrip'
import Module, { ACCENT, FILL_A, FILL_B } from './Module'
import {
  MODULE_IDS,
  type ModuleId,
  type PinTarget,
  readStoredPin,
  readStoredVisible,
  writeStoredPin,
  writeStoredVisible,
} from './viewState'

// The mobile shell. One scrolling column of modules behind a fixed bottom bar:
//  - the bar toggles each module's visibility;
//  - the pin control in a module's title bar lifts it out of the scroller and holds it above,
//    one module at a time;
//  - pin and visibility are view state, persisted in localStorage (see ./viewState).
//
// The three colour modules are the mobile strip (ColorStrip); the controls and preview modules
// still host their existing desktop bodies until their own steps land.

const LABELS: Record<ModuleId, string> = {
  controls: 'Controls',
  colors: 'Colors',
  syntax: 'Syntax',
  ansi: 'ANSI',
  preview: 'Preview',
}

// The editor preview is a viewer, not a control surface, so it holds no pinned slot: no pin
// control is drawn and a pin stored by an older session is ignored on restore (spec §6.2).
const NOT_PINNABLE: ReadonlySet<PinTarget> = new Set<PinTarget>(['preview'])

const MobileShell: React.FC = () => {
  const { activeColor } = useTheme()

  // Read stored view state once, then persist changes. The two write effects are gated on the
  // read having happened, so a first render never overwrites what is on disk with the defaults.
  const [pin, setPin] = useState<PinTarget | null>(null)
  const [visible, setVisible] = useState<ModuleId[]>([...MODULE_IDS])
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    const stored = readStoredPin()
    setPin(stored !== null && !NOT_PINNABLE.has(stored) ? stored : null)
    setVisible(readStoredVisible())
    setRestored(true)
  }, [])

  useEffect(() => {
    if (restored) writeStoredPin(pin)
  }, [pin, restored])

  useEffect(() => {
    if (restored) writeStoredVisible(visible)
  }, [visible, restored])

  const toggleVisible = (id: ModuleId) => {
    setVisible((current) => {
      const next = current.includes(id)
        ? current.filter((entry) => entry !== id)
        : MODULE_IDS.filter((entry) => entry === id || current.includes(entry))
      // Hiding the pinned module unpins it: a hidden module cannot hold the pinned slot.
      if (!next.includes(id) && pin === id) setPin(null)
      return next
    })
  }

  const togglePin = (id: PinTarget) => setPin((current) => (current === id ? null : id))

  const bodies: Record<
    ModuleId,
    { title: string; count?: number; actions?: React.ReactNode; node: React.ReactNode }
  > = {
    controls: { title: 'Theme Controls', node: <ThemeControls compact /> },
    colors: {
      title: 'Theme Colors',
      count: 16,
      actions: <BulkLockControls domain="ui" />,
      node: <ColorStrip domain="ui" />,
    },
    syntax: {
      title: 'Syntax Colors',
      count: 32,
      actions: <BulkLockControls domain="syntax" />,
      node: <ColorStrip domain="syntax" />,
    },
    ansi: { title: 'ANSI Colors', count: 16, node: <ColorStrip domain="ansi" /> },
    preview: { title: 'Editor Preview', node: <ThemePreview compact /> },
  }

  // The picker joins the column above the rest whenever a colour is selected; it has no toggle.
  const order: PinTarget[] = [
    ...(activeColor ? (['picker'] as PinTarget[]) : []),
    ...MODULE_IDS.filter((id) => visible.includes(id)),
  ]

  const pinnedHere = pin !== null && order.includes(pin) ? pin : null
  const scrolling = order.filter((id) => id !== pinnedHere)

  const renderModule = (id: PinTarget, fill: string, cast: 'up' | 'down' | 'none') => {
    if (id === 'picker') {
      return (
        <Module
          key="picker"
          moduleId="picker"
          title="Color Picker"
          pinned={pin === 'picker'}
          onTogglePin={() => togglePin('picker')}
          fill={fill}
          cast={cast}
        >
          <ActiveColorPicker flat />
        </Module>
      )
    }
    const body = bodies[id]
    return (
      <Module
        key={id}
        moduleId={id}
        title={body.title}
        count={body.count}
        pinned={pin === id}
        onTogglePin={() => togglePin(id)}
        pinnable={!NOT_PINNABLE.has(id)}
        actions={body.actions}
        fill={fill}
        cast={cast}
      >
        {body.node}
      </Module>
    )
  }

  return (
    <div
      className="md:hidden"
      data-testid="mobile-shell"
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: FILL_A,
        color: '#D4D4D4',
      }}
    >
      {pinnedHere !== null && (
        <div data-testid="mobile-pinned" style={{ flex: '0 0 auto' }}>
          {renderModule(pinnedHere, FILL_B, 'down')}
        </div>
      )}

      <div data-testid="mobile-scroller" style={{ flex: 1, overflowY: 'auto' }}>
        {scrolling.map((id, index) =>
          renderModule(id, index % 2 === 0 ? FILL_A : FILL_B, index === 0 ? 'none' : 'up')
        )}

        <div
          style={{
            background: FILL_A,
            padding: 8,
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <ExportButton />
          <ExportSemanticButton />
        </div>
      </div>

      <div
        className="bar"
        data-testid="mobile-bar"
        style={{
          flex: '0 0 auto',
          display: 'flex',
          background: FILL_A,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {MODULE_IDS.map((id, index) => {
          const on = visible.includes(id)
          return (
            <button
              key={id}
              type="button"
              data-bar={id}
              aria-pressed={on}
              onClick={() => toggleVisible(id)}
              style={{
                flex: 1,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                padding: 0,
                border: 'none',
                borderRight: index === MODULE_IDS.length - 1 ? 'none' : `2px solid ${FILL_A}`,
                background: on ? ACCENT : FILL_B,
                color: on ? FILL_A : '#B0B0B8',
                fontWeight: on ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {LABELS[id]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default MobileShell
