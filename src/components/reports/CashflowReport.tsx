'use client'

/**
 * 🔒 V22-9 (Phase 7) — Cashflow Report
 *
 * Shows cash inflow vs outflow by category. Two columns: inflows (green) and
 * outflows (red). Net cashflow at the top.
 *
 * Self-contained: receives data as prop from Reports.tsx.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatINR, cn } from '@/lib/utils'
import { ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react'

interface CashflowReportProps {
  data: any
}

export function CashflowReport({ data }: CashflowReportProps) {
  const summary = data?.summary || { totalInflow: 0, totalOutflow: 0, netCashflow: 0 }
  const inflows = data?.inflows || []
  const outflows = data?.outflows || []

  const netPositive = summary.netCashflow >= 0

  return (
    <div className="space-y-4">
      {/* Net cashflow banner */}
      <Card className={cn(
        'shadow-card border-2 overflow-hidden',
        netPositive ? 'border-emerald-200 dark:border-emerald-800' : 'border-rose-200 dark:border-rose-800',
      )}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center',
                netPositive ? 'bg-emerald-100 dark:bg-emerald-950' : 'bg-rose-100 dark:bg-rose-950',
              )}>
                <Wallet className={cn(
                  'w-6 h-6',
                  netPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                )} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Net Cashflow</p>
                <p className={cn(
                  'text-2xl font-bold tabular-nums',
                  netPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                )}>
                  {netPositive ? '+' : ''}{formatINR(summary.netCashflow)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total Inflow</p>
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{formatINR(summary.totalInflow)}</p>
              <p className="text-xs text-muted-foreground mt-1">Total Outflow</p>
              <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">{formatINR(summary.totalOutflow)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Inflows & Outflows side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Inflows */}
        <Card className="shadow-card border-border/60 border-t-2 border-t-emerald-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowDownLeft className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Cash Inflows
            </CardTitle>
            <p className="text-xs text-muted-foreground">Money received</p>
          </CardHeader>
          <CardContent>
            {inflows.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">No inflows in this period</p>
            ) : (
              <div className="space-y-2">
                {inflows.map((item: any, i: number) => {
                  const pct = summary.totalInflow > 0 ? (item.amount / summary.totalInflow) * 100 : 0
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{item.label}</span>
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                          +{formatINR(item.amount)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-500"
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                      <p className="text-3xs text-muted-foreground mt-0.5">{pct.toFixed(1)}% of inflow</p>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Outflows */}
        <Card className="shadow-card border-border/60 border-t-2 border-t-rose-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              Cash Outflows
            </CardTitle>
            <p className="text-xs text-muted-foreground">Money spent</p>
          </CardHeader>
          <CardContent>
            {outflows.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">No outflows in this period</p>
            ) : (
              <div className="space-y-2">
                {outflows.map((item: any, i: number) => {
                  const pct = summary.totalOutflow > 0 ? (item.amount / summary.totalOutflow) * 100 : 0
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{item.label}</span>
                        <span className="text-sm font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                          -{formatINR(item.amount)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-rose-400 to-red-500 transition-all duration-500"
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                      <p className="text-3xs text-muted-foreground mt-0.5">{pct.toFixed(1)}% of outflow</p>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
