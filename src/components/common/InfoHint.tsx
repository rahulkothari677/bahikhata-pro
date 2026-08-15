'use client'

/**
 * The ⓘ that explains a setting, without the explanation always being on screen.
 *
 * 🎨 2026-08-15. Rahul: "add explanation or description about a word … always
 * add with info button so the design look clean. everywhere."
 *
 * WHY THIS IS THE RIGHT TRADE, AND WHERE IT IS THE WRONG ONE. A settings screen
 * that prints a sentence under every control reads as a manual, and the eye has
 * to step over the prose to reach the next choice. Moving the sentence behind a
 * tap is standard progressive disclosure and it is what makes a dense screen
 * scannable.
 *
 * But this app's users are often reading a second language on a first
 * smartphone, and research on emergent Indian users is consistent that hiding
 * text hurts them. So the rule here is narrow: the LABEL always stays visible
 * and must stand on its own. Only the longer explanation moves behind the
 * button. "Compact" stays on screen; "tighter rows, so a long kirana bill still
 * fits one page" is one tap away. Never hide the name of a thing.
 *
 * TAP, NOT HOVER. There is no hover on a phone. A tooltip that only appears on
 * mouseover is invisible to the people this is for, so this is a click-opened
 * popover that also answers to the keyboard.
 *
 * SIZE. The glyph is small but the button is not: 44×44 with a negative margin
 * so it does not push the label around. §4 asks for 48dp targets and the
 * earlier Ask work found a 43px control that had slipped a pixel under the
 * floor — an icon this small is exactly where that happens.
 */

import { useId, useState } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function InfoHint({
  text,
  label,
  className,
}: {
  /** The explanation. Plain words — this is the sentence a shopkeeper reads. */
  text: string
  /**
   * What the button announces to a screen reader, e.g. "About Compact".
   * Falls back to a generic phrase; pass one wherever there is a name to use,
   * because "more information" repeated eleven times down a page tells a
   * screen-reader user nothing about which control they are on.
   */
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ? `About ${label}` : 'More information'}
          aria-expanded={open}
          aria-describedby={open ? id : undefined}
          onClick={e => {
            // The hint often sits inside a row that is itself a button or a
            // link. Without this, asking what something means also chooses it.
            e.preventDefault()
            e.stopPropagation()
          }}
          className={cn(
            // 44×44 target, pulled in by the same amount so the icon sits tight
            // to the text it belongs to and the layout does not move.
            'inline-flex items-center justify-center w-11 h-11 -m-3.5 rounded-full',
            'text-muted-foreground/70 hover:text-foreground hover:bg-muted/60',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            'transition flex-shrink-0 align-middle',
            className,
          )}
        >
          <Info className="w-4 h-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        id={id}
        side="top"
        align="start"
        sideOffset={6}
        className="w-64 text-xs leading-relaxed p-3"
        // Clicking inside the bubble must not fall through to the row either.
        onClick={e => e.stopPropagation()}
      >
        {text}
      </PopoverContent>
    </Popover>
  )
}

/**
 * A settings row heading with its explanation tucked behind the ⓘ.
 *
 * Exists so the pattern is applied the same way everywhere rather than being
 * re-assembled by hand on each screen — the "one vocabulary" rule, at the level
 * of layout. A screen that wants the description visible simply does not use
 * this.
 */
export function SettingLabel({
  title,
  hint,
  className,
  children,
}: {
  title: string
  /** The explanation. Omit and no button is drawn — no empty ⓘ. */
  hint?: string
  className?: string
  /** Anything that belongs beside the title, e.g. a "Soon" badge. */
  children?: React.ReactNode
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 min-w-0', className)}>
      <span className="truncate">{title}</span>
      {hint && <InfoHint text={hint} label={title} />}
      {children}
    </span>
  )
}
