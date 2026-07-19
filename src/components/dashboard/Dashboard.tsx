'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useAppStore } from '@/store/app-store'
import { useTranslation } from '@/hooks/use-translation'
import { useDashboard } from '@/hooks/use-dashboard'
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
  BookOpenText, Share2, Calendar, Target, HandCoins, FileText,
  AlertCircle, Send,
} from 'lucide-react'
import { formatINR, formatINRCompact, relativeTime, cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import { offlineFetch, isOnline, OfflineError } from '@/lib/offline-fetch'
import { useSetting } from '@/hooks/use-setting'
// 🔒 V26 R17 (Phase 5): Lazy-load the chart-heavy section (was: static recharts
// import → charting library in first-paint bundle, including login page).
// recharts is now only loaded when the Dashboard actually renders.
const DashboardCharts = dynamic(() => import('./DashboardCharts').then(m => m.DashboardCharts), {
  ssr: false,
  loading: () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
        <div className="h-28 rounded-xl bg-muted/40 animate-pulse" />
        <div className="h-28 rounded-xl bg-muted/40 animate-pulse" />
      </div>
      <div className="h-72 rounded-xl bg-muted/40 animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 h-72 rounded-xl bg-muted/40 animate-pulse" />
        <div className="h-72 rounded-xl bg-muted/40 animate-pulse" />
      </div>
    </div>
  ),
})
// 🔒 V20-003: Lazy-load heavy dashboard sub-components to reduce initial bundle.
// DayEndSummary and AnalyticsInsights import recharts + other heavy deps.
// Loading them dynamically moves ~200KB out of the initial JS payload.
const DayEndSummary = dynamic(() => import('@/components/dashboard/DayEndSummary').then(m => ({ default: m.DayEndSummary })), { ssr: false, loading: () => null })
const AnalyticsInsights = dynamic(() => import('@/components/dashboard/AnalyticsInsights').then(m => ({ default: m.AnalyticsInsights })), { ssr: false, loading: () => null })
import { useRecurringEntries } from '@/hooks/use-recurring-entries'
import { toast as sonnerToast } from 'sonner'
import { useCountUp } from '@/hooks/use-count-up'
import { EmptyState } from '@/components/common/EmptyState'

const COLORS = ['oklch(0.62 0.18 42)', 'oklch(0.62 0.15 155)', 'oklch(0.72 0.16 80)', 'oklch(0.6 0.12 200)', 'oklch(0.65 0.22 15)']

