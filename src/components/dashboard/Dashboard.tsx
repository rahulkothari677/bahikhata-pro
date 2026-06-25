'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { useTranslation } from '@/hooks/use-translation'
import { SmartInsights } from '@/components/dashboard/SmartInsights'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { DateRangePicker, getPresetRange, getPresetLabel, type DateRange, type DatePreset } from '@/components/common/DateRangePicker'
import {
  TrendingUp, TrendingDown, Wallet, Package,
  ArrowUpRight, ArrowDownRight, AlertTriangle, IndianRupee,
  Receipt, Boxes, PiggyBank, ScanLine, ArrowRight,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  Pie, PieChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts'
import { formatINR, formatINRCompact, relativeTime, cn } from '@/lib/utils'
import { motion } from 'framer-motion'

const COLORS = ['oklch(0.62 0.18 42)', 'oklch(0.62 0.15 155)', 'oklch(0.72 0.16 80)', 'oklch(0.6 0.12 200)', 'oklch(0.65 0.22 15)']

export function Dashboard() {
  const { setView, refreshKey, setSelectedTransactionId, setPreviousView, setPendingDateRange } = useAppStore()
  const { t, language } = useTranslation()
  const [dateRange, setDateRange] = useState<DateRange>(() => getPresetRange('thisMonth'))
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth')

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', refreshKey, dateRange.from.toISOString(), dateRange.to.toISOString()],
    queryFn: async () => {
      const r = await fetch(`/api/dashboard?from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}`)
      return r.json()
    },
  })

  const handleDateChange = (range: DateRange, preset: DatePreset) => {
    setDateRange(range)
    setDatePreset(preset)
  }

  // Navigate to {t('dash.sales_word')} ledger with a date filter applied
  const navigateToSalesWithDate = (from: Date, to: Date, presetLabel: string) => {
    setPendingDateRange({
      from: from.toISOString(),
      to: to.toISOString(),
      preset: presetLabel,
    })
    setPreviousView('dashboard')
    setView('sales')
  }

  // Today's date range for "today" KPIs
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <DateRangeHeader
          dateRange={dateRange}
          datePreset={datePreset}
          onChange={handleDateChange}
          onPresetChange={setDatePreset}
        />
        <DashboardSkeleton />
      </div>
    )
  }

  const { kpis, salesTrend, topProducts, categoryBreakdown, paymentModeSplit, lowStockProducts, gstSummary, recentTransactions, setting } = data

  const rangeLabel = datePreset === 'custom' ? 'Selected Period' : getPresetLabel(datePreset)

  return (
    <div className="space-y-5">
      {/* Greeting banner */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl bg-gradient-saffron p-5 lg:p-6 text-white shadow-lg relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32" />
        <div className="absolute bottom-0 right-20 w-40 h-40 bg-white/5 rounded-full -mb-20" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <p className="text-white/80 text-sm font-medium">{t('dash.greeting')}, {setting?.ownerName || 'Shop Owner'} 🙏</p>
            <h2 className="text-2xl lg:text-3xl font-bold mt-1">{setting?.shopName || 'My Shop'}</h2>
            <p className="text-white/80 text-sm mt-1">
              {t('dash.today_made')} <span className="font-bold text-white">{formatINR(kpis.todayRevenue)}</span> {t('dash.from')} <span className="font-bold text-white">{kpis.todayTxnCount}</span> {t('dash.sales_word')}
            </p>
          </div>
          <Button
            onClick={() => setView('scanner')}
            className="bg-white text-primary hover:bg-white/90 gap-2 shadow-md"
          >
            <ScanLine className="w-4 h-4" />
            {t('dash.scan_bill')}
          </Button>
        </div>
      </motion.div>

      {/* Date range selector + KPI header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold">{t('dash.business_overview')}</h3>
          <p className="text-xs text-muted-foreground">{t('dash.filter_hint')}</p>
        </div>
        <DateRangePicker value={dateRange} onChange={handleDateChange} preset={datePreset} onPresetChange={setDatePreset} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <KPICard
          title={t('dash.today_revenue')}
          value={formatINR(kpis.todayRevenue)}
          icon={IndianRupee}
          gradient="from-amber-500 to-orange-600"
          subtitle={`${kpis.todayTxnCount} ${t('dash.sales_word')}`}
          onClick={() => navigateToSalesWithDate(todayStart, new Date(), 'Today')}
        />
        <KPICard
          title={t('dash.today_profit')}
          value={formatINR(kpis.todayProfit)}
          icon={TrendingUp}
          gradient="from-emerald-500 to-teal-600"
          subtitle={`${t('stat.margin')} ${kpis.todayRevenue > 0 ? ((kpis.todayProfit / kpis.todayRevenue) * 100).toFixed(1) : 0}%`}
          onClick={() => navigateToSalesWithDate(todayStart, new Date(), 'Today')}
        />
        <KPICard
          title={`${rangeLabel} Revenue`}
          value={formatINR(kpis.rangeRevenue)}
          icon={Wallet}
          gradient="from-rose-500 to-pink-600"
          subtitle={`${kpis.rangeTxnCount} ${t('dash.sales_word')} • ${kpis.revenueGrowth >= 0 ? '↑' : '↓'} ${Math.abs(kpis.revenueGrowth).toFixed(1)}% vs prev`}
          trend={kpis.revenueGrowth >= 0 ? 'up' : 'down'}
          onClick={() => navigateToSalesWithDate(dateRange.from, dateRange.to, rangeLabel)}
        />
        <KPICard
          title={`${t('dash.net_profit')} (${rangeLabel})`}
          value={formatINR(kpis.netProfit)}
          icon={PiggyBank}
          gradient="from-violet-500 to-purple-600"
          subtitle={`${kpis.profitGrowth >= 0 ? '↑' : '↓'} ${Math.abs(kpis.profitGrowth).toFixed(1)}% profit trend`}
          trend={kpis.profitGrowth >= 0 ? 'up' : 'down'}
          onClick={() => navigateToSalesWithDate(dateRange.from, dateRange.to, rangeLabel)}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <MiniStatCard
          label={t('dash.receivable')}
          value={formatINR(kpis.totalReceivable)}
          icon={ArrowDownRight}
          color="text-emerald-600"
          onClick={() => setView('parties')}
        />
        <MiniStatCard
          label={t('dash.payable')}
          value={formatINR(kpis.totalPayable)}
          icon={ArrowUpRight}
          color="text-rose-600"
          onClick={() => setView('parties')}
        />
        <MiniStatCard
          label={t('dash.stock_value')}
          value={formatINR(kpis.totalStockValue)}
          icon={Boxes}
          color="text-amber-600"
          onClick={() => setView('inventory')}
        />
        <MiniStatCard
          label={`${t('dash.gst_summary')} (${rangeLabel})`}
          value={formatINR(gstSummary.netPayable)}
          icon={Receipt}
          color="text-violet-600"
          onClick={() => setView('reports')}
        />
      </div>

      {/* Sales trend chart - full width */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">{t('dash.sales_trend')}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">For selected date range</p>
            </div>
            <Badge variant="secondary" className="gap-1">
              <TrendingUp className="w-3 h-3" />
              {salesTrend.length} points
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={salesTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.62 0.18 42)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="oklch(0.62 0.18 42)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="color{t('common.profit')}" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.62 0.15 155)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="oklch(0.62 0.15 155)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.01 60)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'oklch(0.52 0.02 30)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'oklch(0.52 0.02 30)' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatINRCompact(v)} />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: '1px solid oklch(0.91 0.01 60)', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                formatter={(v: number) => formatINR(v)}
              />
              <Area type="monotone" dataKey="revenue" stroke="oklch(0.62 0.18 42)" strokeWidth={2} fill="url(#colorRev)" name="Revenue" />
              <Area type="monotone" dataKey="profit" stroke="oklch(0.62 0.15 155)" strokeWidth={2} fill="url(#colorProfit)" name={t('common.profit')} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 3-column row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top products */}
        <Card className="shadow-card border-border/60 lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">{t('dash.top_products')}</CardTitle>
                <p className="text-xs text-muted-foreground">For selected date range</p>
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => setView('inventory')}>
                {t('dash.view_all')} <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">No {t('dash.sales_word')} in selected range</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={topProducts} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.01 60)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'oklch(0.52 0.02 30)' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatINRCompact(v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'oklch(0.18 0.02 30)' }} axisLine={false} tickLine={false} width={130}
                    tickFormatter={(v) => v.length > 18 ? v.slice(0, 18) + '…' : v}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: '1px solid oklch(0.91 0.01 60)', fontSize: 12 }}
                    formatter={(v: number, name: string) => name === 'revenue' ? [formatINR(v), language === 'hi' ? 'बिक्री' : 'Revenue'] : [formatINR(v), language === 'hi' ? 'मुनाफा' : 'Profit']}
                  />
                  <Bar dataKey="revenue" fill="oklch(0.62 0.18 42)" radius={[0, 6, 6, 0]} barSize={18} name="revenue" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Payment mode pie */}
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">{t('dash.payment_modes')}</CardTitle>
            <p className="text-xs text-muted-foreground">For selected date range</p>
          </CardHeader>
          <CardContent>
            {paymentModeSplit.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">No data</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={paymentModeSplit}
                      dataKey="value"
                      nameKey="name"
                      cx="50%" cy="50%"
                      innerRadius={45} outerRadius={70}
                      paddingAngle={2}
                    >
                      {paymentModeSplit.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatINR(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {paymentModeSplit.map((p, i) => (
                    <div key={p.name} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <div className="text-xs">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground ml-1">{formatINRCompact(p.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category breakdown & low stock */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Category breakdown */}
        <Card className="shadow-card border-border/60 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">{t('dash.category_breakdown')}</CardTitle>
            <p className="text-xs text-muted-foreground">For selected date range</p>
          </CardHeader>
          <CardContent>
            {categoryBreakdown.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">No {t('dash.sales_word')} in selected range</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                {(() => {
                  const total = categoryBreakdown.reduce((s: number, c: any) => s + c.value, 0)
                  return categoryBreakdown.slice(0, 8).map((cat: any, i: number) => {
                    const pct = (cat.value / total) * 100
                    return (
                      <div key={cat.name}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium">{cat.name}</span>
                          <span className="text-xs text-muted-foreground">{formatINRCompact(cat.value)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }}
                          />
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </CardContent>
        </Card>

        {/* {t('dash.low_stock_short')} stock alerts */}
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">{t('dash.low_stock')}</CardTitle>
                  <p className="text-xs text-muted-foreground">{lowStockProducts.length} {t('dash.need_restock')}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => setView('inventory')}>
                {t('dash.manage')} <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {lowStockProducts.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
                सारा स्टॉक ठीक है!
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {lowStockProducts.slice(0, 6).map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg bg-rose-50/50 border border-rose-100">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground">{p.category} • Stock: {p.currentStock} {p.unit}</p>
                    </div>
                    <Badge variant="destructive" className="text-[10px]">
                      {p.currentStock === 0 ? t('dash.out_of_stock') : t('dash.low_stock_short')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent transactions & {t('dash.gst_summary')} summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent transactions */}
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Receipt className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">{t('dash.recent_transactions')}</CardTitle>
                  <p className="text-xs text-muted-foreground">{t('dash.latest_activity')}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => setView('sales')}>
                {t('dash.view_all')} <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentTransactions.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">अभी कोई एंट्री नहीं</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {recentTransactions.map((txn: any) => {
                  const isSale = txn.type === 'sale'
                  const isIncome = txn.type === 'income'
                  const isInflow = isSale || isIncome
                  return (
                    <button
                      key={txn.id}
                      onClick={() => {
                        setSelectedTransactionId(txn.id)
                        setPreviousView('dashboard')
                        setView('transaction-detail')
                      }}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition text-left"
                    >
                      <div className={cn(
                        'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                        isInflow ? 'bg-emerald-100' : 'bg-rose-100'
                      )}>
                        {isInflow ? (
                          <ArrowDownRight className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4 text-rose-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {txn.partyName}
                          {txn.invoiceNo && <span className="text-muted-foreground text-xs ml-1">• {txn.invoiceNo}</span>}
                        </p>
                        <p className="text-[11px] text-muted-foreground capitalize">
                          {txn.type} • {relativeTime(txn.date)} • {txn.paymentMode}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={cn('text-sm font-semibold', isInflow ? 'text-emerald-600' : 'text-rose-600')}>
                          {isInflow ? '+' : '-'}{formatINRCompact(txn.totalAmount)}
                        </p>
                        {isSale && txn.profit !== undefined && (
                          <p className="text-[10px] text-muted-foreground">
                            {t('common.profit')} {formatINRCompact(txn.profit)}
                          </p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* {t('dash.gst_summary')} summary */}
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">{t('dash.gst_summary')} ({rangeLabel})</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => setView('reports')}>
                {t('dash.full_report')} <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <GstMiniStat label="Output Tax (Sales)" value={gstSummary.outputTax} color="text-amber-600" />
              <GstMiniStat label="Input Tax (Purchase)" value={gstSummary.inputTax} color="text-emerald-600" />
              <GstMiniStat label="CGST + SGST" value={gstSummary.cgst + gstSummary.sgst} color="text-violet-600" />
              <GstMiniStat label="Net GST Payable" value={gstSummary.netPayable} color={gstSummary.netPayable >= 0 ? 'text-rose-600' : 'text-emerald-600'} highlight />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* {t('dash.smart_insights')} - AI-powered alerts */}
      {kpis && <SmartInsights />}
    </div>
  )
}

function KPICard({ title, value, icon: Icon, gradient, subtitle, trend, onClick }: {
  title: string
  value: string
  icon: any
  gradient: string
  subtitle?: string
  trend?: 'up' | 'down'
  onClick?: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card
        className={`shadow-card border-border/60 overflow-hidden relative transition ${onClick ? 'cursor-pointer hover:shadow-md hover:border-primary/30' : ''}`}
        onClick={onClick}
      >
        <div className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-br ${gradient} opacity-10 rounded-full -mr-8 -mt-8`} />
        <CardContent className="p-4 lg:p-5 relative">
          <div className="flex items-start justify-between mb-3">
            <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md`}>
              <Icon className="w-4 h-4 text-white" />
            </div>
            {trend && (
              <div className={cn('flex items-center text-xs font-medium', trend === 'up' ? 'text-emerald-600' : 'text-rose-600')}>
                {trend === 'up' ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
          <p className="text-xl lg:text-2xl font-bold mt-0.5 tracking-tight">{value}</p>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-1">{subtitle}</p>}
        </CardContent>
      </Card>
    </motion.div>
  )
}

function MiniStatCard({ label, value, icon: Icon, color, onClick }: {
  label: string
  value: string
  icon: any
  color: string
  onClick?: () => void
}) {
  return (
    <Card
      className="shadow-card border-border/60 hover:shadow-md transition cursor-pointer"
      onClick={onClick}
    >
      <CardContent className="p-3 lg:p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={cn('w-3.5 h-3.5', color)} />
          <p className="text-[10px] lg:text-[11px] text-muted-foreground font-medium uppercase tracking-wide leading-tight">{label}</p>
        </div>
        <p className="text-base lg:text-lg font-bold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  )
}

function GstMiniStat({ label, value, color, highlight }: {
  label: string
  value: number
  color: string
  highlight?: boolean
}) {
  return (
    <div className={cn('rounded-lg p-3 border', highlight ? 'bg-muted/50 border-primary/30' : 'bg-card border-border')}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
      <p className={cn('text-base font-bold mt-1', color)}>{formatINR(value)}</p>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}

// Header with date range picker - shown even during loading so preset state persists
function DateRangeHeader({ dateRange, datePreset, onChange, onPresetChange }: {
  dateRange: DateRange
  datePreset: DatePreset
  onChange: (range: DateRange, preset: DatePreset) => void
  onPresetChange: (preset: DatePreset) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h3 className="text-base font-semibold">Business Overview</h3>
        <p className="text-xs text-muted-foreground">Filter all charts and stats by date range</p>
      </div>
      <DateRangePicker
        value={dateRange}
        onChange={onChange}
        preset={datePreset}
        onPresetChange={onPresetChange}
      />
    </div>
  )
}
