'use client'

/**
 * Open Items or Khata from an Insights group, with that group selected
 * (Phase 5e-4b, ledger model v4 §2: "every group opens the full list"). The
 * list shows the group as an extra chip with ✕ (FocusChip); the server works out
 * who is in it with Insights' own rules (lib/list-focus.ts).
 */
import { useAppStore } from '@/store/app-store'
import { haptic } from '@/lib/haptic'
import type { DateRange } from '@/components/common/DateRangePicker'
import type { ListFocus } from '@/lib/list-focus'

export function useOpenList() {
  const setListFocus = useAppStore((s) => s.setListFocus)
  const setKhataSide = useAppStore((s) => s.setKhataSide)
  const setPreviousView = useAppStore((s) => s.setPreviousView)
  const setView = useAppStore((s) => s.setView)
  return (screen: ListFocus['screen'], focus: string, label: string, range?: DateRange) => {
    haptic.click()
    setListFocus({ screen, focus, label, from: range?.from.toISOString(), to: range?.to.toISOString() })
    if (screen === 'khata') setKhataSide('customer')
    setPreviousView('dashboard')
    setView(screen === 'items' ? 'inventory' : 'parties')
  }
}
