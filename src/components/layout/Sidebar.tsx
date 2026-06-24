'use client'

import { useAppStore, type ViewType } from '@/store/app-store'
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
} from 'lucide-react'

const navItems: { id: ViewType; label: string; icon: any; description: string; badge?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Overview & charts' },
  { id: 'scanner', label: 'AI Bill Scanner', icon: ScanLine, description: 'Snap & auto-fill', badge: 'AI' },
  { id: 'sales', label: 'Sales Ledger', icon: ShoppingCart, description: 'Sales & invoices' },
  { id: 'purchases', label: 'Purchase Ledger', icon: Truck, description: 'Stock purchases' },
  { id: 'inventory', label: 'Inventory', icon: Package, description: 'Products & stock' },
  { id: 'income-expense', label: 'Income & Expense', icon: Wallet, description: 'Track money flow' },
  { id: 'parties', label: 'Parties', icon: Users, description: 'Customers & suppliers' },
  { id: 'reports', label: 'Reports', icon: FileBarChart, description: 'P&L, GST, stock' },
  { id: 'settings', label: 'Settings', icon: Settings, description: 'Shop profile' },
]

export function Sidebar() {
  const { currentView, setView, sidebarOpen, setSidebarOpen } = useAppStore()

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
          'h-screen w-72 flex-shrink-0',
          'bg-sidebar text-sidebar-foreground',
          'flex flex-col',
          'transition-transform duration-300 ease-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between p-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-saffron flex items-center justify-center shadow-lg">
              <BookOpenText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">BahiKhata Pro</h1>
              <p className="text-[10px] text-sidebar-foreground/60 font-medium tracking-wide">INDIA&apos;S SMART LEDGER</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-sidebar-foreground/70 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = currentView === item.id
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative',
                  active
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-lg'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <Icon className={cn('w-[18px] h-[18px] flex-shrink-0', active && 'text-white')} />
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{item.label}</span>
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
                    {item.description}
                  </p>
                </div>
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-sidebar-border">
          <div className="rounded-lg bg-sidebar-accent p-3 flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-sidebar-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-sidebar-accent-foreground">Pro Tip</p>
              <p className="text-[11px] text-sidebar-foreground/60 mt-0.5 leading-snug">
                Use AI Scanner to add bills in 5 seconds.
              </p>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
