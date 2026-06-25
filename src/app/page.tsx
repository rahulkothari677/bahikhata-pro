'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { AuthScreen } from '@/components/auth/AuthScreen'
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
import { OfflineIndicator } from '@/components/common/OfflineIndicator'
import { PWAInstallPrompt } from '@/components/common/PWAInstallPrompt'

export default function Home() {
  const { data: session, status } = useSession()
  const { currentView, features } = useAppStore()
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    Promise.resolve().then(() => setMounted(true))
  }, [])

  const { data: seedStatus } = useQuery({
    queryKey: ['seed-status'],
    enabled: status === 'authenticated' && !!session,
    queryFn: async () => {
      const r = await fetch('/api/seed')
      return r.json()
    },
  })

  // During SSR and first client render, show loading
  // This prevents hydration mismatch
  if (!mounted || status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!session) {
    return <AuthScreen />
  }

  const showOnboarding = !onboardingDismissed && seedStatus !== undefined && !seedStatus.seeded

  return (
    <div className="flex min-h-screen bg-background">
      {features?.keyboardShortcuts && <KeyboardShortcuts />}
      {features?.globalSearch && <GlobalSearch />}

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
          <p>BahiKhata Pro — Made with love for Bharat</p>
        </footer>
      </div>

      <OfflineIndicator />
      <Onboarding open={showOnboarding} onDone={() => setOnboardingDismissed(true)} />

      {features?.pwaInstall && <PWAInstallPrompt />}
    </div>
  )
}
