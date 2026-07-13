'use client'

/**
 * GstTaxPage — dedicated GST & Tax page.
 *
 * 🔒 V22-2 (Phase 2a): Splits GST features out of the Reports page.
 * Instead of having GSTR-1, GSTR-3B, GSTR-2B, E-Invoicing, Period Lock,
 * and Reconciliation buried as tabs inside Reports, this page gives them
 * their own dedicated entry point in the More → GST & Tax section.
 *
 * Layout: grid of cards, each linking to the specific report/tool.
 * Inspired by PhonePe's categorized service grid + BharatPe's GST tools.
 */

import { useAppStore } from '@/store/app-store'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { haptic } from '@/lib/haptic'
import { offlineFetch } from '@/lib/offline-fetch'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, FileText, FileCheck, ShieldCheck, Lock,
  FileSpreadsheet, TrendingUp, ChevronRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface GstTool {
  icon: LucideIcon
  label: string
  description: string
  reportType?: string
  view?: 'reports' | 'settings'
  iconColor: string
  iconBg: string
  badge?: string
}

const GST_TOOLS: GstTool[] = [
  {
    icon: FileText,
    label: 'GSTR-1',
    description: 'Export outward supplies return for GST portal',
    reportType: 'gstr-1',
    view: 'reports',
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-950',
  },
  {
    icon: FileCheck,
    label: 'GSTR-3B',
    description: 'Monthly summary return — auto-computed from your data',
    reportType: 'gstr-3b',
    view: 'reports',
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-950',
  },
  {
    icon: FileCheck,
    label: 'GSTR-2B Reconciliation',
    description: 'Import 2B JSON & match against your purchase books',
    reportType: 'gstr-2b',
    view: 'reports',
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-950',
  },
  {
    icon: ShieldCheck,
    label: 'Reconciliation Health Check',
    description: 'One-tap check — do your books tie out?',
    reportType: 'reconciliation',
    view: 'reports',
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-950',
  },
  {
    icon: Lock,
    label: 'Period Lock',
    description: 'Lock filed GST periods to prevent edits',
    view: 'settings',
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-950',
  },
  {
    icon: FileSpreadsheet,
    label: 'GST Summary Report',
    description: 'Tax liability breakdown by slab (5/12/18/28%)',
    reportType: 'gst',
    view: 'reports',
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-950',
  },
]

export function GstTaxPage() {
  const { setView, previousView, setPreviousView } = useAppStore()
  const { canAccess } = useStaffPermissions()

  const handleBack = () => {
    haptic.click()
    setView(previousView || 'more')
    setPreviousView(null)
  }

  const handleToolClick = (tool: GstTool) => {
    haptic.click()
    setPreviousView('gst-tax')
    if (tool.reportType && tool.view === 'reports') {
      // Navigate to Reports with the specific report type
      // We store the desired report type in the store so Reports can read it
      useAppStore.getState().setPendingDateRange({
        from: '',
        to: '',
        preset: tool.reportType,
      })
      setView('reports')
    } else if (tool.view === 'settings') {
      useAppStore.getState().setAccountOriginView('gst-tax')
      useAppStore.getState().setView('account')
      useAppStore.getState().setAccountSection('data')
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 w-full flex-1">
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={handleBack} className="p-2 -ml-2 rounded-lg hover:bg-muted">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-bold">GST & Tax</h2>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3 pb-24"
           style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>

        {/* Quick stats banner */}
        <div className="bg-gradient-to-r from-blue-500 to-blue-700 rounded-2xl p-4 text-white shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <FileText className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-base">GST Compliance Center</p>
              <p className="text-sm text-white/80">File returns, reconcile ITC, lock periods</p>
            </div>
          </div>
        </div>

        {/* GST Tools grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {GST_TOOLS.map((tool, i) => {
            const Icon = tool.icon
            return (
              <button
                key={tool.label}
                onClick={() => handleToolClick(tool)}
                className="bg-card rounded-2xl shadow-sm border border-border/60 p-4 text-left hover:shadow-md transition active:scale-[0.98] group"
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition group-hover:scale-105',
                    tool.iconBg
                  )}>
                    <Icon className={cn('w-5 h-5', tool.iconColor)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{tool.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{tool.description}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition flex-shrink-0 mt-1" />
                </div>
              </button>
            )
          })}
        </div>

        {/* Info note */}
        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl p-4 border border-blue-200 dark:border-blue-900">
          <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
            💡 <strong>Tip:</strong> File GSTR-1 by the 11th and GSTR-3B by the 20th of each month.
            Use Period Lock after filing to prevent accidental edits to filed data.
          </p>
        </div>
      </div>
    </div>
  )
}
