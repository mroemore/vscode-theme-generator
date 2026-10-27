'use client'

import React from 'react'
import {
  IconDice5,
  IconRefresh,
  IconSparkles,
  IconTerminal2,
} from '@tabler/icons-react'

import { useTheme } from '@/contexts/ThemeContext'

import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { ModeToggle } from './ModeToggle'
import { RedoIcon, UndoIcon } from './icons/HistoryIcons'

import { ColorScheme } from '@/lib/types/colors'

/**
 * The saved indicator. Its only job is to be honest, so every state is derived from the
 * library rather than from a timer of its own: a pending debounce says `Saving…`, a refused
 * write says `Not saved` (never `Saved`), and `Saved` appears only after a write landed.
 * `aria-live` announces the transition once, quietly.
 *
 * Four states, four claims — and only one of them is an alarm. `unsaved` is the state a
 * fresh app is in before the library has been read: nothing has been written yet, which
 * is not a failure, so it gets its own quiet wording and the muted tone. The destructive
 * tone is reserved for a write the library actually refused.
 */
const SaveStateChip: React.FC<{ state: 'saving' | 'saved' | 'error' | 'unsaved' }> = ({
  state,
}) => {
  const copy =
    state === 'saving'
      ? { text: 'Saving…', tone: 'text-muted-foreground', title: 'Saving this theme' }
      : state === 'saved'
        ? { text: 'Saved', tone: 'text-muted-foreground', title: 'This theme is saved in your browser' }
        : state === 'error'
          ? { text: 'Not saved', tone: 'text-destructive', title: 'The last save was refused — the library may be full' }
          : { text: 'Unsaved', tone: 'text-muted-foreground', title: 'Nothing has been written to the library yet' }

  return (
    <span
      data-testid="save-state"
      data-state={state}
      role="status"
      aria-live="polite"
      title={copy.title}
      className={`ml-2 select-none text-[11px] tabular-nums ${copy.tone}`}
    >
      {copy.text}
    </span>
  )
}

interface ThemeControlsProps {
  /**
   * The mobile layout (spec §3.6): the four actions become one row of icon-only buttons, Base Hue
   * keeps the full width, and the two saturation sliders share a 50/50 row. The desktop layout
   * stacks the labels and gives every button the full width. Only the layout differs — the
   * handlers, the sliders and the scheme select are the same code in both.
   */
  compact?: boolean
}

