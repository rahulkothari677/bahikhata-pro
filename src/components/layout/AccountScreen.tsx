'use client'

/**
 * AccountScreen — full-screen profile/account page.
 *
 * 🔒 V21-010 (Phase 2b): Profile header added.
 *
 * Design inspiration:
 * - CRED: Member-since ring around avatar, premium dark gradient
 * - PhonePe: Clean layout, name + phone + manage link
 * - Flipkart: Plan/membership badge (Free/Pro/Elite)
 *
 * The header is a gradient banner with:
 * - Large avatar (with initials, ring for premium plans)
 * - User name + shop name
 * - Phone number (if set)
 * - Plan badge (Free/Pro/Elite)
 * - Edit profile button
 * - Decorative circles for depth
 *
 * Subsequent phases will add the 10 menu sections below this header.
 */

import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { lazy, Suspense } from 'react'
import { useAppStore } from '@/store/app-store'
import { useSubscription } from '@/hooks/use-subscription'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { offlineFetch } from '@/lib/offline-fetch'
import { haptic } from '@/lib/haptic'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getInitials, cn } from '@/lib/utils'
import {
  ArrowLeft, Pencil, Calculator, Crown, Phone, Mail, Store,
  ChevronRight, User, CreditCard, Shield, Settings as SettingsIcon,
  Database, Users, Gift, HelpCircle, Info, Star, LogOut,
  BookOpenText, FileSpreadsheet,
  type LucideIcon,
} from 'lucide-react'
import type { ViewType } from '@/store/app-store'

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

  // Fetch settings for profile data
  const { data: settingData } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await offlineFetch('/api/settings')
      return r.json()
    },
  })

  const setting = settingData?.setting || {}
  const userName = setting.ownerName || session?.user?.name || 'Shop Owner'
  const shopName = setting.shopName || 'My Shop'
  const email = session?.user?.email || ''
  const phone = setting.phone

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
      'Security': 'security',
      'Subscription': 'subscription',
      'App Settings': 'app-settings',
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

  // Plan badge styling
  const planBadges = {
    free: { label: 'Free', className: 'bg-white/20 text-white', icon: null as null | typeof Crown },
    pro: { label: 'Pro', className: 'bg-amber-400 text-amber-900', icon: Crown },
    elite: { label: 'Elite', className: 'bg-violet-400 text-violet-900', icon: Crown },
  }
  const planBadge = planBadges[plan] || planBadges.free
  const PlanIcon = planBadge.icon

  // ═══ Section titles for dedicated pages ═══
  const sectionTitles: Record<string, string> = {
    'profile': 'My Profile',
    'security': 'Security',
    'subscription': 'Subscription',
    'app-settings': 'App Settings',
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
          description: 'Language, dark mode, features',
          view: 'settings',
          iconColor: 'text-slate-600',
          iconBg: 'bg-slate-100',
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
              {/* Avatar with ring for premium plans */}
              <div className="relative flex-shrink-0">
                <Avatar className={cn(
                  "w-20 h-20 border-4 border-white/30",
                  plan !== 'free' && "ring-2 ring-white/50 ring-offset-2 ring-offset-transparent"
                )}>
                  <AvatarFallback className="bg-white/20 backdrop-blur-sm text-white text-2xl font-bold">
                    {getInitials(userName)}
                  </AvatarFallback>
                </Avatar>
                {/* Plan badge on avatar */}
                <div className={cn(
                  "absolute -bottom-1 -right-1 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 shadow-lg",
                  planBadge.className
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
                  <Store className="w-3.5 h-3.5" />
                  {shopName}
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

  // For sections with Settings content, render Settings with singleTab
  // 🔒 V21-014 fix: Use lazy import instead of require() (eslint rule)
  const SettingsComponent = lazy(() => import('@/components/settings/Settings').then(m => ({ default: m.Settings })))
  return (
    <Suspense fallback={<div className="bg-card rounded-2xl shadow-sm border border-border/60 p-8 text-center"><p className="text-muted-foreground text-sm">Loading...</p></div>}>
      <SettingsComponent singleTab={tabMap[section]} />
    </Suspense>
  )
}
