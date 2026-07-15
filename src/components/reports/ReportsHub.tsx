'use client'

/**
 * 🔒 V22-5 (Phase 3) — ReportsHub
 *
 * Vyapar-style categorized grid of all available reports. Replaces the cramped
 * 11-tab horizontal scroll bar that was hard to browse on mobile.
 *
 * Layout:
 *   1. Page title "Reports" + subtitle
 *   2. Four categorized sections, each with its own accent color:
 *      - Financial Reports (rose)
 *      - GST & Tax (blue)
 *      - Inventory & Stock (amber)
 *      - Banking & Reconciliation (emerald)
 *   3. Each report is a tappable card with icon, name, description
 *
 * Behavior:
 *   - Tapping a card sets pendingReportType + previousView='reports'
 *   - Reports.tsx re-renders in single-report mode showing just that report
 *   - Back button on the report page returns to this hub
 *
 * Inspired by: Vyapar's Reports screen, Khatabook's Reports grid,
 * QuickBooks' Reports center.
 */

import { useAppStore } from '@/store/app-store'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'
import {
  TrendingUp, Users, Clock, FileText, FileCheck, ShieldCheck,
  Receipt, Package, AlertTriangle, Banknote, Store,
  ChevronRight, BarChart3, Hash, Scale, Wallet,
  type LucideIcon,
} from 'lucide-react'

interface ReportCard {
  type: string
  icon: LucideIcon
  label: string
  description: string
  iconColor: string
  iconBg: string
}

interface ReportCategory {
  title: string
  titleIcon: LucideIcon
  accentColor: string  // Tailwind text color class for the title accent
  reports: ReportCard[]
}

const CATEGORIES: ReportCategory[] = [
  {
    title: 'Financial Reports',
    titleIcon: BarChart3,
    accentColor: 'text-rose-600 dark:text-rose-400',
    reports: [
      {
        type: 'pl',
        icon: TrendingUp,
        label: 'P&L Statement',
        description: 'Profit & loss — revenue, expenses, net profit',
        iconColor: 'text-rose-600 dark:text-rose-400',
        iconBg: 'bg-rose-100 dark:bg-rose-950',
      },
      {
        type: 'bill-profit',
        icon: FileText,
        label: 'Bill-wise Profit',
        description: 'Per-invoice profit breakdown with margin %',
        iconColor: 'text-rose-600 dark:text-rose-400',
        iconBg: 'bg-rose-100 dark:bg-rose-950',
      },
      {
        type: 'party',
        icon: Users,
        label: 'Party Statement',
        description: 'Customer & supplier balances, sales, purchases',
        iconColor: 'text-rose-600 dark:text-rose-400',
        iconBg: 'bg-rose-100 dark:bg-rose-950',
      },
      {
        type: 'debt-aging',
        icon: Clock,
        label: 'Debt Aging',
        description: 'Outstanding receivables by age bucket',
        iconColor: 'text-rose-600 dark:text-rose-400',
        iconBg: 'bg-rose-100 dark:bg-rose-950',
      },
      {
        type: 'trial-balance',
        icon: Scale,
        label: 'Trial Balance',
        description: 'Debit/credit balances — for CA accounting verification',
        iconColor: 'text-rose-600 dark:text-rose-400',
        iconBg: 'bg-rose-100 dark:bg-rose-950',
      },
    ],
  },
  {
    title: 'GST & Tax',
    titleIcon: FileText,
    accentColor: 'text-blue-600 dark:text-blue-400',
    reports: [
      {
        type: 'gstr-1',
        icon: FileText,
        label: 'GSTR-1',
        description: 'Outward supplies return — file monthly with GST portal',
        iconColor: 'text-blue-600 dark:text-blue-400',
        iconBg: 'bg-blue-100 dark:bg-blue-950',
      },
      {
        type: 'gstr-3b',
        icon: FileCheck,
        label: 'GSTR-3B',
        description: 'Monthly summary return — output tax vs input credit',
        iconColor: 'text-blue-600 dark:text-blue-400',
        iconBg: 'bg-blue-100 dark:bg-blue-950',
      },
      {
        type: 'gstr-2b',
        icon: ShieldCheck,
        label: 'GSTR-2B Reconciliation',
        description: 'Match purchase ITC with auto-generated GSTR-2B',
        iconColor: 'text-blue-600 dark:text-blue-400',
        iconBg: 'bg-blue-100 dark:bg-blue-950',
      },
      {
        type: 'gst',
        icon: Receipt,
        label: 'GST Summary',
        description: 'Tax liability by slab — 5/12/18/28%',
        iconColor: 'text-blue-600 dark:text-blue-400',
        iconBg: 'bg-blue-100 dark:bg-blue-950',
      },
      {
        type: 'hsn',
        icon: Hash,
        label: 'HSN Summary',
        description: 'HSN/SAC-wise tax summary for GSTR-1 filing',
        iconColor: 'text-blue-600 dark:text-blue-400',
        iconBg: 'bg-blue-100 dark:bg-blue-950',
      },
    ],
  },
  {
    title: 'Inventory & Stock',
    titleIcon: Package,
    accentColor: 'text-amber-600 dark:text-amber-400',
    reports: [
      {
        type: 'stock',
        icon: Package,
        label: 'Stock Report',
        description: 'Stock valuation, sale value, potential profit',
        iconColor: 'text-amber-600 dark:text-amber-400',
        iconBg: 'bg-amber-100 dark:bg-amber-950',
      },
      {
        type: 'inventory-aging',
        icon: AlertTriangle,
        label: 'Inventory Aging',
        description: 'Slow-moving & dead stock by age bucket',
        iconColor: 'text-amber-600 dark:text-amber-400',
        iconBg: 'bg-amber-100 dark:bg-amber-950',
      },
    ],
  },
  {
    title: 'Banking & Reconciliation',
    titleIcon: Banknote,
    accentColor: 'text-emerald-600 dark:text-emerald-400',
    reports: [
      {
        type: 'bank-recon',
        icon: Banknote,
        label: 'Bank Reconciliation',
        description: 'Match bank statement with recorded transactions',
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        iconBg: 'bg-emerald-100 dark:bg-emerald-950',
      },
      {
        type: 'cashflow',
        icon: Wallet,
        label: 'Cashflow Report',
        description: 'Cash inflow vs outflow by category',
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        iconBg: 'bg-emerald-100 dark:bg-emerald-950',
      },
      {
        type: 'consolidated',
        icon: Store,
        label: 'Consolidated Report',
        description: 'Multi-shop combined P&L, GST, stock',
        iconColor: 'text-emerald-600 dark:text-emerald-400',
        iconBg: 'bg-emerald-100 dark:bg-emerald-950',
      },
    ],
  },
]

