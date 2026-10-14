'use client'

/**
 * GoalCard — this month's sales goal as a ring (Phase 5b-4, ledger model §7).
 *
 * "October goal · 42% of ₹2,90,000 · 18 days left · ₹9,201 a day needed ·
 * so far ₹9,568 a day." The goal comes from Business Goals (Settings), the
 * figures from lib/goal-pace.ts — actual pace, never a forecast.
 *
 * It reads THIS month (monthRevenue / monthExpenses from the Home feed),
 * whatever the period chip shows. The card it replaces compared the monthly
 * target with the chip's period, so "This Year" read "Target achieved!".
 * The ring opens how the month's sales are worked out.
 */
import { useTranslation } from '@/hooks/use-translation'
import { goalPace } from '@/lib/goal-pace'
import { istMonthStart } from '@/lib/timezone'
import { formatINR, cn } from '@/lib/utils'
import type { ProofSpec } from './ProofSheet'

const R = 36
const C = 2 * Math.PI * R

export function GoalCard({ monthRevenue, monthExpenses, revenueTarget, expenseBudget, onProof }: {
  monthRevenue: number
  monthExpenses: number
  revenueTarget: number | undefined
  expenseBudget: number | undefined
  onProof: (spec: ProofSpec) => void
}) {
  const { t, language } = useTranslation()
  const pace = goalPace({ target: revenueTarget ?? 0, achieved: monthRevenue })
  if (!pace && !expenseBudget) return null

  const now = new Date()
  const monthName = new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long', timeZone: 'Asia/Kolkata' }).format(now)
  const fill = pace ? Math.min(pace.pct, 100) / 100 : 0
  const openMonth = () => onProof({
    kind: 'explain', metric: 'sales', scope: 'range', from: istMonthStart(now), to: now,
    titleKey: 'proof.t_sales_range', periodLabel: monthName, shown: monthRevenue,
  })
  const overBudget = expenseBudget ? monthExpenses > expenseBudget : false

  return (
    <div className="rounded-2xl bg-card border border-border/60 shadow-card p-3 space-y-3">
      {pace && revenueTarget && (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={openMonth}
            className="relative w-[88px] h-[88px] flex-shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={`${t('goal.title').replace('{month}', monthName)}: ${t('goal.of').replace('{pct}', String(pace.pct)).replace('{target}', formatINR(revenueTarget))}. ${t('proof.tap_hint')}`}
          >
            <svg viewBox="0 0 88 88" className="w-full h-full -rotate-90" aria-hidden>
              <circle cx="44" cy="44" r={R} fill="none" strokeWidth="9" stroke="currentColor" className="text-muted" />
              <circle
                cx="44" cy="44" r={R} fill="none" strokeWidth="9" strokeLinecap="round" stroke="currentColor"
                strokeDasharray={C} strokeDashoffset={C * (1 - fill)}
                className={cn('transition-[stroke-dashoffset] duration-700', pace.reached ? 'text-good' : 'text-primary')}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums">{pace.pct}%</span>
          </button>
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-bold">{t('goal.title').replace('{month}', monthName)}</p>
            <p className="text-sm tabular-nums">
              <span className="font-semibold">{formatINR(monthRevenue)}</span>
              <span className="text-muted-foreground"> {t('goal.of_target').replace('{target}', formatINR(revenueTarget))}</span>
            </p>
            {pace.reached ? (
              <p className="text-xs font-semibold text-good">{t('goal.reached')}</p>
            ) : (
              <p className="text-xs text-muted-foreground tabular-nums">
                {pace.daysLeft === 0 ? t('goal.last_day') : (pace.daysLeft === 1 ? t('goal.day_left') : t('goal.days_left').replace('{n}', String(pace.daysLeft)))}
                {' · '}<span className="font-semibold text-foreground">{t('goal.needed').replace('{amount}', formatINR(Math.ceil(pace.neededPerDay)))}</span>
              </p>
            )}
            <p className="text-xs text-muted-foreground tabular-nums">{t('goal.so_far').replace('{amount}', formatINR(Math.floor(pace.soFarPerDay)))}</p>
          </div>
        </div>
      )}
      {expenseBudget ? (
        <div className={cn(pace && 'border-t border-border/60 pt-2')}>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{t('goal.expenses')}</span>
            <span className={cn('tabular-nums font-semibold', overBudget && 'text-bad')}>
              {formatINR(monthExpenses)} <span className="text-muted-foreground font-normal">/ {formatINR(expenseBudget)}</span>
            </span>
          </div>
          <div className="h-2 mt-1 bg-muted rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full', overBudget ? 'bg-bad' : 'bg-check')} style={{ width: `${Math.min(100, (monthExpenses / expenseBudget) * 100)}%` }} />
          </div>
          {overBudget && <p className="text-xs text-bad mt-0.5 tabular-nums">{t('goal.over').replace('{amount}', formatINR(monthExpenses - expenseBudget))}</p>}
        </div>
      ) : null}
    </div>
  )
}
