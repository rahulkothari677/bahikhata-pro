'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft, RefreshCw, TrendingUp, Clock, Coins, Zap, AlertCircle, DollarSign, Activity } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { offlineFetch } from '@/lib/offline-fetch'
import { formatCostInr } from '@/lib/ai-pricing'

interface PeriodStats {
  calls: number
  successCount: number
  failCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costInr: number
  avgDurationMs: number
}

interface UsageData {
  periods: {
    today: PeriodStats
    week: PeriodStats
    month: PeriodStats
    allTime: PeriodStats
  }
  featureBreakdown: Record<string, PeriodStats>
  providerBreakdown: Record<string, PeriodStats & { models: string[] }>
  recentCalls: Array<{
    id: string
    feature: string
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    costInr: number
    costDisplay: string
    durationMs: number
    success: boolean
    errorMessage: string | null
    createdAt: string
  }>
  currentPricing: {
    provider: string
    model: string
    inputPer1M: number
    outputPer1M: number
    inputPer1MInr: number
    outputPer1MInr: number
    usdToInr: number
  }
}

export function AIUsage() {
  const { setView } = useAppStore()

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['ai-usage'],
    queryFn: async () => {
      const r = await offlineFetch('/api/ai-usage')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed to fetch')
      return d as UsageData
    },
    refetchInterval: 30000, // auto-refresh every 30s
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Loading AI usage data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-4">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">Failed to load AI usage</span>
          </div>
          <p className="text-sm text-red-600 dark:text-red-500 mt-1">{String(error)}</p>
          <p className="text-xs text-red-500 dark:text-red-400 mt-2">
            Note: This dashboard is only accessible to founder accounts.
          </p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const fmt = (n: number) => n.toLocaleString('en-IN')
  const fmtCost = (inr: number) => formatCostInr(inr)

  return (
    <div className="space-y-6 p-4 lg:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        {/* 🔒 V26 FIX N8: was hardcoded setView('account') — wrong whenever the
            user arrived from Sidebar → Tools (desktop) or More (mobile). Now
            returns to wherever they actually came from. */}
        <button
          onClick={() => {
            const prev = useAppStore.getState().previousView
            useAppStore.getState().setPreviousView(null)
            setView(prev || 'dashboard')
          }}
          aria-label="Go back"
          className="p-2 -ml-2 rounded-lg hover:bg-muted"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Coins className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            AI Usage & Cost Dashboard
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time token usage and cost tracking for all AI calls
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {/* Current Pricing Card */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            Active Provider & Pricing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Provider</p>
              <p className="font-bold capitalize">{data.currentPricing.provider}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Model</p>
              <p className="font-bold font-mono text-xs">{data.currentPricing.model}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Input (per 1M tokens)</p>
              <p className="font-bold">₹{data.currentPricing.inputPer1MInr.toFixed(2)}</p>
              <p className="text-3xs text-muted-foreground">${data.currentPricing.inputPer1M} USD</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Output (per 1M tokens)</p>
              <p className="font-bold">₹{data.currentPricing.outputPer1MInr.toFixed(2)}</p>
              <p className="text-3xs text-muted-foreground">${data.currentPricing.outputPer1M} USD</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Period Stats — 4 cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <PeriodCard
          label="Today"
          stats={data.periods.today}
          highlight
        />
        <PeriodCard label="This Week" stats={data.periods.week} />
        <PeriodCard label="This Month" stats={data.periods.month} />
        <PeriodCard label="All Time" stats={data.periods.allTime} />
      </div>

      {/* Per-Feature Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-600" />
            This Month — By Feature
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(data.featureBreakdown).map(([feature, stats]) => (
              <div key={feature} className="rounded-lg border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm capitalize">{feature.replace('-', ' ')}</span>
                  <Badge variant="outline">{stats.calls} calls</Badge>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tokens</span>
                    <span className="font-mono">{fmt(stats.totalTokens)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cost</span>
                    <span className="font-bold text-amber-700 dark:text-amber-400">{fmtCost(stats.costInr)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg time</span>
                    <span>{stats.avgDurationMs}ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Success rate</span>
                    <span className={stats.calls > 0 && stats.successCount / stats.calls < 0.9 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
                      {stats.calls > 0 ? `${((stats.successCount / stats.calls) * 100).toFixed(0)}%` : '—'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Per-Provider Breakdown */}
      {Object.keys(data.providerBreakdown).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-violet-600" />
              This Month — By Provider
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(data.providerBreakdown).map(([provider, stats]) => (
                <div key={provider} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm capitalize">{provider}</span>
                    <Badge variant="outline">{stats.calls}</Badge>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div>
                      <span className="text-muted-foreground">Models: </span>
                      <span className="font-mono">{stats.models.join(', ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tokens</span>
                      <span className="font-mono">{fmt(stats.totalTokens)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cost</span>
                      <span className="font-bold text-amber-700 dark:text-amber-400">{fmtCost(stats.costInr)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Calls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Recent AI Calls (last 20)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentCalls.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No AI calls yet. Scan a bill or use voice entry to see data here.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {data.recentCalls.map((call) => (
                <div
                  key={call.id}
                  className={`flex items-center gap-3 p-2 rounded-lg text-xs ${
                    call.success ? 'bg-muted/30' : 'bg-red-50 dark:bg-red-950/20'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${call.success ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">{call.feature.replace('-', ' ')}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="capitalize text-muted-foreground">{call.provider}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-mono text-3xs text-muted-foreground truncate">{call.model}</span>
                    </div>
                    {!call.success && call.errorMessage && (
                      <p className="text-red-600 dark:text-red-400 text-3xs mt-0.5 truncate">
                        {call.errorMessage}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-mono">{fmt(call.totalTokens)} tokens</div>
                    <div className="font-bold text-amber-700 dark:text-amber-400">{call.costDisplay}</div>
                  </div>
                  <div className="text-right flex-shrink-0 text-muted-foreground">
                    <div>{call.durationMs}ms</div>
                    <div className="text-3xs">
                      {new Date(call.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cost Projection */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-600" />
            Cost Projection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">If usage stays at today's rate</p>
              <p className="font-bold text-lg">{fmtCost(data.periods.today.costInr * 30)}</p>
              <p className="text-3xs text-muted-foreground">projected monthly cost</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">At 1,000 active users (your usage)</p>
              <p className="font-bold text-lg">{fmtCost(data.periods.month.costInr * 1000)}</p>
              <p className="text-3xs text-muted-foreground">projected monthly cost at scale</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg cost per AI call</p>
              <p className="font-bold text-lg">
                {data.periods.month.calls > 0
                  ? fmtCost(data.periods.month.costInr / data.periods.month.calls)
                  : '—'}
              </p>
              <p className="text-3xs text-muted-foreground">this month average</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function PeriodCard({ label, stats, highlight }: { label: string; stats: PeriodStats; highlight?: boolean }) {
  const fmt = (n: number) => n.toLocaleString('en-IN')
  const fmtCost = (inr: number) => formatCostInr(inr)

  return (
    <Card className={highlight ? 'border-primary/30 bg-primary/5' : ''}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
          <Badge variant="outline" className="text-3xs">{stats.calls} calls</Badge>
        </div>
        <div className="space-y-1">
          <div>
            <p className="text-3xs text-muted-foreground">Total cost</p>
            <p className={`font-bold text-lg ${highlight ? 'text-primary' : ''}`}>
              {fmtCost(stats.costInr)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1 text-2xs">
            <div>
              <span className="text-muted-foreground">In: </span>
              <span className="font-mono">{fmt(stats.inputTokens)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Out: </span>
              <span className="font-mono">{fmt(stats.outputTokens)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total: </span>
              <span className="font-mono font-bold">{fmt(stats.totalTokens)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Avg: </span>
              <span>{stats.avgDurationMs}ms</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
