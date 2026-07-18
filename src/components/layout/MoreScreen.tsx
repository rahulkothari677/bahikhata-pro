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
import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store/app-store'
import { offlineFetch } from '@/lib/offline-fetch'
import { clearAllOfflineData } from '@/lib/offline-db'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import type { ModuleKey } from '@/lib/staff-permissions'
import { haptic } from '@/lib/haptic'
import { prefetchView } from '@/lib/prefetch'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getInitials, cn } from '@/lib/utils'
import { toast as sonnerToast } from 'sonner'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
// 🔒 AUDIT V25 §6.1 (Batch 8 Phase 4): MoreScreen now renders from the NavRegistry.
import { NAV_REGISTRY, filterByPermissions, groupBySubcategory, type NavDestination, type NavSubcategoryId } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import {
  ChevronRight, BarChart3, Truck, Wallet, Users,
  ScanLine, Sparkles, Settings as SettingsIcon, UserCog,
  Crown, HelpCircle, Phone, Info, Star, LogOut, ArrowLeft,
  FileSpreadsheet, Bell, Calculator, Package,
  FileText, Lock, ShieldCheck, Banknote,
  Store, Mic, ScanBarcode, Bot, Repeat, Send,
  ShoppingCart,
  Undo2, FilePlus2, Coins, AlertTriangle,
  FolderOpen,
} from 'lucide-react'
import type { ViewType } from '@/store/app-store'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from '@/hooks/use-translation'

// 🔒 AUDIT V25 §6.1 (Batch 8 Phase 4): SECTIONS array + MenuItem/MenuSection
// interfaces REMOVED. MoreScreen now renders from the NavRegistry, filtered by
// surfaces: ['more'] + grouped by subcategory. The 120-line handleItemClick
// (8+ label-matching switch statements) is replaced by a single handleNavAction()
// call — all deep-link handlers are encoded in the registry's actionKind system.

// Section metadata: maps subcategory → title + titleIcon for MoreScreen sections.
// Only the subcategories that appear in MoreScreen are defined here.
// 🔒 V26 BUG-047: Added 'financial', 'gst', 'inventory-reports', 'banking' so
// the 15 reports newly surfaced in More (via surfaces: ['more', 'reports-hub'])
// actually render under titled sections. Without these mappings the items
// pass the filter but get dropped by `if (subcat && SECTION_META[subcat])`.
const SECTION_META: Partial<Record<NavSubcategoryId, { title: string; titleIcon: LucideIcon }>> = {
  'sale-purchase':       { title: 'Sale & Purchase',   titleIcon: ShoppingCart },
  'gst-tax':             { title: 'GST & Tax',         titleIcon: FileText },
  'gst':                 { title: 'GST Reports',       titleIcon: FileText },
  'money-banking':       { title: 'Money & Banking',   titleIcon: Banknote },
  'banking':             { title: 'Banking Reports',   titleIcon: Banknote },
  'items-stock':         { title: 'Items & Stock',     titleIcon: Package },
  'inventory-reports':   { title: 'Inventory Reports', titleIcon: Package },
  'reports-analytics':   { title: 'Reports & Analytics', titleIcon: BarChart3 },
  'financial':           { title: 'Financial Reports', titleIcon: BarChart3 },
  'smart-tools':         { title: 'Smart Tools',       titleIcon: Sparkles },
}

