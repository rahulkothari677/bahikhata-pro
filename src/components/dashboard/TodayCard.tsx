'use client'

/**
 * The top of Home (Phase 5b-2, ledger model §7): the Today card, the quick
 * tiles, and To collect / To pay.
 *
 * Today card: today's sales against the same hours last week, then three
 * figures a shopkeeper checks all day — Cash in drawer, Udhaar collected,
 * Profit today — each opening how it is worked out (ProofSheet). New Sale and
 * Scan a bill stay the two big buttons; Repeat last sale and Share today keep
 * their place as small buttons on the card, so nothing disappears.
 *
 * Quick tiles: nav-registry destinations on the 'home-tiles' surface, in
 * tileOrder, opened by the shared handleNavAction — no second list. The
 * model's set: Reports, Cashbook, Items & stock, Reminders, Close day, and GST
 * for a regular GST shop. Five for a shop without GST, as Rahul asked on
 * 13 Aug ("i just want 5 cards"). What left the row is still one tap away:
 * Scan a bill on this card, Ask first in the search box (and in More), Add
 * product / Add party in the + sheet.
 *
 * To collect / To pay: the receivable and payable totals with how many
 * customers and suppliers they come from (counted from the same balances).
 */
import { useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { motion } from 'framer-motion'
import { Plus, ScanLine, Repeat, Loader2, Share2, FileText, ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/app-store'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { useTranslation } from '@/hooks/use-translation'
import { NAV_REGISTRY, filterByPermissions, navShortName, type NavDestination } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import type { GstStatus } from '@/lib/shop-tax'
import { formatINR, cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { lastWeekdayName, proofCountLine, type ProofSpec } from './ProofSheet'

export interface TodayKpis {
  todayRevenue: number
  todayProfit: number
  todayTxnCount: number
  todayCreditNoteCount: number
  todayCollections: number
  todayLastWeekRevenue?: number
  totalReceivable: number
  totalPayable: number
  receivableCount?: number
  payableCount?: number
}

/** Home's quick tiles, in order, from the registry. Exported for the guard. */
export function homeTiles(items: NavDestination[]): NavDestination[] {
  return items
    .filter((d) => d.surfaces?.includes('home-tiles'))
    .sort((a, b) => (a.tileOrder ?? 99) - (b.tileOrder ?? 99))
}

/** "from 12 customers" / "to 1 supplier". Exported for the guard. */
export function partiesLine(n: number, side: 'customer' | 'supplier', t: (k: string) => string): string {
  if (n === 0) return t(side === 'customer' ? 'today.nobody_owes' : 'today.you_owe_nobody')
  const key = side === 'customer'
    ? (n === 1 ? 'today.from_customer_one' : 'today.from_customers')
    : (n === 1 ? 'today.to_supplier_one' : 'today.to_suppliers')
  return t(key).replace('{n}', String(n))
}

const onSaffron = 'bg-white/10 text-white border-white/30 hover:bg-white/20 hover:text-white'

export function TodayCard({
  kpis, ownerName, shopName, hideProfit, drawerCash, canRepeat, repeating, canShare,
  onRepeat, onShare, onNewSale, onScan, onProof,
}: {
  kpis: TodayKpis
  ownerName: string
  shopName: string
  hideProfit: boolean
  drawerCash: number | undefined
  canRepeat: boolean
  repeating: boolean
  canShare: boolean
  onRepeat: () => void
  onShare: () => void
  onNewSale: () => void
  onScan: () => void
  onProof: (spec: ProofSpec) => void
}) {
  const { t, language } = useTranslation()
  const figures: { key: string; label: string; value: number | undefined; spec: ProofSpec }[] = [
    { key: 'drawer', label: t('proof.t_drawer'), value: drawerCash, spec: { kind: 'drawer', titleKey: 'proof.t_drawer', shown: drawerCash } },
    { key: 'got', label: t('today.udhaar_got'), value: kpis.todayCollections, spec: { kind: 'explain', metric: 'got', scope: 'today', titleKey: 'proof.t_got', shown: kpis.todayCollections } },
  ]
  if (!hideProfit) {
    figures.push({ key: 'profit', label: t('proof.t_profit_today'), value: kpis.todayProfit, spec: { kind: 'explain', metric: 'profit', scope: 'today', titleKey: 'proof.t_profit_today', shown: kpis.todayProfit } })
  }
  const lastWeek = t('proof.cmp_last_week').replace('{day}', lastWeekdayName(language))
  const returnsLine = kpis.todayCreditNoteCount === 1
    ? t('today.return_one')
    : t('today.returns_n').replace('{n}', String(kpis.todayCreditNoteCount))

  return (
    // id='cash-in-hand': the "Cash in Hand" deep-link target (AUDIT V25 BUG-032).
    <motion.div
      id="cash-in-hand"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-gradient-saffron p-3 lg:p-5 text-white shadow-lg relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -mr-24 -mt-24" />
      <div className="relative z-10 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white/80 text-xs font-medium">{t('dash.greeting')}, {ownerName}</p>
            <p className="text-xs font-medium text-white/90 mt-0.5">{shopName}</p>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            {canRepeat && (
              <Button variant="outline" size="iconTouch" onClick={onRepeat} disabled={repeating} className={onSaffron} aria-label={t('today.repeat')} title={t('today.repeat')}>
                {repeating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Repeat className="w-4 h-4" />}
              </Button>
            )}
            {canShare && (
              <Button variant="outline" size="iconTouch" onClick={onShare} className={onSaffron} aria-label={t('today.share')} title={t('today.share')}>
                <Share2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Phase 5b-1: the figure opens how it is worked out. */}
        <div>
          <button
            type="button"
            onClick={() => onProof({ kind: 'explain', metric: 'sales', scope: 'today', titleKey: 'proof.t_sales_today', shown: kpis.todayRevenue })}
            className="text-left rounded-lg min-h-12 -mx-1 px-1 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
            aria-label={`${t('proof.t_sales_today')} ${formatINR(kpis.todayRevenue)}. ${t('proof.tap_hint')}`}
          >
            <span className="block text-xs text-white/70 font-medium">{t('proof.t_sales_today')}</span>
            <span className="block text-2xl lg:text-3xl font-bold tabular-nums text-white mt-0.5">
              {formatINR(kpis.todayRevenue)}
            </span>
          </button>
          <p className="text-white/80 text-xs mt-0.5">
            {proofCountLine(kpis.todayTxnCount, false, t)}
            {kpis.todayLastWeekRevenue !== undefined && <> · {lastWeek}: <span className="font-semibold text-white tabular-nums">{formatINR(kpis.todayLastWeekRevenue)}</span></>}
          </p>
          {kpis.todayCreditNoteCount > 0 && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs bg-white/20 px-2 py-0.5 rounded-full">
              <FileText className="w-3 h-3" />
              {returnsLine}
            </span>
          )}
        </div>

        <div className={cn('grid gap-2', figures.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {figures.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onProof(f.spec)}
              className="min-h-12 rounded-xl bg-white/15 hover:bg-white/20 px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-white"
              aria-label={`${f.label} ${f.value === undefined ? '' : formatINR(f.value)}. ${t('proof.tap_hint')}`}
            >
              <span className="block text-xs text-white/80 leading-tight">{f.label}</span>
              <span className="block text-base font-bold tabular-nums leading-snug">{f.value === undefined ? '—' : formatINR(f.value)}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Button onClick={onNewSale} className="flex-1 sm:flex-none bg-white text-primary hover:bg-white/90 gap-2 shadow-md">
            <Plus className="w-4 h-4" />
            New Sale
          </Button>
          <Button onClick={onScan} variant="outline" className={cn('flex-1 sm:flex-none gap-2', onSaffron)}>
            <ScanLine className="w-4 h-4" />
            {t('dash.scan_bill')}
          </Button>
        </div>
      </div>
    </motion.div>
  )
}

export function QuickTiles({ gstStatus }: { gstStatus: GstStatus | undefined }) {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const { canAccess } = useStaffPermissions()
  const isFounder = useAppStore((s) => s.isFounder)
  const isOwner = session?.user?.role === 'owner'
  const tiles = useMemo(() => homeTiles(filterByPermissions(
    NAV_REGISTRY.filter((d) => d.surfaces?.includes('home-tiles')),
    { canAccess, isFlagEnabled: (flag: string) => {
      const features = useAppStore.getState().features
      return features?.[flag as keyof typeof features] ?? false
    }, isOwner, isFounder, platform: 'mobile', gstStatus },
  )), [canAccess, isOwner, isFounder, gstStatus])

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
      {tiles.map((d) => {
        const Icon = d.icon
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => { haptic.click(); handleNavAction(d, { previousView: 'dashboard' }) }}
            className="card-hover min-h-12 flex flex-col items-center gap-1.5 p-2.5 rounded-2xl bg-card border border-border/60 shadow-card hover:border-primary/30 flex-shrink-0 w-[84px] active:scale-95"
          >
            <span className={cn('w-9 h-9 rounded-lg flex items-center justify-center', d.iconBg || 'bg-muted')}>
              <Icon className={cn('w-4 h-4', d.iconColor || 'text-muted-foreground')} />
            </span>
            <span className="text-xs font-medium text-center leading-tight break-words">{navShortName(d, t)}</span>
          </button>
        )
      })}
    </div>
  )
}

export function CollectPayCard({ kpis }: { kpis: TodayKpis }) {
  const { t } = useTranslation()
  const setKhataSide = useAppStore((s) => s.setKhataSide)
  const setView = useAppStore((s) => s.setView)
  const setPreviousView = useAppStore((s) => s.setPreviousView)
  const open = (side: 'customer' | 'supplier') => {
    haptic.click()
    setKhataSide(side)
    setPreviousView('dashboard')
    setView('parties')
  }
  const cell = 'min-h-12 rounded-2xl bg-card border border-border/60 shadow-card p-3 text-left hover:border-primary/30 active:scale-[0.99] transition'
  return (
    <div className="grid grid-cols-2 gap-3">
      <button type="button" onClick={() => open('customer')} className={cell}>
        <span className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowDownRight className="w-3.5 h-3.5 text-good" />{t('today.to_collect')}</span>
        <span className="block text-lg font-bold tabular-nums text-good">{formatINR(kpis.totalReceivable)}</span>
        <span className="block text-xs text-muted-foreground">{partiesLine(kpis.receivableCount ?? 0, 'customer', t)}</span>
      </button>
      <button type="button" onClick={() => open('supplier')} className={cell}>
        <span className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowUpRight className="w-3.5 h-3.5 text-bad" />{t('today.to_pay')}</span>
        <span className="block text-lg font-bold tabular-nums text-bad">{formatINR(kpis.totalPayable)}</span>
        <span className="block text-xs text-muted-foreground">{partiesLine(kpis.payableCount ?? 0, 'supplier', t)}</span>
      </button>
    </div>
  )
}
