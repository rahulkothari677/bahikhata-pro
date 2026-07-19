'use client'

import { useTranslation } from '@/hooks/use-translation'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { DateRangePicker, getPresetRange, type DateRange, type DatePreset } from '@/components/common/DateRangePicker'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { chartColors } from '@/lib/chart-theme'
import { formatINR, formatINRCompact, cn, formatDate } from '@/lib/utils'
import {
  FileBarChart, TrendingUp, Receipt, Package, Users, Calendar,
  ArrowDownRight, ArrowUpRight, IndianRupee, Percent, FileText,
  FileSpreadsheet, Loader2, Download, Printer, Clock, AlertTriangle, Info,
  AlertCircle, Coffee, FileCheck, Banknote, Store, ArrowLeft, Wallet,
} from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch } from '@/lib/offline-fetch'
import { exportPLReportCSV, exportGSTReportCSV, exportStockReportCSV, exportPartyReportCSV, exportBillWiseProfitCSV, exportItemWiseProfitCSV, exportHsnSummaryCSV, exportCashflowCSV, exportTrialBalanceCSV, exportDebtAgingCSV, exportInventoryAgingCSV } from '@/lib/csv-export'
import { exportToTally } from '@/lib/tally-export'
import { DebtAgingReport } from '@/components/reports/DebtAgingReport'
import { InventoryAgingReport } from '@/components/reports/InventoryAgingReport'
import { Gstr1Report } from '@/components/reports/Gstr1Report'
import { Gstr3bReport } from '@/components/reports/Gstr3bReport'
import { Gstr2bReconciliation } from '@/components/reports/Gstr2bReconciliation'
import { BankReconciliation } from '@/components/reports/BankReconciliation'
import { ConsolidatedReport } from '@/components/reports/ConsolidatedReport'
import { BillWiseProfit } from '@/components/reports/BillWiseProfit'
import { HsnSummary } from '@/components/reports/HsnSummary'
import { CashflowReport } from '@/components/reports/CashflowReport'
import { TrialBalance } from '@/components/reports/TrialBalance'
import { ItemWiseProfit } from '@/components/reports/ItemWiseProfit'
import { ReportsHub } from '@/components/reports/ReportsHub'
import { EmptyState } from '@/components/common/EmptyState'

const COLORS = ['oklch(0.62 0.18 42)', 'oklch(0.62 0.15 155)', 'oklch(0.72 0.16 80)', 'oklch(0.6 0.12 200)', 'oklch(0.65 0.22 15)', 'oklch(0.7 0.16 250)']

