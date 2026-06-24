'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { Onboarding } from '@/components/layout/Onboarding'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { Inventory } from '@/components/inventory/Inventory'
import { Ledger } from '@/components/ledger/Ledger'
import { TransactionDetail } from '@/components/ledger/TransactionDetail'
import { TransactionEntry } from '@/components/ledger/TransactionEntry'
import { IncomeExpense } from '@/components/income/IncomeExpense'
import { Parties } from '@/components/parties/Parties'
import { PartyProfile } from '@/components/parties/PartyProfile'
import { BillScanner } from '@/components/scanner/BillScanner'
import { Reports } from '@/components/reports/Reports'
import { Settings } from '@/components/settings/Settings'
import { KeyboardShortcuts } from '@/components/common/KeyboardShortcuts'
import { GlobalSearch } from '@/components/common/GlobalSearch'

export default function Home() {
  const { currentView, features } = useAppStore()
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)

  // Check if data exists — if not, show onboarding
  const { data: seedStatus } = useQuery({
    queryKey: ['seed-status'],
    queryFn: async () => {
      const r = await fetch('/api/seed')
      return r.json()
    },
  })

  // Show onboarding only when we know data is empty AND user hasn't dismissed it
  const showOnboarding = !onboardingDismissed && seedStatus !== undefined && !seedStatus.seeded

  return (
    <div className="flex min-h-screen bg-background">
      {/* Global keyboard shortcuts handler */}
      {features.keyboardShortcuts && <KeyboardShortcuts />}
      {/* Global search command palette */}
      {features.globalSearch && <GlobalSearch />}

      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Header />

        <main className="flex-1 p-4 lg:p-6 max-w-7xl mx-auto w-full">
          {currentView === 'dashboard' && <Dashboard />}
          {currentView === 'inventory' && <Inventory />}
          {currentView === 'sales' && <Ledger type="sale" />}
          {currentView === 'purchases' && <Ledger type="purchase" />}
          {currentView === 'income-expense' && <IncomeExpense />}
          {currentView === 'parties' && <Parties />}
          {currentView === 'scanner' && <BillScanner />}
          {currentView === 'reports' && <Reports />}
          {currentView === 'settings' && <Settings />}
          {currentView === 'transaction-detail' && <TransactionDetail />}
          {currentView === 'party-profile' && <PartyProfile />}
          {currentView === 'new-sale' && <TransactionEntry type="sale" />}
          {currentView === 'new-purchase' && <TransactionEntry type="purchase" />}
        </main>

        <footer className="mt-auto border-t border-border py-3 px-4 lg:px-6 text-center text-[11px] text-muted-foreground no-print">
          <p>BahiKhata Pro — Made with ❤️ for Bharat • Track sales, purchases, GST, inventory & profit in one app</p>
        </footer>
      </div>

      <Onboarding open={showOnboarding} onDone={() => setOnboardingDismissed(true)} />
    </div>
  )
}