export function MoreScreen() {
  const { t } = useTranslation()
  const { setView, previousView, setPreviousView } = useAppStore()
  const { data: session } = useSession()
  const { canAccess, isCA } = useStaffPermissions()
  const { confirmDialog, dialog: confirmDialogEl } = useConfirmDialog()

  // 🔒 AUDIT V23 FIX §9.6: Prefetch the Reports bundle when More opens.
  useEffect(() => {
    prefetchView('reports')
  }, [])

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

  // 🔒 AUDIT V25 §6.1 (Batch 8 Phase 4): Items from NavRegistry, filtered by
  // surfaces: ['more'] + permissions + feature flags. Grouped by subcategory.
  const isOwner = session?.user?.role === 'owner'
  const moreItems = useMemo(() => {
    const filtered = filterByPermissions(
      NAV_REGISTRY.filter(d => d.surfaces?.includes('more')),
      { canAccess, isFlagEnabled: (flag: string) => {
        // Feature flag check — uses the store's features object
        const features = useAppStore.getState().features
        return features?.[flag as keyof typeof features] ?? false
      }, isOwner }
    )
    return filtered.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }, [canAccess, isOwner])

  // Group items by subcategory for section rendering
  const sections = useMemo(() => {
    const grouped = groupBySubcategory(moreItems)
    // Build ordered section list based on SECTION_META keys
    const orderedSections: { subcategory: NavSubcategoryId; title: string; titleIcon: LucideIcon; items: NavDestination[] }[] = []
    for (const [subcat, items] of grouped) {
      if (subcat && SECTION_META[subcat]) {
        orderedSections.push({
          subcategory: subcat,
          ...SECTION_META[subcat],
          items,
        })
      }
    }
    return orderedSections
  }, [moreItems])

  // 🔒 AUDIT V25 §6.1 (Batch 8 Phase 4): Single click handler — replaces the
  // 120-line handleItemClick with all its label-matching switch statements.
  // The shared handleNavAction() handles all 8+ deep-link cases via the
  // registry's actionKind + actionParams.
  const handleItemClick = (dest: NavDestination) => {
    haptic.click()
    handleNavAction(dest, { previousView: 'more' })
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
    // 🔒 AUDIT V23 FIX §13.9d (Batch L follow-up): Same anti-pattern as
    // AccountScreen — if clearAllOfflineData throws, signOut never ran.
    try {
      await clearAllOfflineData()
    } catch (e) {
      console.warn('[logout] clearAllOfflineData failed (non-fatal):', e)
    }
    try {
      signOut({ callbackUrl: '/' })
    } catch (e) {
      console.error('[logout] signOut failed:', e)
      if (typeof window !== 'undefined') window.location.href = '/'
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

        {/* Menu Sections — rendered from NavRegistry (V25 §6.1 Phase 4) */}
        {sections.map((section, idx) => {
          if (section.items.length === 0) return null
          const SectionIcon = section.titleIcon
          return (
          <div key={section.subcategory}>
            {section.title && (
              <div className="flex items-center gap-2 px-2 mb-2">
                {SectionIcon && <SectionIcon className="w-3.5 h-3.5 text-muted-foreground" />}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {section.title}
                </p>
              </div>
            )}
            <div className="bg-card rounded-2xl shadow-sm border border-border/60 overflow-hidden">
              {section.items.map((item: NavDestination, i: number) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition text-left active:bg-muted group',
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
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{item.labelKey ? t(item.labelKey) : item.label}</p>
                        {item.badge && (
                          <span className={cn(
                            'text-[9px] px-1.5 py-0.5 rounded-full font-bold',
                            item.badgeColor || 'bg-primary text-primary-foreground'
                          )}>
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {/* 🔒 V26 FIX N10: ternary precedence bug — `a ? x : b && <p>` rendered
                          the translated description as a BARE unstyled text node for every
                          registry item with a descKey (i.e. all of them), breaking the row
                          typography. Wrap first, translate inside. */}
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

        {/* 🔒 V21-011 (Phase 3): Premium banner removed — now in Account page (Subscription) */}
        {/* 🔒 V21-011 (Phase 3): Support section removed — now in Account page */}
        {/* 🔒 V21-011 (Phase 3): Logout button removed — now in Account page */}
        {/* 🔒 V21-011 (Phase 3): Version footer removed — now in Account page */}
      </div>
      {confirmDialogEl}
    </div>
  )
}
