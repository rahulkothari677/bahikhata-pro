'use client'

/**
 * Sidebar — desktop navigation.
 *
 * 🔒 V26 P9: Redesigned Tools section.
 * Was: flat list of 10+ items dumped together.
 * Now: tools grouped by subcategory with colorful sub-headers,
 * matching the main nav's visual quality. Collapsible groups.
 *
 * Design reference: Linear (grouped sidebar), Notion (collapsible sections),
 * Stripe Dashboard (categorized nav).
 */

import { useAppStore, type ViewType } from '@/store/app-store'
import { useTranslation } from '@/hooks/use-translation'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { cn, getInitials } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'
import { useFeatureFlags } from '@/hooks/use-feature-flags'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import type { ModuleKey } from '@/lib/staff-permissions'
import { prefetchView } from '@/lib/prefetch'
import { NAV_REGISTRY, filterByPermissions, groupBySubcategory, type NavDestination, type NavSubcategoryId } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import { Calculator } from 'lucide-react'
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  ShoppingCart, Users, Package, Banknote,
  FileText, BarChart3, Sparkles, Store,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// 🔒 V26 P9: Sub-headers for the Tools section, grouped by subcategory.
// Same SECTION_META as MoreScreen — consistent visual language across platforms.
const TOOLS_SECTION_META: Partial<Record<NavSubcategoryId, { title: string; accentColor: string }>> = {
  'sale-purchase':       { title: 'Transactions',      accentColor: 'text-indigo-500 dark:text-indigo-400' },
  'parties':             { title: 'Parties',            accentColor: 'text-indigo-500 dark:text-indigo-400' },
  'items-stock':         { title: 'Stock',              accentColor: 'text-amber-500 dark:text-amber-400' },
  'money-banking':       { title: 'Banking',            accentColor: 'text-emerald-500 dark:text-emerald-400' },
  'gst-tax':             { title: 'Controls',           accentColor: 'text-blue-500 dark:text-blue-400' },
  'financial':           { title: 'Financial',          accentColor: 'text-rose-500 dark:text-rose-400' },
  'gst':                 { title: 'GST',                accentColor: 'text-blue-500 dark:text-blue-400' },
  'banking':             { title: 'Banking',            accentColor: 'text-emerald-500 dark:text-emerald-400' },
  'inventory-reports':   { title: 'Inventory',          accentColor: 'text-amber-500 dark:text-amber-400' },
  'smart-tools':         { title: 'AI Tools',           accentColor: 'text-violet-500 dark:text-violet-400' },
  'business':            { title: 'Business',           accentColor: 'text-amber-500 dark:text-amber-400' },
}

