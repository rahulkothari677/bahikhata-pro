'use client'

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
import { useShops } from '@/hooks/use-shops'
import { prefetchView } from '@/lib/prefetch'  // 🔒 V11 §3.3
// 🔒 AUDIT V25 §6.1 (Batch 8 Phase 2): Sidebar now renders from the NavRegistry.
import { NAV_REGISTRY, getByFrequency, filterByPermissions, type NavDestination } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import { Store, Plus, ChevronDown, Check, Calculator } from 'lucide-react'
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
} from 'lucide-react'
// 🔒 AUDIT V25 FIX §4.2 follow-up: Removed 9 unused lucide imports
// (Settings, Sparkles, Crown, HelpCircle, Info, Star, LogOut, Download,
// Pencil, MoreHorizontal) — they were left over from V21-011 when the
// Sidebar buttons that used them were removed.
// 🔒 AUDIT V25 §6.1 (Batch 8 Phase 2): navItems + toolsNavItems arrays REMOVED.
// Sidebar now renders from the NavRegistry (src/lib/nav-registry.ts).
// The registry is the single source of truth — adding a new feature there
// automatically makes it appear in the Sidebar with correct permissions.

export function Sidebar() {
  // 🔒 AUDIT V25 FIX §4.2: useConfirmDialog removed — only handleLogout used it,
  // and handleLogout was orphaned dead code (removed above).
  const { currentView, setView, setPreviousView, sidebarCollapsed, toggleSidebarCollapsed, selectedTransactionType } = useAppStore()
  const { t } = useTranslation()
  const { data: session } = useSession()
  // 🔒 AUDIT V25 FIX §4.2 follow-up: isStaff removed — was unused after
  // handleLogout was deleted. Staff gating is handled by canAccess() below.
  const { canAccess, isCA } = useStaffPermissions()
  const { isFlagEnabled } = useFeatureFlags()
  const { shops, activeShop, switchShop } = useShops()
  const [shopDropdownOpen, setShopDropdownOpen] = useState(false)
  // 🔒 AUDIT V25 FIX §2.1 (Batch 2): Tools section collapsible state.
  // Defaults to collapsed (false) — Tools are secondary, main nav stays primary.
  // Persisted to localStorage so the user's preference is remembered.
  const [toolsOpen, setToolsOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('bahikhata:sidebar-tools-open') === 'true'
  })
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('bahikhata:sidebar-tools-open', toolsOpen ? 'true' : 'false')
    }
  }, [toolsOpen])

  // 🔒 AUDIT V25 §6.1 (Batch 8 Phase 2): Main nav + Tools items from the NavRegistry.
  // Filters by surfaces + permissions + feature flags + platform, sorted by sortOrder.
  // Was: hardcoded navItems + toolsNavItems arrays with inline permission checks.
  const isOwner = session?.user?.role === 'owner'
  const mainNavItems = useMemo(() => {
    return filterByPermissions(
      NAV_REGISTRY.filter(d => d.surfaces?.includes('sidebar-main') && (d.platforms || ['desktop']).includes('desktop')),
      { canAccess, isFlagEnabled: isFlagEnabled as any, isOwner }
    ).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }, [canAccess, isFlagEnabled, isOwner])
  const toolsItems = useMemo(() => {
    return filterByPermissions(
      NAV_REGISTRY.filter(d => d.surfaces?.includes('sidebar-tools') && (d.platforms || ['desktop']).includes('desktop')),
      { canAccess, isFlagEnabled: isFlagEnabled as any, isOwner }
    ).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }, [canAccess, isFlagEnabled, isOwner])

  // 🔒 FIX M9: Outside-click handler — was missing.
  const shopDropdownRef = useRef<HTMLDivElement>(null)
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

  // Fetch settings for profile section
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

  // 🔒 AUDIT V25 FIX §4.2: Removed orphaned handleLogout + handleInstallApp.
  // Both were defined but never referenced — V21-011 removed the Sidebar
  // buttons that called them, but left the handlers behind. Dead code
  // that confused the next edit. Logout now lives in AccountScreen +
  // MoreScreen (the only places that actually render a Logout button).
  // Install-App is handled by PWAInstallPrompt component.

  return (
    <>
      {/* 🔒 AUDIT V25 FIX §4.1: Removed dead mobile drawer apparatus.
          setSidebarOpen(true) was called NOWHERE in the codebase — the
          overlay (was here), slide animation conditional, and X close
          button were all dead code. The mobile sidebar drawer was
          replaced by MobileBottomNav + MoreScreen long ago, but the
          drawer machinery was left behind. Sidebar is now desktop-only
          (lg:sticky) — mobile uses bottom-nav + More. */}

      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 lg:z-auto',
          'h-screen flex-shrink-0',
          'bg-sidebar text-sidebar-foreground',
          'flex flex-col',
          'transition-all duration-300 ease-out',
          // On mobile, sidebar is always translated off-screen (drawer is dead).
          // On desktop, sidebar is always visible (sticky).
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
                <p className="text-[10px] text-sidebar-foreground/50 font-medium tracking-wide">{t('nav.smart_ledger')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Collapse toggle (desktop only) */}
        <button
          onClick={toggleSidebarCollapsed}
          className="hidden lg:flex absolute -right-3 top-20 z-50 w-6 h-6 rounded-full bg-sidebar-border text-sidebar-foreground items-center justify-center hover:bg-sidebar-primary hover:text-white transition shadow-md"
          title={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}
        >
          {sidebarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        {/* 🔒 V26 FIX N4: Switch Shop dropdown REMOVED — was cosmetic (no shopId
            written or filtered anywhere). V23 §13.1 flagged this as a
            data-integrity illusion. The shop name now shows in the profile
            footer at the bottom of the sidebar. Manage Shops is still
            available via Account → Profile. */}

        {/* Navigation — rendered from NavRegistry (V25 §6.1 Phase 2) */}
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
                onMouseEnter={() => item.view && prefetchView(item.view)}  // 🔒 V11 §3.3
                onTouchStart={() => item.view && prefetchView(item.view)}  // 🔒 V11 §3.3
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
                          'text-[9px] px-1.5 py-0.5 rounded-full font-bold',
                          active
                            ? 'bg-white/20 text-white'
                            : 'bg-gradient-saffron text-white'
                        )}>
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className={cn(
                      'text-[11px] truncate',
                      active ? 'text-white/70' : 'text-sidebar-foreground/50'
                    )}>
                      {item.descKey ? t(item.descKey) : (item.description || (item.labelKey ? t(item.labelKey) : item.label))}
                    </p>
                  </div>
                )}
                {/* Show badge in collapsed mode as a dot */}
                {sidebarCollapsed && item.badge && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-gradient-saffron" />
                )}
              </button>
            )
          })}
        </nav>

        {/* 🔒 AUDIT V25 §6.1 (Batch 8 Phase 2): Tools section rendered from
            NavRegistry. Was hardcoded toolsNavItems with inline filtering.
            Now uses toolsItems (filtered from registry by permissions + flags). */}
        {!sidebarCollapsed && (
          <div className="border-t border-sidebar-border">
            <button
              onClick={() => setToolsOpen(!toolsOpen)}
              className="w-full flex items-center gap-2 px-5 py-2.5 text-sidebar-foreground/50 hover:text-sidebar-foreground/70 transition text-left"
              aria-expanded={toolsOpen}
              aria-label="Toggle Tools section"
            >
              <ChevronRight className={cn('w-3 h-3 transition-transform', toolsOpen && 'rotate-90')} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Tools</span>
            </button>
            {toolsOpen && (
              <nav className="px-3 pb-3 space-y-1">
                {toolsItems.map((item: NavDestination) => {
                  const Icon = item.icon
                  // Active state: view matches OR (for navigate-account items) we're on Account → data section
                  const active = item.actionKind === 'navigate-account'
                    ? currentView === 'account' && useAppStore.getState().accountSection === item.actionParams?.accountSection
                    : currentView === (item.view || item.id)
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNavAction(item)}
                      onMouseEnter={() => item.view && prefetchView(item.view)}
                      onTouchStart={() => item.view && prefetchView(item.view)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all group relative',
                        active
                          ? 'bg-sidebar-primary/10 text-sidebar-primary'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                      )}
                      title={item.labelKey ? t(item.labelKey) : item.label}
                    >
                      <Icon className={cn('w-4 h-4 flex-shrink-0', active && 'text-sidebar-primary')} />
                      <div className="flex-1 text-left min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium truncate">{item.labelKey ? t(item.labelKey) : item.label}</span>
                          {item.badge && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-gradient-saffron text-white">
                              {item.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] truncate text-sidebar-foreground/40">{item.descKey ? t(item.descKey) : item.description}</p>
                      </div>
                    </button>
                  )
                })}
              </nav>
            )}
          </div>
        )}
        {sidebarCollapsed && (
          /* Collapsed mode — show a single "Tools" icon that expands the sidebar */
          <div className="border-t border-sidebar-border py-2 flex justify-center">
            <button
              onClick={toggleSidebarCollapsed}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition"
              title="Expand sidebar to see Tools"
              aria-label="Expand sidebar to see Tools"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* V17-Ext Tier 3 Step 5: CA Mode indicator — shows when a CA is logged in */}
        {isCA && !sidebarCollapsed && (
          <div className="px-3 py-2 border-t border-sidebar-border">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <Calculator className="w-4 h-4 text-violet-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-violet-300">CA Mode</p>
                <p className="text-[10px] text-violet-400/70">Read-only access</p>
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

        {/* Footer — Profile button opens Account page */}
        {!sidebarCollapsed ? (
          <div className="border-t border-sidebar-border">
            {/* 🔒 V21-011 (Phase 3): Removed Logout button — now in Account page.
                Removed 'Upgrade to Pro' — now in Account page (Subscription).
                The profile section now opens the Account page (not Settings). */}
            <button
              onClick={() => { setPreviousView(currentView); useAppStore.getState().setAccountOriginView(currentView); setView('account') }}
              className="w-full p-3 flex items-center gap-3 hover:bg-sidebar-accent transition"
            >
              <div className="w-9 h-9 rounded-full bg-gradient-saffron flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {getInitials(userName)}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-xs font-semibold text-sidebar-foreground truncate">{userName}</p>
                <p className="text-[10px] text-sidebar-foreground/50 truncate">{shopName}</p>
              </div>
            </button>
          </div>
        ) : (
          /* Collapsed mode — avatar only, opens Account page */
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