export function ReportsHub() {
  const setPendingReportType = useAppStore(s => s.setPendingReportType)
  const setPreviousView = useAppStore(s => s.setPreviousView)

  const handleOpenReport = (type: string) => {
    haptic.click()
    // 🔒 Set previousView='reports' so the report's back button
    // returns to this hub (not to More or somewhere else).
    setPreviousView('reports')
    setPendingReportType(type)
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-bold">Reports</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Pick a report — each opens as its own page with filters &amp; export.
        </p>
      </div>

      {/* Categorized sections */}
      {CATEGORIES.map((category) => {
        const TitleIcon = category.titleIcon
        return (
          <div key={category.title}>
            <div className="flex items-center gap-2 px-1 mb-2">
              <TitleIcon className={cn('w-3.5 h-3.5', category.accentColor)} />
              <p className={cn(
                'text-xs font-semibold uppercase tracking-wider',
                category.accentColor,
              )}>
                {category.title}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {category.reports.map((report) => {
                const Icon = report.icon
                return (
                  <button
                    key={report.type}
                    onClick={() => handleOpenReport(report.type)}
                    className="group flex items-start gap-3 p-3 bg-card rounded-2xl border border-border/60 shadow-sm hover:shadow-md hover:border-primary/30 transition text-left active:bg-muted/50"
                  >
                    <div className={cn(
                      'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition group-hover:scale-105',
                      report.iconBg,
                    )}>
                      <Icon className={cn('w-5 h-5', report.iconColor)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-tight">{report.label}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {report.description}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition flex-shrink-0 mt-0.5" />
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Footer hint */}
      <div className="pt-2 pb-1 text-center">
        <p className="text-[11px] text-muted-foreground">
          Tip: use the date picker at the top of each report to change the period.
        </p>
      </div>
    </div>
  )
}
