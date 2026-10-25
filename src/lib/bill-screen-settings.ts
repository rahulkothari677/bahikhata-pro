/**
 * Phase 7c, change C12 (#310) — the bill screen's settings, ONE list.
 *
 * Rahul, 25 Oct: "add all these in the setting so the user can add or choose by
 * themselves"; "settings to change all these on new sale page so the user can
 * instantly change according to their comfort". So every way of adding items
 * and every helper on New Sale is a switch, changed from ⚙ on New Sale itself
 * (components/ledger/BillScreenSettings.tsx) and shown again in Settings →
 * Features. Both screens draw from this list, so they cannot disagree.
 *
 * The values live in the app store's feature switches (kept on this phone, like
 * the other Features), ON by default (Side view starts as the List): a shop that
 * never opens ⚙ gets every tool. What the law decides — the shop's GST type, the
 * MRP limit — is never a switch here.
 *
 * Adding a setting means adding its line to CONSUMERS in
 * __tests__/lib/bill-screen-settings.test.ts: a switch nothing reads does not ship.
 */
import type { FeatureKey } from '@/store/app-store'

export type BillSettingGroup = 'add' | 'screen'

export interface BillScreenSetting {
  key: FeatureKey
  group: BillSettingGroup
  label: string
  help: string
  /** Shown only on a sale (price check has no meaning on a purchase). */
  saleOnly?: boolean
  /** Where it starts. Every switch starts ON except a choice of look (Side view starts as List). */
  defaultOn?: boolean
}

/** The value a switch starts at, and goes back to. */
export const startsOn = (s: BillScreenSetting) => s.defaultOn !== false

export const BILL_SETTING_GROUPS: { id: BillSettingGroup; title: string }[] = [
  { id: 'add', title: 'Ways to add items' },
  { id: 'screen', title: 'On the screen' },
]

export const BILL_SCREEN_SETTINGS: readonly BillScreenSetting[] = [
  { key: 'voiceEntry', group: 'add', label: 'Voice', help: 'Say the items' },
  { key: 'aiScanner', group: 'add', label: 'Scan a bill (AI)', help: 'A photo of a written list or bill. Also in the menu' },
  { key: 'barcodeScanner', group: 'add', label: 'Barcode scanner', help: 'The camera reads the packet' },
  // C11: your List design, or the same rows with the groups in a column on the left.
  { key: 'billSideView', group: 'screen', label: 'Side view', help: 'Groups in a column on the left', defaultOn: false },
  { key: 'billQtyButton', group: 'screen', label: 'Qty button', help: 'Type how many, then tap the item' },
  { key: 'billPriceCheck', group: 'screen', label: 'Price check', help: 'See a price without adding it', saleOnly: true },
  { key: 'billOftenList', group: 'screen', label: 'Often sold list', help: 'Best sellers under the search' },
  { key: 'billUsualList', group: 'screen', label: "Customer's usual items", help: 'When a customer is picked' },
  { key: 'billSizeStock', group: 'screen', label: 'Stock on size buttons', help: '"out", "2 left"' },
  { key: 'billSizeMark', group: 'screen', label: 'Mark the most-sold size', help: 'A coloured border' },
]

/** The settings a bill of this kind shows (price check is a sale's only). */
export function billSettingsFor(isSale: boolean): BillScreenSetting[] {
  return BILL_SCREEN_SETTINGS.filter((s) => isSale || !s.saleOnly)
}
