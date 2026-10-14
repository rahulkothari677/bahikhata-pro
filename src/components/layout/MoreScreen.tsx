'use client'

/**
 * MoreScreen — the More tab: one flat page (Phase 5a-4, ledger model §7).
 *
 * Was (V26 P9): eleven collapsed folders, every one closed, so Inventory sat
 * three taps deep (#196). Now three open groups of tiles — Shop books, Tools,
 * Grow — and two rows under them: Shop & settings, Help & support.
 *
 * One home per thing: new entries live in the + sheet, Customers & Suppliers in
 * the Khata tab, single reports on the Reports page, staff and shops under
 * Shop & settings. Every entry here is a nav-registry destination on the
 * 'more' surface with a `moreGroup` (the guard checks that), opened by the
 * shared handleNavAction.
 */

import { useSession } from 'next-auth/react'
import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store/app-store'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { haptic } from '@/lib/haptic'
import { prefetchView } from '@/lib/prefetch'
import { cn } from '@/lib/utils'
import { NAV_REGISTRY, filterByPermissions, getById, type NavDestination } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import { ChevronRight, ArrowLeft, Settings as SettingsIcon } from 'lucide-react'
import { useTranslation } from '@/hooks/use-translation'
import { gstStatus } from '@/lib/shop-tax'
import { useSetting } from '@/hooks/use-setting'

const GROUPS: { id: NonNullable<NavDestination['moreGroup']>; titleKey: string }[] = [
  { id: 'books', titleKey: 'more.group.books' },
  { id: 'tools', titleKey: 'more.group.tools' },
  { id: 'grow', titleKey: 'more.group.grow' },
]

/** The page's groups, in order, from the registry. Exported for the guard. */
export function moreGroups(items: NavDestination[]) {
  return GROUPS.map((g) => ({
    ...g,
    items: items
      .filter((d) => d.surfaces?.includes('more') && d.moreGroup === g.id)
      .sort((a, b) => (a.moreOrder ?? 0) - (b.moreOrder ?? 0)),
  })).filter((g) => g.items.length > 0)
}

export function MoreScreen() {
  const { t } = useTranslation()
  const { setView, previousView, setPreviousView } = useAppStore()
  const { data: session } = useSession()
  const { canAccess } = useStaffPermissions()

  useEffect(() => {
    prefetchView('reports')
  }, [])

  const isOwner = session?.user?.role === 'owner'
  const isFounder = useAppStore((s) => s.isFounder)
  // Phase 1c-2: hide GST returns that are not this shop's (lib/shop-tax.ts).
  const { setting: shopSetting } = useSetting()
  const shopGst = shopSetting ? gstStatus(shopSetting) : undefined
  const groups = useMemo(() => moreGroups(filterByPermissions(
    NAV_REGISTRY.filter((d) => d.surfaces?.includes('more')),
    { canAccess, isFlagEnabled: (flag: string) => {
      const features = useAppStore.getState().features
      return features?.[flag as keyof typeof features] ?? false
    }, isOwner, isFounder, platform: 'mobile', gstStatus: shopGst },
  )), [canAccess, isOwner, isFounder, shopGst])

  const open = (dest: NavDestination) => {
    haptic.click()
    handleNavAction(dest, { previousView: 'more' })
  }

  const handleBack = () => {
    haptic.click()
    setView(previousView || 'dashboard', { back: true })
    setPreviousView(null)
  }

  const name = (d: NavDestination) => t(d.shortLabelKey ?? d.labelKey ?? '') || d.label
  const account = getById('go-to-account')
  const help = getById('help-support')

  return (
    <div className="min-h-screen bg-muted/30 w-full flex-1">
      {/* Top bar */}
      <div className="sticky top-0 z-20 pt-safe bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={handleBack} className="min-h-12 min-w-12 flex items-center justify-center -ml-2 rounded-lg hover:bg-muted" aria-label="Go back">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-bold">{t('nav.more')}</h2>
        </div>
      </div>

      <div
        className="max-w-2xl mx-auto px-4 py-4 space-y-5"
        style={{ paddingBottom: 'calc(6rem + var(--safe-bottom))' }}
      >
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`more-${g.id}`}>
            <h3 id={`more-${g.id}`} className="text-xs font-bold text-muted-foreground mb-2 px-1">{t(g.titleKey)}</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {g.items.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => open(item)}
                    className="min-h-12 rounded-2xl bg-card shadow-card border border-border/60 p-3 flex flex-col items-start gap-2 text-left active:scale-[0.98] transition-transform"
                  >
                    <span className={cn('w-10 h-10 rounded-xl flex items-center justify-center', item.iconBg || 'bg-muted')}>
                      <Icon className={cn('w-5 h-5', item.iconColor || 'text-muted-foreground')} />
                    </span>
                    <span className="text-sm font-semibold leading-tight break-words">{name(item)}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}

        <div className="rounded-2xl bg-card shadow-card border border-border/60 overflow-hidden">
          {account && (
            <button type="button" onClick={() => open(account)} className="w-full min-h-14 flex items-center gap-3 px-4 text-left hover:bg-muted/50">
              <SettingsIcon className="w-5 h-5 text-muted-foreground" />
              <span className="flex-1 text-sm font-semibold">{t('more.shop_settings')}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          {help && (
            <button type="button" onClick={() => open(help)} className="w-full min-h-14 flex items-center gap-3 px-4 text-left hover:bg-muted/50 border-t border-border/40">
              <help.icon className="w-5 h-5 text-muted-foreground" />
              <span className="flex-1 text-sm font-semibold">{name(help)}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
