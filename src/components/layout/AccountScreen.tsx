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
      // If in a section, go back to the account menu
      setAccountSection(null)
    } else {
      // If on the menu, go back to the previous view
      setView(previousView || 'dashboard')
      setPreviousView(null)
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
            useAppStore.getState().setPreviousView('account')
            useAppStore.getState().setAccountSection(null)
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
  // This imports the Settings component dynamically to avoid circular deps
  const Settings = require('@/components/settings/Settings').Settings
  return <Settings singleTab={tabMap[section]} />
}
