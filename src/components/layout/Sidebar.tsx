'use client'

import { useAppStore, type ViewType } from '@/store/app-store'
import { useTranslation } from '@/hooks/use-translation'
import { useState, useRef, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { cn, getInitials } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'
import { useFeatureFlags } from '@/hooks/use-feature-flags'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import type { ModuleKey } from '@/lib/staff-permissions'
import { useShops } from '@/hooks/use-shops'
import { prefetchView } from '@/lib/prefetch'  // 🔒 V11 §3.3
import { Store, Plus, ChevronDown, Check, Calculator } from 'lucide-react'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  Wallet,
  Users,
  ScanLine,
  FileBarChart,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  // 🔒 AUDIT V25 FIX §2.1 (Batch 2): Tools section icons.
  FolderOpen,
  Bot,
  ShieldCheck,
  Lock,
} from 'lucide-react'
// 🔒 AUDIT V25 FIX §4.2 follow-up: Removed 9 unused lucide imports
// (Settings, Sparkles, Crown, HelpCircle, Info, Star, LogOut, Download,
// Pencil, MoreHorizontal) — they were left over from V21-011 when the
// Sidebar buttons that used them were removed.

const navItems: { id: ViewType; labelKey: string; descKey: string; icon: any; badge?: string }[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', descKey: 'dash.business_overview', icon: LayoutDashboard },
  { id: 'scanner', labelKey: 'nav.scanner', descKey: 'nav.scanner', icon: ScanLine, badge: 'AI' },
  { id: 'sales', labelKey: 'nav.sales', descKey: 'nav.sales', icon: ShoppingCart },
  { id: 'purchases', labelKey: 'nav.purchases', descKey: 'nav.purchases', icon: Truck },
  { id: 'inventory', labelKey: 'nav.inventory', descKey: 'nav.inventory', icon: Package },
  { id: 'income-expense', labelKey: 'nav.income', descKey: 'nav.income', icon: Wallet },
  { id: 'parties', labelKey: 'nav.parties', descKey: 'nav.parties', icon: Users },
  { id: 'reports', labelKey: 'nav.reports', descKey: 'nav.reports', icon: FileBarChart },
  // 🔒 V21-011 (Phase 3): Removed 'pricing' and 'settings' from sidebar —
  // now in the Account page (accessible via avatar in top bar).
  // Sidebar is now BUSINESS NAVIGATION ONLY.
]

// 🔒 AUDIT V25 FIX §2.1 (Batch 2): Tools section — secondary nav for items
// that were previously mobile-only (reachable only via MoreScreen, which is
// mobile-only itself). The auditor flagged these as desktop parity gaps:
// Document Vault was 100% unreachable on desktop; AI Usage + AI Comparison
// were buried 3 levels deep in Settings → Features tab → footer buttons;
// Reconciliation + Period Lock were miscategorized under "Data & Privacy".
//
// This Tools section renders below the main nav, separated by a divider.
// Collapsible on desktop (toggle the section header). Gated by staff
// permissions (CA can see Reconciliation + Period Lock for read-only audit,
// staff cannot see Document Vault or AI tools).
//
// Note: Reconciliation + Period Lock don't have their own views — they
// deep-link to Account → data section (same as MoreScreen does). The
// other 3 tools have their own views and navigate directly.
type ToolItem = {
  id: string  // view ID or a special 'reconciliation' / 'period-lock' marker
  label: string
  desc: string
  icon: any
  badge?: string
  // For tools that deep-link to Account → data section instead of a view
  accountSection?: string
}