const ThemeControls: React.FC<ThemeControlsProps> = ({ compact = false }) => {
  const {
    baseHue,
    scheme,
    uiSaturation,
    syntaxSaturation,
    setBaseHue,
    setUiSaturation,
    setSyntaxSaturation,
    setScheme,
    randomizeTheme,
    regenerateUnlocked,
    regenerateAnsiColors,
    undo,
    redo,
    canUndo,
    canRedo,
    saveState,
  } = useTheme()

  // There is no mount-time randomize any more: the provider bootstraps a full theme
  // synchronously, so the first paint is already a generated palette rather than the
  // default one being replaced a tick later.

  const getSaturationGradient = (baseHue: number) => `
    linear-gradient(to right, 
      hsl(${baseHue}, 0%, 50%), 
      hsl(${baseHue}, 100%, 50%)
    )
  `

  const labelClass = compact ? 'text-[10px] text-neutral-400' : 'text-xs'

  const actions = [
    {
      key: 'randomize-full',
      label: 'Randomize Full',
      icon: <IconDice5 size={16} />,
      onClick: () => randomizeTheme('full'),
      hint:
        'Generate a completely new random theme using the base hue to generate the UI colors ' +
        'and add the two accent colors to generate the Syntax colors.',
    },
    {
      key: 'randomize-few',
      label: 'Randomize with Few Colors',
      icon: <IconSparkles size={16} />,
      onClick: () => randomizeTheme('base'),
      hint: 'Generate a completely new random theme using only base hue to generate all colors.',
    },
    {
      key: 'regenerate-unlocked',
      label: 'Regenerate Unlocked',
      icon: <IconRefresh size={16} />,
      onClick: regenerateUnlocked,
      hint: 'Slightly adjust the current theme, keeping locked colors unchanged',
    },
    {
      key: 'regenerate-ansi',
      label: 'Regenerate ANSI Colors',
      icon: <IconTerminal2 size={16} />,
      onClick: regenerateAnsiColors,
      hint: 'Regenerate terminal colors based on the current theme',
    },
  ]

  return (
    <section className={`flex flex-col ${compact ? 'gap-2' : 'gap-5'} w-full`}>
      {/* The module title bar already carries the name on mobile, so only the desktop layout
          renders its own heading. */}
      {!compact && (
        <div
          data-testid="controls-header"
          className="flex items-center justify-between gap-3"
        >
          <h2 className="text-xl font-semibold">Theme Controls</h2>
          <div className="flex items-center gap-1">
            {/* The pair is icon-only and borderless in both layouts: the desktop row and the
                mobile title bar read the same. `disabled` is the attribute, not just a
                fade — a greyed button that still fires would be a lie about the stack. */}
            <button
              type="button"
              data-testid="undo"
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              disabled={!canUndo}
              onClick={undo}
              className="flex h-6 w-6 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:text-muted-foreground"
            >
              <UndoIcon />
            </button>
            <button
              type="button"
              data-testid="redo"
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)"
              disabled={!canRedo}
              onClick={redo}
              className="flex h-6 w-6 items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:text-muted-foreground"
            >
              <RedoIcon />
            </button>
            <SaveStateChip state={saveState} />
          </div>
        </div>
      )}
      <TooltipProvider>
        <div className={compact ? 'flex gap-2' : 'flex gap-5'}>
          <div className="flex flex-1 items-end gap-4">
            <div className="flex-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <label className={labelClass}>Color Scheme:</label>
                    <Select
                      onValueChange={(value) =>
                        setScheme(Number(value) as ColorScheme)
                      }
                      value={scheme.toString()}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Color Scheme">
                          {
                            Object.entries(ColorScheme).filter(
                              ([key, value]) => value === scheme
                            )[0][0]
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ColorScheme)
                          .filter(([key]) => isNaN(Number(key)))
                          .map(([key, value]) => (
                            <SelectItem key={key} value={value as string}>
                              {key}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    Choose a color harmony scheme to generate complementary
                    colors
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ModeToggle />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Switch between dark and light theme modes</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className={compact ? 'flex flex-col gap-2 w-full' : 'flex flex-col gap-2 w-full'}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col gap-1">
                <label className={labelClass}>Base Hue:</label>
                <div className="flex items-center gap-2">
                  <div className="flex-grow">
                    <Slider
                      data-slider="base-hue"
                      value={[baseHue]}
                      min={0}
                      max={359}
                      step={1}
                      bg={`linear-gradient(to right, 
                            hsl(0, 100%, 50%), 
                            hsl(60, 100%, 50%), 
                            hsl(120, 100%, 50%), 
                            hsl(180, 100%, 50%), 
                            hsl(240, 100%, 50%), 
                            hsl(300, 100%, 50%), 
                            hsl(360, 100%, 50%))`}
                      onValueChange={(value) => setBaseHue(value[0])}
                    />
                  </div>
                  {/* <span className="ml-2 w-8 text-right text-xs">
                        {baseHue}
                      </span> */}
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                Set the primary color of your theme. This affects overall color
                tone
              </p>
            </TooltipContent>
          </Tooltip>

          <div className={compact ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2'}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-col gap-1">
                  <label className={labelClass}>UI Saturation:</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-grow">
                      <Slider
                        data-slider="ui-saturation"
                        value={[uiSaturation]}
                        min={0}
                        max={100}
                        step={1}
                        bg={getSaturationGradient(baseHue)}
                        onValueChange={(value: number[]) =>
                          setUiSaturation(value[0])
                        }
                      />
                    </div>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  Adjust color intensity for user interface elements. Higher
                  values result in more vivid colors
                </p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-col gap-1">
                  <label className={compact ? labelClass : 'mr-2 text-xs'}>
                    Syntax Saturation:
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex-grow">
                      <Slider
                        data-slider="syntax-saturation"
                        value={[syntaxSaturation]}
                        min={0}
                        max={100}
                        step={1}
                        bg={getSaturationGradient(baseHue)}
                        onValueChange={(value: number[]) =>
                          setSyntaxSaturation(value[0])
                        }
                      />
                    </div>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  Control color intensity for syntax highlighting. Higher values
                  make code colors more vibrant
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div
          className={
            compact ? 'flex gap-1' : 'flex flex-col justify-between gap-2'
          }
        >
          {actions.map((action) => (
            <Tooltip key={action.key}>
              <TooltipTrigger asChild>
                <Button
                  className={compact ? 'flex-1 rounded-none px-0' : 'w-full text-xs'}
                  size="sm"
                  variant={compact ? 'secondary' : 'default'}
                  data-action={action.key}
                  aria-label={action.label}
                  title={action.label}
                  onClick={action.onClick}
                >
                  {compact ? action.icon : action.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{action.hint}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </section>
  )
}

export default ThemeControls
