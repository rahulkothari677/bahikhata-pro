'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { useTranslation } from '@/hooks/use-translation'
import { SmartInsights } from '@/components/dashboard/SmartInsights'
import { BusinessHealthScore } from '@/components/dashboard/BusinessHealthScore'
import { useBusinessGoals } from '@/hooks/use-business-goals'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { DateRangePicker, getPresetRange, getPresetLabel, type DateRange, type DatePreset } from '@/components/common/DateRangePicker'
import {
  TrendingUp, TrendingDown, Wallet, Package,
  ArrowUpRight, ArrowDownRight, AlertTriangle, IndianRupee,
  Receipt, Boxes, PiggyBank, ScanLine, ArrowRight, Plus, CloudOff, Repeat, Loader2,
  BookOpenText, Share2, Calendar, Target,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  Pie, PieChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts'
import { chartColors } from '@/lib/chart-theme'
import { formatINR, formatINRCompact, relativeTime, cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import { offlineFetch, isOnline, OfflineError } from '@/lib/offline-fetch'
import { useSetting } from '@/hooks/use-setting'
import { useRecurringEntries } from '@/hooks/use-recurring-entries'
import { toast as sonnerToast } from 'sonner'

const COLORS = ['oklch(0.62 0.18 42)', 'oklch(0.62 0.15 155)', 'oklch(0.72 0.16 80)', 'oklch(0.6 0.12 200)', 'oklch(0.65 0.22 15)']

export function Dashboard() {
  const { setView, refreshKey, setSelectedTransactionId, setPreviousView, setPendingDateRange, features } = useAppStore()
  const { t, language } = useTranslation()
  const { hideProfit } = useSetting()
  const { revenueTarget, expenseBudget } = useBusinessGoals()
  const { checkAndCreate: checkRecurring } = useRecurringEntries()
  const [dateRange, setDateRange] = useState<DateRange>(() => getPresetRange('thisMonth'))
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth')
  const [repeating, setRepeating] = useState(false)

  // Check for due recurring entries on mount (auto-create monthly rent, salary, etc.)
  useEffect(() => {
    if (features?.recurringEntries) {
      checkRecurring()
    }
  }, [features?.recurringEntries, checkRecurring])

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', refreshKey, dateRange.from.toISOString(), dateRange.to.toISOString()],
    queryFn: async () => {
      const r = await offlineFetch(`/api/dashboard?from=${dateRange.from.toISOString()}&to=${dateRange.to.toISOString()}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    },
    // Don't retry when offline or on network errors — fail fast
    retry: (count, err) => {
      if (err instanceof OfflineError) return false
      if (err instanceof TypeError) return false // Network failure
      return count < 2
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

  // Show offline-no-data state if: offline AND query failed (any error) AND no cached data
  const isOfflineNoData = !isOnline() && !!error && !data

  if (isOfflineNoData) {
    return (
      <div className="space-y-5">
        <DateRangeHeader
          dateRange={dateRange}
          datePreset={datePreset}
          onChange={handleDateChange}
          onPresetChange={setDatePreset}
        />
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center mb-4">
            <CloudOff className="w-8 h-8 text-amber-600" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No cached data</h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            You&apos;re offline and the dashboard data hasn&apos;t been cached yet.
            Connect to internet once to load your data — after that, it works offline.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setView('sales') }}
              className="gap-2"
            >
              View Sales Ledger
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setView('new-sale') }}
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              New Sale
            </Button>
          </div>
        </div>
      </div>
    )
  }

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

  // Find the last sale transaction (for "Repeat Last Sale" feature)
  const lastSale = recentTransactions.find((t: any) => t.type === 'sale')

  // Share today's summary via WhatsApp
  const handleShareSummary = () => {
    const shopName = setting?.shopName || 'My Shop'
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    const margin = kpis.todayRevenue > 0 ? ((kpis.todayProfit / kpis.todayRevenue) * 100).toFixed(1) : '0'

    const lines = [
      `📊 *${shopName} — Daily Summary*`,
      `📅 ${today}`,
      ``,
      `💰 Total Sales: ${formatINR(kpis.todayRevenue)}`,
    ]
    if (!hideProfit && kpis.todayProfit !== 0) {
      lines.push(`📈 Profit: ${formatINR(kpis.todayProfit)} (${margin}%)`)
    }
    lines.push(`🛒 Transactions: ${kpis.todayTxnCount}`)
    if (kpis.totalReceivable > 0) {
      lines.push(`⚠️ Outstanding: ${formatINR(kpis.totalReceivable)}`)
    }
    lines.push(``)
    lines.push(`Generated by BahiKhata Pro`)

    const text = encodeURIComponent(lines.join('\n'))
    window.open(`https://wa.me/?text=${text}`, '_blank')
  }

  // Repeat last sale — fetches the ACTUAL latest sale (bypassing cache)
  // then pre-fills the New Sale form with its items
  const handleRepeatLastSale = async () => {
    setRepeating(true)
    try {
      // Fetch the latest sale transaction directly (cache: 'no-store' to bypass browser cache)
      const r = await fetch('/api/transactions?limit=1&type=sale', { cache: 'no-store' })
      const data = await r.json()
      const latestSale = data?.transactions?.[0]

      if (!latestSale || !latestSale.items || latestSale.items.length === 0) {
        sonnerToast.error('No sale found to repeat')
        return
      }

      sonnerToast.success(`Loading sale: ${latestSale.items.length} items`)

      // Pass the latest sale's items to the New Sale form via the global preset
      ;(window as any).__ledgerPreset = {
        type: 'sale',
        data: {
          partyId: latestSale.partyId,
          items: latestSale.items.map((item: any) => ({
            productId: item.productId || '',
            name: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            gstRate: item.gstRate,
            unit: item.unit || 'pcs',
          })),
        },
      }
      setPreviousView('dashboard')
      setView('new-sale')
    } catch (err) {
      sonnerToast.error('Failed to load last sale')
    } finally {
      setRepeating(false)
    }
  }

  // Empty state for new users (0 transactions)
  const isNewUser = kpis.totalStockValue === 0 && kpis.productCount === 0 && kpis.rangeTxnCount === 0 && recentTransactions.length === 0

  if (isNewUser) {
    return (
      <div className="space-y-5">
        <DateRangeHeader
          dateRange={dateRange}
          datePreset={datePreset}
          onChange={handleDateChange}
          onPresetChange={setDatePreset}
        />
        {/* Empty state hero */}
        <div className="rounded-2xl bg-gradient-saffron p-8 lg:p-12 text-white shadow-lg relative overflow-hidden text-center">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32" />
          <div className="relative z-10">
            <BookOpenText className="w-12 h-12 text-white mb-4" />
            <h2 className="text-2xl font-bold mb-2">Welcome to BahiKhata Pro!</h2>
            <p className="text-white/80 text-sm max-w-md mx-auto mb-6">
              Your dashboard will come alive once you start recording sales. Here's how to get started in 2 minutes:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto">
              <button
                onClick={() => setView('new-sale')}
                className="bg-white/20 hover:bg-white/30 rounded-xl p-4 text-left transition active:scale-95"
              >
                <Plus className="w-6 h-6 mb-2" />
                <p className="font-semibold text-sm">1. Record a Sale</p>
                <p className="text-xs text-white/70 mt-1">Tap here to create your first sale entry</p>
              </button>
              <button
                onClick={() => setView('inventory')}
                className="bg-white/20 hover:bg-white/30 rounded-xl p-4 text-left transition active:scale-95"
              >
                <Package className="w-6 h-6 mb-2" />
                <p className="font-semibold text-sm">2. Add Products</p>
                <p className="text-xs text-white/70 mt-1">Add your inventory items with prices</p>
              </button>
              <button
                onClick={() => setView('scanner')}
                className="bg-white/20 hover:bg-white/30 rounded-xl p-4 text-left transition active:scale-95"
              >
                <ScanLine className="w-6 h-6 mb-2" />
                <p className="font-semibold text-sm">3. Scan a Bill</p>
                <p className="text-xs text-white/70 mt-1">AI scans any bill automatically</p>
              </button>
            </div>
          </div>
        </div>

        {/* Quick stats (all zeros but shows the layout) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Today's Revenue", value: '₹0', icon: IndianRupee, color: 'text-amber-600 bg-amber-100' },
            { label: "Today's Profit", value: '₹0', icon: TrendingUp, color: 'text-emerald-600 bg-emerald-100' },
            { label: 'Products', value: '0', icon: Package, color: 'text-blue-600 bg-blue-100' },
            { label: 'Customers', value: '0', icon: Wallet, color: 'text-violet-600 bg-violet-100' },
          ].map((stat, i) => {
            const Icon = stat.icon
            return (
              <Card key={i} className="shadow-card border-border/60">
                <CardContent className="p-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2 ${stat.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Hero greeting card — premium gradient with wave pattern.
          Mobile: vertical stack, big revenue number.
          Desktop: horizontal layout with stats on left, actions on right. */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl bg-gradient-saffron p-5 lg:p-7 text-white shadow-card relative overflow-hidden"
      >
        {/* Decorative wave pattern at the bottom — subtle SVG overlay */}
        <svg
          className="absolute bottom-0 left-0 w-full h-24 opacity-20"
          viewBox="0 0 400 80"
          preserveAspectRatio="none"
          fill="none"
        >
          <path
            d="M0,40 C100,80 200,0 400,40 L400,80 L0,80 Z"
            fill="white"
          />
          <path
            d="M0,50 C100,20 200,70 400,30 L400,80 L0,80 Z"
            fill="white"
            opacity="0.5"
          />
        </svg>
        {/* Decorative circles — kept for extra depth */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 pointer-events-none" />
        <div className="absolute bottom-0 right-20 w-40 h-40 bg-white/5 rounded-full -mb-20 pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          {/* Left: greeting + hero revenue number */}
          <div className="flex-1 min-w-0">
            <p className="text-white/80 text-sm font-medium">
              {t('dash.greeting')}, {setting?.ownerName || 'Shop Owner'} 👋
            </p>
            <h2 className="text-xl lg:text-2xl font-bold mt-0.5 font-heading tracking-tight">
              {setting?.shopName || 'My Shop'}
            </h2>

            {/* Hero revenue number — big, bold, tabular nums for alignment */}
            <div className="mt-3 flex items-baseline gap-2 flex-wrap">
              <span className="text-white/70 text-sm font-medium">{t('dash.today_made')}</span>
            </div>
            <div className="flex items-baseline gap-3 mt-1 flex-wrap">
              <span className="text-4xl lg:text-5xl font-extrabold tabular-nums tracking-tight font-heading">
                {formatINR(kpis.todayRevenue)}
              </span>
              <span className="text-white/80 text-sm">
                {t('dash.from')} <span className="font-bold text-white">{kpis.todayTxnCount}</span> {t('dash.sales_word')}
              </span>
            </div>

            {/* Profit indicator — small pill below revenue */}
            {!hideProfit && kpis.todayProfit !== 0 && (
              <div className="mt-2 inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-3 py-1">
                {kpis.todayProfit > 0 ? (
                  <TrendingUp className="w-3.5 h-3.5" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5" />
                )}
                <span className="text-xs font-semibold tabular-nums">
                  {kpis.todayProfit > 0 ? '+' : ''}{formatINR(kpis.todayProfit)} profit
                </span>
              </div>
            )}
          </div>

          {/* Right: action buttons */}
          <div className="flex gap-2 flex-wrap lg:flex-nowrap lg:flex-col lg:items-end">
            <Button
              onClick={() => setView('new-sale')}
              className="bg-white text-primary hover:bg-white/90 gap-2 shadow-md"
            >
              <Plus className="w-4 h-4" />
              New Sale
            </Button>
            <div className="flex gap-2 flex-wrap">
              {/* Repeat Last Sale — loads the last sale's items into a new sale form */}
              {features?.repeatLastSale && (
                <Button
                  onClick={handleRepeatLastSale}
                  disabled={repeating}
                  variant="outline"
                  className="bg-white/10 text-white border-white/30 hover:bg-white/20 hover:text-white gap-2"
                  title={`Repeat your most recent sale`}
                >
                  {repeating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Repeat className="w-4 h-4" />}
                  <span className="hidden sm:inline">{repeating ? 'Loading...' : 'Repeat Last Sale'}</span>
                </Button>
              )}
              <Button
                onClick={() => setView('scanner')}
                variant="outline"
                className="bg-white/10 text-white border-white/30 hover:bg-white/20 hover:text-white gap-2"
              >
                <ScanLine className="w-4 h-4" />
                {t('dash.scan_bill')}
              </Button>
              {/* Share Today's Summary via WhatsApp */}
              {features?.whatsappSharing && kpis.todayTxnCount > 0 && (
                <Button
                  onClick={handleShareSummary}
                  variant="outline"
                  className="bg-white/10 text-white border-white/30 hover:bg-white/20 hover:text-white gap-2"
                  title="Share today's summary on WhatsApp"
                >
                  <Share2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Share Summary</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Date range selector + KPI header — sticky on desktop so user can change dates without scrolling back to top */}
      <div className="flex items-center justify-between gap-3 flex-wrap lg:sticky lg:top-3 lg:z-20 lg:bg-background/80 lg:backdrop-blur-md lg:py-2 lg:-mx-2 lg:px-2 lg:rounded-lg">
        <div>
          <h3 className="text-base font-semibold">{t('dash.business_overview')}</h3>
          <p className="text-xs text-muted-foreground">{t('dash.filter_hint')}</p>
        </div>
        <DateRangePicker value={dateRange} onChange={handleDateChange} preset={datePreset} onPresetChange={setDatePreset} />
      </div>

      {/* KPI Cards */}
      <div className={`grid grid-cols-2 ${hideProfit ? 'lg:grid-cols-2' : 'lg:grid-cols-4'} gap-3 lg:gap-4`}>
        <KPICard
          title={t('dash.today_revenue')}
          value={formatINR(kpis.todayRevenue)}
          icon={IndianRupee}
          gradient="from-amber-500 to-orange-600"
          subtitle={`${kpis.todayTxnCount} ${t('dash.sales_word')}`}
          onClick={() => navigateToSalesWithDate(todayStart, new Date(), 'Today')}
        />
        {!hideProfit && (
          <KPICard
            title={t('dash.today_profit')}
            value={formatINR(kpis.todayProfit)}
            icon={TrendingUp}
            gradient="from-emerald-500 to-teal-600"
            subtitle={`${t('stat.margin')} ${kpis.todayRevenue > 0 ? ((kpis.todayProfit / kpis.todayRevenue) * 100).toFixed(1) : 0}%`}
            onClick={() => navigateToSalesWithDate(todayStart, new Date(), 'Today')}
          />
        )}
        <KPICard
          title={`${rangeLabel} Revenue`}
          value={formatINR(kpis.rangeRevenue)}
          icon={Wallet}
          gradient="from-rose-500 to-pink-600"
          subtitle={`${kpis.rangeTxnCount} ${t('dash.sales_word')} • ${kpis.revenueGrowth >= 0 ? '↑' : '↓'} ${Math.abs(kpis.revenueGrowth).toFixed(1)}% vs prev`}
          trend={kpis.revenueGrowth >= 0 ? 'up' : 'down'}
          onClick={() => navigateToSalesWithDate(dateRange.from, dateRange.to, rangeLabel)}
        />
        {!hideProfit && (
          <KPICard
            title={`${t('dash.net_profit')} (${rangeLabel})`}
            value={formatINR(kpis.netProfit)}
            icon={PiggyBank}
            gradient="from-violet-500 to-purple-600"
            subtitle={`${kpis.profitGrowth >= 0 ? '↑' : '↓'} ${Math.abs(kpis.profitGrowth).toFixed(1)}% profit trend`}
            trend={kpis.profitGrowth >= 0 ? 'up' : 'down'}
            onClick={() => navigateToSalesWithDate(dateRange.from, dateRange.to, rangeLabel)}
          />
        )}
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
                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.62 0.15 155)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="oklch(0.62 0.15 155)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.tick }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: chartColors.tick }} axisLine={false} tickLine={false} tickFormatter={(v) => formatINRCompact(v)} />
              <Tooltip
                cursor={{ stroke: chartColors.grid, strokeWidth: 1, strokeDasharray: '3 3' }}
                contentStyle={chartColors.tooltipStyle}
                formatter={(v: number) => formatINR(v)}
              />
              <Area type="monotone" dataKey="revenue" stroke="oklch(0.62 0.18 42)" strokeWidth={2} fill="url(#colorRev)" name="Revenue" />
              {!hideProfit && (
                <Area type="monotone" dataKey="profit" stroke="oklch(0.62 0.15 155)" strokeWidth={2} fill="url(#colorProfit)" name={t('common.profit')} />
              )}
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
                  <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: chartColors.tick }} axisLine={false} tickLine={false} tickFormatter={(v) => formatINRCompact(v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: chartColors.tick }} axisLine={false} tickLine={false} width={130}
                    tickFormatter={(v) => v.length > 18 ? v.slice(0, 18) + '…' : v}
                  />
                  <Tooltip
                    cursor={{ fill: 'transparent' }}
                    contentStyle={chartColors.tooltipStyle}
                    formatter={(v: number, name: string) => name === 'revenue' ? [formatINR(v), 'Revenue'] : [formatINR(v), 'Profit']}
                  />
                  <Bar dataKey="revenue" fill="oklch(0.62 0.18 42)" radius={[0, 6, 6, 0]} barSize={18} name="revenue"
                    activeBar={{ fill: 'oklch(0.68 0.20 42)', barSize: 24 }}
                  />
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
                      isAnimationActive
                      animationDuration={300}
                    >
                      {paymentModeSplit.map((_, i) => (
                        <Cell
                          key={i}
                          fill={COLORS[i % COLORS.length]}
                          stroke="var(--background)"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      cursor={{ stroke: 'transparent', strokeWidth: 0 }}
                      formatter={(v: number) => formatINR(v)}
                      contentStyle={chartColors.tooltipStyle}
                    />
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
                All products well stocked!
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {lowStockProducts.slice(0, 6).map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg bg-rose-50/50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900">
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
              <div className="text-center py-8 text-sm text-muted-foreground">No transactions yet</div>
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
                        {isSale && txn.profit !== undefined && !hideProfit && (
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

      {/* Day-end summary card — shows after 6 PM with today's business summary */}
      {kpis && kpis.todayTxnCount > 0 && new Date().getHours() >= 18 && (
        <Card className="shadow-card border-border/60 overflow-hidden p-0">
          <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-3 text-white">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                <h3 className="text-base font-bold">Day-End Summary</h3>
              </div>
              <span className="text-xs text-white/70">{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold">{kpis.todayTxnCount}</p>
                <p className="text-[11px] text-white/80 uppercase tracking-wide">Sales</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{formatINRCompact(kpis.todayRevenue)}</p>
                <p className="text-[11px] text-white/80 uppercase tracking-wide">Revenue</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{formatINRCompact(kpis.totalReceivable)}</p>
                <p className="text-[11px] text-white/80 uppercase tracking-wide">Receivable</p>
              </div>
            </div>
            {features?.whatsappSharing && (
              <Button
                onClick={handleShareSummary}
                size="sm"
                variant="outline"
                className="mt-3 w-full bg-white/10 text-white border-white/30 hover:bg-white/20 gap-2"
              >
                <Share2 className="w-4 h-4" />
                Share on WhatsApp
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Business Goals — monthly revenue/expense targets with progress */}
      {(revenueTarget || expenseBudget) && kpis && (
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold">Monthly Goals</p>
            </div>
            <div className="space-y-3">
              {revenueTarget && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">Revenue Target</span>
                    <span className="text-xs text-muted-foreground">
                      {formatINRCompact(kpis.rangeRevenue)} / {formatINRCompact(revenueTarget)}
                    </span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', kpis.rangeRevenue >= revenueTarget ? 'bg-emerald-500' : 'bg-primary')}
                      style={{ width: `${Math.min(100, (kpis.rangeRevenue / revenueTarget) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {kpis.rangeRevenue >= revenueTarget
                      ? 'Target achieved!'
                      : `${((kpis.rangeRevenue / revenueTarget) * 100).toFixed(0)}% — ${formatINRCompact(revenueTarget - kpis.rangeRevenue)} to go`}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Business Health Score — overall wellness indicator */}
      {kpis && kpis.rangeTxnCount > 0 && <BusinessHealthScore kpis={kpis} />}

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
      {/* Hero card — matches the today's summary hero */}
      <Skeleton className="h-36 w-full rounded-2xl" />

      {/* 4 stat cards row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/60 p-4 space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Sales trend chart */}
      <div className="rounded-2xl border border-border/60 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>

      {/* Top products + category breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border/60 p-5 space-y-3 lg:col-span-2">
          <Skeleton className="h-5 w-40" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-border/60 p-5 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-48 w-full rounded-full mx-auto" />
        </div>
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
