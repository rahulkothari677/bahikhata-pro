'use client'

import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  AlertCircle, AlertTriangle, Info, CheckCircle, Sparkles,
  TrendingUp, Package, Users, IndianRupee, Bell,
} from 'lucide-react'

const typeConfig = {
  critical: { icon: AlertCircle, color: 'text-rose-600', bg: 'bg-rose-100 dark:bg-rose-950/50', border: 'border-rose-200' },
  warning: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-100 dark:bg-amber-950/50', border: 'border-amber-200' },
  info: { icon: Info, color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-950/50', border: 'border-blue-200' },
  success: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-950/50', border: 'border-emerald-200' },
}

const categoryIcon = {
  stock: Package,
  dues: Users,
  profit: TrendingUp,
  sales: IndianRupee,
}

export function SmartInsights() {
  const { setView, setPreviousView, setSelectedPartyId, refreshKey } = useAppStore()

  const { data, isLoading } = useQuery({
    queryKey: ['insights', refreshKey],
    queryFn: async () => {
      const r = await fetch('/api/insights')
      return r.json()
    },
  })

  if (isLoading) {
    return (
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Smart Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full rounded-xl" />
        </CardContent>
      </Card>
    )
  }

  const insights: any[] = data?.insights || []
  const summary = data?.summary

  if (insights.length === 0) {
    return (
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Smart Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <CheckCircle className="w-10 h-10 mx-auto text-emerald-500 mb-2" />
            <p className="text-sm font-medium">All clear!</p>
            <p className="text-xs text-muted-foreground mt-1">No alerts — your business is running smoothly.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const handleAction = (insight: any) => {
    if (insight.action === 'reorder') {
      setPreviousView('dashboard')
      setView('new-purchase')
    } else if (insight.action === 'remind' && insight.partyId) {
      setSelectedPartyId(insight.partyId)
      setPreviousView('dashboard')
      setView('party-profile')
    } else if (insight.action === 'reports') {
      setView('reports')
    } else if (insight.action === 'inventory') {
      setView('inventory')
    }
  }

  return (
    <Card className="shadow-card border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Smart Insights
            <Badge variant="secondary" className="text-[10px]">{summary?.total || 0}</Badge>
          </CardTitle>
          <div className="flex items-center gap-1">
            {summary?.critical > 0 && (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <AlertCircle className="w-2.5 h-2.5" /> {summary.critical}
              </Badge>
            )}
            {summary?.warnings > 0 && (
              <Badge className="bg-amber-100 dark:bg-amber-950/50 text-amber-700 text-[10px] gap-1">
                <AlertTriangle className="w-2.5 h-2.5" /> {summary.warnings}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {insights.slice(0, 6).map((insight) => {
            const config = typeConfig[insight.type as keyof typeof typeConfig]
            const TypeIcon = config.icon
            const CatIcon = categoryIcon[insight.category as keyof typeof categoryIcon] || Bell

            return (
              <div
                key={insight.id}
                className={cn('rounded-lg border p-3 flex items-start gap-3', config.border, config.bg)}
              >
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-background')}>
                  <CatIcon className={cn('w-4 h-4', config.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{insight.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{insight.description}</p>
                  {insight.action && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 mt-2 text-[11px] gap-1"
                      onClick={() => handleAction(insight)}
                    >
                      {insight.actionLabel}
                    </Button>
                  )}
                </div>
                <TypeIcon className={cn('w-4 h-4 flex-shrink-0', config.color)} />
              </div>
            )
          })}
          {insights.length > 6 && (
            <p className="text-center text-[11px] text-muted-foreground py-2">
              +{insights.length - 6} more insights
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