// 🔒 V22-2 fix: singleReportType prop — when set, hides ALL tab buttons
// and locks to that specific report. Used by GST & Tax and Money & Banking
// pages so each item opens ONLY its own report (not the full Reports page
// with 11 tabs).
//
// 🔒 V22-5 (Phase 3): When NOT in single-report mode, renders <ReportsHub />
// (Vyapar-style categorized grid) instead of the cramped 11-tab bar.
export function Reports({ singleReportType }: { singleReportType?: string }) {
  const { t } = useTranslation()
  const { features, setView } = useAppStore()
  // 🔒 V22-5: Subscribe to pendingReportType reactively so the ReportsHub
  // can switch to single-report mode WITHOUT remounting (no setView call).
  const pendingReportType = useAppStore(s => s.pendingReportType)
  const setPendingReportType = useAppStore(s => s.setPendingReportType)
  const [reportType, setReportType] = useState<'pl' | 'gst' | 'stock' | 'party' | 'debt-aging' | 'inventory-aging' | 'gstr-1' | 'gstr-3b' | 'gstr-2b' | 'bank-recon' | 'consolidated' | 'bill-profit' | 'hsn' | 'cashflow' | 'trial-balance' | 'item-profit'>(singleReportType as any || 'pl')
  const [dateRange, setDateRange] = useState<DateRange>(() => getPresetRange('thisMonth'))
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth')
  const [exportingGstr, setExportingGstr] = useState(false)
  // 🔒 V22-3 fix: Track whether we're in single-report mode (from prop OR store)
  const [isSingleReport, setIsSingleReport] = useState(!!singleReportType)

  // 🔒 V22-5: Read pendingReportType from store on mount AND whenever it changes.
  // This lets the ReportsHub switch to single-report mode without remounting
  // (no setView call needed — same currentView, just different pendingReportType).
  useEffect(() => {
    if (singleReportType) {
      setIsSingleReport(true)
      return // Don't override singleReportType mode
    }
    if (pendingReportType) {
      setReportType(pendingReportType as any)
      setIsSingleReport(true)
      setPendingReportType(null)  // Clear so next navigation can set a new type
    }
  }, [singleReportType, pendingReportType, setPendingReportType])

  const handleDateChange = (range: DateRange, preset: DatePreset) => {
    setDateRange(range)
    setDatePreset(preset)
  }

  const handleGstrExport = async () => {
    setExportingGstr(true)
    try {
      // 🔒 V6 SC1/PP1: Before downloading CSV, fetch the JSON to check truncated flag.
      // If truncated, hard-block the download with a loud warning — filing a
      // truncated GST return is a compliance risk.
      const checkR = await offlineFetch(`/api/gstr-export?from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}&format=json`)
      if (!checkR.ok) {
        const errBody = await checkR.json().catch(() => ({}))
        throw new Error(errBody.message || errBody.error || `Export check failed (HTTP ${checkR.status})`)
      }
      const checkData = await checkR.json()

      if (checkData.truncated) {
        sonnerToast.error('Cannot export GSTR-1 — too many invoices', {
          description: checkData.truncatedHint || 'The selected period has too many invoices. Split the period into smaller ranges (e.g. weekly) and re-run.',
          duration: 12000,
        })
        return  // Hard-block the CSV download
      }

      // 🔒 V8 L1: Block export if reconciliation fails (per-invoice taxable
      // != summary taxable). This means the GSTR is internally inconsistent
      // and should not be filed. The user should contact support.
      // 🔒 V10 FIX: matches === null means the reconciliation code itself
      // crashed (non-blocking). In that case, DON'T block the export — the
      // export data is still valid, we just couldn't verify it. Only block
      // when matches === false (explicit mismatch).
      if (checkData.reconciliation && checkData.reconciliation.matches === false) {
        sonnerToast.error('Cannot export GSTR-1 — data inconsistency detected', {
          description: `Per-invoice taxable (₹${checkData.reconciliation.perInvoiceTaxable}) does not match summary taxable (₹${checkData.reconciliation.summaryTaxable}). Please contact support before filing.`,
          duration: 15000,
        })
        return  // Hard-block the CSV download
      }

      // Not truncated — proceed with CSV download
      const r = await offlineFetch(`/api/gstr-export?from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}&format=csv`)
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}))
        throw new Error(errBody.message || errBody.error || `Export failed (HTTP ${r.status})`)
      }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // 🔒 FIX C14 (client-side): Was `dateRange.from.toISOString().slice(0, 7)`
      // which uses the UTC year-month of the `from` date. Since `from` = July 1
      // IST = June 30 UTC, this produced "2026-06" instead of "2026-07".
      // Now: computes the IST year-month of the `to` date (same as the server's
      // fp field). The `to` date is always within the intended filing month.
      const toIST = new Date(dateRange.to.getTime() + 5.5 * 60 * 60 * 1000)
      const toYearMonth = `${toIST.getUTCFullYear()}-${String(toIST.getUTCMonth() + 1).padStart(2, '0')}`
      a.download = `GSTR1_${toYearMonth}.csv`
      a.click()
      URL.revokeObjectURL(url)
      sonnerToast.success('GSTR-1 exported! Upload this to GST portal.')
    } catch (e: any) {
      sonnerToast.error('Failed to export GSTR-1', {
        description: e?.message || 'Unknown error. Check the date range — GSTR-1 requires a single-month period.',
        duration: 10000,
      })
    } finally {
      setExportingGstr(false)
    }
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['report', reportType, dateRange.from.toISOString(), dateRange.to.toISOString()],
    // 🔒 V22-5 (Phase 3): Only fetch when in single-report mode (not on ReportsHub).
    // Without the isSingleReport gate, the query would fire on the hub with
    // the default reportType='pl', wasting a request for data we never show.
    // 🔒 V22-9 (Phase 7): Added bill-profit, hsn, cashflow, trial-balance — these
    // DO use the API (unlike gstr-1/3b/2b/bank-recon/consolidated which have their own).
    enabled: isSingleReport && reportType !== 'gstr-1' && reportType !== 'gstr-3b' && reportType !== 'gstr-2b' && reportType !== 'bank-recon' && reportType !== 'consolidated',
    queryFn: async () => {
      // Debt aging uses party report data (includes transactions per party)
      // Inventory aging uses stock report data (includes products with createdAt)
      const apiType = reportType === 'debt-aging' ? 'party' : reportType === 'inventory-aging' ? 'stock' : reportType
      const r = await offlineFetch(`/api/reports?type=${apiType}&from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}`)
      const json = await r.json()
      // 🔒 V11 FIX: If the API returned an error response (e.g., 500 from a
      // DB timeout), throw so React Query's `error` state is set. Without
      // this, the component would receive `{ error: '...' }` as `data`,
      // which is truthy, so it would render <PLReport data={data} /> and
      // crash on `data.summary.totalRevenue` (summary is undefined).
      if (!r.ok || json.error) {
        throw new Error(json.error || json.message || `Request failed with status ${r.status}`)
      }
      return json
    },
    // 🔒 V11 FIX: Don't crash on query errors — show retry state.
    retry: 1,
    // 🔒 FIX M12: Keep previous data while refetching.
    placeholderData: keepPreviousData,
  })

  const periodLabel = `${formatDate(dateRange.from)} to ${formatDate(dateRange.to)}`

  const handleCSVExport = async () => {
    if (!data) {
      sonnerToast.error('Report data not loaded yet')
      return
    }
    // 🔒 V6 SC1/PP1: Hard-block CSV export if the report is truncated.
    // A truncated P&L or GST report is a compliance/trust risk — never let
    // the user export approximate tax figures silently.
    if (data.truncated === true) {
      sonnerToast.error('Cannot export — report is incomplete', {
        description: data.truncatedHint || 'The selected period has too many transactions. Narrow the date range and try again.',
        duration: 12000,
      })
      return
    }
    try {
      const toastId = sonnerToast.loading('Exporting CSV...')
      if (reportType === 'pl') await exportPLReportCSV(data, periodLabel)
      else if (reportType === 'gst') await exportGSTReportCSV(data, periodLabel)
      else if (reportType === 'stock') await exportStockReportCSV(data)
      else if (reportType === 'party') await exportPartyReportCSV(data)
      // 🔒 AUDIT V23 FIX §8.4: CSV export for new reports
      else if (reportType === 'bill-profit') await exportBillWiseProfitCSV(data, periodLabel)
      else if (reportType === 'item-profit') await exportItemWiseProfitCSV(data, periodLabel)
      else if (reportType === 'hsn') await exportHsnSummaryCSV(data, periodLabel)
      else if (reportType === 'cashflow') await exportCashflowCSV(data, periodLabel)
      else if (reportType === 'trial-balance') await exportTrialBalanceCSV(data, periodLabel)
      // 🔒 AUDIT V23 FIX §13.5: Add debt-aging + inventory-aging exports
      else if (reportType === 'debt-aging') await exportDebtAgingCSV(data, periodLabel)
      else if (reportType === 'inventory-aging') await exportInventoryAgingCSV(data)
      sonnerToast.success('CSV ready — save or share from the popup', { id: toastId })
    } catch (err: any) {
      sonnerToast.error('CSV export failed', {
        description: String(err?.message || err).slice(0, 200),
        duration: 10000,
      })
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const handleTallyExport = async () => {
    try {
      const toastId = sonnerToast.loading('Exporting Tally XML...')
      const r = await offlineFetch(`/api/transactions?limit=500`)
      const txnData = await r.json()
      // 🔒 AUDIT V24 §6.7: The endpoint caps at 500 rows. A shop with more
      // transactions was silently getting a TRUNCATED ledger in Tally — the
      // same class of quiet under-reporting the GST exports hard-block on.
      // Surface it loudly instead of pretending the export is complete.
      if (txnData.hasMore) {
        sonnerToast.warning('Tally export is limited to the latest 500 transactions', {
          id: toastId,
          description: 'Older transactions are NOT included in this file. Full-history export is coming; until then, import the rest from an earlier export or narrow your books in Tally accordingly.',
          duration: 12000,
        })
      }
      const setting = (await offlineFetch('/api/settings').then(r => r.json())).setting
      await exportToTally(txnData.transactions || [], setting, 'all')
      if (!txnData.hasMore) {
        sonnerToast.success('Tally XML ready — save or share from the popup', { id: toastId })
      }
    } catch (err: any) {
      sonnerToast.error('Failed to export Tally XML', {
        description: String(err?.message || err).slice(0, 200),
        duration: 10000,
      })
    }
  }

  // 🔒 V22-3 (Phase 1): Title + back button for single-report mode
  const reportTitles: Record<string, string> = {
    'gstr-1': 'GSTR-1 Report',
    'gstr-3b': 'GSTR-3B Report',
    'gstr-2b': 'GSTR-2B Reconciliation',
    'gst': 'GST Summary Report',
    'bank-recon': 'Bank Reconciliation',
    'pl': 'Profit & Loss Report',
    'stock': 'Stock Report',
    'party': 'Party Statement',
    'debt-aging': 'Debt Aging Report',
    'inventory-aging': 'Inventory Aging Report',
    'consolidated': 'Consolidated Report',
    'bill-profit': 'Bill-wise Profit Report',
    'hsn': 'HSN Summary Report',
    'cashflow': 'Cashflow Report',
    'trial-balance': 'Account Summary',
    'item-profit': 'Item-wise Profit Report',
  }
  const currentTitle = isSingleReport
    ? (reportTitles[reportType] || 'Report')
    : 'Reports'

  // 🔒 V22-5 (Phase 3): Back button — exits single-report mode.
  // If previousView is 'reports' (came from ReportsHub), stay on the reports
  // view but reset to hub mode. Otherwise navigate to previousView (e.g. 'more').
  // 🔒 AUDIT V25 FIX §2.3 (Batch 2 follow-up): Fallback was 'more' which
  // stranded desktop users on the mobile More screen. Now fallback is
  // 'dashboard' — always safe.
  const handleBackToHub = () => {
    const prev = useAppStore.getState().previousView
    setIsSingleReport(false)
    useAppStore.getState().setPreviousView(null)
    if (prev === 'reports') {
      // Stay on reports view — will render ReportsHub since isSingleReport is now false
      // No setView needed (currentView is already 'reports')
    } else {
      setView(prev || 'dashboard')
    }
  }

  return (
    <div className="space-y-4">
      {/* 🔒 V22-3 (Phase 1): Title + back button for single-report mode */}
      {isSingleReport && (
        <div className="flex items-center gap-3 no-print">
          <button
            onClick={handleBackToHub}
            className="p-2 -ml-2 rounded-lg hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold">{currentTitle}</h2>
          </div>
        </div>
      )}

      {/* 🔒 V6 SC1/PP1: Loud truncation warning banner.
          Shows when the report is truncated (data.truncated === true).
          Never let a user mistake an approximate tax/P&L figure for the real one.
          🔒 V22-5 (Phase 3): Only show when a report is actually being viewed
          (not on the ReportsHub grid). */}
      {isSingleReport && data?.truncated === true && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 border-2 border-rose-300 dark:border-rose-700 p-4 no-print">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-rose-800 dark:text-rose-300 text-sm">
                This report is INCOMPLETE — do not file or rely on these numbers
              </h3>
              <p className="text-xs text-rose-700 dark:text-rose-400 mt-1">
                {data.truncatedHint || 'The selected period has too many transactions to display. The numbers below cover only part of the range.'}
              </p>
              <p className="text-xs text-rose-700 dark:text-rose-400 mt-2 font-medium">
                → Narrow the date range (e.g. switch from "This Year" to "This Month") to get complete figures. Export is blocked until then.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Print-only header — visible only when printing.
          🔒 V22-5 (Phase 3): Only show when a report is actually being viewed. */}
      {isSingleReport && (
        <div className="hidden print:block mb-4 pb-3 border-b-2 border-black">
          {/* 🔒 AUDIT V23 FIX §13.5: Print header — was always 'Party Statement' for unknown types. */}
        <h1 className="text-2xl font-bold text-black capitalize">{
          reportType === 'pl' ? 'Profit & Loss Report'
          : reportType === 'gst' ? 'GST Report'
          : reportType === 'stock' ? 'Stock Report'
          : reportType === 'party' ? 'Party Statement'
          : reportType === 'debt-aging' ? 'Debt Aging Report'
          : reportType === 'inventory-aging' ? 'Inventory Aging Report'
          : reportType === 'bill-profit' ? 'Bill-wise Profit Report'
          : reportType === 'item-profit' ? 'Item-wise Profit Report'
          : reportType === 'hsn' ? 'HSN Summary Report'
          : reportType === 'cashflow' ? 'Cashflow Report'
          : reportType === 'trial-balance' ? 'Account Summary'
          : 'Report'
        }</h1>
          <p className="text-sm text-gray-700 mt-1">Period: {formatDate(dateRange.from)} to {formatDate(dateRange.to)}</p>
          <p className="text-xs text-gray-500 mt-0.5">Generated by EkBook on {formatDate(new Date())}</p>
        </div>
      )}

      {/* Period selector + export toolbar (hidden for reports that have their own month picker).
          🔒 V22-5 (Phase 3): Only show when a report is actually being viewed
          (not on the ReportsHub grid).
          🔒 V22-9 (Phase 7): bill-profit, hsn, cashflow, trial-balance DO use the
          date range toolbar (unlike gstr-1/3b/2b/bank-recon/consolidated). */}
      {isSingleReport && reportType !== 'gstr-1' && reportType !== 'gstr-3b' && reportType !== 'gstr-2b' && reportType !== 'bank-recon' && reportType !== 'consolidated' && (
      <Card className="shadow-card border-border/60 no-print">
        <CardContent className="p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Report Period:</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <DateRangePicker value={dateRange} onChange={handleDateChange} preset={datePreset} onPresetChange={setDatePreset} align="right" />
              <p className="text-xs text-muted-foreground hidden md:block">
                {formatDate(dateRange.from)} — {formatDate(dateRange.to)}
              </p>
              <Button
                size="touch"
                variant="outline"
                onClick={handleCSVExport}
                disabled={isLoading || !data}
                className="gap-2 lg:h-9"
                title="Export current report as CSV"
              >
                <Download className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                <span className="hidden sm:inline">CSV</span>
              </Button>
              <Button
                size="touch"
                variant="outline"
                onClick={handlePrint}
                className="gap-2 lg:h-9"
                title="Print or save as PDF"
              >
                <Printer className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                <span className="hidden sm:inline">Print</span>
              </Button>
              {features?.gstrExport && (
                <Button
                  size="touch"
                  variant="outline"
                  onClick={handleGstrExport}
                  disabled={exportingGstr}
                  className="gap-2 border-primary/30 text-primary hover:bg-primary/10 lg:h-9"
                >
                  {exportingGstr ? <Loader2 className="w-4 h-4 lg:w-3.5 lg:h-3.5 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 lg:w-3.5 lg:h-3.5" />}
                  <span className="hidden sm:inline">{t('reports.export_gstr')}</span>
                </Button>
              )}
              {/* Tally Export — generates XML for Tally import */}
              <Button
                size="touch"
                variant="outline"
                onClick={handleTallyExport}
                className="gap-2 lg:h-9"
                title="Export to Tally XML format"
              >
                <FileText className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
                <span className="hidden sm:inline">Tally</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* 🔒 V22-5 (Phase 3): Vyapar-style categorized grid of reports.
          Replaces the cramped 11-tab horizontal scroll bar that was hard to
          browse on mobile. Each card opens a dedicated report page. */}
      {!isSingleReport && (
        <ReportsHub />
      )}

      {/* 🔒 V22-3 fix: When in single-report mode, render the report DIRECTLY
          (not inside Tabs, which is hidden). This is why GSTR-1/GSTR-3B/etc.
          were blank — the TabsContent was inside the hidden Tabs block. */}
      {isSingleReport && (
        <>
          {reportType === 'pl' && (error ? <ReportError message={(error as Error).message} /> : isLoading || !data ? <ReportSkeleton /> : <PLReport data={data} />)}
          {reportType === 'gst' && (error ? <ReportError message={(error as Error).message} /> : isLoading || !data ? <ReportSkeleton /> : <GSTReport data={data} />)}
          {reportType === 'stock' && (error ? <ReportError message={(error as Error).message} /> : isLoading || !data ? <ReportSkeleton /> : <StockReport data={data} />)}
          {reportType === 'party' && (error ? <ReportError message={(error as Error).message} /> : isLoading || !data ? <ReportSkeleton /> : <PartyReport data={data} />)}
          {reportType === 'debt-aging' && (error ? <ReportError message={(error as Error).message} /> : isLoading || !data ? <ReportSkeleton /> : <DebtAgingReport data={data} />)}
          {reportType === 'inventory-aging' && (error ? <ReportError message={(error as Error).message} /> : isLoading || !data ? <ReportSkeleton /> : <InventoryAgingReport data={data} />)}
          {reportType === 'gstr-1' && <Gstr1Report />}
          {reportType === 'gstr-3b' && <Gstr3bReport />}
          {reportType === 'gstr-2b' && <Gstr2bReconciliation />}
          {reportType === 'bank-recon' && <BankReconciliation />}
          {reportType === 'consolidated' && <ConsolidatedReport />}
          {/* 🔒 V22-9 (Phase 7): 4 new reports */}
          {reportType === 'bill-profit' && (error ? <ReportError message={(error as Error).message} /> : isLoading || !data ? <ReportSkeleton /> : <BillWiseProfit data={data} />)}
          {reportType === 'hsn' && (error ? <ReportError message={(error as Error).message} /> : isLoading || !data ? <ReportSkeleton /> : <HsnSummary data={data} />)}
          {reportType === 'cashflow' && (error ? <ReportError message={(error as Error).message} /> : isLoading || !data ? <ReportSkeleton /> : <CashflowReport data={data} />)}
          {reportType === 'trial-balance' && (error ? <ReportError message={(error as Error).message} /> : isLoading || !data ? <ReportSkeleton /> : <TrialBalance data={data} />)}
          {/* 🔒 V22-12 (Batch B): Item-wise Profit report */}
          {reportType === 'item-profit' && (error ? <ReportError message={(error as Error).message} /> : isLoading || !data ? <ReportSkeleton /> : <ItemWiseProfit data={data} />)}
        </>
      )}
    </div>
  )
}

function PLReport({ data }: { data: any }) {
  const { t } = useTranslation()
  // 🔒 V11 FIX: Defensive destructuring with defaults.
  const summary = data?.summary || { totalRevenue: 0, grossProfit: 0, totalExpenses: 0, otherIncome: 0, netProfit: 0, profitMargin: 0 }
  const expensesByCategory = data?.expensesByCategory || []
  const incomeByCategory = data?.incomeByCategory || []
  return (
    <div className="space-y-4">
      {/* Top metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ReportStatCard label="Revenue (excl. GST)" value={formatINR(summary.totalRevenue)} icon={IndianRupee} color="text-amber-600 dark:text-amber-400" bg="bg-amber-100" />
        <ReportStatCard label="Gross Profit" value={formatINR(summary.grossProfit)} icon={TrendingUp} color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-100" />
        <ReportStatCard label="Total Expenses" value={formatINR(summary.totalExpenses)} icon={ArrowUpRight} color="text-rose-600" bg="bg-rose-100" />
        <ReportStatCard label="Net Profit" value={formatINR(summary.netProfit)} icon={Percent} color={summary.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'} bg={summary.netProfit >= 0 ? 'bg-emerald-100' : 'bg-rose-100'} />
      </div>

      {/* {t('reports.pl')} breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-rose-600" /> Expenses Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {expensesByCategory.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="No expenses in this period"
                description="Record rent, salary, electricity, or other business expenses to see them here."
                action={{ label: 'Add Expense', onClick: () => useAppStore.getState().setView('income-expense') }}
                color="rose"
                compact
              />
            ) : (
              <div className="space-y-2">
                {expensesByCategory.map((e, i) => {
                  const pct = summary.totalExpenses > 0 ? (e.value / summary.totalExpenses) * 100 : 0
                  return (
                    <div key={e.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium">{e.name}</span>
                        <span className="text-muted-foreground tabular-nums">{formatINR(e.value)} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-rose-400 to-rose-600 transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowDownRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Other Income
            </CardTitle>
          </CardHeader>
          <CardContent>
            {incomeByCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No other income in this period</p>
            ) : (
              <div className="space-y-2">
                {incomeByCategory.map((e, i) => {
                  const pct = summary.otherIncome > 0 ? (e.value / summary.otherIncome) * 100 : 0
                  return (
                    <div key={e.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium">{e.name}</span>
                        <span className="text-muted-foreground tabular-nums">{formatINR(e.value)}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary statement */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" /> Profit & Loss Statement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Revenue (Sales, excl. GST)</span>
              <span className="font-medium">{formatINR(summary.totalRevenue)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Less: Cost of Goods Sold</span>
              <span className="font-medium text-rose-600">-{formatINR(summary.totalRevenue - summary.grossProfit)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="font-semibold">Gross Profit</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatINR(summary.grossProfit)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Add: Other Income</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">+{formatINR(summary.otherIncome)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Less: Operating Expenses</span>
              <span className="font-medium text-rose-600">-{formatINR(summary.totalExpenses)}</span>
            </div>
            <div className="flex justify-between py-2 text-base">
              <span className="font-bold">Net Profit</span>
              <span className={cn('font-bold', summary.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600')}>
                {formatINR(summary.netProfit)}
              </span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Profit Margin</span>
              <span>{summary.profitMargin.toFixed(1)}%</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function GSTReport({ data }: { data: any }) {
  const { t } = useTranslation()
  // 🔒 V22-13 (Batch C, Phase 8f): Chart ↔ Table toggle for the slab summary.
  // 'table' = default table view, 'chart' = grouped bar chart view.
  const [slabView, setSlabView] = useState<'table' | 'chart'>('table')
  // 🔒 V11 FIX: Defensive destructuring with defaults. Was: `const { outputSales,
  // inputPurchases, netGSTPayable } = data` — if any field was undefined (e.g.,
  // partial API response, cache corruption, old cached data from a previous
  // deploy), the component crashed on `outputSales.outputTax`.
  const outputSales = data?.outputSales || { outputTax: 0, taxableValue: 0, bySlab: [] }
  const inputPurchases = data?.inputPurchases || { inputTax: 0, taxableValue: 0, bySlab: [] }
  const netGSTPayable = data?.netGSTPayable ?? 0
  return (
    <div className="space-y-4">
      {/* 🔒 V8 D5: Note about gt/cur_gt fields (gross turnover) */}
      <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-700 dark:text-blue-400 flex items-start gap-2">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">GSTR-1 Export Note</p>
          <p className="mt-1">
            The exported CSV includes invoice-level data (B2B/B2C sections) ready for the GST portal.
            Fields <code className="font-mono bg-blue-100 dark:bg-blue-900/50 px-1 rounded">gt</code> (gross turnover) and
            <code className="font-mono bg-blue-100 dark:bg-blue-900/50 px-1 rounded ml-1">cur_gt</code> (current turnover)
            are set to 0 — fill these manually on the GST portal from your books.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ReportStatCard label="Output Tax (Sales)" value={formatINR(outputSales.outputTax)} icon={ArrowUpRight} color="text-rose-600" bg="bg-rose-100" />
        <ReportStatCard label="Input Tax (Purchases)" value={formatINR(inputPurchases.inputTax)} icon={ArrowDownRight} color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-100" />
        <ReportStatCard label="Net GST Payable" value={formatINR(netGSTPayable)} icon={Receipt} color={netGSTPayable >= 0 ? 'text-rose-600' : 'text-emerald-600 dark:text-emerald-400'} bg={netGSTPayable >= 0 ? 'bg-rose-100' : 'bg-emerald-100'} />
        <ReportStatCard label="Total Invoices" value={String(data?.totalInvoices ?? 0)} icon={FileText} color="text-amber-600 dark:text-amber-400" bg="bg-amber-100" />
      </div>

      {/* By slab */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Output Tax by GST Slab (Sales)</CardTitle>
            <p className="text-xs text-muted-foreground">GST collected from customers</p>
          </CardHeader>
          <CardContent>
            {outputSales.bySlab.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No sales in this period"
                description="Record a sale to see your GST slab-wise summary here."
                action={{ label: 'New Sale', onClick: () => useAppStore.getState().setView('new-sale') }}
                color="emerald"
                compact
              />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={outputSales.bySlab}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                  <XAxis dataKey="rate" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatINRCompact(v)} />
                  <Tooltip cursor={{ fill: "transparent" }} formatter={(v: number) => formatINR(v)} contentStyle={chartColors.tooltipStyle} itemStyle={chartColors.tooltipItemStyle} labelStyle={chartColors.tooltipLabelStyle} />
                  <Bar dataKey="taxable" name="Taxable Value" fill="oklch(0.62 0.18 42)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="cgst" name="CGST" fill="oklch(0.62 0.15 155)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="sgst" name="SGST" fill="oklch(0.72 0.16 80)" radius={[6, 6, 0, 0]} />
                  {/* 🔒 AUDIT V23 FIX §13.5: Add IGST bar — was invisible for inter-state sellers. */}
                  <Bar dataKey="igst" name="IGST" fill="oklch(0.6 0.12 200)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Input Tax by GST Slab (Purchases)</CardTitle>
            <p className="text-xs text-muted-foreground">GST paid to suppliers</p>
          </CardHeader>
          <CardContent>
            {inputPurchases.bySlab.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No purchases in this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={inputPurchases.bySlab}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                  <XAxis dataKey="rate" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatINRCompact(v)} />
                  <Tooltip cursor={{ fill: "transparent" }} formatter={(v: number) => formatINR(v)} contentStyle={chartColors.tooltipStyle} itemStyle={chartColors.tooltipItemStyle} labelStyle={chartColors.tooltipLabelStyle} />
                  <Bar dataKey="taxable" name="Taxable Value" fill="oklch(0.6 0.12 200)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="cgst" name="CGST" fill="oklch(0.62 0.15 155)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="sgst" name="SGST" fill="oklch(0.72 0.16 80)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="igst" name="IGST" fill="oklch(0.62 0.18 42)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 🔒 V22-13 (Batch C, Phase 8f): Slab table with chart ↔ table toggle */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">GST Slab-wise Summary</CardTitle>
            {/* Toggle: Table ↔ Chart */}
            <div className="flex gap-1 bg-muted rounded-lg p-0.5">
              <button
                onClick={() => setSlabView('table')}
                className={cn(
                  'px-2.5 py-1 text-2xs font-medium rounded-md transition',
                  slabView === 'table' ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground',
                )}
              >
                Table
              </button>
              <button
                onClick={() => setSlabView('chart')}
                className={cn(
                  'px-2.5 py-1 text-2xs font-medium rounded-md transition',
                  slabView === 'chart' ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground',
                )}
              >
                Chart
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {slabView === 'table' ? (
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border text-left">
                    <th className="py-2 px-2 font-medium text-muted-foreground">GST Rate</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">Sales Taxable</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">Output Tax</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">Purchase Taxable</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">Input Tax</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">Net Tax</th>
                  </tr>
                </thead>
              <tbody>
                {[0, 5, 12, 18, 28].map(rate => {
                  const o = outputSales.bySlab.find((s: any) => s.rate === rate)
                  const i = inputPurchases.bySlab.find((s: any) => s.rate === rate)
                  const out = o ? o.cgst + o.sgst + o.igst : 0
                  const inp = i ? i.cgst + i.sgst + i.igst : 0
                  if (!o && !i) return null
                  return (
                    <tr key={rate} className="border-b border-border/50">
                      <td className="py-2 px-2 font-medium">{rate}%</td>
                      <td className="py-2 px-2 text-right">{o ? formatINR(o.taxable) : '—'}</td>
                      <td className="py-2 px-2 text-right text-rose-600">{out > 0 ? formatINR(out) : '—'}</td>
                      <td className="py-2 px-2 text-right">{i ? formatINR(i.taxable) : '—'}</td>
                      <td className="py-2 px-2 text-right text-emerald-600 dark:text-emerald-400">{inp > 0 ? formatINR(inp) : '—'}</td>
                      <td className="py-2 px-2 text-right font-semibold">{formatINR(out - inp)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-2 px-2">Total</td>
                  <td className="py-2 px-2 text-right">{formatINR(outputSales.taxableValue)}</td>
                  <td className="py-2 px-2 text-right text-rose-600">{formatINR(outputSales.outputTax)}</td>
                  <td className="py-2 px-2 text-right">{formatINR(inputPurchases.taxableValue)}</td>
                  <td className="py-2 px-2 text-right text-emerald-600 dark:text-emerald-400">{formatINR(inputPurchases.inputTax)}</td>
                  <td className="py-2 px-2 text-right">{formatINR(netGSTPayable)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          ) : (
            /* Chart view — grouped bar chart of output tax vs input tax by slab */
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={[0, 5, 12, 18, 28].map(rate => {
                  const o = outputSales.bySlab.find((s: any) => s.rate === rate)
                  const i = inputPurchases.bySlab.find((s: any) => s.rate === rate)
                  return {
                    rate: `${rate}%`,
                    'Output Tax': o ? o.cgst + o.sgst + o.igst : 0,
                    'Input Tax': i ? i.cgst + i.sgst + i.igst : 0,
                  }
                }).filter(d => d['Output Tax'] > 0 || d['Input Tax'] > 0)}
                margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                <XAxis dataKey="rate" tick={{ fontSize: 11, fill: chartColors.tick }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: chartColors.tick }} axisLine={false} tickLine={false} tickFormatter={(v) => formatINRCompact(v)} width={50} />
                <Tooltip
                  cursor={{ fill: 'oklch(0.55 0.19 42 / 0.05)' }}
                  contentStyle={chartColors.tooltipStyle} itemStyle={chartColors.tooltipItemStyle} labelStyle={chartColors.tooltipLabelStyle}
                  formatter={(v: number) => formatINR(v)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Output Tax" fill="oklch(0.58 0.22 25)" radius={[4, 4, 0, 0]} name="Output Tax (Sales)" />
                <Bar dataKey="Input Tax" fill="oklch(0.62 0.15 155)" radius={[4, 4, 0, 0]} name="Input Tax (Purchases)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StockReport({ data }: { data: any }) {
  const { t } = useTranslation()
  // 🔒 V11 FIX: Defensive defaults for all data fields.
  const totalStockValue = data?.totalStockValue ?? 0
  const totalPotentialValue = data?.totalPotentialValue ?? 0
  const potentialProfit = data?.potentialProfit ?? 0
  const lowStockCount = data?.lowStockCount ?? 0
  const products = data?.products || []
  // 🔒 V26 FIX N6: When "hide profit from staff" is on, the API omits the
  // cost/profit fields entirely (totalStockValue, potentialProfit, per-product
  // purchasePrice/stockValue). Detect that and hide the corresponding cards
  // and columns instead of rendering ₹NaN.
  const hideCost = data?.totalStockValue === undefined
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {!hideCost && <ReportStatCard label="Total Stock Value" value={formatINR(totalStockValue)} icon={Package} color="text-amber-600 dark:text-amber-400" bg="bg-amber-100" />}
        <ReportStatCard label="Potential Sale Value" value={formatINR(totalPotentialValue)} icon={IndianRupee} color="text-emerald-600 dark:text-emerald-400" bg="bg-emerald-100" />
        {!hideCost && <ReportStatCard label="Potential Profit" value={formatINR(potentialProfit)} icon={TrendingUp} color="text-violet-600" bg="bg-violet-100" />}
        <ReportStatCard label="Low Stock Items" value={String(lowStockCount)} icon={ArrowUpRight} color="text-rose-600" bg="bg-rose-100" />
      </div>

      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stock Valuation by Product</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-2 font-medium text-muted-foreground">Product</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground">Category</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Stock</th>
                  {!hideCost && <th className="py-2 px-2 font-medium text-muted-foreground text-right">Buy Price</th>}
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Sale Price</th>
                  {!hideCost && <th className="py-2 px-2 font-medium text-muted-foreground text-right">Stock Value</th>}
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Sale Value</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.products || []).slice(0, 20).map((p: any) => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2 px-2 font-medium">{p.name}</td>
                    <td className="py-2 px-2 text-muted-foreground">{p.category || '—'}</td>
                    <td className="py-2 px-2 text-right">{p.currentStock} {p.unit}</td>
                    {!hideCost && <td className="py-2 px-2 text-right">{formatINR(p.purchasePrice)}</td>}
                    <td className="py-2 px-2 text-right">{formatINR(p.salePrice)}</td>
                    {!hideCost && <td className="py-2 px-2 text-right font-medium">{formatINR(p.stockValue)}</td>}
                    <td className="py-2 px-2 text-right">{formatINR(p.potentialSaleValue)}</td>
                    <td className="py-2 px-2 text-center">
                      {p.isLowStock ? (
                        <Badge variant="destructive" className="text-3xs">Low</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-3xs bg-emerald-100 text-emerald-700 dark:text-emerald-300">OK</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {products.length > 20 && (
              <p className="text-xs text-muted-foreground text-center mt-3">Showing top 20 of {products.length} products</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function PartyReport({ data }: { data: any }) {
  const { t } = useTranslation()
  // 🔒 V11 FIX: Defensive default for parties array.
  const parties = data?.parties || []
  return (
    <div className="space-y-4">
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Party-wise Statement</CardTitle>
          <p className="text-xs text-muted-foreground">Showing all parties with activity or opening balance</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-2 font-medium text-muted-foreground">Party Name</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground">Type</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Sales</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Purchases</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Paid</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Received</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {parties.map((p: any) => (
                  <tr key={p.party.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2 px-2 font-medium">{p.party.name}</td>
                    <td className="py-2 px-2">
                      <Badge variant="outline" className="text-3xs capitalize">{p.party.type}</Badge>
                    </td>
                    <td className="py-2 px-2 text-right text-emerald-600 dark:text-emerald-400">{p.totalSales > 0 ? formatINR(p.totalSales) : '—'}</td>
                    <td className="py-2 px-2 text-right text-amber-600 dark:text-amber-400">{p.totalPurchases > 0 ? formatINR(p.totalPurchases) : '—'}</td>
                    <td className="py-2 px-2 text-right">{p.totalPaid > 0 ? formatINR(p.totalPaid) : '—'}</td>
                    <td className="py-2 px-2 text-right">{p.totalReceived > 0 ? formatINR(p.totalReceived) : '—'}</td>
                    <td className={cn('py-2 px-2 text-right font-semibold', p.balance > 0 ? 'text-emerald-600 dark:text-emerald-400' : p.balance < 0 ? 'text-rose-600' : 'text-muted-foreground')}>
                      {p.balance > 0 ? `+${formatINR(p.balance)}` : p.balance < 0 ? `-${formatINR(Math.abs(p.balance))}` : 'Settled'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parties.length === 0 && (
              <p className="text-center py-8 text-sm text-muted-foreground">No party activity in this period</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ReportStatCard({ label, value, icon: Icon, color, bg }: { label: string; value: string; icon: any; color: string; bg: string }) {
  // Map bg to gradient for icon
  const gradient = bg.includes('amber') ? 'from-amber-500 to-orange-600'
    : bg.includes('emerald') ? 'from-emerald-500 to-teal-600'
    : bg.includes('rose') ? 'from-rose-500 to-red-600'
    : 'from-violet-500 to-purple-600'

  const textColor = color.includes('amber') ? 'text-amber-600 dark:text-amber-400'
    : color.includes('emerald') ? 'text-emerald-600 dark:text-emerald-400'
    : color.includes('rose') ? 'text-rose-600'
    : 'text-violet-600'

  return (
    <div className="rounded-2xl bg-card border border-border/60 shadow-card relative overflow-hidden">
      {/* Colored top border accent */}
      <div className={`h-1 bg-gradient-to-r ${gradient}`} />
      <div className="p-4 relative">
        <div className="flex items-center gap-2.5 mb-2">
          <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md flex-shrink-0`}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          <p className="text-3xs text-muted-foreground uppercase tracking-wide font-semibold leading-tight">{label}</p>
        </div>
        <p className={cn('text-xl font-bold tracking-tight tabular-nums', textColor)}>{value}</p>
      </div>
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      {/* 🔒 FIX M11: Waking-up message for cold DB start */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
        <Coffee className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 animate-pulse" />
        <span>Waking up your shop... this takes a few seconds on first load.</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  )
}

// 🔒 V11 FIX: Error state for when the report API fails (DB timeout, cold
// start, etc.). Was: the component crashed with 'Cannot read properties of
// undefined (reading totalRevenue)' because the API returned { error: '...' }
// and the component tried to destructure data.summary.
function ReportError({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {/* 🔒 AUDIT V23 FIX §13.5: Added dark: variants — was unreadable in dark mode. */}
      <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950 flex items-center justify-center mb-3">
        <AlertCircle className="w-6 h-6 text-rose-600 dark:text-rose-400" />
      </div>
      <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">Couldn't load report</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-4">
        {message || 'The database might be warming up. Please try again in a moment.'}
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        If this keeps happening, try narrowing the date range.
      </p>
    </div>
  )
}
