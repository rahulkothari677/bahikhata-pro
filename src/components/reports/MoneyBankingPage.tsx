'use client'

/**
 * MoneyBankingPage — dedicated Money & Banking page.
 *
 * 🔒 V22-2 (Phase 2b): Splits banking/money features out of Reports + More.
 * Shows Bank Reconciliation, Income & Expense, Day-End Summary, and
 * WhatsApp Reminders as a grid of cards.
 */

import { useAppStore } from '@/store/app-store'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, Banknote, Wallet, Repeat, Send,
  ChevronRight, TrendingUp,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ViewType } from '@/store/app-store'

interface MoneyTool {
  icon: LucideIcon
  label: string
  description: string
  view: ViewType
  reportType?: string
  iconColor: string
  iconBg: string
}

const MONEY_TOOLS: MoneyTool[] = [
  {
    icon: Banknote,
    label: 'Bank Reconciliation',
    description: 'Import bank statement & match transactions',
    view: 'reports',
    reportType: 'bank-recon',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-950',
  },
  {
    icon: Wallet,
    label: 'Income & Expense',
    description: 'Record rent, salary, electricity, other income',
    view: 'income-expense',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-950',
  },
  {
    icon: Repeat,
    label: 'Day-End Summary',
    description: 'Close the drawer — daily cash reconciliation',
    view: 'dashboard',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-950',
  },
  {
    icon: Send,
    label: 'WhatsApp Reminders',
    description: 'Send payment reminders to customers with dues',
    view: 'parties',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-950',
  },
  {
    icon: TrendingUp,
    label: 'P&L Statement',
    description: 'Profit & Loss report — know your real profit',
    view: 'reports',
    reportType: 'pl',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-950',
  },
]

export function MoneyBankingPage() {
  const { setView, previousView, setPreviousView } = useAppStore()

  const handleBack = () => {
    haptic.click()
    setView(previousView || 'more')
    setPreviousView(null)
  }

  const handleToolClick = (tool: MoneyTool) => {
    haptic.click()
    setPreviousView('money-banking')
    if (tool.reportType) {
      // 🔒 V22-2 fix: Set pendingReportType so Reports opens on that specific
      // report type AND hides all other tabs (singleReportType mode).
      useAppStore.getState().setPendingReportType(tool.reportType)
      setView('reports')
    } else {
      setView(tool.view)
    }
  }

  return (
    <div className="min-h-screen bg-muted/30 w-full flex-1">
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={handleBack} className="p-2 -ml-2 rounded-lg hover:bg-muted">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-bold">Money & Banking</h2>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3 pb-24"
           style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>

        {/* Banner */}
        <div className="bg-gradient-to-r from-emerald-500 to-emerald-700 rounded-2xl p-4 text-white shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Banknote className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-base">Money Management</p>
              <p className="text-sm text-white/80">Banking, income, expenses & reminders</p>
            </div>
          </div>
        </div>

        {/* Tools grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {MONEY_TOOLS.map((tool) => {
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
      </div>
    </div>
  )
}
