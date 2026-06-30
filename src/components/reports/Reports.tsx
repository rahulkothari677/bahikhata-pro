'use client'

import { useTranslation } from '@/hooks/use-translation'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  FileSpreadsheet, Loader2, Download, Printer, Clock, AlertTriangle,
} from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch } from '@/lib/offline-fetch'
import { exportPLReportCSV, exportGSTReportCSV, exportStockReportCSV, exportPartyReportCSV } from '@/lib/csv-export'
import { exportToTally } from '@/lib/tally-export'
import { DebtAgingReport } from '@/components/reports/DebtAgingReport'
import { InventoryAgingReport } from '@/components/reports/InventoryAgingReport'

const COLORS = ['oklch(0.62 0.18 42)', 'oklch(0.62 0.15 155)', 'oklch(0.72 0.16 80)', 'oklch(0.6 0.12 200)', 'oklch(0.65 0.22 15)', 'oklch(0.7 0.16 250)']

export function Reports() {
  const { t } = useTranslation()
  const { features } = useAppStore()
  const [reportType, setReportType] = useState<'pl' | 'gst' | 'stock' | 'party' | 'debt-aging' | 'inventory-aging'>('pl')
  const [dateRange, setDateRange] = useState<DateRange>(() => getPresetRange('thisMonth'))
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth')
  const [exportingGstr, setExportingGstr] = useState(false)

  const handleDateChange = (range: DateRange, preset: DatePreset) => {
    setDateRange(range)
    setDatePreset(preset)
  }

  const handleGstrExport = async () => {
    setExportingGstr(true)
    try {
      const r = await offlineFetch(`/api/gstr-export?from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}&format=csv`)
      if (!r.ok) throw new Error('Export failed')
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `GSTR1_${dateRange.from.toISOString().slice(0, 7)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      sonnerToast.success('GSTR-1 exported! Upload this to GST portal.')
    } catch {
      sonnerToast.error('Failed to export GSTR-1')
    } finally {
      setExportingGstr(false)
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: ['report', reportType, dateRange.from.toISOString(), dateRange.to.toISOString()],
    queryFn: async () => {
      // Debt aging uses party report data (includes transactions per party)
      // Inventory aging uses stock report data (includes products with createdAt)
      const apiType = reportType === 'debt-aging' ? 'party' : reportType === 'inventory-aging' ? 'stock' : reportType
      const r = await offlineFetch(`/api/reports?type=${apiType}&from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}`)
      return r.json()
    },
  })

  const periodLabel = `${formatDate(dateRange.from)} to ${formatDate(dateRange.to)}`

  const handleCSVExport = () => {
    if (!data) {
      sonnerToast.error('Report data not loaded yet')
      return
    }
    try {
      if (reportType === 'pl') exportPLReportCSV(data, periodLabel)
      else if (reportType === 'gst') exportGSTReportCSV(data, periodLabel)
      else if (reportType === 'stock') exportStockReportCSV(data)
      else if (reportType === 'party') exportPartyReportCSV(data)
      sonnerToast.success('CSV exported successfully')
    } catch {
      sonnerToast.error('Failed to export CSV')
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const handleTallyExport = async () => {
    try {
      // Fetch transactions for Tally export
      const r = await offlineFetch(`/api/transactions?limit=500`)
      const txnData = await r.json()
      const setting = (await offlineFetch('/api/settings').then(r => r.json())).setting
      exportToTally(txnData.transactions || [], setting, 'all')
      sonnerToast.success('Tally XML exported! Import this in Tally → Gateway of Tally → Import Data')
    } catch {
      sonnerToast.error('Failed to export Tally XML')
    }
  }

  return (
    <div className="space-y-4">
      {/* Print-only header — visible only when printing */}
      <div className="hidden print:block mb-4 pb-3 border-b-2 border-black">
        <h1 className="text-2xl font-bold text-black capitalize">{reportType === 'pl' ? 'Profit & Loss Report' : reportType === 'gst' ? 'GST Report' : reportType === 'stock' ? 'Stock Report' : 'Party Statement'}</h1>
        <p className="text-sm text-gray-700 mt-1">Period: {formatDate(dateRange.from)} to {formatDate(dateRange.to)}</p>
        <p className="text-xs text-gray-500 mt-0.5">Generated by BahiKhata Pro on {formatDate(new Date())}</p>
      </div>

      {/* Period selector + export toolbar */}
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

      {/* Report type tabs — horizontally scrollable on mobile, grid on desktop */}
      <Tabs value={reportType} onValueChange={(v) => setReportType(v as any)}>
        {/* Mobile: horizontal scroll pills (single row, swipe to see more) */}
        <div className="lg:hidden no-print">
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            <ReportTabButton value="pl" active={reportType === 'pl'} icon={TrendingUp} label={t('reports.pl')} onClick={() => setReportType('pl')} />
            <ReportTabButton value="gst" active={reportType === 'gst'} icon={Receipt} label="GST" onClick={() => setReportType('gst')} />
            <ReportTabButton value="stock" active={reportType === 'stock'} icon={Package} label="Stock" onClick={() => setReportType('stock')} />
            <ReportTabButton value="party" active={reportType === 'party'} icon={Users} label="Party" onClick={() => setReportType('party')} />
            <ReportTabButton value="debt-aging" active={reportType === 'debt-aging'} icon={Clock} label="Debt Aging" onClick={() => setReportType('debt-aging')} />
            <ReportTabButton value="inventory-aging" active={reportType === 'inventory-aging'} icon={AlertTriangle} label="Inv Aging" onClick={() => setReportType('inventory-aging')} />
          </div>
        </div>

        {/* Desktop: full grid (all 6 tabs visible) */}
        <TabsList className="hidden lg:grid lg:grid-cols-6 w-full h-auto no-print">
          <TabsTrigger value="pl" className="gap-1.5 py-2">
            <TrendingUp className="w-3.5 h-3.5" /> {t('reports.pl')}
          </TabsTrigger>
          <TabsTrigger value="gst" className="gap-1.5 py-2">
            <Receipt className="w-3.5 h-3.5" /> GST
          </TabsTrigger>
          <TabsTrigger value="stock" className="gap-1.5 py-2">
            <Package className="w-3.5 h-3.5" /> Stock
          </TabsTrigger>
          <TabsTrigger value="party" className="gap-1.5 py-2">
            <Users className="w-3.5 h-3.5" /> Party
          </TabsTrigger>
          <TabsTrigger value="debt-aging" className="gap-1.5 py-2">
            <Clock className="w-3.5 h-3.5" /> Debt Aging
          </TabsTrigger>
          <TabsTrigger value="inventory-aging" className="gap-1.5 py-2">
            <AlertTriangle className="w-3.5 h-3.5" /> Inv Aging
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pl" className="mt-4">
          {isLoading || !data ? <ReportSkeleton /> : <PLReport data={data} />}
        </TabsContent>
        <TabsContent value="gst" className="mt-4">
          {isLoading || !data ? <ReportSkeleton /> : <GSTReport data={data} />}
        </TabsContent>
        <TabsContent value="stock" className="mt-4">
          {isLoading || !data ? <ReportSkeleton /> : <StockReport data={data} />}
        </TabsContent>
        <TabsContent value="party" className="mt-4">
          {isLoading || !data ? <ReportSkeleton /> : <PartyReport data={data} />}
        </TabsContent>
        <TabsContent value="debt-aging" className="mt-4">
          {isLoading || !data ? <ReportSkeleton /> : <DebtAgingReport data={data} />}
        </TabsContent>
        <TabsContent value="inventory-aging" className="mt-4">
          {isLoading || !data ? <ReportSkeleton /> : <InventoryAgingReport data={data} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * ReportTabButton — pill-style tab button for mobile horizontal scroll.
 * Active state: primary background + white text.
 * Inactive: muted background + dark text.
 */
function ReportTabButton({ active, icon: Icon, label, onClick }: {
  value: string
  active: boolean
  icon: any
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all flex-shrink-0',
        active
          ? 'bg-primary text-primary-foreground shadow-md'
          : 'bg-muted text-muted-foreground hover:bg-muted/80'
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

function PLReport({ data }: { data: any }) {
  const { t } = useTranslation()
  const { summary, expensesByCategory, incomeByCategory } = data
  return (
    <div className="space-y-4">
      {/* Top metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ReportStatCard label="Revenue (Sales)" value={formatINR(summary.totalRevenue)} icon={IndianRupee} color="text-amber-600" bg="bg-amber-100" />
        <ReportStatCard label="Gross Profit" value={formatINR(summary.grossProfit)} icon={TrendingUp} color="text-emerald-600" bg="bg-emerald-100" />
        <ReportStatCard label="Total Expenses" value={formatINR(summary.totalExpenses)} icon={ArrowUpRight} color="text-rose-600" bg="bg-rose-100" />
        <ReportStatCard label="Net Profit" value={formatINR(summary.netProfit)} icon={Percent} color={summary.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'} bg={summary.netProfit >= 0 ? 'bg-emerald-100' : 'bg-rose-100'} />
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
              <p className="text-sm text-muted-foreground text-center py-8">No expenses in this period</p>
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
              <ArrowDownRight className="w-4 h-4 text-emerald-600" /> Other Income
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
              <span className="text-muted-foreground">Revenue (Sales Subtotal)</span>
              <span className="font-medium">{formatINR(summary.totalRevenue)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Less: Cost of Goods Sold</span>
              <span className="font-medium text-rose-600">-{formatINR(summary.totalRevenue - summary.grossProfit)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="font-semibold">Gross Profit</span>
              <span className="font-bold text-emerald-600">{formatINR(summary.grossProfit)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Add: Other Income</span>
              <span className="font-medium text-emerald-600">+{formatINR(summary.otherIncome)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-muted-foreground">Less: Operating Expenses</span>
              <span className="font-medium text-rose-600">-{formatINR(summary.totalExpenses)}</span>
            </div>
            <div className="flex justify-between py-2 text-base">
              <span className="font-bold">Net Profit</span>
              <span className={cn('font-bold', summary.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
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
  const { outputSales, inputPurchases, netGSTPayable } = data
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ReportStatCard label="Output Tax (Sales)" value={formatINR(outputSales.outputTax)} icon={ArrowUpRight} color="text-rose-600" bg="bg-rose-100" />
        <ReportStatCard label="Input Tax (Purchases)" value={formatINR(inputPurchases.inputTax)} icon={ArrowDownRight} color="text-emerald-600" bg="bg-emerald-100" />
        <ReportStatCard label="Net GST Payable" value={formatINR(netGSTPayable)} icon={Receipt} color={netGSTPayable >= 0 ? 'text-rose-600' : 'text-emerald-600'} bg={netGSTPayable >= 0 ? 'bg-rose-100' : 'bg-emerald-100'} />
        <ReportStatCard label="Total Invoices" value={String(data.totalInvoices)} icon={FileText} color="text-amber-600" bg="bg-amber-100" />
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
              <p className="text-sm text-muted-foreground text-center py-8">No sales in this period</p>
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
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Slab table */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">GST Slab-wise Summary</CardTitle>
        </CardHeader>
        <CardContent>
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
                      <td className="py-2 px-2 text-right text-emerald-600">{inp > 0 ? formatINR(inp) : '—'}</td>
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
                  <td className="py-2 px-2 text-right text-emerald-600">{formatINR(inputPurchases.inputTax)}</td>
                  <td className="py-2 px-2 text-right">{formatINR(netGSTPayable)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StockReport({ data }: { data: any }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ReportStatCard label="Total Stock Value" value={formatINR(data.totalStockValue)} icon={Package} color="text-amber-600" bg="bg-amber-100" />
        <ReportStatCard label="Potential Sale Value" value={formatINR(data.totalPotentialValue)} icon={IndianRupee} color="text-emerald-600" bg="bg-emerald-100" />
        <ReportStatCard label="Potential Profit" value={formatINR(data.potentialProfit)} icon={TrendingUp} color="text-violet-600" bg="bg-violet-100" />
        <ReportStatCard label="Low Stock Items" value={String(data.lowStockCount)} icon={ArrowUpRight} color="text-rose-600" bg="bg-rose-100" />
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
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Buy Price</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Sale Price</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Stock Value</th>
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
                    <td className="py-2 px-2 text-right">{formatINR(p.purchasePrice)}</td>
                    <td className="py-2 px-2 text-right">{formatINR(p.salePrice)}</td>
                    <td className="py-2 px-2 text-right font-medium">{formatINR(p.stockValue)}</td>
                    <td className="py-2 px-2 text-right">{formatINR(p.potentialSaleValue)}</td>
                    <td className="py-2 px-2 text-center">
                      {p.isLowStock ? (
                        <Badge variant="destructive" className="text-[10px]">Low</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700">OK</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(data?.products?.length || 0) > 20 && (
              <p className="text-xs text-muted-foreground text-center mt-3">Showing top 20 of {data.products.length} products</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function PartyReport({ data }: { data: any }) {
  const { t } = useTranslation()
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
                {(data?.parties || []).map((p: any) => (
                  <tr key={p.party.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2 px-2 font-medium">{p.party.name}</td>
                    <td className="py-2 px-2">
                      <Badge variant="outline" className="text-[10px] capitalize">{p.party.type}</Badge>
                    </td>
                    <td className="py-2 px-2 text-right text-emerald-600">{p.totalSales > 0 ? formatINR(p.totalSales) : '—'}</td>
                    <td className="py-2 px-2 text-right text-amber-600">{p.totalPurchases > 0 ? formatINR(p.totalPurchases) : '—'}</td>
                    <td className="py-2 px-2 text-right">{p.totalPaid > 0 ? formatINR(p.totalPaid) : '—'}</td>
                    <td className="py-2 px-2 text-right">{p.totalReceived > 0 ? formatINR(p.totalReceived) : '—'}</td>
                    <td className={cn('py-2 px-2 text-right font-semibold', p.balance > 0 ? 'text-emerald-600' : p.balance < 0 ? 'text-rose-600' : 'text-muted-foreground')}>
                      {p.balance > 0 ? `+${formatINR(p.balance)}` : p.balance < 0 ? `-${formatINR(Math.abs(p.balance))}` : 'Settled'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!data?.parties || data.parties.length === 0) && (
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

  const textColor = color.includes('amber') ? 'text-amber-600'
    : color.includes('emerald') ? 'text-emerald-600'
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
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold leading-tight">{label}</p>
        </div>
        <p className={cn('text-xl font-bold tracking-tight tabular-nums', textColor)}>{value}</p>
      </div>
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  )
}
