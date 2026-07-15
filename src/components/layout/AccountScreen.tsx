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
import {
  ArrowLeft, Pencil, Calculator, Crown, Phone, Mail, Store,
  ChevronRight, User, CreditCard, Shield, Settings as SettingsIcon,
  Database, Users, Gift, HelpCircle, Info, Star, LogOut,
  BookOpenText, FileSpreadsheet, Check, Sparkles, Share2, Send,
  Package, TrendingUp, Wallet, AlertCircle,
  type LucideIcon,
} from 'lucide-react'
import type { ViewType } from '@/store/app-store'

// 🔒 V22-6 (Phase 4) FIX: Move lazy() to module scope.
// Was: `const SettingsComponent = lazy(...)` inside AccountSectionContent.
// That created a NEW lazy component on every render, causing Settings to
// re-mount and lose all its form state on any parent re-render.
// Now: declared once at module scope, stable across renders.
const SettingsComponent = lazy(() =>
  import('@/components/settings/Settings').then(m => ({ default: m.Settings }))
)

interface AccountMenuItem {
  icon: LucideIcon
  label: string
  description?: string
  view?: ViewType
  action?: () => void
  iconColor: string
  iconBg: string
}

interface AccountMenuSection {
  title?: string
  items: AccountMenuItem[]
}

