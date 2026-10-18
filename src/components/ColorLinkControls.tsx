'use client'

// The two link affordances, shared by all three colour panels so a theme pill and a
// syntax/ANSI row cannot drift apart in behaviour or wording.
//
//   SourceLinkButton   — on a theme pill. Enters/leaves link-placement mode, and on
//                        hover asks the panels to cross-highlight its targets.
//   TargetLinkControls — on a linked syntax/ANSI row. The readability toggle and the
//                        unlink affordance, both right-aligned.
//
// Neither mutates a colour: highlighting is an outline only, so hovering can never
// affect the exported palette.

import React from 'react'
import Color from 'color'
import { Contrast, Link as LinkIcon, Unlink } from 'lucide-react'

import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { useTheme } from '@/contexts/ThemeContext'
import { targetsOf } from '@/lib/colors/links'
import type { LinkTargetId } from '@/lib/colors/links'
import type { UIKey } from '@/lib/colors/ui'

/** Black or white, whichever reads on the given colour. */
export function contrastOn(value: string): string {
  try {
    return Color(value).isLight() ? '#000' : '#fff'
  } catch {
    return '#fff'
  }
}

/** A faint wash of the pill's own contrasting colour, for button backgrounds. */
export function tintOn(value: string): string {
  try {
    return Color(contrastOn(value)).alpha(0.12).string()
  } catch {
    return 'rgba(255,255,255,0.12)'
  }
}

/** The outline a highlighted pill or row wears. Never a colour change. */
export function highlightStyle(active: boolean, value: string): React.CSSProperties {
  return active
    ? { boxShadow: `0 0 0 2px ${contrastOn(value)}`, borderRadius: '0.375rem' }
    : {}
}

export const SourceLinkButton: React.FC<{
  colorKey: string
  value: string
}> = ({ colorKey, value }) => {
  const {
    linkingSource,
    startLinking,
    links,
    hoveredSource,
    setHoveredSource,
  } = useTheme()

  const source = colorKey as UIKey
  const contrast = contrastOn(value)
  const targets = targetsOf(links, source)
  const isLinked = targets.length > 0
  const isPlacing = linkingSource === source
  const isCrossHighlighted = hoveredSource === source
  const outlined = isPlacing || isCrossHighlighted

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          className="h-5 w-5"
          style={{
            backgroundColor: tintOn(value),
            boxShadow: outlined ? `inset 0 0 0 2px ${contrast}` : undefined,
          }}
          onClick={(event) => {
            event.stopPropagation()
            startLinking(source)
          }}
          onMouseEnter={() => setHoveredSource(source)}
          onMouseLeave={() => setHoveredSource(null)}
          aria-label={
            isPlacing
              ? `Cancel linking from ${colorKey}`
              : `Link ${colorKey} to syntax or ANSI colours`
          }
          aria-pressed={isPlacing}
          data-placing={isPlacing || undefined}
          data-linked={isLinked || undefined}
        >
          <LinkIcon
            size={16}
            // "Slightly changed colour when actively linked": the icon goes from a
            // washed-out to a full-strength contrast tint, which reads on any pill.
            style={{ color: contrast, opacity: isLinked ? 1 : 0.5 }}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isLinked
          ? `Linked to ${targets.length} colour${targets.length === 1 ? '' : 's'} — click to link more`
          : `Link ${colorKey} to syntax or ANSI colours`}
      </TooltipContent>
    </Tooltip>
  )
}

export const TargetLinkControls: React.FC<{
  targetId: LinkTargetId
  value: string
}> = ({ targetId, value }) => {
  const { links, unlinkTarget, setLinkAdjust, setHoveredSource } = useTheme()
  const link = links[targetId]
  if (!link) return null

  const contrast = contrastOn(value)

  return (
    <div
      className="flex items-center"
      // Hovering a linked target's icon cross-highlights the source and every sibling
      // target — the same signal the source pill's own hover gives, from either end.
      onMouseEnter={() => setHoveredSource(link.source)}
      onMouseLeave={() => setHoveredSource(null)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4"
            onClick={(event) => {
              event.stopPropagation()
              setLinkAdjust(targetId, !link.adjust)
            }}
            aria-label={
              link.adjust
                ? 'Readability-adjusted copy of the linked colour'
                : 'Raw copy of the linked colour'
            }
          >
            <Contrast
              size={13}
              style={{ color: contrast, opacity: link.adjust ? 1 : 0.45 }}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {link.adjust
            ? `Readability-adjusted copy of ${link.source} — click to use the raw colour`
            : `Raw copy of ${link.source} — click to make it readable`}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4"
            onClick={(event) => {
              event.stopPropagation()
              unlinkTarget(targetId)
            }}
            aria-label={`Unlink from ${link.source}`}
          >
            <Unlink size={14} style={{ color: contrast }} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{link.source} — click to unlink</TooltipContent>
      </Tooltip>
    </div>
  )
}
