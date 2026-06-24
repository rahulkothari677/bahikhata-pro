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

interface AppState {
  currentView: ViewType
  setView: (v: ViewType) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  refreshKey: number
  triggerRefresh: () => void
  scannerResult: any
  setScannerResult: (r: any) => void
  scannerBillType: 'sale' | 'purchase'
  setScannerBillType: (t: 'sale' | 'purchase') => void
}

export const useAppStore = create<AppState>((set) => ({
  currentView: 'dashboard',
  setView: (v) => set({ currentView: v, sidebarOpen: false }),
  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  refreshKey: 0,
  triggerRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
  scannerResult: null,
  setScannerResult: (r) => set({ scannerResult: r }),
  scannerBillType: 'purchase',
  setScannerBillType: (t) => set({ scannerBillType: t }),
}))
