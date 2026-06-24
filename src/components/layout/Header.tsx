'use client'

import { useAppStore } from '@/store/app-store'
import { Menu, Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useQuery } from '@tanstack/react-query'

const viewTitles: Record<string, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Your shop at a glance' },
  inventory: { title: 'Inventory', subtitle: 'Manage products & stock' },
  sales: { title: 'Sales Ledger', subtitle: 'Record sales & invoices' },
  purchases: { title: 'Purchase Ledger', subtitle: 'Record stock purchases' },
  'income-expense': { title: 'Income & Expenses', subtitle: 'Track money flow' },
  parties: { title: 'Parties', subtitle: 'Customers & suppliers' },
  scanner: { title: 'AI Bill Scanner', subtitle: 'Snap a bill, we auto-fill' },
  reports: { title: 'Reports', subtitle: 'P&L, GST & stock reports' },
  settings: { title: 'Settings', subtitle: 'Shop profile & preferences' },
}

export function Header() {
  const { currentView, setSidebarOpen, setView } = useAppStore()
  const info = viewTitles[currentView] || { title: 'BahiKhata Pro', subtitle: '' }

  const { data: settingData } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await fetch('/api/settings')
      return r.json()
    },
  })

  const shopName = settingData?.setting?.shopName || 'My Shop'

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="flex items-center justify-between gap-3 px-4 lg:px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-muted"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg lg:text-xl font-bold tracking-tight truncate">{info.title}</h2>
            <p className="text-xs text-muted-foreground truncate hidden sm:block">{info.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick action: AI Scan */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setView('scanner')}
            className="hidden sm:flex gap-2 border-primary/30 text-primary hover:bg-primary/10"
          >
            <Sparkles className="w-4 h-4" />
            <span className="hidden md:inline">Scan Bill</span>
          </Button>

          {/* New Sale quick action */}
          <Button
            size="sm"
            onClick={() => setView('sales')}
            className="bg-gradient-saffron gap-2 shadow-md hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Entry</span>
          </Button>

          {/* Shop name badge */}
          <div className="hidden lg:flex items-center gap-2 pl-3 ml-1 border-l border-border">
            <div className="w-8 h-8 rounded-full bg-gradient-saffron flex items-center justify-center text-white text-xs font-bold">
              {shopName.charAt(0)}
            </div>
            <div className="text-xs">
              <p className="font-semibold leading-tight">{shopName}</p>
              <p className="text-muted-foreground leading-tight">Owner</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
