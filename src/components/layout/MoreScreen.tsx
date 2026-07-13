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
import type { ModuleKey } from '@/lib/staff-permissions'
import { haptic } from '@/lib/haptic'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getInitials, cn } from '@/lib/utils'
import { toast as sonnerToast } from 'sonner'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import {
  ChevronRight, Pencil, BarChart3, Truck, Wallet, Users,
  ScanLine, Sparkles, Settings as SettingsIcon, UserCog,
  Crown, HelpCircle, Phone, Info, Star, LogOut, ArrowLeft,
  FileSpreadsheet, Bell, Calculator, Package,
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
      { icon: Package, label: 'Inventory', description: 'Manage products, stock, prices', view: 'inventory', iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100' },
      { icon: Wallet, label: 'Income & Expense', description: 'Rent, salary, other income', view: 'income-expense', iconColor: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-100' },
      { icon: Users, label: 'Customers & Suppliers', description: 'Track dues & party balances', view: 'parties', iconColor: 'text-blue-600', iconBg: 'bg-blue-100' },
    ],
  },
  {
    title: 'Smart Tools',
    items: [
      { icon: ScanLine, label: 'AI Bill Scanner', description: 'Snap a bill, auto-fill everything', view: 'scanner', iconColor: 'text-violet-600', iconBg: 'bg-violet-100' },
    ],
  },
  // 🔒 V21-011 (Phase 3): Removed Account section (Settings) — now in Account page
  // 🔒 V21-011 (Phase 3): Removed Support section (Help, Contact, About, Rate) — now in Account page
  // 🔒 V21-011 (Phase 3): Removed Premium banner — now in Account page (Subscription)
  // 🔒 V21-011 (Phase 3): Removed Logout button — now in Account page
  // 🔒 V21-011 (Phase 3): Removed Profile header — now in Account page
  // More section is now BUSINESS TOOLS ONLY.
]

export function MoreScreen() {
  const { setView, previousView, setPreviousView } = useAppStore()
  const { data: session } = useSession()
  const { canAccess, isCA } = useStaffPermissions()
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

  // 🔒 V21-011: handleEditProfile removed — profile header was moved to Account page.
  // This was dead code after Phase 3 simplification.

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
        {/* 🔒 V21-011 (Phase 3): Profile header removed — now in Account page.
            The More section is now BUSINESS TOOLS ONLY. */}

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
            if (moduleKey) return canAccess(moduleKey as ModuleKey)
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

        {/* 🔒 V21-011 (Phase 3): Premium banner removed — now in Account page (Subscription) */}
        {/* 🔒 V21-011 (Phase 3): Support section removed — now in Account page */}
        {/* 🔒 V21-011 (Phase 3): Logout button removed — now in Account page */}
        {/* 🔒 V21-011 (Phase 3): Version footer removed — now in Account page */}
      </div>
      {confirmDialogEl}
    </div>
  )
}