export function Sidebar() {
  const { currentView, setView, setPreviousView, sidebarCollapsed, toggleSidebarCollapsed, selectedTransactionType } = useAppStore()
  const { t } = useTranslation()
  const { data: session } = useSession()
  const { canAccess, isCA } = useStaffPermissions()
  const { isFlagEnabled } = useFeatureFlags()

  const [toolsOpen, setToolsOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('bahikhata:sidebar-tools-open') === 'true'
  })
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('bahikhata:sidebar-tools-open', toolsOpen ? 'true' : 'false')
    }
  }, [toolsOpen])

  const isOwner = session?.user?.role === 'owner'
  const isFounder = useAppStore((s) => s.isFounder)
  // 🔒 V26 N3: Use the SAME feature-flag system as MoreScreen (app-store user toggles).
  // Was: used useFeatureFlags().isFlagEnabled (server kill-switches, snake_case)
  // → 'aiScanner' (camelCase) was undefined → ?? true → AI features NEVER hidden on desktop.
  // Now: uses useAppStore.getState().features (same as MoreScreen) — consistent across platforms.
  const mainNavItems = useMemo(() => {
    return filterByPermissions(
      NAV_REGISTRY.filter(d => d.surfaces?.includes('sidebar-main')),
      { canAccess, isFlagEnabled: (flag: string) => {
        const features = useAppStore.getState().features
        return features?.[flag as keyof typeof features] ?? false
      }, isOwner, isFounder, platform: 'desktop' }
    ).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }, [canAccess, isOwner, isFounder])

  const toolsItems = useMemo(() => {
    return filterByPermissions(
      NAV_REGISTRY.filter(d => d.surfaces?.includes('sidebar-tools')),
      { canAccess, isFlagEnabled: (flag: string) => {
        const features = useAppStore.getState().features
        return features?.[flag as keyof typeof features] ?? false
      }, isOwner, isFounder, platform: 'desktop' }
    ).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }, [canAccess, isOwner, isFounder])

  // 🔒 V26 P9: Group tools by subcategory for sub-headers
  const groupedTools = useMemo(() => {
    const grouped = groupBySubcategory(toolsItems)
    // Build ordered list based on TOOLS_SECTION_META
    const ordered: { subcategory: NavSubcategoryId; title: string; accentColor: string; items: NavDestination[] }[] = []
    for (const [subcat, items] of grouped) {
      if (subcat && TOOLS_SECTION_META[subcat] && items.length > 0) {
        ordered.push({
          subcategory: subcat,
          ...TOOLS_SECTION_META[subcat]!,
          items,
        })
      }
    }
    // Also include any tools without a subcategory in an "Other" group
    const uncategorized = grouped.get(undefined)
    if (uncategorized && uncategorized.length > 0) {
      ordered.push({
        subcategory: 'other' as NavSubcategoryId,
        title: 'Other',
        accentColor: 'text-muted-foreground',
        items: uncategorized,
      })
    }
    return ordered
  }, [toolsItems])

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

  return (
    <>
      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 lg:z-auto',
          'h-screen flex-shrink-0',
          'bg-sidebar text-sidebar-foreground',
          'flex flex-col',
          'transition-all duration-300 ease-out',
          '-translate-x-full lg:translate-x-0',
          sidebarCollapsed ? 'lg:w-20 w-72' : 'w-72'
        )}
      >
        {/* Brand */}
        <div className={cn(
          'flex items-center border-b border-sidebar-border p-5',
          sidebarCollapsed ? 'lg:justify-center lg:px-3' : 'justify-between'
        )}>
          <div className={cn('flex items-center gap-3', sidebarCollapsed && 'lg:gap-0')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-saffron flex items-center justify-center shadow-lg flex-shrink-0">
              <BookOpenText className="w-5 h-5 text-white" />
            </div>
            {!sidebarCollapsed && (
              <div>
                <h1 className="text-lg font-bold text-sidebar-foreground tracking-tight">EkBook</h1>
                <p className="text-3xs text-sidebar-foreground/60 font-medium tracking-wide">{t('nav.smart_ledger')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={toggleSidebarCollapsed}
          className="hidden lg:flex absolute -right-3 top-20 z-50 w-6 h-6 rounded-full bg-sidebar-border text-sidebar-foreground items-center justify-center hover:bg-sidebar-primary hover:text-white transition shadow-md"
          title={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}
        >
          {sidebarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        {/* Main Navigation */}
        <nav className={cn('flex-1 overflow-y-auto px-3 py-4 space-y-1', sidebarCollapsed && 'lg:px-2')}>
          {mainNavItems.map((item: NavDestination) => {
            const Icon = item.icon
            const itemId = item.view || item.id
            const active = currentView === itemId ||
              (currentView === 'transaction-detail' && ((selectedTransactionType === 'purchase' && itemId === 'purchases') || (selectedTransactionType !== 'purchase' && itemId === 'sales'))) ||
              (currentView === 'new-sale' && itemId === 'sales') ||
              (currentView === 'new-purchase' && itemId === 'purchases') ||
              (currentView === 'party-profile' && itemId === 'parties')
            return (
              <button
                key={item.id}
                onClick={() => handleNavAction(item)}
                onMouseEnter={() => item.view && prefetchView(item.view)}
                onTouchStart={() => item.view && prefetchView(item.view)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative',
                  sidebarCollapsed && 'lg:justify-center lg:px-2',
                  active
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-lg'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
                title={sidebarCollapsed ? item.labelKey ? t(item.labelKey) : item.label : undefined}
              >
                <Icon className={cn('w-[18px] h-[18px] flex-shrink-0', active && 'text-white')} />
                {!sidebarCollapsed && (
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{item.labelKey ? t(item.labelKey) : item.label}</span>
                      {item.badge && (
                        <span className={cn(
                          'text-3xs px-1.5 py-0.5 rounded-full font-bold',
                          active
                            ? 'bg-white/20 text-white'
                            : 'bg-gradient-saffron text-white'
                        )}>
                          {item.badge}
                        </span>
                      )}
                    </div>
                    {/* 🔒 V26 P9: Increased opacity from /50 to /65 for better readability */}
                    <p className={cn(
                      'text-2xs truncate',
                      active ? 'text-white/80' : 'text-sidebar-foreground/65'
                    )}>
                      {item.descKey ? t(item.descKey) : (item.description || (item.labelKey ? t(item.labelKey) : item.label))}
                    </p>
                  </div>
                )}
                {sidebarCollapsed && item.badge && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-gradient-saffron" />
                )}
              </button>
            )
          })}
        </nav>

        {/* 🔒 V26 P10: Old collapsible Tools section REMOVED.
            Tools is now a main-nav entry (like Reports) that opens a
            beautiful card-based ToolsHub page. The sidebar is cleaner
            and the tools get the same visual treatment as reports. */}

        {/* CA Mode indicator */}
        {isCA && !sidebarCollapsed && (
          <div className="px-3 py-2 border-t border-sidebar-border">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <Calculator className="w-4 h-4 text-violet-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-violet-300">CA Mode</p>
                <p className="text-3xs text-violet-400/70">Read-only access</p>
              </div>
            </div>
          </div>
        )}
        {isCA && sidebarCollapsed && (
          <div className="px-2 py-1 border-t border-sidebar-border flex justify-center">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center" title="CA Mode (Read-only)">
              <Calculator className="w-4 h-4 text-violet-400" />
            </div>
          </div>
        )}

        {/* Footer — Profile button */}
        {!sidebarCollapsed ? (
          <div className="border-t border-sidebar-border">
            <button
              onClick={() => { setPreviousView(currentView); useAppStore.getState().setAccountOriginView(currentView); setView('account') }}
              className="w-full p-3 flex items-center gap-3 hover:bg-sidebar-accent transition"
            >
              <div className="w-9 h-9 rounded-full bg-gradient-saffron flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {getInitials(userName)}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-xs font-semibold text-sidebar-foreground truncate">{userName}</p>
                {/* 🔒 V26 P9: Increased from /50 to /60 for readability */}
                <p className="text-3xs text-sidebar-foreground/60 truncate">{shopName}</p>
              </div>
            </button>
          </div>
        ) : (
          <div className="border-t border-sidebar-border py-2 flex flex-col items-center gap-2">
            <button
              onClick={() => { setPreviousView(currentView); useAppStore.getState().setAccountOriginView(currentView); setView('account') }}
              className="w-10 h-10 rounded-full bg-gradient-saffron flex items-center justify-center text-white text-sm font-bold"
              title="Account"
            >
              {getInitials(userName).charAt(0)}
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
