'use client'

/**
 * 🔒 AUDIT V25 §6.1 (Batch 8 Phase 2): Shared navigation action handler.
 *
 * Takes a NavDestination from the registry + performs the correct runtime
 * navigation based on its `actionKind`. Used by Sidebar, MoreScreen,
 * ReportsHub, GlobalSearch, and AccountScreen — one handler, one place
 * to fix navigation bugs.
 *
 * Before this, each surface had its own ad-hoc switch on label/view
 * with inline navigation logic. The shared handler ensures the same
 * destination navigates the same way everywhere.
 */

import { useAppStore } from '@/store/app-store'
import { toast as sonnerToast } from 'sonner'
import { haptic } from '@/lib/haptic'
import type { NavDestination } from '@/lib/nav-registry'
import type { ViewType } from '@/store/app-store'

export function handleNavAction(
  dest: NavDestination,
  opts?: {
    /** Set previousView before navigating (default: current view). */
    previousView?: ViewType
    /** Override the "set previousView to 'more'" behavior in MoreScreen. */
    skipPreviousView?: boolean
  },
) {
  const store = useAppStore.getState()
  const currentView = store.currentView

  // Set previousView so back buttons work
  if (!opts?.skipPreviousView) {
    store.setPreviousView(opts?.previousView || currentView)
  }

  const kind = dest.actionKind || 'navigate'
  const params = dest.actionParams || {}

  switch (kind) {
    case 'navigate':
      if (dest.view) store.setView(dest.view)
      break

    case 'navigate-report':
      if (params.reportType) store.setPendingReportType(params.reportType)
      store.setView('reports')
      break

    case 'navigate-settings':
      if (params.settingsTab) store.setPendingSettingsTab(params.settingsTab as any)
      store.setView('settings')
      break

    case 'navigate-account':
      store.setAccountOriginView(currentView)
      if (params.accountSection) store.setAccountSection(params.accountSection)
      store.setView('account')
      break

    case 'navigate-scroll':
      if (params.scrollTarget) store.setScrollTarget(params.scrollTarget)
      if (dest.view) store.setView(dest.view)
      break

    case 'navigate-day-end':
      store.fireTriggerDayEnd()
      store.setView('dashboard')
      break

    case 'navigate-bulk':
      store.fireTriggerBulkReminders()
      store.setView('parties')
      break

    case 'toast-navigate':
      haptic.click()
      if (params.toastTitle) {
        sonnerToast.info(params.toastTitle, {
          description: params.toastDescription,
          duration: 5000,
        })
      }
      // 🔒 Feature Phase 6: Set returnMode for sale-return / purchase-return
      // so the Ledger shows a "Pick a sale to return" banner.
      if (dest.id === 'sale-return') store.setReturnMode('sale')
      else if (dest.id === 'purchase-return') store.setReturnMode('purchase')
      if (dest.view) store.setView(dest.view)
      break

    case 'coming-soon':
      haptic.click()
      sonnerToast.info(params.toastTitle || 'Coming soon!', {
        description: params.toastDescription,
        duration: 4000,
      })
      break

    case 'custom':
      // Custom actions are handled by the surface itself (Rate, Logout, Share).
      // The surface checks dest.id and runs its own handler.
      // This case is a no-op here — the surface should NOT call handleNavAction
      // for custom destinations; it should check actionKind === 'custom' first.
      console.warn('[handleNavAction] custom action kind should be handled by the surface, not the shared handler', dest.id)
      break

    default:
      if (dest.view) store.setView(dest.view)
  }
}
