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
  | 'account'
  | 'transaction-detail'
  | 'party-profile'
  | 'new-sale'
  | 'new-purchase'
  | 'pricing'
  | 'ai-comparison'
  | 'ai-usage'
  // 🔒 V22-1: New views for categorized More section
  | 'gst-tax'
  | 'money-banking'

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
  | 'businessAnalytics'

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
  businessAnalytics: true,
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
  // 🔒 V21-012 (Phase 4a): Pending settings tab — when the Account page
  // navigates to Settings, it sets this so Settings opens on the right tab.
  pendingSettingsTab: 'profile' | 'features' | 'appearance' | 'data' | 'staff' | null
  setPendingSettingsTab: (tab: 'profile' | 'features' | 'appearance' | 'data' | 'staff' | null) => void
  // 🔒 V22-2 (Phase 2 fix): Pending report type — when GST & Tax or Banking
  // page navigates to Reports, it sets this so Reports opens on that specific
  // report type AND hides all other tabs (singleReportType mode).
  pendingReportType: string | null
  setPendingReportType: (type: string | null) => void
  // 🔒 V21-014 (Phase 6): Account section — when non-null, AccountScreen
  // renders a DEDICATED page for that section (no tabs, no menu).
  // When null, shows the account menu (profile header + 10 items).
  accountSection: string | null
  setAccountSection: (section: string | null) => void
  // 🔒 V21-014 fix: Tracks where the user was BEFORE opening the Account page.
  // Used by the Account menu's back button to return to the original view.
  // This is separate from previousView because previousView gets overwritten
  // when navigating to pricing from the subscription section.
  accountOriginView: ViewType | null
  setAccountOriginView: (view: ViewType | null) => void
  features: FeatureFlags
  setFeature: (key: FeatureKey, enabled: boolean) => void
  resetFeatures: () => void
  themeColor: ThemeColor
  setThemeColor: (c: ThemeColor) => void
  language: string
  setLanguage: (l: string) => void
  // 🔒 V21-006: DB warmup flag — gates dashboard queries until warmup completes.
  // This prevents the dashboard query from racing with warmup for the DB connection.
  dbWarmedUp: boolean
  setDbWarmedUp: (done: boolean) => void
  // 🔒 V21-008: Bootstrap flag — gates settings/shops/subscription hooks until
  // bootstrap completes and primes the cache. Without this, the individual hooks
  // fire immediately on mount and fetch separately (defeating the consolidation).
  bootstrapDone: boolean
  setBootstrapDone: (done: boolean) => void
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
      // 🔒 V21-012 (Phase 4a)
      pendingSettingsTab: null,
      setPendingSettingsTab: (tab) => set({ pendingSettingsTab: tab }),
      // 🔒 V22-2 (Phase 2 fix)
      pendingReportType: null,
      setPendingReportType: (type) => set({ pendingReportType: type }),
      // 🔒 V21-014 (Phase 6)
      accountSection: null,
      setAccountSection: (section) => set({ accountSection: section }),
      // 🔒 V21-014 fix
      accountOriginView: null,
      setAccountOriginView: (view) => set({ accountOriginView: view }),
      features: DEFAULT_FEATURES,
      setFeature: (key, enabled) => set((s) => ({ features: { ...s.features, [key]: enabled } })),
      resetFeatures: () => set({ features: DEFAULT_FEATURES }),
      themeColor: 'saffron',
      setThemeColor: (c) => set({ themeColor: c }),
      language: 'en',
      setLanguage: (l) => set({ language: l }),
      // 🔒 V21-006: DB warmup flag
      dbWarmedUp: false,
      setDbWarmedUp: (done) => set({ dbWarmedUp: done }),
      // 🔒 V21-008: Bootstrap flag
      bootstrapDone: false,
      setBootstrapDone: (done) => set({ bootstrapDone: done }),
      searchOpen: false,
      setSearchOpen: (open) => set({ searchOpen: open }),
      paywallOpen: false,
      paywallFeature: null,
      openPaywall: (feature) => set({ paywallOpen: true, paywallFeature: feature }),
      closePaywall: () => set({ paywallOpen: false, paywallFeature: null }),
    }),
  )

