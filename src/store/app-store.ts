import { create } from 'zustand'
import { rememberScroll, restoreScroll, scrollToTop } from '@/lib/scroll-memory'

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
  | 'party-bills'
  | 'party-settle'
  | 'new-sale'
  | 'new-purchase'
  | 'new-estimate'
  | 'pricing'
  | 'ai-comparison'
  | 'ai-usage'
  | 'document-vault'
  | 'tools'
  | 'gst-tax'
  | 'money-banking'
  | 'staff-management'
  | 'ca-access'
  | 'business-goals'
  | 'day-end-summary'
  | 'unsynced-entries'
  | 'supplier-opening-balance-review'

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

interface NavStackEntry {
  view: ViewType
  params?: Record<string, any>
}

interface AppState {
  currentView: ViewType
  /** `{ back: true }` restores the destination's remembered scroll position
   *  instead of starting it at the top. Use it from back buttons. */
  setView: (v: ViewType, opts?: { back?: boolean }) => void
  // 🔒 AUDIT V23 FIX §9.1: Navigation stack — replaces the 5 parallel nav
  // variables (previousView, accountOriginView, pendingSettingsTab,
  // pendingReportType, accountSection) with a single stack.
  // push(view, params) adds to the stack; pop() goes back.
  // Android hardware-back maps to pop(). Old variables remain for backward
  // compatibility during incremental migration.
  navStack: NavStackEntry[]
  pushView: (view: ViewType, params?: Record<string, any>) => void
  popView: () => void
  canGoBack: () => boolean
  // 🔒 AUDIT V25 FIX §4.1: sidebarOpen/setSidebarOpen removed — dead state.
  // The mobile sidebar drawer was dead code (setSidebarOpen(true) was called
  // nowhere). Sidebar is now desktop-only via lg:sticky; mobile uses
  // MobileBottomNav + MoreScreen.
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void
  setSidebarCollapsed: (c: boolean) => void
  refreshKey: number
  triggerRefresh: () => void
  scannerResult: any
  setScannerResult: (r: any) => void
  scannerBillType: 'sale' | 'purchase'
  setScannerBillType: (t: 'sale' | 'purchase') => void
  /**
   * 🔒 AUDIT C5: "settle THIS bill" intent, carried from the Bills page to the
   * Settle dialog on the party profile.
   *
   * The dialog lives on the profile, and the Settle buttons live on the Bills
   * page. Without this the button could only navigate — which is exactly what
   * it did, doing nothing useful once it arrived.
   *
   * `amount` is a SUGGESTION (the bill's current due) and stays editable: a
   * customer paying ₹200 against a ₹553 bill is the normal case, not an edge
   * one, so this must not force full settlement.
   */
  pendingSettle: { transactionId: string; invoiceNo: string | null; amount: number } | null
  setPendingSettle: (s: { transactionId: string; invoiceNo: string | null; amount: number } | null) => void
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
  // 🔒 V26 N23: Deep-link triggers for Voice Entry + Barcode Scanner.
  // Same counter pattern as triggerNewEntry. TransactionEntry subscribes
  // to these and auto-opens the voice dialog / barcode scanner when the
  // counter increments. Was: voice-entry/barcode-scanner nav entries just
  // opened new-sale, leaving the user to find the mic/scan button.
  triggerVoiceOpen: number
  fireTriggerVoiceOpen: () => void
  triggerBarcodeOpen: number
  fireTriggerBarcodeOpen: () => void
  // 🔒 AUDIT V25 FIX BUG-032 (Batch 6): Deep-link triggers for MoreScreen items.
  // These use the same counter pattern as triggerNewEntry — components subscribe
  // to the counter and fire their action when it increments.
  triggerDayEnd: number
  fireTriggerDayEnd: () => void
  triggerBulkReminders: number
  fireTriggerBulkReminders: () => void
  // Scroll target for dashboard deep-links (e.g., 'smart-insights', 'cash-in-hand').
  // Dashboard reads this on mount + scrolls to the element with matching id.
  // Cleared after scrolling so it doesn't re-trigger on every mount.
  scrollTarget: string | null
  setScrollTarget: (target: string | null) => void
  // 🔒 Feature Phase 6: Guided returns — returnMode flag shows a banner on the
  // sales/purchase ledger telling the user to pick a transaction to return.
  returnMode: 'sale' | 'purchase' | null
  setReturnMode: (mode: 'sale' | 'purchase' | null) => void
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
  // 🔒 V26 P7-3 (Phase 7): Real founder status from bootstrap. Used by
  // filterByPermissions to gate founderOnly nav entries (AI Usage, etc.).
  // Was: founderOnly gated on isOwner (true for every account) → AI Usage
  // showed for everyone but 403'd for non-founders.
  isFounder: boolean
  setIsFounder: (founder: boolean) => void
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
    (set, get) => ({
      currentView: 'dashboard',
      /*
       * Every screen change runs through here, which makes it the one place
       * that can get scroll position right — so it does, rather than each
       * caller remembering to.
       *
       * Default is forward: remember where we are leaving, then start the new
       * screen at the top. Pass `{ back: true }` from a back button and the
       * destination is restored to where the user left it instead. That
       * distinction cannot be inferred here — going back sets currentView
       * exactly like going forward does — so the back sites declare it.
       */
      setView: (v, opts) => {
        const from = get().currentView
        if (from !== v) rememberScroll(from)
        set({ currentView: v })
        if (opts?.back) restoreScroll(v)
        else scrollToTop()
      },
      // 🔒 AUDIT V23 FIX §9.1: Navigation stack implementation
      navStack: [],
      pushView: (view, params) => {
        const s = get()
        rememberScroll(s.currentView)
        set({ currentView: view, navStack: [...s.navStack, { view: s.currentView, params }] })
        scrollToTop()
      },
      popView: () => {
        const s = get()
        if (s.navStack.length === 0) return
        const prev = s.navStack[s.navStack.length - 1]
        rememberScroll(s.currentView)
        set({ currentView: prev.view, navStack: s.navStack.slice(0, -1) })
        // popView is by definition a back step, so the destination is restored.
        restoreScroll(prev.view)
      },
      canGoBack: () => get().navStack.length > 0,
      // 🔒 AUDIT V25 FIX §4.1: sidebarOpen/setSidebarOpen removed.
      // 🔒 AUDIT V25 FIX §3b.2 (Batch 3b): Sidebar collapsed by default on desktop.
      // Was: sidebarCollapsed: false (expanded by default, user had to manually collapse).
      // User feedback: the expanded sidebar takes too much space on first load.
      // Now: defaults to true (collapsed, icon-only mode). User expands via the
      // toggle button when they want full labels. Persisted to localStorage so
      // the user's preference is remembered across sessions.
      sidebarCollapsed: (() => {
        if (typeof window === 'undefined') return true  // SSR default
        const saved = localStorage.getItem('bahikhata:sidebar-collapsed')
        return saved === null ? true : saved === 'true'  // default true if not set
      })(),
      toggleSidebarCollapsed: () => set((s) => {
        const next = !s.sidebarCollapsed
        if (typeof window !== 'undefined') {
          localStorage.setItem('bahikhata:sidebar-collapsed', String(next))
        }
        return { sidebarCollapsed: next }
      }),
      setSidebarCollapsed: (c) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('bahikhata:sidebar-collapsed', String(c))
        }
        set({ sidebarCollapsed: c })
      },
      refreshKey: 0,
      triggerRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
      scannerResult: null,
      setScannerResult: (r) => set({ scannerResult: r }),
      scannerBillType: 'purchase',
      setScannerBillType: (t) => set({ scannerBillType: t }),
      // 🔒 AUDIT C5: see the type declaration above.
      pendingSettle: null,
      setPendingSettle: (s) => set({ pendingSettle: s }),
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
      // 🔒 V26 N23: Voice + Barcode deep-link triggers.
      triggerVoiceOpen: 0,
      fireTriggerVoiceOpen: () => set((s) => ({ triggerVoiceOpen: s.triggerVoiceOpen + 1 })),
      triggerBarcodeOpen: 0,
      fireTriggerBarcodeOpen: () => set((s) => ({ triggerBarcodeOpen: s.triggerBarcodeOpen + 1 })),
      // 🔒 AUDIT V25 FIX BUG-032 (Batch 6): Deep-link trigger implementations.
      triggerDayEnd: 0,
      fireTriggerDayEnd: () => set((s) => ({ triggerDayEnd: s.triggerDayEnd + 1 })),
      triggerBulkReminders: 0,
      fireTriggerBulkReminders: () => set((s) => ({ triggerBulkReminders: s.triggerBulkReminders + 1 })),
      scrollTarget: null,
      setScrollTarget: (target) => set({ scrollTarget: target }),
      // 🔒 Feature Phase 6: Guided returns
      returnMode: null,
      setReturnMode: (mode) => set({ returnMode: mode }),
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
      // 🔒 V26 N4: Hydrate features from localStorage. Was: always DEFAULT_FEATURES
      // → all toggles reset on reload. Now: read each key from localStorage,
      // falling back to DEFAULT_FEATURES for any missing/invalid values.
      features: (() => {
        if (typeof window === 'undefined') return DEFAULT_FEATURES
        try {
          const hydrated = { ...DEFAULT_FEATURES }
          for (const key of Object.keys(DEFAULT_FEATURES) as FeatureKey[]) {
            const saved = localStorage.getItem(`bahikhata:feature:${key}`)
            if (saved !== null) {
              hydrated[key] = saved === 'true'
            }
          }
          return hydrated
        } catch {
          return DEFAULT_FEATURES
        }
      })(),
      // 🔒 V26 N4: Persist feature toggles to localStorage so they survive reload.
      // Was: only in-memory set() — all 21 toggles reset on reload while the UI
      // toasted "enabled/disabled". Now: save to localStorage on every setFeature.
      setFeature: (key, enabled) => {
        set((s) => ({ features: { ...s.features, [key]: enabled } }))
        // Persist to localStorage
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(`bahikhata:feature:${key}`, enabled ? 'true' : 'false')
          } catch {}
        }
      },
      resetFeatures: () => {
        set({ features: DEFAULT_FEATURES })
        // Clear all feature keys from localStorage
        if (typeof window !== 'undefined') {
          try {
            Object.keys(DEFAULT_FEATURES).forEach(key => {
              localStorage.removeItem(`bahikhata:feature:${key}`)
            })
          } catch {}
        }
      },
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
      isFounder: false,
      setIsFounder: (founder) => set({ isFounder: founder }),
      searchOpen: false,
      setSearchOpen: (open) => set({ searchOpen: open }),
      paywallOpen: false,
      paywallFeature: null,
      openPaywall: (feature) => set({ paywallOpen: true, paywallFeature: feature }),
      closePaywall: () => set({ paywallOpen: false, paywallFeature: null }),
    }),
  )

