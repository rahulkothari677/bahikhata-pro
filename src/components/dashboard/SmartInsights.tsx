'use client'

/**
 * SmartInsights — AI-powered business insights displayed on the dashboard.
 *
 * Combines 4 smart features:
 * 1. Smart Reorder Suggestions — predicts when stock will run out
 * 2. Profit Margin Alerts — products with low/negative margins
 * 3. Sales Pattern Detection — weekend spikes, trends, gaps
 * 4. Customer Credit Risk — parties with high outstanding + slow payment
 *
 * All computed client-side from existing dashboard data — no extra API calls.
 */

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn, formatINR, formatINRCompact } from '@/lib/utils'
import {
  Sparkles, TrendingUp, TrendingDown, AlertTriangle, Package,
  ShoppingCart, Calendar, User, ArrowRight, Percent, Clock,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useQuery } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from '@/hooks/use-translation'

export function SmartInsights() {
  const { setView, setPreviousView, refreshKey } = useAppStore()
  const { language } = useTranslation()
  const { data } = useDashboardData()
  const [expanded, setExpanded] = useState(true)
  // 🔒 V26 (V23 §8.12 residual): dismissal was keyed by array INDEX — when the
  // dashboard refetched and the computed insight list shifted, the wrong
  // insight got hidden. Now keyed by the insight's title (stable per insight
  // type), so a dismissal survives data refreshes and list reordering.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  if (!data) return null

  const allInsights = computeInsights(data, language)
  const insights = allInsights.filter((ins) => !dismissed.has(ins.title))

  if (insights.length === 0) return null

  const criticalCount = insights.filter(i => i.severity === 'critical').length
  const warningCount = insights.filter(i => i.severity === 'warning').length

  const dismissInsight = (title: string) => {
    setDismissed(prev => new Set(prev).add(title))
  }

  return (
    <div className="rounded-2xl shadow-card border border-border/60 overflow-hidden">
      {/* Header — gradient with AI branding */}
      <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-3 text-white relative overflow-hidden">
        {/* Decorative pattern */}
        <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-12 -mt-12 pointer-events-none" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold font-heading tracking-tight">Smart Insights</h3>
              <p className="text-[10px] text-white/80">
                {criticalCount > 0 && `${criticalCount} critical · `}
                {warningCount > 0 && `${warningCount} warnings · `}
                AI-powered business intelligence
              </p>
            </div>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-white/80 hover:text-white text-xs font-medium bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 transition"
          >
            {expanded ? 'Hide' : 'Show all'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-3 space-y-2">
          {/* 🔒 AUDIT V25 BATCH 4c (user request): Insight cards now in a 2-col
              grid on desktop (was single column). Fills the full-width container
              better — no more "blank" look. Each insight card has larger text
              + more padding for readability. Stacks on mobile. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {insights.map((insight, displayIndex) => {
              const Icon = insight.icon
              return (
                <motion.div
                  key={insight.title}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: displayIndex * 0.05 }}
                  className={cn(
                    'flex items-start gap-3 p-3.5 rounded-xl border transition group',
                    insight.severity === 'critical' && 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50',
                    insight.severity === 'warning' && 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50',
                    insight.severity === 'info' && 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/50',
                    insight.severity === 'positive' && 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50',
                  )}
                >
                  <div className={cn(
                    'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                    insight.severity === 'critical' && 'bg-rose-100 dark:bg-rose-900/40',
                    insight.severity === 'warning' && 'bg-amber-100 dark:bg-amber-900/40',
                    insight.severity === 'info' && 'bg-blue-100 dark:bg-blue-900/40',
                    insight.severity === 'positive' && 'bg-emerald-100 dark:bg-emerald-900/40',
                  )}>
                    <Icon className={cn(
                      'w-5 h-5',
                      insight.severity === 'critical' && 'text-rose-600',
                      insight.severity === 'warning' && 'text-amber-600 dark:text-amber-400',
                      insight.severity === 'info' && 'text-blue-600',
                      insight.severity === 'positive' && 'text-emerald-600 dark:text-emerald-400',
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-snug">{insight.title}</p>
                    {/* 🔒 AUDIT V25 BATCH 4c: Larger description text (was text-[11px],
                        now text-[13px]) + more line height for readability. */}
                    <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">{insight.description}</p>
                    {insight.action && (
                      <button
                        onClick={insight.action.onClick}
                        className={cn(
                          'text-xs font-semibold mt-2.5 hover:underline inline-flex items-center gap-1 rounded-full px-3 py-1.5 transition',
                          insight.severity === 'critical' && 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 hover:bg-rose-200 dark:hover:bg-rose-900/60',
                          insight.severity === 'warning' && 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60',
                          insight.severity === 'info' && 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60',
                          insight.severity === 'positive' && 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/60',
                        )}
                      >
                        {insight.action.label}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {/* Dismiss button — appears on hover */}
                  <button
                    onClick={() => dismissInsight(insight.title)}
                    className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition flex-shrink-0 -mt-1 -mr-1 p-1"
                    aria-label="Dismiss insight"
                    title="Dismiss"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </motion.div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Insight computation ───────────────────────────────────────────

type Insight = {
  title: string
  description: string
  icon: any
  severity: 'critical' | 'warning' | 'info' | 'positive'
  action?: { label: string; onClick: () => void }
}

// 🔒 V22-13 (Batch C, Item 0): Language-aware insight text.
// Returns insight text in the user's selected app language.
// Falls back to English for languages without translations (gu, mr, ta, te).
// Only ONE language is shown at a time — no dual-language display.
function insightText(
  lang: string,
  en: { title: string; description: string; actionLabel?: string },
  hi: { title: string; description: string; actionLabel?: string },
): { title: string; description: string; actionLabel?: string } {
  if (lang === 'hi') return hi
  // gu, mr, ta, te → fall back to English for now (future: add translations)
  return en
}

function computeInsights(data: any, lang: string = 'en'): Insight[] {
  const insights: Insight[] = []
  const { kpis, lowStockProducts, topProducts, recentTransactions, salesTrend } = data

  // ─── 0. Daily Summary — always shows at the top when there's data ──
  if (kpis && (kpis.todayRevenue > 0 || kpis.totalReceivable > 0)) {
    const text = insightText(lang,
      {
        title: kpis.todayRevenue > 0 ? "📊 Today's Summary" : '📊 Udhaar Summary',
        description: kpis.todayRevenue > 0
          ? `Today: ${formatINR(kpis.todayRevenue)} revenue from ${kpis.todayTxnCount} sale${kpis.todayTxnCount !== 1 ? 's' : ''}.${kpis.totalReceivable > 0 ? ` Outstanding: ${formatINR(kpis.totalReceivable)}.` : ''}`
          : `No sales today yet. Outstanding receivable: ${formatINR(kpis.totalReceivable)}.`,
      },
      {
        title: kpis.todayRevenue > 0 ? '📊 आज का सारांश' : '📊 उधार सारांश',
        description: (() => {
          const parts: string[] = []
          if (kpis.todayRevenue > 0) parts.push(`आज ${formatINR(kpis.todayRevenue)} की बिक्री (${kpis.todayTxnCount} बिल)`)
          if (kpis.totalReceivable > 0) parts.push(`बकाया: ${formatINR(kpis.totalReceivable)}`)
          return parts.length > 0 ? parts.join(' · ') : 'आज कोई बिक्री नहीं'
        })(),
      },
    )
    insights.push({
      title: text.title,
      description: text.description,
      icon: Sparkles,
      severity: 'info',
    })
  }

  // ─── 1. Smart Reorder Suggestions ─────────────────────────────
  if (lowStockProducts && lowStockProducts.length > 0) {
    lowStockProducts.slice(0, 3).forEach((p: any) => {
      const salesVelocity = topProducts?.find((tp: any) => tp.id === p.id)?.quantity || 0
      const daysLeft = p.currentStock > 0 && salesVelocity > 0
        ? Math.ceil(p.currentStock / (salesVelocity / 30))
        : p.currentStock <= 0 ? 0 : 999

      const text = insightText(lang,
        {
          title: p.currentStock <= 0
            ? `📦 ${p.name} is OVERSOLD`
            : daysLeft <= 7
              ? `📦 ${p.name} runs out in ~${daysLeft} days`
              : `📦 ${p.name} is running low`,
          description: p.currentStock <= 0
            ? `Oversold by ${Math.abs(p.currentStock)} ${p.unit}. Restock immediately — you're losing sales.`
            : `${p.currentStock} ${p.unit} left · threshold: ${p.lowStockThreshold} ${p.unit}. Consider reordering soon.`,
          actionLabel: 'Create Purchase',
        },
        {
          title: p.currentStock <= 0
            ? `📦 ${p.name} ज्यादा बिक गया`
            : daysLeft <= 7
              ? `📦 ${p.name} ${daysLeft} दिन में खत्म हो जाएगा`
              : `📦 ${p.name} खत्म हो रहा है`,
          description: p.currentStock <= 0
            ? `${Math.abs(p.currentStock)} ${p.unit} ज्यादा बिका — जल्दी स्टॉक भरें, वरना बिक्री खोनी पड़ेगी।`
            : `${p.currentStock} ${p.unit} बचे हैं · थ्रेशोल्ड: ${p.lowStockThreshold} ${p.unit}। जल्दी ऑर्डर करें।`,
          actionLabel: 'खरीद दर्ज करें',
        },
      )
      insights.push({
        title: text.title,
        description: text.description,
        icon: Package,
        severity: p.currentStock <= 0 ? 'critical' : 'warning',
        action: {
          label: text.actionLabel || 'Create Purchase',
          onClick: () => {
            useAppStore.getState().setPreviousView('dashboard')
            useAppStore.getState().setView('new-purchase')
          },
        },
      })
    })
  }

  // ─── 2. Profit Margin Alerts ─────────────────────────────────
  if (kpis) {
    const margin = kpis.todayRevenue > 0 ? (kpis.todayProfit / kpis.todayRevenue) * 100 : 0
    if (kpis.todayRevenue > 0 && margin < 10 && margin >= 0) {
      const text = insightText(lang,
        { title: `📊 Profit margin is thin (${margin.toFixed(1)}%)`, description: `Today's margin is below 10%. Revenue: ${formatINR(kpis.todayRevenue)}, Profit: ${formatINR(kpis.todayProfit)}. Consider reviewing your pricing.` },
        { title: `📊 मार्जिन कम है (${margin.toFixed(1)}%)`, description: `आज का मार्जिन 10% से कम है। बिक्री: ${formatINR(kpis.todayRevenue)}, प्रॉफिट: ${formatINR(kpis.todayProfit)}। दाम बढ़ाने पर विचार करें।` },
      )
      insights.push({ title: text.title, description: text.description, icon: Percent, severity: 'warning' })
    }
    if (kpis.todayProfit < 0 && kpis.todayRevenue > 0) {
      const text = insightText(lang,
        { title: `⚠️ Selling at a LOSS today`, description: `Today's profit is negative (${formatINR(kpis.todayProfit)}). You're selling below cost price. Review your prices immediately.` },
        { title: `⚠️ आज घाटे में बिक्री हो रही है`, description: `आज का प्रॉफिट नेगेटिव है (${formatINR(kpis.todayProfit)})। आप कीमत से कम में बेच रहे हैं। तुरंत दाम जांचें।` },
      )
      insights.push({ title: text.title, description: text.description, icon: TrendingDown, severity: 'critical' })
    }
    if (kpis.profitGrowth < -10) {
      const text = insightText(lang,
        { title: `📉 Profit down ${kpis.profitGrowth.toFixed(1)}% vs last period`, description: `Your profit has dropped significantly. Check if costs have increased or if you're discounting too much.` },
        { title: `📉 पिछले महीने से प्रॉफिट ${Math.abs(kpis.profitGrowth).toFixed(0)}% कम है`, description: `प्रॉफिट काफी कम हो गया है। जांचें कि खर्च बढ़े हैं या ज्यादा छूट दे रहे हैं।` },
      )
      insights.push({ title: text.title, description: text.description, icon: TrendingDown, severity: 'warning' })
    }
  }

  // ─── 3. Sales Pattern Detection ──────────────────────────────
  if (salesTrend && salesTrend.length >= 7) {
    const weekdaySales = salesTrend.filter((d: any) => {
      const day = new Date(d.date || d.label).getDay()
      return day >= 1 && day <= 5
    })
    const weekendSales = salesTrend.filter((d: any) => {
      const day = new Date(d.date || d.label).getDay()
      return day === 0 || day === 6
    })

    const avgWeekday = weekdaySales.length > 0
      ? weekdaySales.reduce((s: number, d: any) => s + (d.revenue || 0), 0) / weekdaySales.length
      : 0
    const avgWeekend = weekendSales.length > 0
      ? weekendSales.reduce((s: number, d: any) => s + (d.revenue || 0), 0) / weekendSales.length
      : 0

    if (avgWeekend > avgWeekday * 1.3 && avgWeekday > 0) {
      const pct = ((avgWeekend / avgWeekday - 1) * 100).toFixed(0)
      const text = insightText(lang,
        { title: `🗓️ Weekends bring ${pct}% more sales`, description: `Weekend avg: ${formatINRCompact(avgWeekend)} vs weekday: ${formatINRCompact(avgWeekday)}. Consider stocking up before weekends.` },
        { title: `🗓️ वीकेंड में ${pct}% ज्यादा बिक्री होती है`, description: `वीकेंद औसत: ${formatINRCompact(avgWeekend)} vs वर्कडे: ${formatINRCompact(avgWeekday)}। वीकेंड से पहले स्टॉक बढ़ाएं।` },
      )
      insights.push({ title: text.title, description: text.description, icon: Calendar, severity: 'info' })
    }

    const lastSale = recentTransactions?.find((t: any) => t.type === 'sale')
    if (lastSale) {
      const daysSinceLastSale = Math.floor((Date.now() - new Date(lastSale.date).getTime()) / (1000 * 60 * 60 * 24))
      if (daysSinceLastSale >= 3) {
        const text = insightText(lang,
          { title: `🔕 No sales in ${daysSinceLastSale} days`, description: `It's been ${daysSinceLastSale} days since your last sale. Consider reaching out to regular customers or running a promotion.` },
          { title: `🔕 ${daysSinceLastSale} दिन से कोई बिक्री नहीं`, description: `${daysSinceLastSale} दिन से कोई बिक्री नहीं हुई। नियमित ग्राहकों को संपर्क करें या ऑफर चलाएं।` },
        )
        insights.push({ title: text.title, description: text.description, icon: ShoppingCart, severity: daysSinceLastSale >= 7 ? 'critical' : 'warning' })
      }
    }
  }

  // ─── 4. Customer Credit Risk ─────────────────────────────────
  if (kpis && kpis.totalReceivable > 0) {
    const receivablePct = kpis.rangeRevenue > 0 ? (kpis.totalReceivable / kpis.rangeRevenue) * 100 : 0
    if (receivablePct > 30) {
      const text = insightText(lang,
        { title: `💰 Customers owe you ${formatINR(kpis.totalReceivable)}`, description: `That's ${receivablePct.toFixed(0)}% of your total revenue. Consider sending payment reminders via WhatsApp.`, actionLabel: 'Send Reminders' },
        { title: `💰 ग्राहकों को ${formatINR(kpis.totalReceivable)} बकाया है`, description: `यह आपकी कुल बिक्री का ${receivablePct.toFixed(0)}% है। WhatsApp पर रिमाइंडर भेजने पर विचार करें।`, actionLabel: 'रिमाइंडर भेजें' },
      )
      insights.push({
        title: text.title,
        description: text.description,
        icon: User,
        severity: receivablePct > 50 ? 'critical' : 'warning',
        action: {
          label: text.actionLabel || 'Send Reminders',
          onClick: () => {
            useAppStore.getState().setPreviousView('dashboard')
            useAppStore.getState().setView('parties')
          },
        },
      })
    }
  }

  // ─── Positive insight ────────────────────────────────────────
  if (kpis && kpis.revenueGrowth > 20) {
    const text = insightText(lang,
      { title: `🚀 Revenue up ${kpis.revenueGrowth.toFixed(0)}% vs last period`, description: `Great work! Your revenue is trending up significantly. Keep up the momentum.` },
      { title: `🚀 पिछले महीने से ${kpis.revenueGrowth.toFixed(0)}% ज्यादा बिक्री`, description: `शाबाश! आपकी बिक्री तेजी से बढ़ रही है। यही रफ्तार रखें!` },
    )
    insights.push({ title: text.title, description: text.description, icon: TrendingUp, severity: 'positive' })
  }

  return insights
}

// ─── Dashboard data hook (reuses existing query) ─────────────────
// 🔒 PERFORMANCE FIX (auditor P0): Use the shared useDashboardThisMonth hook.
// Was: separate useQuery with different key → extra API call.
// Now: shares the exact same cache entry as Dashboard.tsx → zero extra calls.
import { useDashboardThisMonth } from '@/hooks/use-dashboard'

function useDashboardData() {
  return useDashboardThisMonth()
}

