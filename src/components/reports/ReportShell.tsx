'use client'

/**
 * 🔒 AUDIT V23 FIX §9.2 — ReportShell
 *
 * Reusable shell for report pages: title, period picker, export button,
 * truncation banner, loading skeleton, empty state.
 *
 * Every new report should render inside this shell for visual consistency.
 * Old reports can be migrated incrementally.
 *
 * Usage:
 * <ReportShell
 *   title="Bill-wise Profit"
 *   data={data}
 *   isLoading={isLoading}
 *   error={error}
 *   onExport={handleCSVExport}
 *   dateRange={dateRange}
 *   onDateChange={handleDateChange}
 * >
 *   <BillWiseProfit data={data} />
 * </ReportShell>
 */

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DateRangePicker, getPresetRange, type DateRange, type DatePreset } from '@/components/common/DateRangePicker'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, Calendar, Download, Printer, Loader2, AlertTriangle } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'

interface ReportShellProps {
  title: string
  subtitle?: string
  data: any
  isLoading: boolean
  error: Error | null
  onExport?: () => void
  onBack?: () => void
  dateRange?: DateRange
  onDateChange?: (range: DateRange, preset: DatePreset) => void
  datePreset?: DatePreset
  onPresetChange?: (preset: DatePreset) => void
  showExport?: boolean
  showDateRange?: boolean
  children: React.ReactNode
}

export function ReportShell({
  title,
  subtitle,
  data,
  isLoading,
  error,
  onExport,
  onBack,
  dateRange,
  onDateChange,
  datePreset,
  onPresetChange,
  showExport = true,
  showDateRange = true,
  children,
}: ReportShellProps) {
  const truncated = data?.truncated === true

  return (
    <div className="space-y-4">
      {/* Title + back button */}
      {onBack && (
        <div className="flex items-center gap-3 no-print">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-lg hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      )}

      {/* Truncation warning */}
      {truncated && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 border-2 border-rose-300 dark:border-rose-700 p-4 no-print">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-rose-800 dark:text-rose-300 text-sm">
                This report is INCOMPLETE — do not file or rely on these numbers
              </h3>
              <p className="text-xs text-rose-700 dark:text-rose-400 mt-1">
                {data.truncatedHint || 'The selected period has too many transactions. Narrow the date range to get complete figures.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Period selector + export toolbar */}
      {showDateRange && dateRange && onDateChange && (
        <Card className="shadow-card border-border/60 no-print">
          <CardContent className="p-3 lg:p-4">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Report Period:</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <DateRangePicker value={dateRange} onChange={onDateChange} preset={datePreset || 'thisMonth'} onPresetChange={onPresetChange || (() => {})} align="right" />
                {showExport && onExport && (
                  <Button
                    size="touch"
                    variant="outline"
                    onClick={onExport}
                    disabled={isLoading || !data}
                    className="gap-2 lg:h-9"
                  >
                    <Download className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                    <span className="hidden sm:inline">CSV</span>
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content: loading / error / data */}
      {error ? (
        <ReportError message={error.message} />
      ) : isLoading || !data ? (
        <ReportSkeleton />
      ) : (
        children
      )}
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
        <Loader2 className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 animate-pulse" />
        <span>Waking up your shop... this takes a few seconds on first load.</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  )
}

function ReportError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mb-3">
        <AlertTriangle className="w-6 h-6 text-rose-600" />
      </div>
      <h3 className="font-semibold text-slate-800 mb-1">Couldn't load report</h3>
      <p className="text-sm text-slate-500 max-w-sm mb-4">{message || 'The database might be warming up.'}</p>
    </div>
  )
}