export function AccountScreen() {
  const { setView, previousView, setPreviousView } = useAppStore()
  const accountSection = useAppStore((s) => s.accountSection)
  const setAccountSection = useAppStore((s) => s.setAccountSection)
  const { data: session } = useSession()
  const { plan } = useSubscription()
  const { isCA, isOwner } = useStaffPermissions()
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
  const email = session?.user?.email || ''
  const phone = setting.phone

  // 🔒 V22-6 (Phase 4): Profile completion calculation.
  // 6 fields checked: ownerName, shopName, phone, gstin, address, email.
  // Each filled = 1/6 = ~16.67%. Returns { pct, missing: string[] }.
  const profileCompletion = useMemo(() => {
    const fields = [
      { label: 'Owner Name', filled: !!(setting.ownerName && setting.ownerName.trim()) },
      { label: 'Shop Name', filled: !!(setting.shopName && setting.shopName.trim()) },
      { label: 'Phone', filled: !!(setting.phone && setting.phone.trim()) },
      { label: 'GSTIN', filled: !!(setting.gstin && setting.gstin.trim()) },
      { label: 'Address', filled: !!(setting.address && setting.address.trim()) },
      { label: 'Email', filled: !!email },
    ]
    const filledCount = fields.filter(f => f.filled).length
    const pct = Math.round((filledCount / fields.length) * 100)
    const missing = fields.filter(f => !f.filled).map(f => f.label)
    return { pct, filledCount, total: fields.length, missing }
  }, [setting.ownerName, setting.shopName, setting.phone, setting.gstin, setting.address, email])

  // 🔒 V22-6 (Phase 4): Business stats from dashboard data.
  // Defensive defaults — if dashboard hasn't loaded yet, show 0/—.
  const kpis = dashboardData?.kpis
  const businessStats = useMemo(() => [
    {
      label: 'Products',
      value: kpis?.productCount != null ? String(kpis.productCount) : '—',
      icon: Package,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-100 dark:bg-amber-950',
    },
    {
      label: 'Customers',
      value: kpis?.partyCount != null ? String(kpis.partyCount) : '—',
      icon: Users,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-100 dark:bg-blue-950',
    },
    {
      label: 'This Month',
      value: kpis?.rangeRevenue != null ? formatINRCompact(kpis.rangeRevenue) : '—',
      icon: TrendingUp,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-100 dark:bg-emerald-950',
    },
    {
      label: 'Receivable',
      value: kpis?.totalReceivable != null ? formatINRCompact(kpis.totalReceivable) : '—',
      icon: Wallet,
      color: 'text-rose-600 dark:text-rose-400',
      bg: 'bg-rose-100 dark:bg-rose-950',
    },
  ], [kpis?.productCount, kpis?.partyCount, kpis?.rangeRevenue, kpis?.totalReceivable])

  const handleBack = () => {
    haptic.click()
    if (accountSection) {
      // 🔒 V22-3 fix: If the user came directly from More (not from Account
      // menu), back should go directly to More — not Account menu first.
      // We check if previousView is 'more' OR accountOriginView is 'more'.
      const origin = useAppStore.getState().accountOriginView
      const prev = useAppStore.getState().previousView
      if (prev === 'more' || origin === 'more') {
        // Came from More → go back to More directly
        setAccountSection(null)
        setView('more')
        setPreviousView(null)
        useAppStore.getState().setAccountOriginView(null)
      } else {
        // Came from Account menu → go back to Account menu
        setAccountSection(null)
      }
    } else {
      // If on the menu, go back to the original view
      const origin = useAppStore.getState().accountOriginView
      setView(origin || previousView || 'dashboard')
      setPreviousView(null)
      useAppStore.getState().setAccountOriginView(null)
    }
  }

  const handleItemClick = (item: AccountMenuItem) => {
    haptic.click()

    // 🔒 V21-014 (Phase 6): Open dedicated section page (not Settings with tabs)
    const sectionMap: Record<string, string> = {
      'My Profile': 'profile',
      'Business Card': 'business-card',
      'Security': 'security',
      'Subscription': 'subscription',
      'App Settings': 'app-settings',
      'Feature Toggles': 'features',
      'Data & Privacy': 'data',
      'Staff & Access': 'staff',
      'Refer & Earn': 'referral',
      'Help & Support': 'help',
      'About': 'about',
    }
    if (item.label && sectionMap[item.label]) {
      setAccountSection(sectionMap[item.label])
      return
    }

    // For items without a dedicated section (like Rate EkBook), use action
    if (item.action) item.action()
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
  const sectionTitles: Record<string, string> = {
    'profile': 'My Profile',
    'business-card': 'Business Card',
    'security': 'Security',
    'subscription': 'Subscription',
    'app-settings': 'App Settings',
    'features': 'Feature Toggles',
    'data': 'Data & Privacy',
    'staff': 'Staff & Access',
    'referral': 'Refer & Earn',
    'help': 'Help & Support',
    'about': 'About',
  }

  // ═══ 10 Menu Sections ═══
  const sections: AccountMenuSection[] = [
    {
      title: 'Account',
      items: [
        {
          icon: User,
          label: 'My Profile',
          description: 'Shop name, GSTIN, address, contact',
          view: 'settings',
          iconColor: 'text-blue-600',
          iconBg: 'bg-blue-100',
        },
        {
          icon: Store,
          label: 'Business Card',
          description: 'Shareable digital visiting card with QR',
          view: 'settings',
          iconColor: 'text-violet-600 dark:text-violet-400',
          iconBg: 'bg-violet-100 dark:bg-violet-950',
        },
        {
          icon: CreditCard,
          label: 'Subscription',
          description: 'Plan, usage, billing, upgrade',
          view: 'pricing',
          iconColor: 'text-amber-600 dark:text-amber-400',
          iconBg: 'bg-amber-100',
        },
        {
          icon: Shield,
          label: 'Security',
          description: 'App lock, change password',
          view: 'settings',
          iconColor: 'text-emerald-600 dark:text-emerald-400',
          iconBg: 'bg-emerald-100',
        },
      ],
    },
    {
      title: 'Preferences',
      items: [
        {
          icon: SettingsIcon,
          label: 'App Settings',
          description: 'Language, dark mode, theme, app lock, backup',
          view: 'settings',
          iconColor: 'text-slate-600',
          iconBg: 'bg-slate-100',
        },
        {
          icon: Check,
          label: 'Feature Toggles',
          description: 'Search & toggle 20+ features on/off',
          view: 'settings',
          iconColor: 'text-violet-600 dark:text-violet-400',
          iconBg: 'bg-violet-100 dark:bg-violet-950',
        },
        {
          icon: Database,
          label: 'Data & Privacy',
          description: 'Export data, clear cache, delete account',
          view: 'settings',
          iconColor: 'text-violet-600',
          iconBg: 'bg-violet-100',
        },
      ],
    },
    {
      title: 'Business',
      items: [
        ...(isOwner ? [{
          icon: Users,
          label: 'Staff & Access',
          description: 'Manage staff, CA access',
          view: 'settings' as ViewType,
          iconColor: 'text-indigo-600',
          iconBg: 'bg-indigo-100',
        }] : []),
        {
          icon: Gift,
          label: 'Refer & Earn',
          description: 'Invite friends, earn rewards',
          view: 'settings' as ViewType,
          iconColor: 'text-rose-600',
          iconBg: 'bg-rose-100',
        },
      ],
    },
    {
      title: 'Support',
      items: [
        {
          icon: HelpCircle,
          label: 'Help & Support',
          description: 'FAQ, contact us, report a bug',
          view: 'settings' as ViewType,
          iconColor: 'text-blue-600',
          iconBg: 'bg-blue-100',
        },
        {
          icon: Star,
          label: 'Rate EkBook',
          description: 'Help others discover us',
          action: () => {
            window.open('https://play.google.com/store/apps/details?id=com.ekbook.app', '_blank')
          },
          iconColor: 'text-amber-600 dark:text-amber-400',
          iconBg: 'bg-amber-100',
        },
        {
          icon: Info,
          label: 'About',
          description: 'Version, privacy policy, terms',
          view: 'settings' as ViewType,
          iconColor: 'text-slate-600',
          iconBg: 'bg-slate-100',
        },
      ],
    },
  ]

  return (
    <div className="min-h-screen bg-muted/30 w-full flex-1">
      {/* Top bar with back button */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={handleBack}
            className="p-2 -ml-2 rounded-lg hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-bold">
            {accountSection ? (sectionTitles[accountSection] || 'Account') : 'Account'}
          </h2>
        </div>
      </div>

      {/* ═══ Dedicated Section Page (no tabs, no menu) ═══ */}
      {accountSection && (
        <div className="max-w-2xl mx-auto px-4 py-4 pb-24"
             style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>
          <AccountSectionContent
            section={accountSection}
            setting={setting}
            session={session}
            isOwner={isOwner}
            isCA={isCA}
          />
        </div>
      )}

      {/* ═══ Account Menu (profile header + 10 items) ═══ */}
      {!accountSection && (
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4 pb-24"
           style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>

        {/* 🔒 V22-11 (Batch A, Phase 4e): Plan / Upgrade Card — Revolut pattern.
            Shows current plan at the TOP of the profile (before the header).
            - Free users: gradient card with "Upgrade to Pro" CTA + benefits
            - Pro users: amber card with "You're on Pro" + renewal info
            - Elite users: violet card with "You're on Elite" + premium badge
            Tapping navigates to the pricing page. */}
        {!isCA && (
          <button
            onClick={() => {
              haptic.click()
              setPreviousView('account')
              useAppStore.getState().setAccountOriginView('account')
              setView('pricing')
            }}
            className={cn(
              'w-full rounded-2xl shadow-card relative overflow-hidden text-white transition active:scale-[0.98] text-left',
              plan === 'elite'
                ? 'bg-gradient-to-br from-violet-500 to-purple-700'
                : plan === 'pro'
                  ? 'bg-gradient-to-br from-amber-400 to-orange-600'
                  : 'bg-gradient-to-br from-slate-700 to-slate-900',
            )}
          >
            <div className="p-4 relative">
              {/* Decorative circle */}
              <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-12 -mt-12 pointer-events-none" />
              <div className="relative flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                  {plan === 'free' ? (
                    <Sparkles className="w-5 h-5 text-white" />
                  ) : (
                    <Crown className="w-5 h-5 text-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {plan === 'free' ? (
                    <>
                      <p className="font-bold text-sm">Upgrade to Pro</p>
                      <p className="text-[11px] text-white/80 mt-0.5">
                        AI Scanner · GST Export · WhatsApp · Voice Entry
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-bold text-sm">
                        You're on {plan === 'elite' ? 'Elite' : 'Pro'} {plan === 'elite' && '👑'}
                      </p>
                      <p className="text-[11px] text-white/80 mt-0.5">
                        {plan === 'elite'
                          ? 'All features unlocked · Priority support'
                          : 'Pro features active · Upgrade to Elite for more'}
                      </p>
                    </>
                  )}
                </div>
                <div className="flex-shrink-0">
                  <span className="text-[10px] font-bold uppercase tracking-wide bg-white/20 px-2 py-1 rounded-full">
                    {plan === 'free' ? 'View Plans' : 'Manage'}
                  </span>
                </div>
              </div>
            </div>
          </button>
        )}

        {/* ═══ Profile Header — premium gradient banner ═══ */}
        <button
          onClick={isCA ? undefined : handleEditProfile}
          disabled={isCA}
          className={cn(
            "w-full rounded-2xl shadow-card relative overflow-hidden text-white transition",
            isCA ? "cursor-default" : "active:scale-[0.98]"
          )}
        >
          <div className={cn(
            "p-6 relative",
            isCA ? "bg-gradient-to-br from-violet-600 to-purple-700" : "bg-gradient-saffron"
          )}>
            {/* Decorative circles for depth */}
            <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -mr-20 -mt-20 pointer-events-none" />
            <div className="absolute bottom-0 right-20 w-28 h-28 bg-white/5 rounded-full -mb-14 pointer-events-none" />
            <div className="absolute top-1/2 left-0 w-20 h-20 bg-white/5 rounded-full -ml-10 pointer-events-none" />

            <div className="relative flex items-center gap-4">
              {/* 🔒 V22-6 (Phase 4): Avatar with CRED-style plan ring.
                  - Free: subtle white ring (default)
                  - Pro: amber-to-orange gradient ring (premium feel)
                  - Elite: violet-to-purple gradient ring (top-tier feel)
                  The ring is a conic-gradient via Tailwind's bg-gradient-to-br
                  applied to a wrapper div, with the avatar inside. */}
              <div className="relative flex-shrink-0">
                {/* Plan ring — gradient wrapper around the avatar */}
                <div className={cn(
                  "p-[3px] rounded-full bg-gradient-to-br shadow-lg",
                  planBadge.ringGradient,
                )}>
                  <Avatar className="w-20 h-20 border-2 border-white/40">
                    <AvatarFallback className="bg-white/20 backdrop-blur-sm text-white text-2xl font-bold">
                      {getInitials(userName)}
                    </AvatarFallback>
                  </Avatar>
                </div>
                {/* Plan badge on avatar (bottom-right) */}
                <div className={cn(
                  "absolute -bottom-1 -right-1 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 shadow-lg ring-2 ring-white/80",
                  planBadge.badgeClassName
                )}>
                  {PlanIcon && <PlanIcon className="w-2.5 h-2.5" />}
                  {planBadge.label}
                </div>
              </div>

              {/* Name + shop + contact */}
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-xl font-heading tracking-tight truncate">
                    {userName}
                  </p>
                  {isCA && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-white/25 text-white whitespace-nowrap flex items-center gap-1">
                      <Calculator className="w-2.5 h-2.5" /> CA
                    </span>
                  )}
                </div>
                <p className="text-sm text-white/85 truncate flex items-center gap-1.5 mt-0.5">
                  <Store className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{activeShop?.name || shopName}</span>
                </p>
                {phone && (
                  <p className="text-xs text-white/75 truncate flex items-center gap-1.5 mt-0.5">
                    <Phone className="w-3 h-3" />
                    {phone}
                  </p>
                )}
                {email && (
                  <p className="text-xs text-white/65 truncate flex items-center gap-1.5 mt-0.5">
                    <Mail className="w-3 h-3" />
                    {email}
                  </p>
                )}
                {isCA && (
                  <p className="text-[11px] text-white/60 truncate mt-1">
                    Read-only access — ask the owner to make changes
                  </p>
                )}
              </div>

              {/* Edit button (hidden for CA) */}
              {!isCA && (
                <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                  <Pencil className="w-4 h-4" />
                </div>
              )}
            </div>
          </div>
        </button>

        {/* 🔒 V22-6 (Phase 4): Business Stats Row — 4 quick stats in a grid.
            Uses dashboard data (cached via useDashboardThisMonth).
            Shown as compact cards below the profile header. */}
        <div className="grid grid-cols-4 gap-2">
          {businessStats.map((stat) => {
            const StatIcon = stat.icon
            return (
              <div
                key={stat.label}
                className="card-hover bg-card rounded-xl border border-border/60 shadow-sm p-2.5 flex flex-col items-center text-center"
              >
                <div className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center mb-1.5',
                  stat.bg,
                )}>
                  <StatIcon className={cn('w-3.5 h-3.5', stat.color)} />
                </div>
                <p className="text-sm font-bold tabular-nums leading-tight">{stat.value}</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{stat.label}</p>
              </div>
            )
          })}
        </div>

        {/* 🔒 V22-11 (Batch A, Phase 4f): Switch Shop card — for multi-shop users.
            Only shows when user has 2+ shops. Single-shop users don't see this.
            Separate card (NOT inside the profile button) to avoid nested-button
            HTML validation issues. */}
        {shops.length > 1 && !isCA && (
          <div ref={shopDropdownRef} className="bg-card rounded-2xl border border-border/60 shadow-sm overflow-hidden">
            <button
              onClick={() => {
                haptic.click()
                setShopDropdownOpen(!shopDropdownOpen)
              }}
              className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition"
            >
              <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-950 flex items-center justify-center flex-shrink-0">
                <Store className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-xs text-muted-foreground">Active Shop</p>
                <p className="text-sm font-medium truncate">{activeShop?.name || shopName}</p>
              </div>
              <ChevronRight className={cn(
                'w-4 h-4 text-muted-foreground transition-transform',
                shopDropdownOpen && 'rotate-90',
              )} />
            </button>
            {shopDropdownOpen && (
              <div className="border-t border-border/40 max-h-60 overflow-y-auto">
                {shops.map(shop => (
                  <button
                    key={shop.id}
                    onClick={() => {
                      switchShop(shop.id)
                      setShopDropdownOpen(false)
                    }}
                    className={cn(
                      'w-full text-left px-3 py-2.5 hover:bg-muted/50 transition flex items-center gap-2',
                      activeShop?.id === shop.id && 'bg-primary/5',
                    )}
                  >
                    <Store className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-sm truncate">{shop.name}</span>
                    {activeShop?.id === shop.id && (
                      <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 🔒 V22-6 (Phase 4): Profile Completion Progress Bar.
            LinkedIn-style: shows % complete + missing field hint.
            - 100% → green + "Profile complete!"
            - <100% → blue + "Add X, Y to complete" */}
        {profileCompletion.pct < 100 && (
          <button
            onClick={handleEditProfile}
            disabled={isCA}
            className={cn(
              "w-full bg-card rounded-2xl border border-border/60 shadow-sm p-3.5 text-left transition",
              isCA ? "cursor-default opacity-70" : "hover:shadow-md active:scale-[0.99]",
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
                  <AlertCircle className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold">Profile {profileCompletion.pct}% complete</p>
                  <p className="text-[10px] text-muted-foreground">
                    {profileCompletion.missing.length > 0
                      ? `Add: ${profileCompletion.missing.slice(0, 3).join(', ')}${profileCompletion.missing.length > 3 ? '…' : ''}`
                      : 'All fields filled'}
                  </p>
                </div>
              </div>
              {!isCA && (
                <span className="text-[10px] font-medium text-primary">Complete →</span>
              )}
            </div>
            {/* Progress bar */}
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  profileCompletion.pct === 100
                    ? 'bg-emerald-500'
                    : profileCompletion.pct >= 67
                      ? 'bg-emerald-400'
                      : profileCompletion.pct >= 34
                        ? 'bg-amber-400'
                        : 'bg-rose-400',
                )}
                style={{ width: `${profileCompletion.pct}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {profileCompletion.filledCount} of {profileCompletion.total} fields filled
            </p>
          </button>
        )}

        {/* ═══ Menu Sections ═══ */}
        {sections.map((section, idx) => {
          if (section.items.length === 0) return null
          return (
            <div key={idx}>
              {section.title && (
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
                  {section.title}
                </p>
              )}
              <div className="bg-card rounded-2xl shadow-sm border border-border/60 overflow-hidden">
                {section.items.map((item, i) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.label}
                      onClick={() => handleItemClick(item)}
                      className={cn(
                        'w-full flex items-center gap-3 p-3.5 hover:bg-muted/50 transition text-left active:bg-muted group',
                        i > 0 && 'border-t border-border/40',
                      )}
                    >
                      <div className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition group-hover:scale-105',
                        item.iconBg
                      )}>
                        <Icon className={cn('w-5 h-5', item.iconColor)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{item.label}</p>
                        {item.description && (
                          <p className="text-xs text-muted-foreground truncate">{item.description}</p>
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

        {/* ═══ Logout Button ═══ */}
        <button
          onClick={() => {
            haptic.warning()
            import('next-auth/react').then(({ signOut }) => {
              import('@/lib/offline-db').then(({ clearAllOfflineData }) => {
                clearAllOfflineData().then(() => {
                  signOut({ callbackUrl: '/' })
                })
              })
            })
          }}
          className="w-full bg-card rounded-2xl p-4 shadow-sm border border-rose-200 flex items-center justify-center gap-2 text-rose-600 hover:bg-rose-50 transition active:scale-[0.98]"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-semibold">Logout</span>
        </button>

        {/* Version footer */}
        <p className="text-center text-xs text-muted-foreground pt-2">
          EkBook v1.0 · Made with love for Bharat 🇮🇳
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
  setting,
  session,
  isOwner,
  isCA,
}: {
  section: string
  setting: any
  session: any
  isOwner: boolean
  isCA: boolean
}) {
  // Render the Settings component with a singleTab prop that hides the tab bar
  // and locks to the relevant tab. This reuses all the existing Settings logic
  // (forms, API calls, state management) without duplicating code.
  const tabMap: Record<string, 'profile' | 'features' | 'appearance' | 'data' | 'staff'> = {
    'profile': 'profile',
    'security': 'profile',
    'app-settings': 'appearance',
    'features': 'features',
    'data': 'data',
    'staff': 'staff',
    'referral': 'profile',
    'help': 'profile',
    'about': 'profile',
  }

  // For subscription, redirect to pricing page
  if (section === 'subscription') {
    return (
      <div className="bg-card rounded-2xl shadow-sm border border-border/60 p-6 text-center">
        <CreditCard className="w-12 h-12 text-amber-500 mx-auto mb-3" />
        <p className="font-semibold mb-1">Manage Subscription</p>
        <p className="text-sm text-muted-foreground mb-4">
          View plans, upgrade, or manage your subscription.
        </p>
        <button
          onClick={() => {
            // 🔒 V21-014 fix: Don't clear accountSection — keep it as 'subscription'
            // so when the user comes back from pricing, they see the subscription
            // section (not the Account menu). Set previousView to 'account' so
            // the back button on pricing returns here.
            useAppStore.getState().setPreviousView('account')
            useAppStore.getState().setView('pricing')
          }}
          className="px-4 py-2 rounded-lg bg-gradient-saffron text-white text-sm font-medium"
        >
          View Plans
        </button>
      </div>
    )
  }

  // For sections that don't have dedicated content yet, show a placeholder
  const hasContent = tabMap[section]

  // ═══ Profile Page — QR Code card + Settings form ═══
  // 🔒 V22-6 (Phase 4): Show a QR code at the top of the profile page that
  // encodes the shop's vCard contact info (name, shop, phone, gstin, address).
  // Customers/other shops can scan this to save the contact.
  // Below the QR card, render the Settings (profile tab) form for editing.
  if (section === 'profile') {
    // Build vCard string (MECARD format — works with most Indian phones)
    const vcardParts: string[] = []
    if (setting.ownerName) vcardParts.push(`N:${setting.ownerName}`)
    if (setting.shopName) vcardParts.push(`ORG:${setting.shopName}`)
    if (setting.phone) vcardParts.push(`TEL:${setting.phone}`)
    if (session?.user?.email) vcardParts.push(`EMAIL:${session.user.email}`)
    if (setting.address) vcardParts.push(`ADR:${setting.address}`)
    if (setting.gstin) vcardParts.push(`NOTE:GSTIN ${setting.gstin}`)
    const vcard = `MECARD:${vcardParts.join(';')};;`

    return (
      <div className="space-y-4">
        {/* QR Code Card */}
        <div className="bg-card rounded-2xl shadow-sm border border-border/60 overflow-hidden">
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

        {/* Settings form (profile tab) */}
        <Suspense fallback={<div className="bg-card rounded-2xl shadow-sm border border-border/60 p-8 text-center"><p className="text-muted-foreground text-sm">Loading...</p></div>}>
          <SettingsComponent singleTab="profile" />
        </Suspense>
      </div>
    )
  }

  // ═══ Business Card Page — shareable digital visiting card ═══
  // 🔒 V22-13 (Batch C, Phase 7h): A beautiful digital visiting card with
  // shop branding, contact info, and QR code. Can be shared via WhatsApp
  // or downloaded as an image.
  if (section === 'business-card') {
    // Build vCard for QR code (MECARD format)
    const vcardParts: string[] = []
    if (setting.ownerName) vcardParts.push(`N:${setting.ownerName}`)
    if (setting.shopName) vcardParts.push(`ORG:${setting.shopName}`)
    if (setting.phone) vcardParts.push(`TEL:${setting.phone}`)
    if (session?.user?.email) vcardParts.push(`EMAIL:${session.user.email}`)
    if (setting.address) vcardParts.push(`ADR:${setting.address}`)
    if (setting.gstin) vcardParts.push(`NOTE:GSTIN ${setting.gstin}`)
    const vcard = `MECARD:${vcardParts.join(';')};;`

    return (
      <div className="space-y-4">
        {/* Digital Business Card */}
        <div className="relative rounded-2xl overflow-hidden shadow-card">
          {/* Card front — gradient background */}
          <div className="bg-gradient-saffron p-6 text-white relative">
            {/* Decorative circles */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full -ml-12 -mb-12" />

            <div className="relative flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Shop name */}
                <p className="text-[10px] uppercase tracking-wider text-white/70 font-semibold">Business Name</p>
                <h3 className="text-xl font-bold mt-0.5 truncate">{setting.shopName || 'My Shop'}</h3>

                {/* Owner name */}
                {setting.ownerName && (
                  <p className="text-sm text-white/85 mt-2">
                    <span className="text-white/60">Proprietor:</span> {setting.ownerName}
                  </p>
                )}

                {/* Contact details */}
                <div className="mt-3 space-y-1">
                  {setting.phone && (
                    <p className="text-xs text-white/85 flex items-center gap-1.5">
                      <Phone className="w-3 h-3 flex-shrink-0" />
                      {setting.phone}
                    </p>
                  )}
                  {session?.user?.email && (
                    <p className="text-xs text-white/75 flex items-center gap-1.5">
                      <Mail className="w-3 h-3 flex-shrink-0" />
                      {session.user.email}
                    </p>
                  )}
                  {setting.gstin && (
                    <p className="text-xs text-white/75 flex items-center gap-1.5 font-mono">
                      <FileSpreadsheet className="w-3 h-3 flex-shrink-0" />
                      GSTIN: {setting.gstin}
                    </p>
                  )}
                </div>

                {/* Address */}
                {setting.address && (
                  <p className="text-[11px] text-white/65 mt-2 leading-relaxed">
                    {setting.address}
                  </p>
                )}
              </div>

              {/* QR Code */}
              <div className="flex-shrink-0">
                <div className="p-2 bg-white rounded-xl shadow-lg">
                  <QRCodeSVG
                    value={vcard}
                    size={96}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <p className="text-[9px] text-white/60 text-center mt-1">Scan to save</p>
              </div>
            </div>
          </div>
        </div>

        {/* Share buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              const shareText = `${setting.shopName || 'My Shop'}\n${setting.ownerName ? 'Proprietor: ' + setting.ownerName + '\n' : ''}${setting.phone ? 'Phone: ' + setting.phone + '\n' : ''}${setting.gstin ? 'GSTIN: ' + setting.gstin + '\n' : ''}${setting.address ? 'Address: ' + setting.address : ''}`
              if (navigator.share) {
                navigator.share({ title: setting.shopName || 'My Shop', text: shareText }).catch(() => {})
              } else if (navigator.clipboard) {
                navigator.clipboard.writeText(shareText).then(() => {
                  sonnerToast.success('Business card copied to clipboard')
                }).catch(() => {})
              }
            }}
            className="py-2.5 rounded-lg bg-gradient-saffron text-white text-sm font-medium flex items-center justify-center gap-2"
          >
            <Share2 className="w-4 h-4" />
            Share Card
          </button>
          <button
            onClick={() => {
              const waText = encodeURIComponent(`${setting.shopName || 'My Shop'}\n${setting.ownerName ? 'Proprietor: ' + setting.ownerName + '\n' : ''}${setting.phone ? 'Phone: ' + setting.phone + '\n' : ''}${setting.gstin ? 'GSTIN: ' + setting.gstin + '\n' : ''}${setting.address ? 'Address: ' + setting.address : ''}`)
              window.open(`https://wa.me/?text=${waText}`, '_blank')
            }}
            className="py-2.5 rounded-lg border border-emerald-300 text-emerald-700 dark:text-emerald-400 dark:border-emerald-800 text-sm font-medium flex items-center justify-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition"
          >
            <Send className="w-4 h-4" />
            Send on WhatsApp
          </button>
        </div>

        {/* Tip */}
        <div className="rounded-lg bg-muted/50 border border-border/60 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-1">💡 How to use:</p>
          <p>Share this card with customers via WhatsApp. They can scan the QR code to instantly save your shop's contact in their phone.</p>
        </div>
      </div>
    )
  }

  // ═══ Security Page ═══
  if (section === 'security') {
    return (
      <div className="space-y-4">
        <div className="bg-card rounded-2xl shadow-sm border border-border/60 overflow-hidden">
          <div className="p-4 border-b border-border/40">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="font-semibold text-sm">App Lock</p>
                <p className="text-xs text-muted-foreground">Require PIN/biometric to open app</p>
              </div>
            </div>
          </div>
          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Biometric Lock</p>
              <p className="text-xs text-muted-foreground">Use fingerprint or face ID</p>
            </div>
            <div className="w-11 h-6 bg-muted rounded-full flex items-center px-0.5 cursor-not-allowed opacity-50">
              <div className="w-5 h-5 rounded-full bg-white shadow" />
            </div>
          </div>
          <div className="p-4 border-t border-border/40 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">PIN Lock</p>
              <p className="text-xs text-muted-foreground">4-digit PIN required on startup</p>
            </div>
            <div className="w-11 h-6 bg-muted rounded-full flex items-center px-0.5 cursor-not-allowed opacity-50">
              <div className="w-5 h-5 rounded-full bg-white shadow" />
            </div>
          </div>
          <div className="p-3 border-t border-border/40 bg-muted/30">
            <p className="text-[11px] text-muted-foreground text-center">🔒 Coming soon in a future update</p>
          </div>
        </div>

        <div className="bg-card rounded-2xl shadow-sm border border-border/60 overflow-hidden">
          <div className="p-4 border-b border-border/40">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <Shield className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-sm">Change Password</p>
                <p className="text-xs text-muted-foreground">Update your account password</p>
              </div>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Current Password</label>
              <input type="password" placeholder="••••••••" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">New Password</label>
              <input type="password" placeholder="••••••••" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Confirm New Password</label>
              <input type="password" placeholder="••••••••" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            </div>
            <button className="w-full py-2.5 rounded-lg bg-gradient-saffron text-white text-sm font-medium mt-2">
              Update Password
            </button>
          </div>
        </div>

        <div className="bg-card rounded-2xl shadow-sm border border-border/60 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
              <Info className="w-5 h-5 text-violet-600" />
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
              Each shop's data is isolated (multi-tenant security)
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              DPDP Act compliant — delete your data anytime
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ═══ Referral Page ═══
  if (section === 'referral') {
    return (
      <div className="space-y-4">
        <div className="bg-gradient-to-br from-rose-500 to-pink-600 rounded-2xl p-6 text-white shadow-lg text-center">
          <Gift className="w-16 h-16 mx-auto mb-3 opacity-90" />
          <h3 className="text-xl font-bold mb-1">Refer & Earn</h3>
          <p className="text-sm text-white/80 mb-4">
            Invite fellow shopkeepers to EkBook. When they sign up, you both get 1 month of Pro FREE.
          </p>
          <div className="bg-white/20 backdrop-blur-sm rounded-xl p-3 mb-3">
            <p className="text-xs text-white/70 mb-1">Your Referral Code</p>
            <p className="text-2xl font-bold tracking-wider">{session?.user?.email?.split('@')[0]?.toUpperCase()?.slice(0, 8) || 'EKBOOK'}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const code = session?.user?.email?.split('@')[0]?.toUpperCase()?.slice(0, 8) || 'EKBOOK'
                const shareText = `Use my code ${code} to get 1 month Pro FREE on EkBook!`
                const shareUrl = 'https://bahikhata-pro.vercel.app'
                if (navigator.share) {
                  navigator.share({ title: 'EkBook — India\'s Smartest Ledger App', text: shareText, url: shareUrl })
                } else if (navigator.clipboard) {
                  navigator.clipboard.writeText(`${shareText} ${shareUrl}`)
                }
              }}
              className="flex-1 py-2.5 rounded-lg bg-white text-rose-600 text-sm font-bold"
            >
              Share
            </button>
            <button
              onClick={() => {
                const code = session?.user?.email?.split('@')[0]?.toUpperCase()?.slice(0, 8) || 'EKBOOK'
                navigator.clipboard?.writeText(code)
              }}
              className="flex-1 py-2.5 rounded-lg bg-white/20 backdrop-blur-sm text-white text-sm font-medium"
            >
              Copy Code
            </button>
          </div>
        </div>

        <div className="bg-card rounded-2xl shadow-sm border border-border/60 p-4">
          <p className="font-semibold text-sm mb-3">How It Works</p>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 text-xs font-bold flex-shrink-0">1</div>
              <div>
                <p className="text-sm font-medium">Share your code</p>
                <p className="text-xs text-muted-foreground">Send your referral code to fellow shopkeepers</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 text-xs font-bold flex-shrink-0">2</div>
              <div>
                <p className="text-sm font-medium">They sign up</p>
                <p className="text-xs text-muted-foreground">Your friend creates an EkBook account using your code</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 text-xs font-bold flex-shrink-0">3</div>
              <div>
                <p className="text-sm font-medium">You both earn</p>
                <p className="text-xs text-muted-foreground">Both get 1 month of Pro features FREE</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-2xl shadow-sm border border-border/60 p-4 text-center">
          <p className="text-xs text-muted-foreground">No referrals yet. Start sharing your code!</p>
        </div>
      </div>
    )
  }

  // ═══ Help & Support Page ═══
  if (section === 'help') {
    return (
      <div className="space-y-4">
        <div className="bg-card rounded-2xl shadow-sm border border-border/60 overflow-hidden">
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

        <div className="bg-card rounded-2xl shadow-sm border border-border/60 overflow-hidden">
          <div className="p-4 border-b border-border/40">
            <p className="font-semibold text-sm">Frequently Asked Questions</p>
          </div>
          {[
            { q: 'Is my data safe?', a: 'Yes. All data is encrypted, passwords are hashed, and each shop\'s data is isolated. You can delete your data anytime.' },
            { q: 'Does it work offline?', a: 'Yes! Create sales, add products, check inventory — everything works offline. Syncs automatically when online.' },
            { q: 'Can I use it on mobile and desktop?', a: 'Yes. EkBook works on any device with a browser. Install as an app on your phone for the best experience.' },
            { q: 'How do I file GST returns?', a: 'Go to Reports → GSTR-1 or GSTR-3B. Generate the JSON file and upload it to the GST portal. One-click export.' },
            { q: 'How much does it cost?', a: 'Free forever for basic use. Pro plan starts at ₹99/month with unlimited AI scans, GST export, and more.' },
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

        <div className="bg-card rounded-2xl shadow-sm border border-border/60 p-4">
          <p className="font-semibold text-sm mb-2">Report a Bug</p>
          <p className="text-xs text-muted-foreground mb-3">
            Found something broken? Let us know and we'll fix it ASAP.
          </p>
          <a href="mailto:support@ekbook.app?subject=Bug Report" className="block w-full py-2.5 rounded-lg border border-border text-center text-sm font-medium hover:bg-muted transition">
            Report a Bug
          </a>
        </div>
      </div>
    )
  }

  // ═══ About Page ═══
  if (section === 'about') {
    return (
      <div className="space-y-4">
        <div className="bg-card rounded-2xl shadow-sm border border-border/60 p-6 text-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-saffron flex items-center justify-center mx-auto mb-4 shadow-lg">
            <BookOpenText className="w-10 h-10 text-white" />
          </div>
          <h3 className="text-xl font-bold">EkBook</h3>
          <p className="text-sm text-muted-foreground mt-1">India's Smartest Ledger App</p>
          <p className="text-xs text-muted-foreground mt-2">Version 1.0.0</p>
          <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
            🇮🇳 Made in India
          </div>
        </div>

        <div className="bg-card rounded-2xl shadow-sm border border-border/60 overflow-hidden">
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
            onClick={() => window.open('https://play.google.com/store/apps/details?id=com.ekbook.app', '_blank')}
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

        <div className="bg-card rounded-2xl shadow-sm border border-border/60 p-4 text-center">
          <p className="text-xs text-muted-foreground leading-relaxed">
            EkBook is a GST-compliant ledger app built for Indian shopkeepers.
            AI bill scanning, voice entry, GST filing, inventory management —
            all in one app. Works offline. Free to start.
          </p>
          <p className="text-xs text-muted-foreground mt-3">
            Made with ❤️ for Bharat 🇮🇳
          </p>
        </div>
      </div>
    )
  }

  // For sections that don't have dedicated content yet, show a placeholder
  if (!hasContent) {
    return (
      <div className="bg-card rounded-2xl shadow-sm border border-border/60 p-6 text-center">
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
    <Suspense fallback={<div className="bg-card rounded-2xl shadow-sm border border-border/60 p-8 text-center"><p className="text-muted-foreground text-sm">Loading...</p></div>}>
      <SettingsComponent singleTab={tabMap[section]} />
    </Suspense>
  )
}
