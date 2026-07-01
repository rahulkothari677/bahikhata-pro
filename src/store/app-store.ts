import { create } from 'zustand'

export type ViewType =
  | 'dashboard'
  | 'inventory'
  | 'sales'
  | 'purchases'
  | 'income-expense'
  | 'parties'
  | 'scanner'
  | 'reports'
  | 'settings'
  | 'more'
  | 'transaction-detail'
  | 'party-profile'
  | 'new-sale'
  | 'new-purchase'
  | 'pricing'
  | 'ai-comparison'

export type ViewMode = 'grid' | 'list'

// Paywall feature type — must match GatedFeature in use-subscription.ts
export type PaywallFeature =
  | 'ai_scanner'
  | 'barcode_scanner'
  | 'gstr_export'
  | 'whatsapp_sharing'
  | 'voice_entry'
  | 'recurring_entries'
  | 'smart_insights'
  | 'advanced_reports'
  | 'staff_accounts'
  | 'split_view'
  | 'customer_statement'
  | 'expense_budgets'
  | 'repeat_last_sale'
  | 'share_summary'

export type FeatureKey =
  | 'darkMode'
  | 'keyboardShortcuts'
  | 'globalSearch'
  | 'whatsappSharing'
  | 'smartInsights'
  | 'paymentReminders'
  | 'recurringEntries'
  | 'gstrExport'
  | 'customerLoyalty'
  | 'reorderAlerts'
  | 'aiScanner'
  | 'lowStockAlerts'
  | 'profitTracking'
  | 'pwaInstall'
  | 'barcodeScanner'
  | 'analyticsTracking'
  | 'offlineMode'
  | 'autoSaveDrafts'
  | 'dailySummary'
  | 'announcementBanners'
  | 'repeatLastSale'
  | 'quickActions'

export type FeatureFlags = Record<FeatureKey, boolean>

export type ThemeColor = 'saffron' | 'emerald' | 'blue' | 'violet' | 'rose' | 'teal'

const DEFAULT_FEATURES: FeatureFlags = {
  darkMode: false,
  keyboardShortcuts: true,
  globalSearch: true,
  whatsappSharing: true,
  smartInsights: true,
  paymentReminders: true,
  recurringEntries: true,
  gstrExport: true,
  customerLoyalty: true,
  reorderAlerts: true,
  aiScanner: true,
  lowStockAlerts: true,
  profitTracking: true,
  pwaInstall: true,
  barcodeScanner: true,
  analyticsTracking: true,
  offlineMode: true,
  autoSaveDrafts: true,
  dailySummary: false,
  announcementBanners: true,
  repeatLastSale: true,
  quickActions: true,
}

interface AppState {
  currentView: ViewType
  setView: (v: ViewType) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void
  setSidebarCollapsed: (c: boolean) => void
  refreshKey: number
  triggerRefresh: () => void
  scannerResult: any
  setScannerResult: (r: any) => void
  scannerBillType: 'sale' | 'purchase'
  setScannerBillType: (t: 'sale' | 'purchase') => void
  selectedTransactionId: string | null
  selectedTransactionType: string | null
  setSelectedTransactionId: (id: string | null) => void
  setSelectedTransactionType: (type: string | null) => void
  selectedPartyId: string | null
  setSelectedPartyId: (id: string | null) => void
  inventoryViewMode: ViewMode
  setInventoryViewMode: (m: ViewMode) => void
  partiesViewMode: ViewMode
  setPartiesViewMode: (m: ViewMode) => void
  transactionsViewMode: ViewMode
  setTransactionsViewMode: (m: ViewMode) => void
  inventoryCategory: string | null
  setInventoryCategory: (c: string | null) => void
  triggerNewEntry: number
  triggerNewEntryView: ViewType | null
  fireTriggerNewEntry: () => void
  previousView: ViewType | null
  setPreviousView: (v: ViewType | null) => void
  pendingDateRange: { from: string; to: string; preset: string } | null
  setPendingDateRange: (r: { from: string; to: string; preset: string } | null) => void
  features: FeatureFlags
  setFeature: (key: FeatureKey, enabled: boolean) => void
  resetFeatures: () => void
  themeColor: ThemeColor
  setThemeColor: (c: ThemeColor) => void
  language: 'en' | 'hi'
  setLanguage: (l: 'en' | 'hi') => void
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  // Global paywall state — shared across all components via Zustand.
  // Previously useSubscription used local useState, which meant the PaywallModal
  // in page.tsx never saw state changes from BillScanner/VoiceEntry.
  paywallOpen: boolean
  paywallFeature: PaywallFeature | null
  openPaywall: (feature: PaywallFeature) => void
  closePaywall: () => void
}


export const useAppStore = create<AppState>()(
    (set) => ({
      currentView: 'dashboard',
      setView: (v) => set({ currentView: v, sidebarOpen: false }),
      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      sidebarCollapsed: false,
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (c) => set({ sidebarCollapsed: c }),
      refreshKey: 0,
      triggerRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
      scannerResult: null,
      setScannerResult: (r) => set({ scannerResult: r }),
      scannerBillType: 'purchase',
      setScannerBillType: (t) => set({ scannerBillType: t }),
      selectedTransactionId: null,
  selectedTransactionType: null,
      setSelectedTransactionId: (id) => set({ selectedTransactionId: id }),
  setSelectedTransactionType: (type) => set({ selectedTransactionType: type }),
      selectedPartyId: null,
      setSelectedPartyId: (id) => set({ selectedPartyId: id }),
      inventoryViewMode: 'grid',
      setInventoryViewMode: (m) => set({ inventoryViewMode: m }),
      partiesViewMode: 'grid',
      setPartiesViewMode: (m) => set({ partiesViewMode: m }),
      transactionsViewMode: 'list',
      setTransactionsViewMode: (m) => set({ transactionsViewMode: m }),
      inventoryCategory: null,
      setInventoryCategory: (c) => set({ inventoryCategory: c }),
      triggerNewEntry: 0,
      triggerNewEntryView: null,
      fireTriggerNewEntry: () => set((s) => ({ triggerNewEntry: s.triggerNewEntry + 1, triggerNewEntryView: s.currentView })),
      previousView: null,
      setPreviousView: (v) => set({ previousView: v }),
      pendingDateRange: null,
      setPendingDateRange: (r) => set({ pendingDateRange: r }),
      features: DEFAULT_FEATURES,
      setFeature: (key, enabled) => set((s) => ({ features: { ...s.features, [key]: enabled } })),
      resetFeatures: () => set({ features: DEFAULT_FEATURES }),
      themeColor: 'saffron',
      setThemeColor: (c) => set({ themeColor: c }),
      language: 'en',
      setLanguage: (l) => set({ language: l }),
      searchOpen: false,
      setSearchOpen: (open) => set({ searchOpen: open }),
      paywallOpen: false,
      paywallFeature: null,
      openPaywall: (feature) => set({ paywallOpen: true, paywallFeature: feature }),
      closePaywall: () => set({ paywallOpen: false, paywallFeature: null }),
    }),
  )

