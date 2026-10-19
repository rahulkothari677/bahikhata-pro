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
  // Phase 5a-3: "Got payment" opens Khata on Customers, "Gave payment" on Suppliers.
  if (params.khataSide) store.setKhataSide(params.khataSide)
  // Phase 5c-4: "Insights" from More, the menu or search opens Home on Insights.
  if (params.homeView) store.setHomeView(params.homeView)

  // Nothing to do about scroll position here: store.setView starts every
  // forward navigation at the top on its own. 'navigate-scroll' still works,
  // because its target element is scrolled into view by the destination
  // screen's own effect, which runs after the view has mounted and reset.

  switch (kind) {
    case 'navigate':
      if (dest.view) store.setView(dest.view)
      // 🔒 V26 N21: For Ctrl+K "Add Product"/"Add Customer" commands, fire
      // the trigger-new-entry counter after navigating so the target view
      // (Inventory/Parties) opens its add dialog. Was: just navigated to the
      // list view, leaving the user to find the + button themselves.
      // Phase 5a-3: the counter bump fired before the target screen existed, so
      // the form never opened. A request waits until the screen consumes it.
      if (params.fireTriggerNewEntry && dest.view) store.requestOnArrival(dest.view, 'new-entry')
      else if (params.fireTriggerNewEntry) store.fireTriggerNewEntry()
      // 🔒 V26 N23: Voice Entry / Barcode Scanner open the mic / scanner on
      // New Sale. Phase 5b-2: as a request (the counter bump was missed when
      // New Sale was not open yet — the #214 class).
      if (params.fireTriggerVoiceOpen && dest.view) store.requestOnArrival(dest.view, 'voice')
      if (params.fireTriggerBarcodeOpen && dest.view) store.requestOnArrival(dest.view, 'barcode')
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

    // Phase 5b-2: requests, not counter bumps (Close day / Reminders from More
    // opened Home / Khata without the dialog — the #214 class).
    case 'navigate-day-end':
      store.requestOnArrival('dashboard', 'day-end')
      store.setView('dashboard')
      break

    case 'navigate-bulk':
      store.requestOnArrival('parties', 'bulk-reminders')
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
