'use client'

/**
 * MoreScreen — full-screen menu page replacing the cramped sidebar on mobile.
 *
 * This is the "everything else" hub — profile, secondary features, settings,
 * support, and logout. Designed to match the polish of modern apps like
 * WhatsApp Settings, Instagram Profile, Spotify Library.
 *
 * Layout (top to bottom):
 *   1. Profile header (avatar, name, shop name, email, edit button)
 *   2. Business section (Reports, Purchases, Income/Expense, Parties)
 *   3. Tools section (AI Scanner, Smart Insights)
 *   4. Account section (Settings, Staff Management)
 *   5. Premium banner (gradient, for future subscription)
 *   6. Support section (Help, Contact, About, Rate)
 *   7. Logout button (red, at bottom)
 */

import { useQuery } from '@tanstack/react-query'
import { useSession, signOut } from 'next-auth/react'
import { useAppStore } from '@/store/app-store'
import { offlineFetch } from '@/lib/offline-fetch'
import { clearAllOfflineData } from '@/lib/offline-db'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { haptic } from '@/lib/haptic'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getInitials, cn } from '@/lib/utils'
import { toast as sonnerToast } from 'sonner'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import {
  ChevronRight, Pencil, BarChart3, Truck, Wallet, Users,
  ScanLine, Sparkles, Settings as SettingsIcon, UserCog,
  Crown, HelpCircle, Phone, Info, Star, LogOut, ArrowLeft,
  FileSpreadsheet, Bell,
} from 'lucide-react'
import type { ViewType } from '@/store/app-store'
import type { LucideIcon } from 'lucide-react'

interface MenuItem {
  icon: LucideIcon
  label: string
  description?: string
  view: ViewType
  iconColor: string
  iconBg: string
}

interface MenuSection {
  title?: string
  items: MenuItem[]
}

const SECTIONS: MenuSection[] = [
  {
    title: 'Business',
    items: [
      { icon: BarChart3, label: 'Reports', description: 'GST, P&L, sales analytics', view: 'reports', iconColor: 'text-rose-600', iconBg: 'bg-rose-100' },
      { icon: Truck, label: 'Purchases', description: 'Stock purchases & supplier ledger', view: 'purchases', iconColor: 'text-amber-600', iconBg: 'bg-amber-100' },
      { icon: Wallet, label: 'Income & Expense', description: 'Rent, salary, other income', view: 'income-expense', iconColor: 'text-emerald-600', iconBg: 'bg-emerald-100' },
      { icon: Users, label: 'Customers & Suppliers', description: 'Track dues & party balances', view: 'parties', iconColor: 'text-blue-600', iconBg: 'bg-blue-100' },
    ],
  },
  {
    title: 'Smart Tools',
    items: [
      { icon: ScanLine, label: 'AI Bill Scanner', description: 'Snap a bill, auto-fill everything', view: 'scanner', iconColor: 'text-violet-600', iconBg: 'bg-violet-100' },
    ],
  },
  {
    title: 'Account',
    items: [
      { icon: SettingsIcon, label: 'Settings', description: 'Shop profile, features, theme', view: 'settings', iconColor: 'text-slate-600', iconBg: 'bg-slate-100' },
    ],
  },
]