export function Dashboard() {
  const { setView, setSelectedTransactionId, setPreviousView, setPendingDateRange, features } = useAppStore()
  // 🔒 AUDIT V25 FIX BUG-032 (Batch 6): Subscribe to deep-link triggers from MoreScreen.
  const triggerDayEnd = useAppStore((s) => s.triggerDayEnd)
  const fireTriggerDayEnd = useAppStore((s) => s.fireTriggerDayEnd)
  const scrollTarget = useAppStore((s) => s.scrollTarget)
  const setScrollTarget = useAppStore((s) => s.setScrollTarget)
  const { t, language } = useTranslation()
  const { hideProfit } = useSetting()
  const { revenueTarget, expenseBudget } = useBusinessGoals()
  const { checkAndCreate: checkRecurring } = useRecurringEntries()
  const [dateRange, setDateRange] = useState<DateRange>(() => getPresetRange('thisMonth'))
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth')
  const [repeating, setRepeating] = useState(false)
  // 🔒 V17-Ext §5.4: Day-end "Close the Drawer" dialog
  const [showDayEnd, setShowDayEnd] = useState(false)

  // 🔒 AUDIT V25 FIX BUG-032 (Batch 6): When MoreScreen's "Day-End Summary" is
  // tapped, it calls fireTriggerDayEnd() + setView('dashboard'). This effect
  // detects the counter increment + opens the Close Drawer dialog. Skips the
  // initial mount (counter starts at 0).
  const prevTriggerDayEnd = useRef(0)
  useEffect(() => {
    if (triggerDayEnd > prevTriggerDayEnd.current) {
      prevTriggerDayEnd.current = triggerDayEnd
      setShowDayEnd(true)
    }
  }, [triggerDayEnd])

  // 🔒 AUDIT V25 FIX BUG-032 (Batch 6): When MoreScreen's "Smart Insights" or
  // "Cash in Hand" is tapped, it sets scrollTarget + setView('dashboard'). This
  // effect scrolls to the element with matching id after the dashboard renders.
  // Cleared after scrolling so it doesn't re-trigger on every mount.
  useEffect(() => {
    if (!scrollTarget) return
    // Small delay to let the dashboard finish rendering before scrolling.
    const timer = setTimeout(() => {
      const el = document.getElementById(scrollTarget)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // Brief highlight so the user sees which card was deep-linked to.
        el.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background', 'transition-all')
        setTimeout(() => {
          el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background')
        }, 2000)
      }
      setScrollTarget(null)  // clear after use
    }, 300)
    return () => clearTimeout(timer)
  }, [scrollTarget, setScrollTarget])

  // Check for due recurring entries on mount (auto-create monthly rent, salary, etc.)
  useEffect(() => {
    if (features?.recurringEntries) {
      checkRecurring()
    }
  }, [features?.recurringEntries, checkRecurring])

  // 🔒 V9 4.1: After 3 seconds of loading, show a friendly "waking up" message.
  // Timer is cleared when loading completes (isLoading becomes false).
  // Note: isLoading comes from useDashboard below — we use a ref + effect
  // pattern to avoid the "used before declaration" error.
  const [showWakingMessage, setShowWakingMessage] = useState(false)
  const loadingRef = useRef(false)

  // 🔒 V9 1.2 FIX: Use the shared useDashboard hook (day-granular cache keys)
  // instead of an inline useQuery with millisecond-precision timestamps.
  // Was: two different cache keys (Dashboard.tsx inline + page.tsx shared hook)
  // → two full dashboard API calls on every page load (28s + 41s on cold DB).
  // Now: ONE hook, ONE cache key, ONE API call. React Query dedupes.
  const { data, isLoading, error } = useDashboard(dateRange)

  // 🔒 V9 4.1: Track loading state in ref for the waking-message timer
  useEffect(() => {
    loadingRef.current = isLoading
    if (isLoading) {
      const timer = setTimeout(() => {
        if (loadingRef.current) setShowWakingMessage(true)
      }, 3000)
      return () => clearTimeout(timer)
    } else {
      setShowWakingMessage(false)
    }
  }, [isLoading])

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

  // 🔒 BUG FIX V5: Show error state if query fails (e.g., 401) and no data
  if (error && !data && !isLoading) {
    return (
      <div className="space-y-3 lg:space-y-5">
        <DateRangeHeader
          dateRange={dateRange}
          datePreset={datePreset}
          onChange={handleDateChange}
          onPresetChange={setDatePreset}
        />
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center mb-4">
            <CloudOff className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Unable to load dashboard</h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            Your session may have expired. Please refresh the page or log in again.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.href = '/'}
            className="gap-2"
          >
            Go to Login
          </Button>
        </div>
      </div>
    )
  }

  if (isOfflineNoData) {
    return (
      <div className="space-y-3 lg:space-y-5">
        <DateRangeHeader
          dateRange={dateRange}
          datePreset={datePreset}
          onChange={handleDateChange}
          onPresetChange={setDatePreset}
        />
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center mb-4">
            <CloudOff className="w-8 h-8 text-amber-600 dark:text-amber-400" />
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
      <div className="space-y-3 lg:space-y-5">
        <DateRangeHeader
          dateRange={dateRange}
          datePreset={datePreset}
          onChange={handleDateChange}
          onPresetChange={setDatePreset}
        />
        {/* 🔒 V9 4.1: Friendly overlay message after 3s so the user knows the
            app is working, not broken. Centered on screen with a colorful
            saffron spinner so it's impossible to miss. */}
        {showWakingMessage && (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-14 h-14 rounded-full border-4 border-primary/20 border-t-primary animate-spin mb-4" />
            <p className="text-base font-semibold text-primary">Waking up your shop…</p>
            <p className="text-sm text-muted-foreground mt-1">Almost there — just a moment.</p>
          </div>
        )}
        {!showWakingMessage && <DashboardSkeleton />}
      </div>
    )
  }

  // 🔒 BUG FIX V5: Add null checks to prevent crash when API returns error
  // Was: const { kpis, ... } = data → if data is partial/missing, crash
  // Now: provide defaults for every field
  const kpis = data.kpis || { todayRevenue: 0, todayProfit: 0, todayTxnCount: 0, todayCreditNoteCount: 0, rangeRevenue: 0, rangeProfit: 0, rangeExpenses: 0, rangePurchases: 0, rangeIncome: 0, revenueGrowth: 0, profitGrowth: 0, totalReceivable: 0, totalPayable: 0, rangeSaleCount: 0 }
  const salesTrend = data.salesTrend || []
  const topProducts = data.topProducts || []
  const categoryBreakdown = data.categoryBreakdown || []
  const paymentModeSplit = data.paymentModeSplit || []
  const lowStockProducts = data.lowStockProducts || []
  const gstSummary = data.gstSummary || { totalTaxableSales: 0, totalCGST: 0, totalSGST: 0, totalIGST: 0, totalTax: 0 }
  const recentTransactions = data.recentTransactions || []
  const setting = data.setting || { shopName: 'My Shop' }

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
    lines.push(`Generated by EkBook`)

    const text = encodeURIComponent(lines.join('\n'))
    window.open(`https://wa.me/?text=${text}`, '_blank')
  }

  // Repeat last sale — fetches the ACTUAL latest sale (bypassing cache)
  // then pre-fills the New Sale form with its items
  const handleRepeatLastSale = async () => {
    setRepeating(true)
    try {
      // Fetch the latest sale transaction directly (cache: 'no-store' to bypass browser cache)
      // 🔒 V4 BUG-3 + V9: Use offlineFetch (not raw fetch) so this works offline.
      // Was reverted during a rebase conflict. Now fixed.
      const r = await offlineFetch('/api/transactions?limit=1&type=sale', {
        cache: 'no-store',
      })
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
      // 🔒 V4 BUG-3: Handle offline errors specifically
      if (err instanceof OfflineError) {
        sonnerToast.error('You are offline and no recent sale is cached.')
      } else {
        sonnerToast.error('Failed to load last sale')
      }
    } finally {
      setRepeating(false)
    }
  }

  // Empty state for new users (0 transactions)
  // 🔒 V7.1 + V9: Only show welcome screen if the user has NO data at all
  // (no products, no parties, no transactions). Was: also checked totalStockValue
  // which is 0 for products with 0 stock/purchasePrice → false positive for
  // existing users. Was reverted during rebase — now fixed.
  const isNewUser = kpis.productCount === 0 && kpis.partyCount === 0 && kpis.rangeTxnCount === 0 && recentTransactions.length === 0

  if (isNewUser) {
    return (
      <div className="space-y-3 lg:space-y-5">
        <DateRangeHeader
          dateRange={dateRange}
          datePreset={datePreset}
          onChange={handleDateChange}
          onPresetChange={setDatePreset}
        />
        {/* 🔒 Feature Phase 7: Guided first-sale flow — get new users to their
            first value in <2 minutes. The old empty state had 3 equal buttons
            (Record a Sale, Add Products, Scan a Bill) with no clear primary
            action. The new version has a prominent "Record Your First Sale"
            CTA with a 2-step guide that's faster to complete.

            Step 1: Add a product (quick inline — name + price only)
            Step 2: Record a sale with that product
            Both steps link directly to the respective entry screens.

            The "or try demo data" option seeds sample data for users who
            want to explore before entering real data.
        */}
        <div className="rounded-2xl bg-gradient-saffron p-6 lg:p-10 text-white shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32" />
          <div className="relative z-10">
            <BookOpenText className="w-10 h-10 text-white mb-3" />
            <h2 className="text-xl lg:text-2xl font-bold mb-1">Welcome to EkBook! 🎉</h2>
            <p className="text-white/80 text-sm mb-5">
              Let's record your first sale — it takes less than 2 minutes.
            </p>

            {/* Step-by-step guide */}
            <div className="space-y-3 max-w-lg">
              {/* Step 1: Add a product */}
              <button
                onClick={() => {
                  setPreviousView('dashboard')
                  setView('inventory')
                  sonnerToast.info('Step 1: Add a product', {
                    description: 'Tap "Add Product" and enter the name + sale price. Then come back to record your first sale.',
                    duration: 8000,
                  })
                }}
                className="w-full bg-white/15 hover:bg-white/25 rounded-xl p-4 text-left transition active:scale-[0.98] flex items-center gap-3 group"
              >
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm flex-shrink-0">1</div>
                <div className="flex-1">
                  <p className="font-semibold text-sm flex items-center gap-1.5">
                    <Package className="w-4 h-4" /> Add your first product
                  </p>
                  <p className="text-xs text-white/70 mt-0.5">Enter a product name + price (30 seconds)</p>
                </div>
                <ArrowRight className="w-4 h-4 text-white/60 group-hover:text-white group-hover:translate-x-0.5 transition" />
              </button>

              {/* Step 2: Record a sale */}
              <button
                onClick={() => {
                  setPreviousView('dashboard')
                  setView('new-sale')
                  sonnerToast.info('Step 2: Record your first sale', {
                    description: 'Select a product, enter the quantity, and tap Save. Your dashboard will come alive!',
                    duration: 8000,
                  })
                }}
                className="w-full bg-white text-saffron-600 rounded-xl p-4 text-left transition active:scale-[0.98] flex items-center gap-3 shadow-lg group"
              >
                <div className="w-8 h-8 rounded-full bg-saffron-600/10 flex items-center justify-center font-bold text-sm flex-shrink-0">2</div>
                <div className="flex-1">
                  <p className="font-semibold text-sm flex items-center gap-1.5">
                    <Plus className="w-4 h-4" /> Record your first sale
                  </p>
                  <p className="text-xs text-saffron-600/70 mt-0.5">Pick a product, enter qty, tap Save (60 seconds)</p>
                </div>
                <ArrowRight className="w-4 h-4 text-saffron-600/60 group-hover:text-saffron-600 group-hover:translate-x-0.5 transition" />
              </button>

              {/* Or: Scan a bill */}
              <button
                onClick={() => {
                  setPreviousView('dashboard')
                  setView('scanner')
                }}
                className="w-full bg-white/10 hover:bg-white/20 rounded-xl p-3 text-left transition active:scale-[0.98] flex items-center gap-3 group"
              >
                <ScanLine className="w-5 h-5 text-white/80 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-sm text-white/90">Or: Scan a bill with AI</p>
                  <p className="text-xs text-white/60 mt-0.5">Snap a photo — we'll auto-fill everything</p>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-white/40 group-hover:text-white/70 transition" />
              </button>
            </div>
          </div>
        </div>

        {/* Quick stats (all zeros but shows the layout) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Today's Revenue", value: '₹0', icon: IndianRupee, color: 'text-amber-600 dark:text-amber-400 bg-amber-100' },
            { label: "Today's Profit", value: '₹0', icon: TrendingUp, color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100' },
            { label: 'Products', value: '0', icon: Package, color: 'text-blue-600 bg-blue-100' },
            { label: 'Customers', value: '0', icon: Wallet, color: 'text-violet-600 bg-violet-100' },
          ].map((stat, i) => {
            const Icon = stat.icon
            return (
              <Card key={i} className="shadow-card border-border/60 border-t-2 border-t-primary/10">
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
    <div className="space-y-3 lg:space-y-5">
      {/* Greeting banner — also the "Cash in Hand" deep-link target */}
      {/* 🔒 AUDIT V25 FIX BUG-032 (Batch 6): id='cash-in-hand' for scroll-target deep-link. */}
      <motion.div
        id="cash-in-hand"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl bg-gradient-saffron p-4 lg:p-6 text-white shadow-lg relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32" />
        <div className="absolute bottom-0 right-20 w-40 h-40 bg-white/5 rounded-full -mb-20" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <p className="text-white/80 text-sm font-medium">{t('dash.greeting')}, {setting?.ownerName || 'Shop Owner'}</p>
            <h2 className="text-2xl lg:text-3xl font-bold mt-1">{setting?.shopName || 'My Shop'}</h2>
            <p className="text-white/80 text-sm mt-1">
              {t('dash.today_made')} <span className="font-bold text-white">{formatINR(kpis.todayRevenue)}</span> {t('dash.from')} <span className="font-bold text-white">{kpis.todayTxnCount}</span> {t('dash.sales_word')}
              {/* 🔒 V17 Audit Phase 1 P0.3: Show "net of returns" badge if credit notes exist today */}
              {kpis.todayCreditNoteCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-[11px] bg-white/20 px-2 py-0.5 rounded-full">
                  <FileText className="w-3 h-3" />
                  {kpis.todayCreditNoteCount} return{kpis.todayCreditNoteCount !== 1 ? 's' : ''} netted
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => setView('new-sale')}
              className="bg-white text-primary hover:bg-white/90 gap-2 shadow-md"
            >
              <Plus className="w-4 h-4" />
              New Sale
            </Button>
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
            {/* 🔒 V17-Ext §5.4: Close the Drawer — day-end cash reconciliation */}
            <Button
              onClick={() => setShowDayEnd(true)}
              variant="outline"
              className="bg-white/10 text-white border-white/30 hover:bg-white/20 hover:text-white gap-2"
              title="Close the drawer — end of day cash summary"
            >
              <Wallet className="w-4 h-4" />
              <span className="hidden sm:inline">Close Drawer</span>
            </Button>
          </div>
        </div>
      </motion.div>

      {/* 🔒 V22-8 (Phase 6): Quick Action Shortcuts — horizontal scrollable row
          of 6 one-tap actions. Inspired by PhonePe's quick actions row.
          Visible on all screen sizes; horizontally scrollable on mobile. */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {[
          { label: 'New Sale', icon: Plus, view: 'new-sale' as const, color: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400' },
          { label: 'Add Product', icon: Package, view: 'inventory' as const, color: 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400' },
          { label: 'Scan Bill', icon: ScanLine, view: 'scanner' as const, color: 'bg-violet-100 dark:bg-violet-950 text-violet-600 dark:text-violet-400' },
          { label: 'Add Party', icon: Wallet, view: 'parties' as const, color: 'bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400' },
          { label: 'Reports', icon: Receipt, view: 'reports' as const, color: 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400' },
          { label: 'Income', icon: HandCoins, view: 'income-expense' as const, color: 'bg-teal-100 dark:bg-teal-950 text-teal-600 dark:text-teal-400' },
        ].map((action) => {
          const ActionIcon = action.icon
          return (
            <button
              key={action.label}
              onClick={() => {
                setPreviousView('dashboard')
                setView(action.view)
              }}
              className="card-hover flex flex-col items-center gap-1.5 p-2.5 rounded-xl bg-card border border-border/60 shadow-sm hover:border-primary/30 flex-shrink-0 min-w-[72px] active:scale-95"
            >
              <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', action.color)}>
                <ActionIcon className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-medium text-center leading-tight">{action.label}</span>
            </button>
          )
        })}
      </div>

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
          animateValue={kpis.todayRevenue}
          icon={IndianRupee}
          gradient="from-amber-500 to-orange-600"
          // 🔒 AUDIT V24 §3: This figure is GST-INCLUSIVE (Σ totalAmount, net of
          // credit notes) while the P&L "Revenue" is taxable (ex-GST). Same word,
          // two numbers = instant distrust. Label the basis explicitly here and
          // on the P&L report so the difference reads as intentional.
          subtitle={`${kpis.todayTxnCount} ${t('dash.sales_word')} • ${t('dash.incl_gst')}`}
          onClick={() => navigateToSalesWithDate(todayStart, new Date(), 'Today')}
        />
        {!hideProfit && (
          <KPICard
            title={t('dash.today_profit')}
            value={formatINR(kpis.todayProfit)}
            animateValue={kpis.todayProfit}
            icon={TrendingUp}
            gradient="from-emerald-500 to-teal-600"
            subtitle={`${t('stat.margin')} ${kpis.todayRevenue > 0 ? ((kpis.todayProfit / kpis.todayRevenue) * 100).toFixed(1) : 0}%`}
            onClick={() => navigateToSalesWithDate(todayStart, new Date(), 'Today')}
          />
        )}
        <KPICard
          title={`${rangeLabel} Revenue`}
          value={formatINR(kpis.rangeRevenue)}
          animateValue={kpis.rangeRevenue}
          icon={Wallet}
          gradient="from-rose-500 to-pink-600"
          subtitle={`${kpis.rangeTxnCount} ${t('dash.sales_word')} (${t('dash.incl_gst')}) • ${kpis.revenueGrowth >= 0 ? '↑' : '↓'} ${Math.abs(kpis.revenueGrowth).toFixed(1)}% vs prev`}
          trend={kpis.revenueGrowth >= 0 ? 'up' : 'down'}
          onClick={() => navigateToSalesWithDate(dateRange.from, dateRange.to, rangeLabel)}
        />
        {!hideProfit && (
          <KPICard
            title={`${t('dash.net_profit')} (${rangeLabel})`}
            value={formatINR(kpis.netProfit)}
            animateValue={kpis.netProfit}
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
          color="text-emerald-600 dark:text-emerald-400"
          onClick={() => setView('parties')}
        />
        <MiniStatCard
          label={t('dash.payable')}
          value={formatINR(kpis.totalPayable)}
          icon={ArrowUpRight}
          color="text-rose-600"
          onClick={() => setView('parties')}
        />
        {/* 🔒 FIX M-NEW-2: Collections Today — udhaar payments received today */}
        {kpis.todayCollections > 0 && (
          <MiniStatCard
            label="Collected Today"
            value={formatINR(kpis.todayCollections)}
            icon={HandCoins}
            color="text-blue-600"
            subtitle={`${kpis.todayCollectionCount} payment${kpis.todayCollectionCount === 1 ? '' : 's'}`}
            onClick={() => setView('parties')}
          />
        )}
        <MiniStatCard
          label={t('dash.stock_value')}
          value={formatINR(kpis.totalStockValue)}
          icon={Boxes}
          color="text-amber-600 dark:text-amber-400"
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

      {/* 🔒 AUDIT V25 FIX §3 row 9 (Batch 3): Removed duplicate Revenue Target
          Progress Card (was lines 597-671). The "Business Goals" card at the
          bottom of the dashboard shows BOTH revenue target AND expense budget
          with progress — more informative. The duplicate caused confusion
          (two progress bars for the same target on one screen) and the
          auditor flagged it. */}
      {/* 🔒 AUDIT V25 BATCH 3b REVERT: §2.4 right-rail layout was reverted per
          user feedback — the single-column layout looked better. Keeping the
          duplicate removal above (§3 row 9) since that's a separate fix. */}

      {/* 🔒 V26 R17 (Phase 5): Chart sections lazy-loaded via DashboardCharts.
          recharts is now only in this dynamic chunk, NOT in the first-paint
          bundle. Skeleton fallback shows while the chunk loads. */}
      <DashboardCharts
        salesTrend={salesTrend}
        kpis={kpis}
        hideProfit={hideProfit}
        topProducts={topProducts}
        paymentModeSplit={paymentModeSplit}
        t={t}
        setView={setView}
      />

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
        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
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
        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Receipt className="w-4 h-4 text-amber-600 dark:text-amber-400" />
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
              <EmptyState
                icon={Receipt}
                title="No transactions yet"
                description="Record your first sale or purchase to see it here."
                action={{ label: 'New Sale', onClick: () => setView('new-sale') }}
                color="emerald"
                compact
              />
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
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
                      className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/50 transition text-left"
                    >
                      {/* Circular avatar — shows first letter of party name,
                          or icon for walk-in. Tinted with accent color. */}
                      <div className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm',
                        isInflow ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-900/40 text-rose-600'
                      )}>
                        {txn.partyName
                          ? txn.partyName.charAt(0).toUpperCase()
                          : isInflow
                            ? <ArrowDownRight className="w-4 h-4" />
                            : <ArrowUpRight className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {txn.partyName || 'Walk-in Customer'}
                        </p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                          <span className="capitalize">{txn.type}</span>
                          <span>•</span>
                          <span>{relativeTime(txn.date)}</span>
                          {txn.invoiceNo && (
                            <>
                              <span>•</span>
                              <span className="truncate">{txn.invoiceNo}</span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={cn(
                          'text-sm font-bold tabular-nums',
                          isInflow ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                        )}>
                          {isInflow ? '+' : '-'}{formatINRCompact(txn.totalAmount)}
                        </p>
                        {isSale && txn.profit !== undefined && !hideProfit && (
                          <p className="text-[10px] text-muted-foreground tabular-nums">
                            +{formatINRCompact(txn.profit)}
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
        {/* 🔒 AUDIT V25 BATCH 4b REVERT: Health Score moved back out of this
            column — user feedback said the earlier version (Health Score as
            standalone full-width card below Business Goals) looked better.
            GST summary is back to being a standalone card in the right column
            of the Recent Transactions + GST summary 2-col grid. */}
        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
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
              <GstMiniStat label="Output Tax (Sales)" value={gstSummary.outputTax} color="text-amber-600 dark:text-amber-400" />
              <GstMiniStat label="Input Tax (Purchase)" value={gstSummary.inputTax} color="text-emerald-600 dark:text-emerald-400" />
              <GstMiniStat label="CGST + SGST" value={gstSummary.cgst + gstSummary.sgst} color="text-violet-600" />
              <GstMiniStat label="Net GST Payable" value={gstSummary.netPayable} color={gstSummary.netPayable >= 0 ? 'text-rose-600' : 'text-emerald-600 dark:text-emerald-400'} highlight />
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

      {/* 🔒 AUDIT V25 BATCH 3b REVERT: Removed right-rail wrapper. Single column again. */}

      {/* Business Goals — monthly revenue/expense targets with progress */}
      {(revenueTarget || expenseBudget) && kpis && (
        <div className="rounded-2xl bg-card border border-border/60 border-t-2 border-t-primary/10 shadow-card overflow-hidden">
          <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-3 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10 pointer-events-none" />
            <div className="relative flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Target className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold font-heading">Monthly Goals</p>
                <p className="text-[10px] text-white/80">Track your progress this month</p>
              </div>
            </div>
          </div>
          <div className="p-3 space-y-3">
            {revenueTarget && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold">Revenue Target <span className="text-muted-foreground font-normal">(selected range)</span></span>
                  <span className="text-xs font-bold tabular-nums">
                    {formatINRCompact(kpis.rangeRevenue)} / {formatINRCompact(revenueTarget)}
                  </span>
                </div>
                <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500', kpis.rangeRevenue >= revenueTarget ? 'bg-emerald-500' : 'bg-primary')}
                    style={{ width: `${Math.min(100, (kpis.rangeRevenue / revenueTarget) * 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                  {kpis.rangeRevenue >= revenueTarget
                    ? '🎉 Target achieved!'
                    : `${((kpis.rangeRevenue / revenueTarget) * 100).toFixed(0)}% — ${formatINRCompact(revenueTarget - kpis.rangeRevenue)} to go`}
                </p>
              </div>
            )}
            {expenseBudget && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold">Expense Budget</span>
                  <span className="text-xs font-bold tabular-nums">
                    {formatINRCompact(kpis.rangeExpenses || 0)} / {formatINRCompact(expenseBudget)}
                  </span>
                </div>
                <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500',
                      (kpis.rangeExpenses || 0) > expenseBudget ? 'bg-rose-500' : 'bg-amber-500'
                    )}
                    style={{ width: `${Math.min(100, ((kpis.rangeExpenses || 0) / expenseBudget) * 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                  {(kpis.rangeExpenses || 0) > expenseBudget
                    ? `⚠️ Over budget by ${formatINRCompact((kpis.rangeExpenses || 0) - expenseBudget)}`
                    : `${formatINRCompact(expenseBudget - (kpis.rangeExpenses || 0))} remaining`}
                </p>
              </div>
            )}
            {(!revenueTarget && !expenseBudget) && (
              <p className="text-xs text-muted-foreground text-center py-2">
                No goals set. Go to Settings → Business Goals to set targets.
              </p>
            )}
          </div>
        </div>
      )}

      {/* 🔒 Feature Phase 4: Daily Digest card — shows after 9 PM IST with
          today's business summary. Opt-in via Settings → Notifications. */}
      {kpis && kpis.todayTxnCount > 0 && (() => {
        // Check if daily digest is enabled + it's after 9 PM IST
        const now = new Date()
        const istHour = (now.getUTCHours() + 5 + (now.getUTCMinutes() >= 30 ? 1 : 0)) % 24
        if (istHour < 21) return null  // Only show after 9 PM IST
        try {
          const prefs = JSON.parse(localStorage.getItem('bahikhata:notif-prefs') || '{}')
          if (prefs.dailyDigest === false) return null  // Opt-out
        } catch { /* default to showing */ }

        const digestText = `📊 EkBook Daily Digest\n\nSales today: ${kpis.todayTxnCount}\nRevenue: ${formatINR(kpis.todayRevenue)}\nProfit: ${formatINR(kpis.todayProfit)}\nReceivable: ${formatINR(kpis.totalReceivable)}\n\n— Sent from EkBook`

        return (
          <div className="rounded-2xl bg-gradient-to-r from-indigo-500 to-blue-600 p-4 text-white shadow-card relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10 pointer-events-none" />
            <div className="relative flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <Repeat className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-bold">Today's Digest</p>
                  <p className="text-[11px] text-white/80">
                    {kpis.todayTxnCount} sales · {formatINR(kpis.todayRevenue)} revenue · {formatINR(kpis.todayProfit)} profit
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  const url = `https://wa.me/?text=${encodeURIComponent(digestText)}`
                  window.open(url, '_blank')
                }}
                className="text-xs font-medium bg-white/20 hover:bg-white/30 rounded-full px-3 py-1.5 transition flex items-center gap-1"
              >
                <Send className="w-3 h-3" /> Share
              </button>
            </div>
          </div>
        )
      })()}

      {/* 🔒 Feature Phase 5: Auto-backup reminder — shows if last backup
          is >7 days old. Opt-in via Settings → Notifications. */}
      {(() => {
        try {
          const prefs = JSON.parse(localStorage.getItem('bahikhata:notif-prefs') || '{}')
          if (prefs.backupReminder === false) return null
          const lastBackup = localStorage.getItem('bahikhata:last-backup')
          if (!lastBackup) return null  // Never backed up — don't nag on first use
          const daysSince = (Date.now() - new Date(lastBackup).getTime()) / (1000 * 60 * 60 * 24)
          if (daysSince < 7) return null  // Recent backup — no reminder needed
          return (
            <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">Backup Reminder</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                    Your last backup was {Math.floor(daysSince)} days ago. Back up your data regularly to prevent loss.
                  </p>
                  <button
                    onClick={() => setView('settings')}
                    className="text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline mt-2 flex items-center gap-1"
                  >
                    Go to Backup <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          )
        } catch { return null }
      })()}

      {/* Business Health Score — overall wellness indicator.
          🔒 AUDIT V25 BATCH 4b REVERT: Restored to standalone full-width card
          below Business Goals (was moved below GST summary in Batch 4 §4.2,
          but user feedback said the earlier version looked better). */}
      {kpis && kpis.rangeTxnCount > 0 && <BusinessHealthScore kpis={kpis} />}

      {/* 🔒 AUDIT V25 BATCH 4c (user request): Smart Insights + Business Analytics
          reverted to standalone full-width (was 2-col grid in Batch 4). User
          feedback: content was too cramped in 2-col. Now full-width with
          improved internal readability — larger text, more padding, 2-col
          insight grid inside each card to fill horizontal space. */}

      {/* {t('dash.smart_insights')} - AI-powered alerts */}
      {/* 🔒 AUDIT V25 FIX BUG-032 (Batch 6): id='smart-insights' for scroll-target deep-link. */}
      <div id="smart-insights">
        {kpis && <SmartInsights />}
      </div>

      {/* V17-Ext 5.5: Business Analytics — best-sellers, dead stock, top customers, reorder */}
      {features?.businessAnalytics && <AnalyticsInsights />}

      {/* 🔒 V17-Ext §5.4: Day-end "Close the Drawer" dialog */}
      <DayEndSummary open={showDayEnd} onOpenChange={setShowDayEnd} />
    </div>
  )
}

function KPICard({ title, value, icon: Icon, gradient, subtitle, trend, onClick, animateValue }: {
  title: string
  value: string
  icon: any
  gradient: string
  subtitle?: string
  trend?: 'up' | 'down'
  onClick?: () => void
  animateValue?: number
}) {
  const shouldAnimate = animateValue !== undefined && animateValue > 0
  const animatedNum = useCountUp(shouldAnimate ? animateValue! : 0)
  const displayValue = shouldAnimate ? formatINR(animatedNum) : value

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={onClick ? 'cursor-pointer' : ''}
      onClick={onClick}
    >
      {/* White card with colored gradient icon + subtle colored top border */}
      <div className={`rounded-2xl bg-card border border-border/60 shadow-card relative overflow-hidden h-full transition hover:shadow-lg ${onClick ? 'hover:scale-[1.02]' : ''}`}>
        {/* Subtle colored top border — connects card to theme */}
        <div className={`h-1 bg-gradient-to-r ${gradient}`} />
        <div className="p-3 lg:p-5 relative">
          <div className="flex items-start justify-between mb-3">
            <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md flex-shrink-0`}>
              <Icon className="w-4 h-4 text-white" />
            </div>
            {trend && (
              <div className={cn('flex items-center text-xs font-bold rounded-full px-2 py-0.5',
                trend === 'up' ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/40' : 'text-rose-600 bg-rose-100 dark:bg-rose-950/40'
              )}>
                {trend === 'up' ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
          <p className="text-xl lg:text-2xl font-bold mt-0.5 tracking-tight tabular-nums">{displayValue}</p>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-1 truncate">{subtitle}</p>}
        </div>
      </div>
    </motion.div>
  )
}

function MiniStatCard({ label, value, icon: Icon, color, subtitle, onClick }: {
  label: string
  value: string
  icon: any
  color: string
  subtitle?: string
  onClick?: () => void
}) {
  // Map text color to bg color for the glass icon container
  const bgClass = color.includes('emerald') ? 'bg-emerald-500/10'
    : color.includes('rose') ? 'bg-rose-500/10'
    : color.includes('amber') ? 'bg-amber-500/10'
    : color.includes('blue') ? 'bg-blue-500/10'
    : 'bg-violet-500/10'

  return (
    <div
      className={`rounded-2xl bg-card border border-border/60 shadow-card hover:shadow-md transition cursor-pointer ${onClick ? 'hover:scale-[1.02]' : ''}`}
      onClick={onClick}
    >
      <div className="p-3 lg:p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', bgClass)}>
            <Icon className={cn('w-3.5 h-3.5', color)} />
          </div>
          <p className="text-[10px] lg:text-[11px] text-muted-foreground font-medium uppercase tracking-wide leading-tight truncate">{label}</p>
        </div>
        <p className="text-base lg:text-lg font-bold tracking-tight tabular-nums">{value}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
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
    <div className="space-y-3 lg:space-y-5">
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
      <div className="rounded-2xl border border-border/60 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>

      {/* Top products + category breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border/60 p-4 space-y-3 lg:col-span-2">
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
        <div className="rounded-2xl border border-border/60 p-4 space-y-3">
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
