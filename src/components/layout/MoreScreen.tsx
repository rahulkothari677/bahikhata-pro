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
  ChevronRight, BarChart3, Truck, Wallet, Users,
  ScanLine, Sparkles, Settings as SettingsIcon, UserCog,
  Crown, HelpCircle, Phone, Info, Star, LogOut, ArrowLeft,
  FileSpreadsheet, Bell, Calculator, Package,
  FileText, FileCheck, Lock, ShieldCheck, Banknote,
  Store, Mic, ScanBarcode, Bot, Repeat, Send,
  ShoppingCart, TrendingUp,
  Undo2, FilePlus2, Coins, AlertTriangle, Hash,
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
  badge?: string
  badgeColor?: string
}

interface MenuSection {
  title?: string
  titleIcon?: LucideIcon
  items: MenuItem[]
}

// 🔒 V22-4 (Phase 2): Restructured into 6 categories — better discoverability
// than Vyapar's 5 groups. Each category has a distinct color.
// Sale & Purchase = indigo, GST & Tax = blue, Money & Banking = emerald,
// Items & Stock = amber, Reports & Analytics = rose, Smart Tools = violet
//
// 🔒 V22-11 (Batch A): Added missing items to match the original plan:
// Sale Return, Purchase Return, Estimates, Cash in Hand, Stock Summary,
// Low Stock Alerts, Item-wise Profit, HSN Summary.
const SECTIONS: MenuSection[] = [
  {
    title: 'Sale & Purchase',
    titleIcon: ShoppingCart,
    items: [
      { icon: ShoppingCart, label: 'New Sale', description: 'Record a sale invoice', view: 'new-sale', iconColor: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-100 dark:bg-indigo-950' },
      { icon: Truck, label: 'New Purchase', description: 'Record a purchase bill', view: 'new-purchase', iconColor: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-100 dark:bg-indigo-950' },
      { icon: Undo2, label: 'Sale Return', description: 'Credit notes — return from customer', view: 'sales', iconColor: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-100 dark:bg-indigo-950' },
      { icon: Undo2, label: 'Purchase Return', description: 'Debit notes — return to supplier', view: 'purchases', iconColor: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-100 dark:bg-indigo-950' },
      { icon: FilePlus2, label: 'Estimates / Quotations', description: 'Create quotes for customers', view: 'new-sale', iconColor: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-100 dark:bg-indigo-950', badge: 'Soon', badgeColor: 'bg-indigo-200 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300' },
      { icon: Wallet, label: 'Income & Expense', description: 'Rent, salary, other income', view: 'income-expense', iconColor: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-100 dark:bg-indigo-950' },
    ],
  },
  {
    title: 'GST & Tax',
    titleIcon: FileText,
    items: [
      { icon: FileText, label: 'GSTR-1', description: 'Export & file outward supplies return', view: 'reports', iconColor: 'text-blue-600 dark:text-blue-400', iconBg: 'bg-blue-100 dark:bg-blue-950' },
      { icon: FileCheck, label: 'GSTR-3B', description: 'Monthly summary return', view: 'reports', iconColor: 'text-blue-600 dark:text-blue-400', iconBg: 'bg-blue-100 dark:bg-blue-950' },
      { icon: FileCheck, label: 'GSTR-2B', description: 'ITC reconciliation with 2B', view: 'reports', iconColor: 'text-blue-600 dark:text-blue-400', iconBg: 'bg-blue-100 dark:bg-blue-950' },
      { icon: FileText, label: 'GST Summary', description: 'Tax liability by slab (5/12/18/28%)', view: 'reports', iconColor: 'text-blue-600 dark:text-blue-400', iconBg: 'bg-blue-100 dark:bg-blue-950' },
      { icon: Hash, label: 'HSN Summary', description: 'HSN/SAC-wise tax summary for GSTR-1', view: 'reports', iconColor: 'text-blue-600 dark:text-blue-400', iconBg: 'bg-blue-100 dark:bg-blue-950' },
      { icon: ShieldCheck, label: 'Reconciliation', description: 'Health check — do books tie out?', view: 'reports', iconColor: 'text-blue-600 dark:text-blue-400', iconBg: 'bg-blue-100 dark:bg-blue-950' },
      { icon: Lock, label: 'Period Lock', description: 'Lock filed GST periods', view: 'reports', iconColor: 'text-blue-600 dark:text-blue-400', iconBg: 'bg-blue-100 dark:bg-blue-950' },
    ],
  },
  {
    title: 'Money & Banking',
    titleIcon: Banknote,
    items: [
      { icon: Banknote, label: 'Bank Reconciliation', description: 'Match bank transactions', view: 'reports', iconColor: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-100 dark:bg-emerald-950' },
      { icon: Coins, label: 'Cash in Hand', description: 'Today\'s cash position & collections', view: 'dashboard', iconColor: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-100 dark:bg-emerald-950' },
      { icon: Repeat, label: 'Day-End Summary', description: 'Close the drawer — daily cash', view: 'dashboard', iconColor: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-100 dark:bg-emerald-950' },
      { icon: Send, label: 'WhatsApp Reminders', description: 'Send payment reminders', view: 'parties', iconColor: 'text-emerald-600 dark:text-emerald-400', iconBg: 'bg-emerald-100 dark:bg-emerald-950' },
    ],
  },
  {
    title: 'Items & Stock',
    titleIcon: Package,
    items: [
      { icon: Package, label: 'Inventory', description: 'Products, stock, prices', view: 'inventory', iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-950' },
      { icon: BarChart3, label: 'Stock Summary', description: 'Stock valuation & sale value report', view: 'reports', iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-950' },
      { icon: AlertTriangle, label: 'Low Stock Alerts', description: 'Products running low — reorder now', view: 'inventory', iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-950' },
      { icon: TrendingUp, label: 'Item-wise Profit', description: 'Per-invoice profit breakdown & margins', view: 'reports', iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-950' },
      { icon: Users, label: 'Customers & Suppliers', description: 'Track dues & party balances', view: 'parties', iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-950' },
      { icon: Store, label: 'Multi-Shop Management', description: 'Switch or add shops', view: 'settings', iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-950' },
      { icon: UserCog, label: 'Staff & Access', description: 'Manage staff, CA access', view: 'settings', iconColor: 'text-amber-600 dark:text-amber-400', iconBg: 'bg-amber-100 dark:bg-amber-950' },
    ],
  },
  {
    title: 'Reports & Analytics',
    titleIcon: BarChart3,
    items: [
      { icon: TrendingUp, label: 'P&L Statement', description: 'Profit & loss report', view: 'reports', iconColor: 'text-rose-600 dark:text-rose-400', iconBg: 'bg-rose-100 dark:bg-rose-950' },
      { icon: BarChart3, label: 'All Reports', description: 'Stock, party, aging, consolidated', view: 'reports', iconColor: 'text-rose-600 dark:text-rose-400', iconBg: 'bg-rose-100 dark:bg-rose-950' },
    ],
  },
  {
    title: 'Smart Tools',
    titleIcon: Sparkles,
    items: [
      { icon: ScanLine, label: 'AI Bill Scanner', description: 'Snap a bill, auto-fill everything', view: 'scanner', iconColor: 'text-violet-600 dark:text-violet-400', iconBg: 'bg-violet-100 dark:bg-violet-950', badge: 'AI', badgeColor: 'bg-violet-500 text-white' },
      { icon: Mic, label: 'Voice Entry', description: 'Speak to create sales', view: 'new-sale', iconColor: 'text-violet-600 dark:text-violet-400', iconBg: 'bg-violet-100 dark:bg-violet-950', badge: 'AI', badgeColor: 'bg-violet-500 text-white' },
      { icon: ScanBarcode, label: 'Barcode Scanner', description: 'Scan barcodes for fast billing', view: 'new-sale', iconColor: 'text-violet-600 dark:text-violet-400', iconBg: 'bg-violet-100 dark:bg-violet-950' },
      { icon: Bot, label: 'AI Usage & Limits', description: 'Track AI scans, voice entries', view: 'ai-usage', iconColor: 'text-violet-600 dark:text-violet-400', iconBg: 'bg-violet-100 dark:bg-violet-950' },
      { icon: Sparkles, label: 'Smart Insights', description: 'AI-powered alerts & suggestions', view: 'dashboard', iconColor: 'text-violet-600 dark:text-violet-400', iconBg: 'bg-violet-100 dark:bg-violet-950' },
    ],
  },
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

  const handleItemClick = (view: ViewType, label?: string) => {
    haptic.click()
    setPreviousView('more')

    // 🔒 V22-3 (Phase 1): Map item labels to report types so each opens
    // DIRECTLY to its own report — no hub page, no tabs.
    // 🔒 V22-11 (Batch A): Added HSN Summary, Stock Summary, Item-wise Profit.
    const reportTypeMap: Record<string, string> = {
      'GSTR-1': 'gstr-1',
      'GSTR-3B': 'gstr-3b',
      'GSTR-2B': 'gstr-2b',
      'GST Summary': 'gst',
      'HSN Summary': 'hsn',
      'Bank Reconciliation': 'bank-recon',
      'P&L Statement': 'pl',
      'Stock Summary': 'stock',
      'Item-wise Profit': 'item-profit',
    }
    if (label && reportTypeMap[label]) {
      useAppStore.getState().setPendingReportType(reportTypeMap[label])
      setView('reports')
      return
    }

    // 🔒 V22-11 (Batch A): Estimates / Quotations is a future feature.
    // Show a "Coming Soon" toast instead of navigating.
    if (label === 'Estimates / Quotations') {
      sonnerToast.info('Estimates & Quotations coming soon!', {
        description: 'We\'re building this feature — create professional quotes for your customers.',
        duration: 4000,
      })
      return
    }

    // 🔒 V22-3: Reconciliation & Period Lock → Account → Data section
    // But set previousView='more' so Account's back button goes directly
    // back to More (not Account menu first).
    if (label === 'Reconciliation' || label === 'Period Lock') {
      useAppStore.getState().setPreviousView('more')
      useAppStore.getState().setAccountOriginView('more')
      useAppStore.getState().setView('account')
      useAppStore.getState().setAccountSection('data')
      return
    }

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

        {/* Menu Sections — 4 categorized sections with context colors */}
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
          const SectionIcon = section.titleIcon
          return (
          <div key={idx}>
            {section.title && (
              <div className="flex items-center gap-2 px-2 mb-2">
                {SectionIcon && <SectionIcon className="w-3.5 h-3.5 text-muted-foreground" />}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {section.title}
                </p>
              </div>
            )}
            <div className="bg-card rounded-2xl shadow-sm border border-border/60 overflow-hidden">
              {visibleItems.map((item, i) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.label}
                    onClick={() => handleItemClick(item.view, item.label)}
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
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{item.label}</p>
                        {item.badge && (
                          <span className={cn(
                            'text-[9px] px-1.5 py-0.5 rounded-full font-bold',
                            item.badgeColor || 'bg-primary text-primary-foreground'
                          )}>
                            {item.badge}
                          </span>
                        )}
                      </div>
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