export function MoreScreen() {
  const { setView, previousView, setPreviousView } = useAppStore()
  const { data: session } = useSession()
  const { canAccess } = useStaffPermissions()
  const { confirmDialog, dialog: confirmDialogEl } = useConfirmDialog()

  // Fetch settings for profile header
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

  const handleItemClick = (view: ViewType) => {
    haptic.click()
    setPreviousView('more')
    setView(view)
  }

  const handleEditProfile = () => {
    haptic.click()
    setPreviousView('more')
    setView('settings')
  }

  const handleBack = () => {
    haptic.click()
    setView(previousView || 'dashboard')
    setPreviousView(null)
  }

  const handleLogout = async () => {
    if (!await confirmDialog('Are you sure you want to logout?', { title: 'Logout', confirmLabel: 'Logout', destructive: false })) return
    haptic.warning()
    try {
      await clearAllOfflineData()
      signOut({ callbackUrl: '/' })
    } catch {
      sonnerToast.error('Failed to logout')
    }
  }

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
          <h2 className="text-lg font-bold">More</h2>
        </div>
      </div>

      <div
        className="max-w-2xl mx-auto px-4 py-4 space-y-4 pb-24"
        style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}
      >
        {/* Profile Header — premium gradient banner */}
        <button
          onClick={handleEditProfile}
          className="w-full rounded-2xl shadow-card relative overflow-hidden text-white active:scale-[0.98] transition"
        >
          <div className="bg-gradient-saffron p-5 relative">
            {/* Decorative circles */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 pointer-events-none" />
            <div className="absolute bottom-0 right-20 w-24 h-24 bg-white/5 rounded-full -mb-12 pointer-events-none" />
            <div className="relative flex items-center gap-4">
              <Avatar className="w-16 h-16 border-4 border-white/30 flex-shrink-0">
                <AvatarFallback className="bg-white/20 backdrop-blur-sm text-white text-xl font-bold">
                  {getInitials(userName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-lg font-heading tracking-tight truncate">{userName}</p>
                <p className="text-sm text-white/80 truncate">{shopName}</p>
                {email && <p className="text-xs text-white/70 truncate">{email}</p>}
              </div>
              <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                <Pencil className="w-4 h-4" />
              </div>
            </div>
          </div>
        </button>

        {/* Menu Sections — filtered by staff permissions */}
        {SECTIONS.map((section, idx) => {
          const visibleItems = section.items.filter((item) => {
            const moduleMap: Record<string, string> = {
              'reports': 'reports',
              'purchases': 'purchases',
              'income-expense': 'incomeExpense',
              'parties': 'parties',
              'scanner': 'scanner',
              'settings': 'settings',
            }
            const moduleKey = moduleMap[item.view]
            if (moduleKey) return canAccess(moduleKey as any)
            return true
          })
          if (visibleItems.length === 0) return null
          return (
          <div key={idx}>
            {section.title && (
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
                {section.title}
              </p>
            )}
            <div className="bg-card rounded-2xl shadow-sm border border-border/60 overflow-hidden">
              {visibleItems.map((item, i) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.view}
                    onClick={() => handleItemClick(item.view)}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition text-left active:bg-muted group',
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

        {/* Premium Banner — links to Plans & Pricing view */}
        <button
          onClick={() => { haptic.click(); setPreviousView('more'); setView('pricing') }}
          className="w-full bg-gradient-to-r from-amber-500 to-orange-600 rounded-2xl p-4 shadow-lg text-white text-left hover:shadow-xl transition active:scale-[0.98] flex items-center gap-4"
        >
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <Crown className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-base">Upgrade to Pro</p>
            <p className="text-sm text-white/80">Unlimited AI scans, multi-shop, advanced reports</p>
          </div>
          <ChevronRight className="w-5 h-5 text-white/80" />
        </button>

        {/* Support Section */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
            Support
          </p>
          <div className="bg-card rounded-2xl shadow-sm border border-border/60 overflow-hidden">
            <button
              onClick={() => { haptic.click(); sonnerToast.info('Help center coming soon!') }}
              className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                <HelpCircle className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">Help & Support</p>
                <p className="text-xs text-muted-foreground">FAQs, tutorials, guides</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => { haptic.click(); sonnerToast.info('Contact us at support@ekbook.app') }}
              className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition text-left border-t border-border/40"
            >
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <Phone className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">Contact Us</p>
                <p className="text-xs text-muted-foreground">WhatsApp, email, phone</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => { haptic.click(); sonnerToast.info('EkBook v1.0 — Made in India 🇮🇳') }}
              className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition text-left border-t border-border/40"
            >
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                <Info className="w-5 h-5 text-slate-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">About</p>
                <p className="text-xs text-muted-foreground">Version, privacy policy, terms</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => { haptic.click(); sonnerToast.success('Thank you for rating! ⭐') }}
              className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition text-left border-t border-border/40"
            >
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Star className="w-5 h-5 text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">Rate EkBook</p>
                <p className="text-xs text-muted-foreground">Help others discover us</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Logout Button */}
        <button
          onClick={handleLogout}
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
      {confirmDialogEl}
    </div>
  )
}
