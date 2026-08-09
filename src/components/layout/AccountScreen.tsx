'use client'

/**
 * AccountScreen — full-screen profile/account page.
 *
 * 🔒 V21-010 (Phase 2b): Profile header added.
 * 🔒 V22-6 (Phase 4): Advanced upgrades —
 *   - CRED-style plan ring around avatar (gradient per plan)
 *   - Business Stats row (Products, Customers, This Month, Receivable)
 *   - LinkedIn-style profile completion progress bar
 *   - Shop QR Code on profile page (vCard format, scannable by any phone)
 *
 * Design inspiration:
 * - CRED: Member-since ring around avatar, premium dark gradient
 * - PhonePe: Clean layout, name + phone + manage link
 * - Flipkart: Plan/membership badge (Free/Pro/Elite)
 * - LinkedIn: Profile completion progress bar
 * - Vyapar: Shop QR code for contact sharing
 *
 * The header is a gradient banner with:
 * - Large avatar wrapped in plan-colored gradient ring
 * - User name + shop name
 * - Phone number (if set)
 * - Plan badge (Free/Pro/Elite)
 * - Edit profile button
 * - Decorative circles for depth
 *
 * Below the header:
 * - Business Stats row (4 quick stats from dashboard data)
 * - Profile Completion progress bar (if < 100%)
 * - 10 menu sections
 * - Logout button
 * - Version footer
 */

import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { lazy, Suspense, useMemo, useState, useRef, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useAppStore } from '@/store/app-store'
import { canGoBackInApp } from '@/hooks/use-browser-back-button'
import { useSubscription } from '@/hooks/use-subscription'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { useDashboardThisMonth } from '@/hooks/use-dashboard'
import { useShops } from '@/hooks/use-shops'
import { offlineFetch } from '@/lib/offline-fetch'
import { haptic } from '@/lib/haptic'
import { toast as sonnerToast } from 'sonner'
import { formatINRCompact } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getInitials, cn } from '@/lib/utils'
// 🔒 AUDIT V25 §6.1 (Batch 8 Phase 7): AccountScreen now renders from the NavRegistry.
import { NAV_REGISTRY, type NavDestination, type AccountGroupId } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import { APP_VERSION_LABEL } from '@/lib/app-version'
import {
  ArrowLeft, Pencil, Calculator, Crown, Phone, Mail, Store,
  ChevronRight, User, CreditCard, Shield, ShieldCheck, Settings as SettingsIcon,
  Database, Users, Gift, HelpCircle, Info, Star, LogOut,
  BookOpenText, FileSpreadsheet, Check, Sparkles, Share2, Send,
  Package, TrendingUp, Wallet, AlertCircle, CheckCircle2,
  type LucideIcon,
} from 'lucide-react'
import type { ViewType } from '@/store/app-store'
// 🔒 AUDIT V23 FIX §13.7: Use real ReferralCard instead of fake email-prefix code
import { ReferralCard } from '@/components/referral/ReferralCard'
import { BusinessCardDisplay } from '@/components/common/BusinessCardDisplay'
import { AppLockCard } from '@/components/security/AppLockCard'
import { useTranslation } from '@/hooks/use-translation'

// 🔒 V22-6 (Phase 4) FIX: Move lazy() to module scope.
// Was: `const SettingsComponent = lazy(...)` inside AccountSectionContent.
// That created a NEW lazy component on every render, causing Settings to
// re-mount and lose all its form state on any parent re-render.
// Now: declared once at module scope, stable across renders.
const SettingsComponent = lazy(() =>
  import('@/components/settings/Settings').then(m => ({ default: m.Settings }))
)
// Type-only, so it does not pull the 2000-line Settings module into this chunk.
import type { SettingsSection } from '@/components/settings/Settings'
// The plan comparison, shown inline on the Subscription page. Lazy for the
// same reason Settings is: most visits to Account never open Subscription.
const PricingPlansComponent = lazy(() =>
  import('@/components/subscription/PricingPlans').then(m => ({ default: m.PricingPlans }))
)

// 🔒 AUDIT V25 §6.1 (Batch 8 Phase 7): AccountScreen now renders from the NavRegistry.
// AccountMenuItem + AccountMenuSection interfaces removed — registry types replace them.
// sections array + handleItemClick replaced with registry-driven grouping + handleNavAction().

/**
 * The Account menu, top to bottom.
 *
 * 🎨 2026-08-08. Ordered by how often a shopkeeper needs it, which is roughly
 * the reverse of how the old screen was ordered: settings the app author cares
 * about first, the shop's own details buried in the middle. Five groups —
 * enough to separate genuinely different things, few enough to scan.
 */
// 🐛 2026-08-09: titleKey, not a literal. These five headings stayed English
// when the rows beneath them switched to Hindi.
const ACCOUNT_GROUP_ORDER: { id: AccountGroupId; titleKey: string; title: string }[] = [
  { id: 'business',      titleKey: 'account.group.business',      title: 'Business' },
  { id: 'plan',          titleKey: 'account.group.plan',          title: 'Plan & Rewards' },
  { id: 'app',           titleKey: 'account.group.app',           title: 'App' },
  { id: 'data-security', titleKey: 'account.group.data-security', title: 'Data & Security' },
  { id: 'support',       titleKey: 'account.group.support',       title: 'Help' },
]

