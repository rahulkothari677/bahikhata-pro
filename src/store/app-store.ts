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
  | 'transaction-detail'
  | 'party-profile'
  | 'new-sale'
  | 'new-purchase'

export type ViewMode = 'grid' | 'list'

interface AppState {
  currentView: ViewType
  setView: (v: ViewType) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  // Collapsed sidebar (desktop)
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void
  setSidebarCollapsed: (c: boolean) => void
  // Refresh trigger
  refreshKey: number
  triggerRefresh: () => void
  // Scanner
  scannerResult: any
  setScannerResult: (r: any) => void
  scannerBillType: 'sale' | 'purchase'
  setScannerBillType: (t: 'sale' | 'purchase') => void
  // Selected entities for detail views
  selectedTransactionId: string | null
  setSelectedTransactionId: (id: string | null) => void
  selectedPartyId: string | null
  setSelectedPartyId: (id: string | null) => void
  // View modes (persisted per module)
  inventoryViewMode: ViewMode
  setInventoryViewMode: (m: ViewMode) => void
  partiesViewMode: ViewMode
  setPartiesViewMode: (m: ViewMode) => void
  transactionsViewMode: ViewMode
  setTransactionsViewMode: (m: ViewMode) => void
  // Inventory category filter
  inventoryCategory: string | null
  setInventoryCategory: (c: string | null) => void
  // Global dialog triggers (so Header can open dialogs) - timestamp based, only fires for the currently mounted component
  triggerNewEntry: number
  triggerNewEntryView: ViewType | null
  fireTriggerNewEntry: () => void
  // Previous view (for back button from detail pages)
  previousView: ViewType | null
  setPreviousView: (v: ViewType | null) => void
}

export const useAppStore = create<AppState>((set) => ({
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
  setSelectedTransactionId: (id) => set({ selectedTransactionId: id }),
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
}))
