'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
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
import { formatINR, formatINRCompact, cn, formatDate } from '@/lib/utils'
import {
  FileBarChart, TrendingUp, Receipt, Package, Users, Calendar,
  ArrowDownRight, ArrowUpRight, IndianRupee, Percent, FileText,
} from 'lucide-react'

const COLORS = ['oklch(0.62 0.18 42)', 'oklch(0.62 0.15 155)', 'oklch(0.72 0.16 80)', 'oklch(0.6 0.12 200)', 'oklch(0.65 0.22 15)', 'oklch(0.7 0.16 250)']

export function Reports() {
  const [reportType, setReportType] = useState<'pl' | 'gst' | 'stock' | 'party'>('pl')
  const [dateRange, setDateRange] = useState<DateRange>(() => getPresetRange('thisMonth'))
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth')

  const handleDateChange = (range: DateRange, preset: DatePreset) => {
    setDateRange(range)
    setDatePreset(preset)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['report', reportType, dateRange.from.toISOString(), dateRange.to.toISOString()],
    queryFn: async () => {
      const r = await fetch(`/api/reports?type=${reportType}&from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}`)
      return r.json()
    },
  })

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Report Period:</span>
            </div>
            <div className="flex items-center gap-3">
              <DateRangePicker value={dateRange} onChange={handleDateChange} align="right" />
              <p className="text-xs text-muted-foreground hidden sm:block">
                {formatDate(dateRange.from)} — {formatDate(dateRange.to)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report type tabs */}
      <Tabs value={reportType} onValueChange={(v) => setReportType(v as any)}>
        <TabsList className="grid grid-cols-2 lg:grid-cols-4 w-full h-auto">
          <TabsTrigger value="pl" className="gap-1.5 py-2">
            <TrendingUp className="w-3.5 h-3.5" /> P&L
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
      </Tabs>
    </div>
  )
}

function PLReport({ data }: { data: any }) {
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

      {/* P&L breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-card border-border/60">
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
                        <span className="text-muted-foreground">{formatINR(e.value)} ({pct.toFixed(0)}%)</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-rose-400 to-rose-600" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/60">
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
                        <span className="text-muted-foreground">{formatINR(e.value)}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: `${pct}%` }} />
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
      <Card className="shadow-card border-border/60">
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
        <Card className="shadow-card border-border/60">
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
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.01 60)" vertical={false} />
                  <XAxis dataKey="rate" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatINRCompact(v)} />
                  <Tooltip formatter={(v: number) => formatINR(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="taxable" name="Taxable Value" fill="oklch(0.62 0.18 42)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="cgst" name="CGST" fill="oklch(0.62 0.15 155)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="sgst" name="SGST" fill="oklch(0.72 0.16 80)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/60">
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
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.01 60)" vertical={false} />
                  <XAxis dataKey="rate" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatINRCompact(v)} />
                  <Tooltip formatter={(v: number) => formatINR(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
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
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">GST Slab-wise Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
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
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ReportStatCard label="Total Stock Value" value={formatINR(data.totalStockValue)} icon={Package} color="text-amber-600" bg="bg-amber-100" />
        <ReportStatCard label="Potential Sale Value" value={formatINR(data.totalPotentialValue)} icon={IndianRupee} color="text-emerald-600" bg="bg-emerald-100" />
        <ReportStatCard label="Potential Profit" value={formatINR(data.potentialProfit)} icon={TrendingUp} color="text-violet-600" bg="bg-violet-100" />
        <ReportStatCard label="Low Stock Items" value={String(data.lowStockCount)} icon={ArrowUpRight} color="text-rose-600" bg="bg-rose-100" />
      </div>

      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stock Valuation by Product</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
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
                {data.products.slice(0, 20).map((p: any) => (
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
            {data.products.length > 20 && (
              <p className="text-xs text-muted-foreground text-center mt-3">Showing top 20 of {data.products.length} products</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function PartyReport({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Party-wise Statement</CardTitle>
          <p className="text-xs text-muted-foreground">Showing all parties with activity or opening balance</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
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
                {data.parties.map((p: any) => (
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
            {data.parties.length === 0 && (
              <p className="text-center py-8 text-sm text-muted-foreground">No party activity in this period</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ReportStatCard({ label, value, icon: Icon, color, bg }: { label: string; value: string; icon: any; color: string; bg: string }) {
  return (
    <Card className="shadow-card border-border/60">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', bg)}>
            <Icon className={cn('w-3.5 h-3.5', color)} />
          </div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
        </div>
        <p className="text-lg font-bold">{value}</p>
      </CardContent>
    </Card>
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