export function AccountScreen() {
  const { t } = useTranslation()
  const { setView, previousView, setPreviousView } = useAppStore()
  const accountSection = useAppStore((s) => s.accountSection)
  const setAccountSection = useAppStore((s) => s.setAccountSection)
  const { data: session } = useSession()
  // 🐛 UI/UX Phase 4: Get usage + data from useSubscription (was: only plan)
  const { plan, usage, refresh: refreshSubscription } = useSubscription()
  const { isCA, isOwner, canAccess } = useStaffPermissions()
  // 🔒 V22-11 (Batch A, Phase 4f): Shop switcher — for multi-shop users.
  const { shops, activeShop, switchShop } = useShops()
  const [shopDropdownOpen, setShopDropdownOpen] = useState(false)
  const shopDropdownRef = useRef<HTMLDivElement>(null)

  // Close shop dropdown on outside click
  useEffect(() => {
    if (!shopDropdownOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (shopDropdownRef.current && !shopDropdownRef.current.contains(e.target as Node)) {
        setShopDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [shopDropdownOpen])

  // Fetch settings for profile data
  const { data: settingData } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await offlineFetch('/api/settings')
      return r.json()
    },
  })

  // 🔒 V22-6 (Phase 4): Fetch dashboard data for business stats row.
  // Reuses the shared useDashboardThisMonth hook so the data is cached
  // and shared with the Dashboard view (no extra API call).
  const { data: dashboardData } = useDashboardThisMonth()

  const setting = settingData?.setting || {}
  const userName = setting.ownerName || session?.user?.name || 'Shop Owner'
  const shopName = setting.shopName || 'My Shop'
  // 🐛 2026-08-04: Setting.email FIRST. This screen was showing the address the
  // shopkeeper SIGNS IN with, ignoring the Email field in Settings → Profile
  // that they had filled in with their shop's address. Same fault as the one on
  // the business card; see lib/card-details.
  const email = setting.email || session?.user?.email || ''
  const phone = setting.phone

  // 🐛 UI/UX Phase 5 Fix 1: Profile completion calculation.
  // Was: 6 fields, shopName defaulted to "My Shop" in DB → new users started
  // at 17% with no real data entered. Now: 7 fields (added logoUrl), and
  // shopName only counts as "filled" if it's NOT the placeholder "My Shop".
  const profileCompletion = useMemo(() => {
    const fields = [
      { label: t('account.field.shopName'), filled: !!(setting.shopName && setting.shopName.trim() && setting.shopName.trim() !== 'My Shop') },
      { label: t('account.field.ownerName'), filled: !!(setting.ownerName && setting.ownerName.trim()) },
      { label: t('account.field.phone'), filled: !!(setting.phone && setting.phone.trim()) },
      { label: t('account.field.gstin'), filled: !!(setting.gstin && setting.gstin.trim()) },
      { label: t('account.field.address'), filled: !!(setting.address && setting.address.trim()) },
      { label: t('account.field.email'), filled: !!email },
      { label: t('account.field.logo'), filled: !!setting.logoUrl },
    ]
    const filledCount = fields.filter(f => f.filled).length
    const pct = Math.round((filledCount / fields.length) * 100)
    const missing = fields.filter(f => !f.filled).map(f => f.label)
    return { pct, filledCount, total: fields.length, missing, fields }
  }, [setting.ownerName, setting.shopName, setting.phone, setting.gstin, setting.address, setting.logoUrl, email, t])

  // 🔒 V22-6 (Phase 4): Business stats from dashboard data.
  // Defensive defaults — if dashboard hasn't loaded yet, show 0/—.
  const kpis = dashboardData?.kpis
  const businessStats = useMemo(() => [
    {
      label: t('account.stat.products'),
      value: kpis?.productCount != null ? String(kpis.productCount) : '—',
      icon: Package,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-100 dark:bg-amber-950',
    },
    {
      label: t('account.stat.customers'),
      value: kpis?.partyCount != null ? String(kpis.partyCount) : '—',
      icon: Users,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-100 dark:bg-blue-950',
    },
    {
      label: t('account.stat.thisMonth'),
      value: kpis?.rangeRevenue != null ? formatINRCompact(kpis.rangeRevenue) : '—',
      icon: TrendingUp,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-100 dark:bg-emerald-950',
    },
    {
      label: t('account.stat.receivable'),
      value: kpis?.totalReceivable != null ? formatINRCompact(kpis.totalReceivable) : '—',
      icon: Wallet,
      color: 'text-rose-600 dark:text-rose-400',
      bg: 'bg-rose-100 dark:bg-rose-950',
    },
  ], [kpis?.productCount, kpis?.partyCount, kpis?.rangeRevenue, kpis?.totalReceivable, t])

  const handleBack = () => {
    haptic.click()
    if (accountSection) {
      /*
       * 🐛 2026-08-04: hand this to the history stack rather than navigating by
       * hand. Account sections are now real entries in it (see
       * use-browser-back-button), so one step back lands wherever the section
       * was opened from — the Account menu or More — with no need to work it
       * out from `accountOriginView`.
       *
       * The old branch called `setView('more')`, and 'more' is a ROOT view:
       * every such call bumped the history generation and left the earlier
       * entries stale. Enough of those and a later back press walked out of
       * the app's own history entirely, which is what restarted the app.
       */
      if (canGoBackInApp()) {
        window.history.back()
        return
      }
      // Deep-linked straight into a section, with nothing behind it.
      const origin = useAppStore.getState().accountOriginView
      const prev = useAppStore.getState().previousView
      setAccountSection(null)
      if (prev === 'more' || origin === 'more') {
        setView('more', { back: true })
        setPreviousView(null)
        useAppStore.getState().setAccountOriginView(null)
      }
    } else {
      // If on the menu, go back to the original view
      const origin = useAppStore.getState().accountOriginView
      setView(origin || previousView || 'dashboard', { back: true })
      setPreviousView(null)
      useAppStore.getState().setAccountOriginView(null)
    }
  }

  // 🔒 AUDIT V25 §6.1 (Batch 8 Phase 7): handleItemClick removed — replaced
  // by handleAccountItemClick in the useMemo below. The old 30-line
  // sectionMap + label-matching is now handled by the registry's
  // actionKind: 'navigate-account' + actionParams.accountSection.

  // 🔒 AUDIT V23 FIX §13.9d (Batch L follow-up): Logout handler — extracted
  // from the inline onClick so the registry's custom action can call it.
  const handleLogout = async () => {
    haptic.warning()
    try {
      const { clearAllOfflineData } = await import('@/lib/offline-db')
      try {
        await clearAllOfflineData()
      } catch (e) {
        console.warn('[logout] clearAllOfflineData failed (non-fatal):', e)
      }
    } catch (e) {
      console.warn('[logout] offline-db module load failed (non-fatal):', e)
    }
    try {
      const { signOut } = await import('next-auth/react')
      await signOut({ callbackUrl: '/' })
    } catch (e) {
      console.error('[logout] signOut failed:', e)
      if (typeof window !== 'undefined') window.location.href = '/'
    }
  }

  const handleEditProfile = () => {
    haptic.click()
    setAccountSection('profile')
  }

  // 🔒 V22-6 (Phase 4): Plan styling — badge + ring gradient per plan.
  // free = white/saffron ring, pro = amber ring, elite = violet ring.
  // Inspired by CRED's member-since ring around the avatar.
  const planBadges = {
    free: {
      label: 'Free',
      badgeClassName: 'bg-white/20 text-white',
      ringGradient: 'from-slate-300 to-slate-500',
      icon: null as null | typeof Crown,
    },
    pro: {
      label: 'Pro',
      badgeClassName: 'bg-amber-400 text-amber-900',
      ringGradient: 'from-amber-300 via-amber-500 to-orange-500',
      icon: Crown,
    },
    elite: {
      label: 'Elite',
      badgeClassName: 'bg-violet-400 text-violet-900',
      ringGradient: 'from-violet-300 via-violet-500 to-purple-600',
      icon: Crown,
    },
  }
  const planBadge = planBadges[plan] || planBadges.free
  const PlanIcon = planBadge.icon

  // ═══ Section titles for dedicated pages ═══
  // 🔒 AUDIT V25 §6.1 (Batch 8 Phase 7): Was a hardcoded Record. Now derived
  // from the registry — the label field IS the section title.
  /*
   * Page titles. Derived from the registry so a row and the page it opens can
   * never disagree — "Data & Backup" used to open a page headed "Data &
   * Accounting", and "Accounting Controls" opened that same page.
   */
  const sectionTitles = useMemo(() => {
    const titles: Record<string, string> = {}
    /*
     * 🐛 2026-08-08: only rows that actually appear IN this menu may name its
     * pages. Reports-hub entries deep-link here too — 'reconciliation' and
     * 'period-lock' both open accountSection 'accounting' — and taking the
     * first match in registry order titled the Accounting Controls page
     * "Reconciliation", after a row the user had not tapped.
     */
    for (const d of NAV_REGISTRY) {
      if (!d.surfaces?.includes('account')) continue
      const s = d.actionParams?.accountSection
      // 🐛 2026-08-09: t(labelKey), not the raw label. The MENU ROW runs its
      // label through t() but this map did not, so with Hindi selected the
      // row read "दुकान प्रोफ़ाइल" and the page it opened was headed
      // "Shop Profile". Same string, two languages, one tap apart.
      if (s && !titles[s]) titles[s] = d.labelKey ? t(d.labelKey) : d.label
    }
    return titles
  }, [t])

  // 🔒 AUDIT V25 §6.1 (Batch 8 Phase 7): Menu sections from NavRegistry,
  // filtered by surfaces: ['account'] + permissions. Grouped by subcategory.
  // Was: hardcoded sections array (14 items in 4 sections with inline sectionMap).
  const { accountSections, handleAccountItemClick } = useMemo(() => {
    const items = NAV_REGISTRY
      .filter(d => d.surfaces?.includes('account'))
      .filter(d => !d.ownerOnly || isOwner)  // owner-only gating
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))

    /*
     * Group by `accountGroup`, in the fixed order below.
     *
     * 🎨 2026-08-08. Was grouped by `subcategory`, which MoreScreen also groups
     * by — so "Manage Shops" and "Staff & Access" landed wherever MoreScreen
     * needed them, and the account groups came out in Map insertion order,
     * i.e. whatever order the registry array happened to be written in.
     * Both are now explicit.
     */
    const grouped = new Map<AccountGroupId, NavDestination[]>()
    for (const d of items) {
      if (!d.accountGroup) continue  // guarded by nav-registry-account-groups.test.ts
      if (!grouped.has(d.accountGroup)) grouped.set(d.accountGroup, [])
      grouped.get(d.accountGroup)!.push(d)
    }

    const sections = ACCOUNT_GROUP_ORDER
      .filter(g => (grouped.get(g.id)?.length ?? 0) > 0)
      .map(g => ({ subcategory: g.id, title: t(g.titleKey) || g.title, items: grouped.get(g.id)! }))

    // Click handler — uses handleNavAction for standard items, custom for Rate/Logout
    const handleClick = (dest: NavDestination) => {
      haptic.click()
      if (dest.actionKind === 'custom') {
        // Custom actions handled inline
        if (dest.id === 'rate-ekbook') {
          window.open('https://play.google.com/store/apps/details?id=pro.ekbook.app', '_blank')
        } else if (dest.id === 'logout') {
          handleLogout()
        }
        return
      }
      // Standard items use handleNavAction — which calls setAccountSection +
      // setView('account') for navigate-account items.
      handleNavAction(dest)
    }

    return { accountSections: sections, handleAccountItemClick: handleClick }
  }, [isOwner, t])

  return (
    <div className="min-h-screen bg-muted/30 w-full flex-1">
      {/* Top bar with back button */}
      <div className="sticky top-0 z-20 pt-safe bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            aria-label="Go back"
            onClick={handleBack}
            className="p-2 -ml-2 rounded-lg hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-bold">
            {accountSection ? (sectionTitles[accountSection] || t('account.title')) : t('account.title')}
          </h2>
        </div>
      </div>

      {/* ═══ Dedicated Section Page (no tabs, no menu) ═══ */}
      {accountSection && (
        <div className="max-w-2xl mx-auto px-4 py-4 pb-24"
             style={{ paddingBottom: 'calc(6rem + var(--safe-bottom))' }}>
          <AccountSectionContent
            section={accountSection}
            hostTitle={sectionTitles[accountSection] || 'Account'}
            setting={setting}
            session={session}
            isOwner={isOwner}
            isCA={isCA}
            plan={plan}
            usage={usage}
          />
        </div>
      )}

      {/* ═══ Account Menu (profile header + 10 items) ═══ */}
      {!accountSection && (
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4 pb-24"
           style={{ paddingBottom: 'calc(6rem + var(--safe-bottom))' }}>

        {/* ═══ Who this is ═══════════════════════════════════════════════
            🎨 2026-08-08. Rahul: "the design of the profile section is too
            bad where it's most of the space of the screen".

            Measured before this change, on a 694px viewport: the upgrade
            banner (76px) + identity banner (134px) + stats (88px) + the
            completion checklist (316px) put the first menu row at y=779.
            Every pixel of the first screen was header; you had to scroll to
            discover that Account had a menu at all.

            The banner is now one row tall. Same information — avatar, name,
            shop, plan — in the space a phone can actually spare. The upgrade
            card that used to sit above it has moved below the menu, where a
            promotion belongs. */}
        <button
          onClick={isCA ? undefined : handleEditProfile}
          disabled={isCA}
          className={cn(
            'w-full rounded-2xl shadow-card relative overflow-hidden text-white transition text-left',
            isCA ? 'cursor-default' : 'active:scale-[0.98]',
          )}
        >
          <div className={cn(
            'px-4 py-3.5 relative',
            isCA ? 'bg-gradient-to-br from-violet-600 to-purple-700' : 'bg-gradient-saffron',
          )}>
            <div className="absolute top-0 right-0 w-28 h-28 bg-white/10 rounded-full -mr-14 -mt-14 pointer-events-none" />
            <div className="relative flex items-center gap-3">
              <div className={cn('p-[2px] rounded-full bg-gradient-to-br flex-shrink-0', planBadge.ringGradient)}>
                <Avatar className="w-12 h-12 border-2 border-white/40">
                  <AvatarFallback className="bg-white/20 backdrop-blur-sm text-white text-base font-bold">
                    {getInitials(userName)}
                  </AvatarFallback>
                </Avatar>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-bold text-base font-heading tracking-tight truncate">{userName}</p>
                  {isCA && (
                    <span className="text-3xs px-1.5 py-0.5 rounded-full font-bold bg-white/25 whitespace-nowrap flex items-center gap-1 flex-shrink-0">
                      <Calculator className="w-2.5 h-2.5" /> CA
                    </span>
                  )}
                </div>
                {/* Shop, phone and email were three stacked lines. They are one
                    line now: on a phone the shop name is what identifies the
                    account, and the rest is a tap away in Shop Profile. */}
                <p className="text-xs text-white/85 truncate flex items-center gap-1.5 mt-0.5">
                  <Store className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{shopName}</span>
                  {phone && <span className="text-white/50">·</span>}
                  {phone && <span className="truncate">{phone}</span>}
                </p>
              </div>

              <span className={cn(
                'text-3xs font-bold uppercase tracking-wide px-2 py-1 rounded-full flex items-center gap-1 flex-shrink-0',
                planBadge.badgeClassName,
              )}>
                {PlanIcon && <PlanIcon className="w-2.5 h-2.5" />}
                {planBadge.label}
              </span>
              {!isCA && <Pencil className="w-4 h-4 text-white/70 flex-shrink-0" />}
            </div>
          </div>
        </button>

        {/* Business stats — unchanged in substance, tightened in height. */}
        <div className="grid grid-cols-4 gap-2">
          {businessStats.map((stat) => {
            const StatIcon = stat.icon
            return (
              <div
                key={stat.label}
                className="card-hover bg-card rounded-xl border border-border/60 shadow-card px-1.5 py-2 flex flex-col items-center text-center"
              >
                <StatIcon className={cn('w-3.5 h-3.5 mb-1', stat.color)} />
                <p className="text-sm font-bold tabular-nums leading-tight">{stat.value}</p>
                <p className="text-3xs text-muted-foreground leading-tight">{stat.label}</p>
              </div>
            )
          })}
        </div>

        {/* ═══ What is still missing ══════════════════════════════════════
            🎨 Rahul: "what is added is cut through the line".

            The checklist listed all seven fields and drew a strikethrough
            through the six he had already filled — so the card was mostly a
            list of finished work, presented in the one text style that
            universally means cancelled or no longer valid. It stood 316px
            tall to tell him about one empty field.

            Progress-meter guidance is to credit what is done and point at
            what is next. So: the bar keeps the credit, and only the fields
            still missing get a row. At 100% the whole thing disappears
            rather than becoming a badge that congratulates him forever. */}
        {!isCA && profileCompletion.pct < 100 && (
          <button
            onClick={handleEditProfile}
            className="w-full bg-card rounded-2xl border border-border/60 shadow-card p-3 text-left hover:bg-muted/40 transition"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">
                  {t('account.completion.title').replace('{pct}', String(profileCompletion.pct))}
                </p>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1.5">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      profileCompletion.pct >= 67 ? 'bg-emerald-400'
                        : profileCompletion.pct >= 34 ? 'bg-amber-400' : 'bg-rose-400',
                    )}
                    style={{ width: `${profileCompletion.pct}%` }}
                  />
                </div>
              </div>
              <span className="text-3xs font-medium text-primary flex-shrink-0">{t('account.completion.cta')} →</span>
            </div>
            {/* Only the gaps, as chips — a 28px row instead of a 240px list. */}
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {profileCompletion.fields.filter(f => !f.filled).map(field => (
                <span
                  key={field.label}
                  className="text-3xs font-medium px-2 py-1 rounded-full bg-muted text-muted-foreground"
                >
                  + {field.label}
                </span>
              ))}
            </div>
          </button>
        )}

        {/* ═══ Menu Sections — rendered from NavRegistry (V25 §6.1 Phase 7) ═══ */}
        {accountSections.map((section, idx) => {
          if (section.items.length === 0) return null
          return (
            <div key={section.subcategory}>
              {section.title && (
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
                  {section.title}
                </p>
              )}
              <div className="bg-card rounded-2xl shadow-card border border-border/60 overflow-hidden">
                {section.items.map((item: NavDestination, i: number) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleAccountItemClick(item)}
                      className={cn(
                        'w-full flex items-center gap-3 p-3.5 hover:bg-muted/50 transition text-left active:bg-muted group',
                        i > 0 && 'border-t border-border/40',
                      )}
                    >
                      <div className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition group-hover:scale-105',
                        item.iconBg || 'bg-muted'
                      )}>
                        <Icon className={cn('w-5 h-5', item.iconColor || 'text-muted-foreground')} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm flex items-center gap-1.5">
                          {item.labelKey ? t(item.labelKey) : item.label}
                          {/* 🐛 2026-08-09: the Account menu never rendered badges, so a row
                              could not say "Soon" even when the registry marked it. Manage
                              Shops needed it: the page has one working control. */}
                          {item.badge && (
                            <span className={cn(
                              'text-3xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full',
                              item.badgeColor || 'bg-muted text-muted-foreground',
                            )}>
                              {item.badge}
                            </span>
                          )}
                        </p>
                        {/* 🐛 2026-08-09: t(descKey), not the raw string. The label above
                            already went through t(), so with Hindi selected every row read
                            as a Hindi title over an English sentence. i18n.ts carries 126
                            nav.desc.* translations that nothing had ever rendered. */}
                        {(item.descKey || item.description) && (
                          <p className="text-xs text-muted-foreground truncate">
                            {item.descKey ? t(item.descKey) : item.description}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition flex-shrink-0" />
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* ═══ Upgrade ════════════════════════════════════════════════════
            🎨 Rahul: "there is an subscription manage in the top which should
            not be on the top."

            He is right, and not only about the position. It was the first
            thing on the screen — above his own name — and it duplicated the
            Subscription row that already sits in Plan & Rewards. A promotion
            that outranks the user's identity reads as an ad, and the shop
            owner opening Account is usually there to do something else.

            Kept, because a free user does need a way to find Pro, but placed
            after the menu: visible on the way out, in nobody's way on the
            way in. Hidden entirely for paying users — they have the
            Subscription row, and there is nothing left to sell them. */}
        {!isCA && plan === 'free' && (
          <button
            onClick={() => {
              haptic.click()
              setPreviousView('account')
              useAppStore.getState().setAccountOriginView('account')
              setView('pricing')
            }}
            className="w-full rounded-2xl shadow-card relative overflow-hidden text-white transition active:scale-[0.98] text-left bg-gradient-to-br from-slate-700 to-slate-900"
          >
            <div className="p-4 relative">
              <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-12 -mt-12 pointer-events-none" />
              <div className="relative flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">Upgrade to Pro</p>
                  <p className="text-2xs text-white/80 mt-0.5">
                    AI Scanner · GST Export · WhatsApp · Voice Entry
                  </p>
                </div>
                <span className="text-3xs font-bold uppercase tracking-wide bg-white/20 px-2 py-1 rounded-full flex-shrink-0">
                  View Plans
                </span>
              </div>
            </div>
          </button>
        )}

        {/* Version footer */}
        <p className="text-center text-xs text-muted-foreground pt-2">
          {APP_VERSION_LABEL} · Made with love for Bharat 🇮🇳
        </p>
      </div>
      )}
    </div>
  )
}

/**
 * 🔒 V21-014 (Phase 6): AccountSectionContent — renders a DEDICATED page
 * for each account section. No tabs, no menu — just the content for that
 * one section. Each section is a standalone page like PhonePe/CRED.
 */
function AccountSectionContent({
  section,
  hostTitle,
  setting,
  session,
  isOwner,
  isCA,
  plan,
  usage,
}: {
  section: string
  /** What the top bar already says. Cards use it to avoid echoing it. */
  hostTitle: string
  setting: any
  session: any
  isOwner: boolean
  isCA: boolean
  plan: string
  usage: any
}) {
  /*
   * Which Settings cards each Account page is made of.
   *
   * 🎨 2026-08-08. This replaces a map from nine sections onto five tabs, in
   * which five of them — profile, security, referral, help and about — all
   * pointed at 'profile'. That is the whole reason Rahul's My Profile page
   * held the AI Bill Scanner language and Manage Shops: those cards were
   * written inside the profile tab, and every section that fell through to
   * 'profile' inherited them.
   *
   * A section absent from this map renders no Settings cards at all — the
   * bespoke pages below (subscription, security, referral, help, about,
   * business card) supply their own content.
   */
  const sectionCards: Record<string, SettingsSection[]> = {
    'profile':       ['shop-profile'],
    'shops':         ['manage-shops'],
    'invoices':      ['invoices'],
    'appearance':    ['appearance'],
    'preferences':   ['preferences'],
    'notifications': ['notifications'],
    'features':      ['features', 'ai-tools'],
    'accounting':    ['accounting'],
    'data':          ['data-backup'],
    'staff':         ['staff'],
    // Restores Replay Tour + Replay Theme Picker, which the removal of the
    // ungated About card had orphaned. See the note in Settings.tsx.
    'about':         ['about-card'],
  }

  // For subscription, redirect to pricing page
  if (section === 'subscription') {
    // 🐛 UI/UX Phase 4 Fix 1: Rebuilt Subscription section — was a dead-end with
    // just a "View Plans" button. Now shows: current plan, renewal date, daily
    // usage (AI scans + voice entries), and upgrade/cancel buttons.
    const planLabel = plan === 'elite' ? 'Elite' : plan === 'pro' ? 'Pro' : 'Free'
    const planColor = plan === 'elite' ? 'violet' : plan === 'pro' ? 'amber' : 'slate'
    const planIcon = plan === 'elite' ? Crown : plan === 'pro' ? Sparkles : CreditCard
    const PlanIcon = planIcon
    const usageInfo = usage as Record<string, any> | null
    const aiScans = usageInfo?.aiScans
    const voiceEntries = usageInfo?.voiceEntries

    return (
      <div className="space-y-4">
        {/* Current Plan Card */}
        <div className={cn(
          'rounded-2xl p-5 text-white shadow-card',
          plan === 'elite' ? 'bg-gradient-to-br from-violet-500 to-purple-700' :
          plan === 'pro' ? 'bg-gradient-to-br from-amber-400 to-orange-600' :
          'bg-gradient-to-br from-slate-500 to-slate-700'
        )}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PlanIcon className="w-5 h-5" />
              <span className="text-lg font-bold">{planLabel} Plan</span>
            </div>
            {plan === 'free' && (
              <span className="text-2xs bg-white/20 px-2 py-1 rounded-full">Free Forever</span>
            )}
          </div>
          {plan !== 'free' && (
            <p className="text-sm text-white/80">
              {plan === 'pro' ? '₹299/month' : '₹599/month'} · AI Scanner, GST Export, WhatsApp, Voice Entry
              {plan === 'elite' && ', Smart Insights, Staff Accounts'}
            </p>
          )}
          {plan === 'free' && (
            <p className="text-sm text-white/80">
              Basic sales, purchases, inventory. Upgrade for AI Scanner, GST Export & more.
            </p>
          )}
        </div>

        {/* Usage This Month (only for AI scans + voice — the metered features) */}
        {(aiScans || voiceEntries) && (
          <div className="bg-card rounded-2xl shadow-card border border-border/60 p-4">
            <p className="text-sm font-semibold mb-3">Today&apos;s Usage</p>
            <div className="space-y-3">
              {aiScans && (
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">AI Bill Scans</span>
                    <span className="font-medium tabular-nums">
                      {aiScans.used} / {aiScans.limit === Infinity ? '∞' : aiScans.limit} used today
                    </span>
                  </div>
                  {aiScans.limit !== Infinity && aiScans.limit > 0 && (
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all',
                          aiScans.remaining === 0 ? 'bg-rose-500' : 'bg-amber-500')}
                        style={{ width: `${Math.min((aiScans.used / aiScans.limit) * 100, 100)}%` }}
                      />
                    </div>
                  )}
                  {aiScans.remaining === 0 && (
                    <p className="text-2xs text-rose-500 mt-1">Daily limit reached — resets tomorrow</p>
                  )}
                </div>
              )}
              {voiceEntries && (
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Voice Entries</span>
                    <span className="font-medium tabular-nums">
                      {voiceEntries.used} / {voiceEntries.limit === Infinity ? '∞' : voiceEntries.limit} used today
                    </span>
                  </div>
                  {voiceEntries.limit !== Infinity && voiceEntries.limit > 0 && (
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all',
                          voiceEntries.remaining === 0 ? 'bg-rose-500' : 'bg-violet-500')}
                        style={{ width: `${Math.min((voiceEntries.used / voiceEntries.limit) * 100, 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Upgrade / View Plans button */}
        {plan === 'free' && (
          <button
            onClick={() => {
              useAppStore.getState().setPreviousView('account')
              useAppStore.getState().setView('pricing')
            }}
            className="w-full py-3 rounded-xl bg-gradient-saffron text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md"
          >
            <Sparkles className="w-4 h-4" />
            Upgrade to Pro — Unlock AI Scanner, GST & More
          </button>
        )}
        {plan !== 'free' && plan !== 'elite' && (
          <button
            onClick={() => {
              useAppStore.getState().setPreviousView('account')
              useAppStore.getState().setView('pricing')
            }}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-md"
          >
            <Crown className="w-4 h-4" />
            Upgrade to Elite — Smart Insights & Staff Accounts
          </button>
        )}
        {plan === 'elite' && (
          <div className="text-center py-2">
            <p className="text-sm text-muted-foreground">You&apos;re on the highest plan. Enjoy all features! 👑</p>
          </div>
        )}

        {/* ═══ The plans themselves ═══════════════════════════════════════
            🎨 Rahul: "subscription section is mostly blank and plans aren't
            visible."

            Measured: this page was exactly one viewport tall (694px of 694px)
            and held a plan name and two usage counters. The Free/Pro/Elite
            comparison did exist — behind a button labelled "View All Plans &
            Pricing", on a separate screen.

            So nothing here had to be built; the page just had to stop hiding
            the one thing a page called Subscription is for. Same component
            the pricing screen uses, so there is still only one place that
            knows what a plan costs. */}
        <div className="pt-2">
          <div className="mb-3 px-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Plans &amp; Pricing
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Change or cancel any time. Prices include GST.
            </p>
          </div>
          <Suspense fallback={<div className="h-64 bg-muted animate-pulse rounded-2xl" />}>
            <PricingPlansComponent />
          </Suspense>
        </div>
      </div>
    )
  }

  // For sections that don't have dedicated content yet, show a placeholder
  const hasContent = sectionCards[section]

  // ═══ Profile Page — QR Code card + Settings form ═══
  // 🔒 V22-6 (Phase 4): Show a QR code at the top of the profile page that
  // encodes the shop's vCard contact info (name, shop, phone, gstin, address).
  // Customers/other shops can scan this to save the contact.
  // Below the QR card, render the Settings (profile tab) form for editing.
  if (section === 'profile') {
    // Build vCard string (MECARD format — works with most Indian phones)
    // 🔒 AUDIT V23 FIX §8.12: Escape ; and , in values — MECARD uses these as delimiters.
    // An address like "12, Main Rd; Nashik" would corrupt the QR's fields.
    const escapeMecard = (val: string) => val.replace(/([;,:\\])/g, '\\$1')
    const vcardParts: string[] = []
    if (setting.ownerName) vcardParts.push(`N:${escapeMecard(setting.ownerName)}`)
    if (setting.shopName) vcardParts.push(`ORG:${escapeMecard(setting.shopName)}`)
    if (setting.phone) vcardParts.push(`TEL:${escapeMecard(setting.phone)}`)
    if (session?.user?.email) vcardParts.push(`EMAIL:${escapeMecard(session.user.email)}`)
    if (setting.address) vcardParts.push(`ADR:${escapeMecard(setting.address)}`)
    if (setting.gstin) vcardParts.push(`NOTE:GSTIN ${escapeMecard(setting.gstin)}`)
    const vcard = `MECARD:${vcardParts.join(';')};;`

    return (
      <div className="space-y-4">
        {/* QR Code Card — 🔒 Phase 8d: Hide if no contact info filled */}
        {vcardParts.length > 0 && (
        <div className="bg-card rounded-2xl shadow-card border border-border/60 overflow-hidden">
          <div className="p-4 border-b border-border/40">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-950 flex items-center justify-center">
                <Store className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="font-semibold text-sm">Shop QR Code</p>
                <p className="text-xs text-muted-foreground">Scan to save this shop's contact</p>
              </div>
            </div>
          </div>
          <div className="p-6 flex flex-col items-center">
            {/* QR Code — white background for scanability */}
            <div className="p-4 bg-white rounded-2xl shadow-inner">
              <QRCodeSVG
                value={vcard}
                size={180}
                level="M"
                includeMargin={false}
                className="rounded"
              />
            </div>
            <p className="text-sm font-medium mt-3 text-center">{setting.shopName || 'My Shop'}</p>
            {setting.ownerName && (
              <p className="text-xs text-muted-foreground mt-0.5 text-center">{setting.ownerName}</p>
            )}
            <div className="flex gap-2 mt-4 w-full">
              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: setting.shopName || 'My Shop',
                      text: `Contact for ${setting.shopName || 'My Shop'}${setting.phone ? ` — ${setting.phone}` : ''}`,
                      url: window.location.href,
                    }).catch(() => {})
                  } else if (navigator.clipboard) {
                    navigator.clipboard.writeText(vcard).then(() => {
                      // Silently copied — no toast needed for QR
                    }).catch(() => {})
                  }
                }}
                className="flex-1 py-2 rounded-lg bg-gradient-saffron text-white text-xs font-medium"
              >
                Share
              </button>
              <button
                onClick={() => {
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(vcard).then(() => {
                      // Silently copied
                    }).catch(() => {})
                  }
                }}
                className="flex-1 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition"
              >
                Copy vCard
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Settings form (profile tab) */}
        <Suspense fallback={<div className="bg-card rounded-2xl shadow-card border border-border/60 p-8 text-center"><p className="text-muted-foreground text-sm">Loading...</p></div>}>
          <SettingsComponent sections={['shop-profile']} hostTitle={hostTitle} />
        </Suspense>
      </div>
    )
  }

  // ═══ Business Card Page — shareable digital visiting card ═══
  // 🐛 UI/UX Phase 2: Now uses BusinessCardDisplay component with 10 designs,
  // logo support, image download, and vCard 3.0 (was: single hard-coded design,
  // no logo, no download, MECARD format).
  if (section === 'business-card') {
    return (
      <BusinessCardDisplay
        setting={setting}
        // The SIGN-IN address, passed as a last resort only. The card prefers
        // Setting.email and then the card's own override — see lib/card-details.
        email={session?.user?.email}
      />
    )
  }

  // ═══ Security Page ═══
  if (section === 'security') {
    // 🐛 UI/UX Phase 4 Fix 3: Security section — was 100% "Coming Soon" with
    // fake toggles + dead Change Password card. Now: links to the real password
    // reset flow (/reset-password) + shows actual security posture info +
    // links to device-level security (Android screen lock).
    return (
      <div className="space-y-4">
        {/* Change Password — links to the real reset flow */}
        <div className="bg-card rounded-2xl shadow-card border border-border/60 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="font-semibold text-sm">Change Password</p>
              <p className="text-xs text-muted-foreground">Update your account password</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            We&apos;ll send a password reset link to your email. Click the link in the email to set a new password.
          </p>
          <button
            onClick={() => {
              useAppStore.getState().setView('dashboard')
              window.location.href = '/reset-password'
            }}
            className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center justify-center gap-2 transition"
          >
            <Shield className="w-4 h-4" />
            Send Reset Link
          </button>
        </div>

        {/* ═══ App Lock ═══════════════════════════════════════════════════
            🔒 Rahul: "security has no real feature."

            This was two "Coming Soon" notices — one here, one in App Settings
            — plus instructions for using the phone's own screen lock instead.
            It is now built. See src/lib/app-lock.ts for the threat model and
            for why every failure path unlocks rather than locks. */}
        <AppLockCard />

        {/* Data Security — what's actually protecting the user's data */}
        <div className="bg-card rounded-2xl shadow-card border border-border/60 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="font-semibold text-sm">Data Security</p>
              <p className="text-xs text-muted-foreground">Your data is protected</p>
            </div>
          </div>
          <div className="space-y-2 mt-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              All data is encrypted in transit (HTTPS/TLS)
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Passwords are hashed with bcrypt (never stored in plain text)
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Each shop&apos;s data is isolated — no other user can see it
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              DPDP Act compliant — delete your data anytime (Settings → Data → Danger Zone)
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ═══ Referral Page ═══
  // 🔒 AUDIT V23 FIX §13.7: Was showing a FAKE referral code (email prefix).
  // The real referral system exists: /api/referral/code, /api/referral/apply,
  // /api/referral/status, ReferralCard.tsx. Now using the real component.
  if (section === 'referral') {
    return <ReferralCard />
  }
  if (section === 'help') {
    return (
      <div className="space-y-4">
        <div className="bg-card rounded-2xl shadow-card border border-border/60 overflow-hidden">
          <div className="p-4 border-b border-border/40">
            <p className="font-semibold text-sm">Contact Us</p>
          </div>
          <a href="mailto:support@ekbook.app" className="flex items-center gap-3 p-4 hover:bg-muted/50 transition border-b border-border/40">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <Mail className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Email Support</p>
              <p className="text-xs text-muted-foreground">support@ekbook.app · We reply within 24 hours</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </a>
          <button
            onClick={() => window.open('https://wa.me/918340228552?text=Hi%20EkBook%20team', '_blank')}
            className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Phone className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium">WhatsApp Support</p>
              <p className="text-xs text-muted-foreground">Quick help via WhatsApp chat</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="bg-card rounded-2xl shadow-card border border-border/60 overflow-hidden">
          <div className="p-4 border-b border-border/40">
            <p className="font-semibold text-sm">Frequently Asked Questions</p>
          </div>
          {[
            { q: 'Is my data safe?', a: 'Yes. All data is encrypted, passwords are hashed, and your account is protected with multi-tenant isolation. You can delete your data anytime.' },
            { q: 'Does it work offline?', a: 'Yes! Create sales, add products, check inventory — everything works offline. Syncs automatically when online.' },
            { q: 'Can I use it on mobile and desktop?', a: 'Yes. EkBook works on any device with a browser. Install as an app on your phone for the best experience.' },
            { q: 'How do I file GST returns?', a: 'Go to Reports → GSTR-1 or GSTR-3B. GSTR-1 exports a portal-ready JSON (upload directly to gst.gov.in); GSTR-3B exports a CSV summary you can copy into the portal. One-click export.' },
            { q: 'How much does it cost?', a: 'Free forever for basic use. Pro plan starts at ₹299/month with unlimited AI scans, GST export, and more.' },
          ].map((faq, i) => (
            <details key={i} className={i > 0 ? 'border-t border-border/40' : ''}>
              <summary className="p-4 cursor-pointer text-sm font-medium flex items-center justify-between">
                {faq.q}
                <span className="text-muted-foreground">+</span>
              </summary>
              <div className="px-4 pb-4 text-xs text-muted-foreground">{faq.a}</div>
            </details>
          ))}
        </div>

        {/* 🔒 Feature Phase 2: Beta Readiness Kit — enhanced "Report a Problem"
            with auto-filled debug info (device, version, current view, crash count).
            Was: simple mailto link with no context. Now: pre-fills email body with
            useful debug info so the support team can reproduce the issue faster. */}
        <div className="bg-card rounded-2xl shadow-card border border-border/60 p-4">
          <p className="font-semibold text-sm mb-2">Report a Problem</p>
          <p className="text-xs text-muted-foreground mb-3">
            Found something broken or not working right? Let us know and we'll fix it ASAP.
            Your report includes debug info (app version, device, crash count) to help us diagnose faster.
          </p>
          {/* Auto-collected debug info — shown to the user so they know what's included */}
          <div className="bg-muted/50 rounded-lg p-3 mb-3 text-2xs text-muted-foreground space-y-0.5">
            <p><span className="font-medium">App version:</span> {APP_VERSION_LABEL}</p>
            <p><span className="font-medium">Device:</span> {typeof navigator !== 'undefined' ? navigator.userAgent.split(') ')[0].split('(')[1] || 'Unknown' : 'Unknown'}</p>
            <p><span className="font-medium">Screen:</span> {typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : 'Unknown'}</p>
            <p><span className="font-medium">Crash-free sessions:</span> {(() => {
              try {
                const total = parseInt(localStorage.getItem('bahikhata:session-count') || '0')
                const crashed = parseInt(localStorage.getItem('bahikhata:crash-count') || '0')
                return `${total - crashed}/${total} (${total > 0 ? Math.round((1 - crashed / total) * 100) : 100}%)`
              } catch { return 'Unknown' }
            })()}</p>
          </div>
          <a
            href={`mailto:support@ekbook.app?subject=${encodeURIComponent(`Bug Report — ${APP_VERSION_LABEL}`)}&body=${encodeURIComponent(
              `Hi EkBook team,\n\nI encountered a problem:\n\n[Describe what happened here]\n\n--- Debug Info ---\nApp version: ${APP_VERSION_LABEL}\nDevice: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}\nScreen: ${typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'Unknown'}\nURL: ${typeof window !== 'undefined' ? window.location.href : 'Unknown'}\nCrash-free sessions: ${(() => {
                try {
                  const total = parseInt(localStorage.getItem('bahikhata:session-count') || '0')
                  const crashed = parseInt(localStorage.getItem('bahikhata:crash-count') || '0')
                  return `${total - crashed}/${total}`
                } catch { return 'Unknown' }
              })()}\n------------------`
            )}`}
            className="block w-full py-2.5 rounded-lg border border-border text-center text-sm font-medium hover:bg-muted transition"
          >
            Report a Problem
          </a>
        </div>
      </div>
    )
  }

  // ═══ About Page ═══
  if (section === 'about') {
    return (
      <div className="space-y-4">
        <div className="bg-card rounded-2xl shadow-card border border-border/60 p-6 text-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-saffron flex items-center justify-center mx-auto mb-4 shadow-lg">
            <BookOpenText className="w-10 h-10 text-white" />
          </div>
          <h3 className="text-xl font-bold">EkBook</h3>
          <p className="text-sm text-muted-foreground mt-1">India's Smartest Ledger App</p>
          {/* 🔒 AUDIT V23 FIX §10: App version with build info for beta readiness */}
          <p className="text-xs text-muted-foreground mt-2">{APP_VERSION_LABEL}</p>
          {/* 🔒 Feature Phase 2: Crash-free metric for beta readiness */}
          <p className="text-2xs text-muted-foreground mt-1">
            {(() => {
              try {
                const total = parseInt(localStorage.getItem('bahikhata:session-count') || '0')
                const crashed = parseInt(localStorage.getItem('bahikhata:crash-count') || '0')
                const pct = total > 0 ? Math.round((1 - crashed / total) * 100) : 100
                return `Crash-free: ${pct}% (${Math.max(0, total - crashed)}/${total} sessions)`
              } catch { return '' }
            })()}
          </p>
          <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
            🇮🇳 Made in India
          </div>
        </div>

        <div className="bg-card rounded-2xl shadow-card border border-border/60 overflow-hidden">
          <a href="/privacy" className="flex items-center gap-3 p-4 hover:bg-muted/50 transition border-b border-border/40">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <Shield className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Privacy Policy</p>
              <p className="text-xs text-muted-foreground">How we handle your data</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </a>
          <a href="/terms" className="flex items-center gap-3 p-4 hover:bg-muted/50 transition border-b border-border/40">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-slate-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Terms of Service</p>
              <p className="text-xs text-muted-foreground">Terms and conditions</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </a>
          <button
            onClick={() => window.open('https://play.google.com/store/apps/details?id=pro.ekbook.app', '_blank')}
            className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <Star className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium">Rate EkBook</p>
              <p className="text-xs text-muted-foreground">Help others discover us</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="bg-card rounded-2xl shadow-card border border-border/60 p-4 text-center">
          <p className="text-xs text-muted-foreground leading-relaxed">
            EkBook is a GST-compliant ledger app built for Indian shopkeepers.
            AI bill scanning, voice entry, GST filing, inventory management —
            all in one app. Works offline. Free to start.
          </p>
          <p className="text-xs text-muted-foreground mt-3">
            Made with ❤️ for Bharat 🇮🇳
          </p>
        </div>

        {/* 🐛 2026-08-08: Replay Tour + Replay Theme Picker. They used to
            ride along in an ungated About card that appeared at the foot of
            every settings tab; removing that card orphaned them. This is a
            bespoke page that returns before the generic Settings render, so
            it has to ask for the card itself. */}
        <Suspense fallback={null}>
          <SettingsComponent sections={['about-card']} hostTitle={hostTitle} />
        </Suspense>
      </div>
    )
  }

  // For sections that don't have dedicated content yet, show a placeholder
  if (!hasContent) {
    return (
      <div className="bg-card rounded-2xl shadow-card border border-border/60 p-6 text-center">
        <p className="text-muted-foreground text-sm">
          This section is coming soon. We're building it to match the quality
          of top apps like PhonePe and CRED.
        </p>
      </div>
    )
  }

  // For sections with Settings content, render Settings with singleTab.
  // 🔒 V22-6 fix: SettingsComponent is now declared at module scope (above).
  return (
    <Suspense fallback={<div className="bg-card rounded-2xl shadow-card border border-border/60 p-8 text-center"><p className="text-muted-foreground text-sm">Loading...</p></div>}>
      <SettingsComponent sections={sectionCards[section]} hostTitle={hostTitle} />
    </Suspense>
  )
}
