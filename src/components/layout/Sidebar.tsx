'use client'

import { useAppStore, type ViewType } from '@/store/app-store'
import { useTranslation } from '@/hooks/use-translation'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  Wallet,
  Users,
  ScanLine,
  FileBarChart,
  Settings,
  BookOpenText,
  X,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

const navItems: { id: ViewType; labelKey: string; descKey: string; icon: any; badge?: string }[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', descKey: 'dash.business_overview', icon: LayoutDashboard },
  { id: 'scanner', labelKey: 'nav.scanner', descKey: 'nav.scanner', icon: ScanLine, badge: 'AI' },
  { id: 'sales', labelKey: 'nav.sales', descKey: 'nav.sales', icon: ShoppingCart },
  { id: 'purchases', labelKey: 'nav.purchases', descKey: 'nav.purchases', icon: Truck },
  { id: 'inventory', labelKey: 'nav.inventory', descKey: 'nav.inventory', icon: Package },
  { id: 'income-expense', labelKey: 'nav.income', descKey: 'nav.income', icon: Wallet },
  { id: 'parties', labelKey: 'nav.parties', descKey: 'nav.parties', icon: Users },
  { id: 'reports', labelKey: 'nav.reports', descKey: 'nav.reports', icon: FileBarChart },
  { id: 'settings', labelKey: 'nav.settings', descKey: 'nav.settings', icon: Settings },
]

export function Sidebar() {
  const { currentView, setView, sidebarOpen, setSidebarOpen, sidebarCollapsed, toggleSidebarCollapsed, selectedTransactionType } = useAppStore()
  const { t } = useTranslation()
  const { data: session } = useSession()
  const isStaff = session?.user?.role === 'staff'
  // Staff can't see: reports, settings (except theme)
  const staffHiddenItems: ViewType[] = isStaff ? ['reports'] : []

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 lg:z-auto',
          'h-screen flex-shrink-0',
          'bg-sidebar text-sidebar-foreground',
          'flex flex-col',
          'transition-all duration-300 ease-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
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
                <h1 className="text-lg font-bold text-sidebar-foreground tracking-tight">BahiKhata Pro</h1>
                <p className="text-[10px] text-sidebar-foreground/50 font-medium tracking-wide">{t('nav.smart_ledger')}</p>
              </div>
            )}
          </div>
          {!sidebarCollapsed && (
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-sidebar-foreground/70 hover:text-sidebar-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Collapse toggle (desktop only) */}
        <button
          onClick={toggleSidebarCollapsed}
          className="hidden lg:flex absolute -right-3 top-20 z-50 w-6 h-6 rounded-full bg-sidebar-border text-sidebar-foreground items-center justify-center hover:bg-sidebar-primary hover:text-white transition shadow-md"
          title={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}
        >
          {sidebarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        {/* Navigation */}
        <nav className={cn('flex-1 overflow-y-auto px-3 py-4 space-y-1', sidebarCollapsed && 'lg:px-2')}>
          {navItems.filter(item => !staffHiddenItems.includes(item.id)).map((item) => {
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

        {/* Footer */}
        {!sidebarCollapsed && (
          <div className="p-4 border-t border-sidebar-border">
            <div className="rounded-lg bg-sidebar-accent p-3 flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-sidebar-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-sidebar-accent-foreground">{t('nav.pro_tip')}</p>
                <p className="text-[11px] text-sidebar-foreground/60 mt-0.5 leading-snug">
                  {t('nav.pro_tip_desc')}
                </p>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