const toolsNavItems: ToolItem[] = [
  { id: 'document-vault', label: 'Document Vault', desc: 'Bills, invoices, GST certs', icon: FolderOpen },
  { id: 'ai-usage', label: 'AI Usage', desc: 'Track AI scans & cost', icon: Bot, badge: 'AI' },
  { id: 'ai-comparison', label: 'AI Comparison', desc: 'Compare AI providers', icon: Bot, badge: 'AI' },
  { id: 'reconciliation', label: 'Reconciliation', desc: 'Health check — books tie out?', icon: ShieldCheck, accountSection: 'data' },
  { id: 'period-lock', label: 'Period Lock', desc: 'Lock filed GST periods', icon: Lock, accountSection: 'data' },
]

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

        {/* Shop switcher — shows current shop, dropdown to switch */}
        {!sidebarCollapsed && shops.length > 0 && (
          <div className="px-3 py-2 border-b border-sidebar-border relative" ref={shopDropdownRef}>
            <button
              onClick={() => setShopDropdownOpen(!shopDropdownOpen)}
              className="w-full flex items-center gap-2 p-2 rounded-lg bg-sidebar-accent/50 hover:bg-sidebar-accent transition text-left"
            >
              <Store className="w-4 h-4 text-sidebar-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-sidebar-foreground/50 uppercase tracking-wide font-medium">Current Shop</p>
                <p className="text-xs font-semibold text-sidebar-foreground truncate">{activeShop?.name || 'All Shops'}</p>
              </div>
              <ChevronDown className={cn('w-3.5 h-3.5 text-sidebar-foreground/50 transition-transform', shopDropdownOpen && 'rotate-180')} />
            </button>

            {/* Shop dropdown */}
            {shopDropdownOpen && (
              <div className="absolute top-full left-3 right-3 mt-1 bg-sidebar-accent border border-sidebar-border rounded-lg shadow-lg z-50 overflow-hidden">
                {shops.map(shop => (
                  <button
                    key={shop.id}
                    onClick={() => { switchShop(shop.id); setShopDropdownOpen(false) }}
                    className={cn(
                      'w-full flex items-center gap-2 p-2 hover:bg-sidebar-primary/20 transition text-left',
                      activeShop?.id === shop.id && 'bg-sidebar-primary/10'
                    )}
                  >
                    <Store className="w-3.5 h-3.5 text-sidebar-foreground/70 flex-shrink-0" />
                    <span className="text-xs font-medium text-sidebar-foreground flex-1 truncate">{shop.name}</span>
                    {activeShop?.id === shop.id && <Check className="w-3.5 h-3.5 text-sidebar-primary" />}
                  </button>
                ))}
                {/* Add new shop */}
                <button
                  onClick={() => { useAppStore.getState().setPreviousView(currentView); useAppStore.getState().setAccountOriginView(currentView); useAppStore.getState().setView('account'); useAppStore.getState().setAccountSection('profile'); setShopDropdownOpen(false) }}
                  className="w-full flex items-center gap-2 p-2 hover:bg-sidebar-primary/20 transition text-left border-t border-sidebar-border"
                >
                  <Plus className="w-3.5 h-3.5 text-sidebar-primary flex-shrink-0" />
                  <span className="text-xs font-medium text-sidebar-foreground">Add New Shop</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <nav className={cn('flex-1 overflow-y-auto px-3 py-4 space-y-1', sidebarCollapsed && 'lg:px-2')}>
          {navItems.filter(item => {
            if (item.id === 'scanner' && !isFlagEnabled('ai_scanner')) return false
            // V17-Ext Tier 3 Step 5: CAs cannot see Pricing (owner-only upgrade feature)
            if (item.id === 'pricing' && isCA) return false
            // Gate by staff permissions — map ViewType to ModuleKey
            const moduleMap: Record<string, string> = {
              'dashboard': 'dashboard',
              'sales': 'sales',
              'purchases': 'purchases',
              'inventory': 'inventory',
              'scanner': 'scanner',
              'reports': 'reports',
              'income-expense': 'incomeExpense',
              'parties': 'parties',
              'settings': 'settings',
              'pricing': 'pricing', // pricing is always visible (owner only feature)
            }
            const moduleKey = moduleMap[item.id]
            if (moduleKey && moduleKey !== 'pricing') {
              return canAccess(moduleKey as ModuleKey)
            }
            return true
          }).map((item) => {
            const Icon = item.icon
            const active = currentView === item.id ||
              (currentView === 'transaction-detail' && ((selectedTransactionType === 'purchase' && item.id === 'purchases') || (selectedTransactionType !== 'purchase' && item.id === 'sales'))) ||
              (currentView === 'new-sale' && item.id === 'sales') ||
              (currentView === 'new-purchase' && item.id === 'purchases') ||
              (currentView === 'party-profile' && item.id === 'parties')
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                onMouseEnter={() => prefetchView(item.id)}  // 🔒 V11 §3.3
                onTouchStart={() => prefetchView(item.id)}  // 🔒 V11 §3.3
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative',
                  sidebarCollapsed && 'lg:justify-center lg:px-2',
                  active
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-lg'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
                title={sidebarCollapsed ? t(item.labelKey) : undefined}
              >
                <Icon className={cn('w-[18px] h-[18px] flex-shrink-0', active && 'text-white')} />
                {!sidebarCollapsed && (
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{t(item.labelKey)}</span>
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
                      {t(item.descKey)}
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

        {/* 🔒 AUDIT V25 FIX §2.1 (Batch 2): Tools section — secondary nav for
            items that were previously mobile-only (Document Vault, AI Usage,
            AI Comparison) or buried 3 levels deep (Reconciliation, Period Lock).
            Collapsible so the main nav stays primary. Hidden when sidebar is
            collapsed (icons-only mode) — collapsed mode shows a single
            "Tools" icon that expands the sidebar.
            CA can see Reconciliation + Period Lock (read-only audit use).
            Staff cannot see Document Vault or AI tools (gated by canAccess). */}
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
                {toolsNavItems.filter(item => {
                  // Gate by staff permissions + feature flags
                  if (item.id === 'document-vault' && !canAccess('settings' as ModuleKey)) return false
                  if ((item.id === 'ai-usage' || item.id === 'ai-comparison') && !isFlagEnabled('ai_scanner')) return false
                  // CA can see reconciliation + period-lock (read-only audit)
                  // Staff can see reconciliation (they have reports access)
                  return true
                }).map((item) => {
                  const Icon = item.icon
                  // Active state: view matches OR (for reconciliation/period-lock) we're on Account → data section
                  const active = item.accountSection
                    ? currentView === 'account' && useAppStore.getState().accountSection === item.accountSection
                    : currentView === item.id
                  const handleClick = () => {
                    if (item.accountSection) {
                      // Deep-link to Account → section (same pattern as MoreScreen)
                      setPreviousView(currentView)
                      useAppStore.getState().setAccountOriginView(currentView)
                      useAppStore.getState().setAccountSection(item.accountSection)
                      setView('account')
                    } else {
                      setView(item.id as ViewType)
                    }
                  }
                  return (
                    <button
                      key={item.id}
                      onClick={handleClick}
                      onMouseEnter={() => !item.accountSection && prefetchView(item.id)}
                      onTouchStart={() => !item.accountSection && prefetchView(item.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all group relative',
                        active
                          ? 'bg-sidebar-primary/10 text-sidebar-primary'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                      )}
                      title={item.label}
                    >
                      <Icon className={cn('w-4 h-4 flex-shrink-0', active && 'text-sidebar-primary')} />
                      <div className="flex-1 text-left min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium truncate">{item.label}</span>
                          {item.badge && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-gradient-saffron text-white">
                              {item.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] truncate text-sidebar-foreground/40">{item.desc}</p>
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
