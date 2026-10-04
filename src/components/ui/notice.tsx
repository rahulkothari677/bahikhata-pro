'use client'

/**
 * 🔒 THE ONE WARNING BOX (Phase 4b, Oct 2026).
 *
 * Before this, every screen drew its own: 7 separate notice and banner
 * components and at least 31 hand-made tinted boxes in 20 files, each with
 * its own colours, sizes and amount of text. A shopkeeper could not tell a
 * "nice to know" from "this bill is wrong" at a glance, because nothing
 * meant the same thing twice.
 *
 * Four levels, from the UX plan (Oct 2026), each with ONE colour role:
 *
 *   stop   money or the law is at stake; fix before going on    (bad)
 *   act    something to do, usually with a date or a ₹ amount   (check)
 *   note   worth knowing; nothing to do                         (muted)
 *   clear  checked and fine                                     (good)
 *
 * The rules the box enforces by its shape:
 *  - A title of a few words, then at most ONE short line. Anything longer
 *    goes behind ⓘ (`info`) — the app-not-notebook rule.
 *  - A warning should be resolvable where it appears, so `action` sits on
 *    the box itself (a button, or a small field and a Save).
 *  - Several warnings on one screen go through <NoticeStack>, which shows
 *    the worst first and folds the rest, so a screen never becomes a wall
 *    of coloured boxes.
 */

import { useState, type ReactNode, type ComponentType } from 'react'
import { OctagonAlert, TriangleAlert, Info, CircleCheck, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InfoHint } from '@/components/common/InfoHint'

export type NoticeLevel = 'stop' | 'act' | 'note' | 'clear'

/** Worst first. Exported so a screen can sort its own list the same way. */
export const NOTICE_ORDER: Record<NoticeLevel, number> = { stop: 0, act: 1, note: 2, clear: 3 }

const LOOK: Record<NoticeLevel, { box: string; icon: string; title: string; Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }> = {
  stop: { box: 'bg-bad-soft border-bad/35', icon: 'text-bad', title: 'text-bad', Icon: OctagonAlert },
  act: { box: 'bg-check-soft border-check/35', icon: 'text-check', title: 'text-foreground', Icon: TriangleAlert },
  note: { box: 'bg-muted/50 border-border', icon: 'text-muted-foreground', title: 'text-foreground', Icon: Info },
  clear: { box: 'bg-good-soft border-good/30', icon: 'text-good', title: 'text-foreground', Icon: CircleCheck },
}

export interface NoticeProps {
  level: NoticeLevel
  /** A few words: what is wrong or what to do. */
  title: ReactNode
  /** At most one short line. Longer text belongs in `info`. */
  children?: ReactNode
  /** The explanation, behind ⓘ. */
  info?: string
  /** Fix it here: a button, or a small field and a Save. */
  action?: ReactNode
  /** Data under the warning (the bills it is about), not prose. */
  content?: ReactNode
  /** Shows a 48px close button. */
  onDismiss?: () => void
  /** Replace the level's icon when a picture says it better (a truck for e-way bills). */
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  className?: string
  'data-testid'?: string
}

export function Notice({ level, title, children, info, action, content, onDismiss, icon, className, ...rest }: NoticeProps) {
  const look = LOOK[level]
  const Icon = icon ?? look.Icon
  return (
    <div
      role={level === 'stop' ? 'alert' : level === 'act' ? 'status' : undefined}
      data-notice-level={level}
      data-testid={rest['data-testid']}
      className={cn('rounded-2xl border px-4 py-3 flex items-start gap-3 min-w-0', look.box, className)}
    >
      <Icon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', look.icon)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <p className={cn('text-sm font-semibold leading-snug min-w-0', look.title)}>{title}</p>
          {info && <InfoHint text={info} label={typeof title === 'string' ? title : undefined} className="ml-1" />}
        </div>
        {children && <div className="text-sm text-muted-foreground mt-0.5 leading-snug">{children}</div>}
        {content && <div className="mt-2.5">{content}</div>}
        {action && <div className="mt-2.5 flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-2 -mr-3 w-12 h-12 flex-shrink-0 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

export interface StackedNotice extends NoticeProps {
  id: string
}

/**
 * Several warnings, worst first. The first `stop` and the first `act` stay
 * open; everything after them folds behind "N more", so the one that matters
 * is never pushed below the fold by three that don't.
 */
export function NoticeStack({ notices, className }: { notices: StackedNotice[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const sorted = sortNotices(notices)
  const { shown, folded } = splitNotices(sorted)
  if (!sorted.length) return null
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {shown.map(({ id, ...n }) => <Notice key={id} {...n} />)}
      {folded.length > 0 && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-12 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-muted/60 inline-flex items-center gap-1.5 self-start"
        >
          <ChevronDown className="w-4 h-4" aria-hidden /> {folded.length} more
        </button>
      )}
      {open && folded.map(({ id, ...n }) => <Notice key={id} {...n} />)}
    </div>
  )
}

/** Worst first; equal levels keep the order the screen gave them. */
export function sortNotices<T extends { level: NoticeLevel }>(notices: T[]): T[] {
  return notices
    .map((n, i) => ({ n, i }))
    .sort((a, b) => NOTICE_ORDER[a.n.level] - NOTICE_ORDER[b.n.level] || a.i - b.i)
    .map(({ n }) => n)
}

/** Which notices stay open: the first stop, the first act, or the first notice if neither. */
export function splitNotices<T extends { level: NoticeLevel }>(sorted: T[]): { shown: T[]; folded: T[] } {
  const keep = new Set<number>()
  const firstStop = sorted.findIndex((n) => n.level === 'stop')
  const firstAct = sorted.findIndex((n) => n.level === 'act')
  if (firstStop >= 0) keep.add(firstStop)
  if (firstAct >= 0) keep.add(firstAct)
  if (!keep.size && sorted.length) keep.add(0)
  return {
    shown: sorted.filter((_, i) => keep.has(i)),
    folded: sorted.filter((_, i) => !keep.has(i)),
  }
}
