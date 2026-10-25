'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { findProductByScannedCode, resolveProductForEnterKey } from '@/lib/find-product-by-code'
import { itemSearch } from '@/lib/item-search'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAppStore } from '@/store/app-store'
import { useArrivalRequest } from '@/hooks/use-new-entry-request'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { InfoHint, SettingLabel } from '@/components/common/InfoHint'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { toast as sonnerToast } from 'sonner'
import { resolveName } from '@/lib/resolve-name'
import { formatINR, cn, getInitials } from '@/lib/utils'
import { owedByNobody, owedByNobodyMessage } from '@/lib/paid-amount'
import {
  ShoppingCart, Truck, Plus, X, Search, ChevronDown, ChevronRight,
  TrendingUp, TrendingDown, Calendar, User, ScanLine, Folder, FolderOpen,
  Package, Phone, IndianRupee, Save, Trash2, Check, AlertCircle, Mic, Clock, AlertTriangle, Minus,
  FileDown, Settings2,
} from 'lucide-react'
import { VoiceEntry } from '@/components/common/VoiceEntry'
import { BillScreenSettings } from '@/components/ledger/BillScreenSettings'
import { KeypadBar, QtyPad, type KeypadRow } from '@/components/ledger/KeypadBar'
import { DraftManagerModal } from '@/components/common/DraftManagerModal'
import { BarcodeScanner } from '@/components/common/BarcodeScanner'
import { EmptyState } from '@/components/common/EmptyState'
import { checkMixedSupply } from '@/lib/mixed-supply-invoice'
import { supplyKind, stateCodeOf, stateNameForCode, deliveryCheck, billPlaceOfSupply, compositionInterStateBlocked, rule46eMissing, resolveStateCode, gstinStateCode, type StatePlace } from '@/lib/gst-states'
import { useSetting } from '@/hooks/use-setting'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { track, EVENTS } from '@/lib/analytics'
import { useDrafts } from '@/hooks/use-drafts'
import { haptic } from '@/lib/haptic'
import { trackRecentProduct, getRecentProductIds } from '@/lib/recent-products'
import { freezeWhileBillOpen } from '@/lib/pick-rows'
import { ItemPicker } from './ItemPicker'
import { partyMatchesSearch, partyPrefillFromSearch } from '@/lib/party-search'
import { PaySheet, SavedSheet, type SavedBill } from '@/components/ledger/PaySheet'
import { buildUpiLink, invoiceShopFromSetting } from '@/lib/invoice-document'
import { changeFor } from '@/lib/quick-cash'
import { createScanBuffer } from '@/lib/scanner-burst'
import { isEntryView } from '@/lib/entry-views'
import { ProductDialog } from '@/components/inventory/ProductDialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { useRatePrompt } from '@/hooks/use-rate-prompt'
// 🔒 V10 §2.3: Single rounding function shared between client and server.
// Was: `const r = (n) => Math.round(n*100)/100` here, which lacks the 1e-9
// epsilon correction in roundMoney() → on boundary values like 1.005 the
// client displayed a different total (1.00) than the server stored (1.01).
// Now: both use the same roundMoney() — no drift between entry preview and
// stored value.
import { roundMoney, splitGst } from '@/lib/money'
import { computeLineItems } from '@/lib/line-items'
import { baseUnitOf, subUnitsFor, normalizeUnitName, resolveEnteredQuantity, normalizeToUnit, isCountUnit, stepForUnit } from '@/lib/units'
import { tracksStock, isService } from '@/lib/inventory-tracking'
import { readError } from '@/lib/read-error'
import { invalidateMoneyCaches } from '@/lib/invalidate-money-caches'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { registerExitGuard } from '@/lib/exit-guard'
import { CustomFieldInputs } from '@/components/common/CustomFieldInputs'
import type { CustomFieldDef } from '@/lib/custom-fields'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { ratesForPicker, isLegacyGstRate } from '@/lib/gst-rates'
import { istDateString } from '@/lib/timezone'
import { refillPrice, resolveLineIncludesGst } from '@/lib/refill-line'
import { lineTaxable } from '@/lib/line-taxable'
import { gstStatus, chargesGstOnSales, claimsInputCredit, isOutwardDocument } from '@/lib/shop-tax'
import { purchaseCostPerUnit, purchaseRateFromCost, isNoCostLine, marginOnCosted, linesAboveMrp, lineAboveMrp, customerPaysPerUnit } from '@/lib/unit-profit'
import { quantityForAmount } from '@/lib/loose-amount'
import { nextQtyFor, nextLabel, looseLabel, isLooseUnit, type NextQty } from '@/lib/loose-entry'
import { parseTypedLine, splitTypedList, isTypedList } from '@/lib/typed-line'
import { pickTypedLine, teach, learnedId } from '@/lib/typed-pick'
import { TypedChecks, type TypedCheck } from '@/components/ledger/TypedChecks'
import { OneOffLine } from '@/components/ledger/OneOffLine'
import { entryLineInputs, billTotalAfterRoundOff, heldBillFigures, heldBillName, heldBillWhen } from '@/lib/bill-total'
import { MAX_HELD } from '@/hooks/use-drafts'

/** Phase 7f: held bills shown as chips on the Held row; the rest behind "All". */
const HELD_CHIPS = 2
import { StateField, GstinField } from '@/components/common/StateField'

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI / QR' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'credit', label: 'Credit (Udhaar)' },
]

type LedgerType = 'sale' | 'purchase'

type ItemRow = {
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  gstRate: number
  unit: string
  /*
   * The line's own GST treatment, carried from the product (#91).
   *
   * Needed because a 0% line is NOT automatically exempt — a line marked
   * 'taxable' at a nil tariff is still a taxable supply and belongs on the tax
   * invoice. Without this the mixed-supply check would read every zero-rate
   * line as exempt and split bills that need no splitting, which matters now
   * that the item screen deliberately leaves a conditional item as 'taxable'
   * until the shopkeeper answers the packaging question.
   */
  gstTreatment?: string | null
  /*
   * Whether THIS line's price includes GST (#130, #135).
   *
   * Lines used to borrow the product's flag, which is about its SALE price.
   * Two things went wrong: a line refilled from a saved bill carries the
   * stored ex-GST price, so the product's "inclusive" flag took GST out a
   * second time (a full return of a ₹765.01 sale refunded ₹728.60); and a
   * supplier's ex-GST purchase rate was treated as GST-inclusive.
   *
   * Set when the line comes from a saved bill (its own recorded value);
   * left undefined for a freshly picked product, which then follows
   * lineIncludesGst(): the product's flag on a sale, the bill's
   * "rates include GST" switch on a purchase.
   */
  priceIncludesGst?: boolean
}

/**
 * The entry forms. After a save, "back where you came from" never means back
 * into a fresh copy of a form — estimates included (5d-3: a New Estimate opened
 * from New Estimate returned to a blank estimate after saving).
 */
// One list of bill-entry screens (lib/entry-views.ts) — the keyboard shortcuts use it too.

export function TransactionEntry({ type, estimateMode = false }: { type: LedgerType; estimateMode?: boolean }) {
  const isSale = type === 'sale'
  // 🔒 Feature Phase 3: estimateMode — when true, the form saves with type='estimate'
  // instead of 'sale'. Estimates don't affect stock, party balance, or GST.
  // The UI shows "Estimate" instead of "Sale" + hides the payment field.
  // V17-Ext Tier 3: actualType can be overridden by preset to 'credit-note' or 'debit-note'
  const [actualType, setActualType] = useState<string>(estimateMode ? 'estimate' : type)
  const isCreditNote = actualType === 'credit-note'
  const isDebitNote = actualType === 'debit-note'
  const isNote = isCreditNote || isDebitNote
  // V17-Ext Tier 3: Note-specific fields
  const [noteReason, setNoteReason] = useState<string>('')
  const [affectsStock, setAffectsStock] = useState(false)
  const [originalTransactionId, setOriginalTransactionId] = useState<string | null>(null)
  /*
   * Purchases: do the supplier's rates on this bill include GST? (#135)
   * A GST tax invoice shows rates before tax, so the default is NO. A kachcha
   * bill or a retail purchase can be switched to YES for the whole bill.
   */
  const [purchaseRatesIncludeGst, setPurchaseRatesIncludeGst] = useState(false)
  const isPurchaseSide = actualType === 'purchase' || actualType === 'debit-note'
  const { setView, triggerRefresh, setScannerBillType, previousView, setPreviousView, features, triggerVoiceOpen, triggerBarcodeOpen, setEntryType } = useAppStore()

  const queryClient = useQueryClient()
  // 🔒 ROUND 10b (2026-07-22): the New Sale screen printed "Gross Profit
  // ₹X (Y%)" in the summary with NO staff gate — so a shop assistant with
  // "hide profit" turned on read the exact margin on every bill they rang up.
  // Rounds 12-15 closed this on the dashboard, inventory and reports, and
  // missed the one screen staff use most.
  //
  // Gating the display also avoids a second problem: the figure is computed in
  // the browser from the product's purchase price, and that price is now
  // stripped from /api/products for hide-profit staff — so the number shown
  // was not merely private, it was wrong (cost read as zero, so the whole sale
  // looked like profit).
  const { hideProfit } = useSetting()

  const [partyId, setPartyId] = useState('')
  const [partySearch, setPartySearch] = useState('')
  const [partyDropdownOpen, setPartyDropdownOpen] = useState(false)
  /* Details starts closed on mobile; the lg: rules keep it open on desktop
     regardless, so this only ever governs the phone. */
  const [detailsOpen, setDetailsOpen] = useState(false)
  const { confirmDialog: confirmSave, dialog: saveDialogEl } = useConfirmDialog()
  const [leavePromptOpen, setLeavePromptOpen] = useState(false)
  const leaveResolverRef = useRef<((allow: boolean) => void) | null>(null)
  const [addPartyOpen, setAddPartyOpen] = useState(false)
  // 🔒 V9 4.4: Persistent stock warning banner (not just a toast)
  const [stockWarnings, setStockWarnings] = useState<any[]>([])

  const [date, setDate] = useState(istDateString(new Date()))
  const [invoiceNo, setInvoiceNo] = useState('')
  const [isInterState, setIsInterState] = useState(false)
  // Phase 2c (#114): goods sent to another address. The state decides the
  // place of supply; for a registered buyer whose goods go to another state,
  // bill-to-ship-to is ASKED (null = not answered) because it changes the tax.
  const [shipElsewhere, setShipElsewhere] = useState(false)
  const [deliveryState, setDeliveryState] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [billToShipTo, setBillToShipTo] = useState<boolean | null>(null)
  // A credit note against a saved bill keeps that bill's tax head (the server
  // does the same, lib/bill-delivery.ts) — loaded so the screen agrees.
  const [originalSupply, setOriginalSupply] = useState<{ isInterState: boolean; placeOfSupply: string | null; deliveryState: string | null; party: StatePlace | null } | null>(null)
  /* Purchases only — see the toggle in the details section. */
  const [isReverseCharge, setIsReverseCharge] = useState(false)
  // Section 17(5) — '' means credit is claimable, which is the normal case.
  const [itcBlockedReason, setItcBlockedReason] = useState('')
  /* Purchases only — offer to write the bill's prices back as product cost. */
  const [updateProductCosts, setUpdateProductCosts] = useState(true)
  const [paymentMode, setPaymentMode] = useState('cash')
  const [paidAmount, setPaidAmount] = useState('')
  // 🔒 AUDIT V24 §1: For credit/debit notes, paidAmount means "cash refunded".
  // Default OFF = pure khata adjustment (send paidAmount 0). See the refund
  // toggle in the payment card below.
  // #278 (Phase 6b): null until the shopkeeper chooses. A counter return (no customer) then defaults
  // to "cash refunded" — there is no khata to adjust, and the screen used to show "₹100 due" to nobody.
  const [cashRefund, setCashRefund] = useState<boolean | null>(null)
  const cashRefundOn = cashRefund ?? (isCreditNote && !partyId)
  // #277: the header names what this screen is making (a return, not "New Sale").
  useEffect(() => { setEntryType(actualType); return () => setEntryType(null) }, [actualType, setEntryType])
  const [discountAmount, setDiscountAmount] = useState('')
  const [notes, setNotes] = useState('')

  /*
   * 📄 Phase 5 — the shop's own fields.
   *
   * `billFields` is one object for the whole bill. `itemFields` is keyed by
   * LINE INDEX, matching how every other per-line value on this screen is
   * held, so adding or removing a line keeps them aligned with `items`.
   */
  const [billFields, setBillFields] = useState<Record<string, string>>({})
  const [itemFields, setItemFields] = useState<Record<number, Record<string, string>>>({})
  const { data: cfData } = useQuery({
    queryKey: ['custom-fields'],
    queryFn: async () => {
      const r = await offlineFetch('/api/custom-fields')
      if (!r.ok) throw new Error('Could not load your fields')
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })
  const allDefs: CustomFieldDef[] = cfData?.fields ?? []
  const billDefs = allDefs.filter(f => f.entity === 'invoice')
  const itemDefs = allDefs.filter(f => f.entity === 'item')

  // Cascading product selection
  const [productSearch, setProductSearch] = useState('')
  const [items, setItems] = useState<ItemRow[]>([])

  const [saving, setSaving] = useState(false)
  const [showVoiceEntry, setShowVoiceEntry] = useState(false)
  const [draftModalOpen, setDraftModalOpen] = useState(false)
  const [barcodeOpen, setBarcodeOpen] = useState(false)

  // 🔒 V26 N23: Auto-open voice dialog / barcode scanner when the user picks
  // the Voice Entry / Barcode Scanner nav entry. The nav entry fires the
  // counter via handle-nav-action; here we subscribe and toggle the dialog
  // open. Was: nav entry just opened new-sale, user had to find the mic /
  // scan button themselves.
  const lastVoiceTriggerRef = useRef(triggerVoiceOpen)
  useEffect(() => {
    if (triggerVoiceOpen > lastVoiceTriggerRef.current) {
      lastVoiceTriggerRef.current = triggerVoiceOpen
      setShowVoiceEntry(true)
    }
  }, [triggerVoiceOpen])

  const lastBarcodeTriggerRef = useRef(triggerBarcodeOpen)
  useEffect(() => {
    if (triggerBarcodeOpen > lastBarcodeTriggerRef.current) {
      lastBarcodeTriggerRef.current = triggerBarcodeOpen
      setBarcodeOpen(true)
    }
  }, [triggerBarcodeOpen])
  // Phase 5b-2: "Speak" / "Barcode" from the + sheet, More or search arrive as
  // requests — the counters above only work when this screen is already open
  // (the header's mic), and were missed when it opened a moment later.
  const entryView = estimateMode ? 'new-estimate' : type === 'purchase' ? 'new-purchase' : 'new-sale'
  useArrivalRequest(entryView, 'voice', () => setShowVoiceEntry(true))
  useArrivalRequest(entryView, 'barcode', () => setBarcodeOpen(true))
  // Prevents autosave until preset check is complete (avoids creating
  // empty drafts when "Repeat Last Sale" or scanner pre-fills the form)
  const [presetChecked, setPresetChecked] = useState(false)
  // When true, the form was filled by a preset (Repeat Last Sale / Scanner).
  // Suppresses autosave until the user MANUALLY modifies the form.
  // This prevents draft creation for deliberate actions where the user
  // intends to save immediately, not come back later.
  const [presetLoaded, setPresetLoaded] = useState(false)

  // Multi-draft autosave — supports multiple saved drafts per form type.
  // Each draft has a unique ID; the hook tracks which draft is "active" (currently being edited).
  const draftFormType = `txn-${type}`
  const { drafts, activeDraftId, save, restoreDraft, deleteDraft, clearActive, holdNow, refresh: refreshDrafts } = useDrafts<{
    partyId: string
    date: string
    invoiceNo: string
    isInterState: boolean
    paymentMode: string
    paidAmount: string
    discountAmount: string
    notes: string
    items: ItemRow[]
    // 🔒 ROUND 10b (2026-07-22): the four fields that decide WHAT the
    // form is saving. Without them a half-finished credit note restored as a
    // plain sale — see the note on the autosave effect below.
    actualType?: string
    noteReason?: string
    affectsStock?: boolean
    originalTransactionId?: string | null
    // 🔒 R10b-4 (Phase 3): cashRefund toggle must persist in drafts.
    cashRefund?: boolean
    // #135: the purchase bill's "rates include GST" switch.
    purchaseRatesIncludeGst?: boolean
    // Phase 2c (#114): where the goods go — it decides the tax head.
    shipElsewhere?: boolean
    deliveryState?: string
    deliveryAddress?: string
    billToShipTo?: boolean | null
  }>(draftFormType)

  // Rate prompt — increments counter after each successful transaction
  const { increment: incrementRateCount } = useRatePrompt()

  const handleRestoreDraft = useCallback((id: string) => {
    if (typeof restoreDraft !== 'function') {
      console.error('[TransactionEntry] restoreDraft is not a function:', typeof restoreDraft)
      sonnerToast.error('Unable to restore — please refresh the page')
      return
    }
    const draft = restoreDraft(id)
    if (!draft) {
      sonnerToast.error('Draft not found — it may have expired')
      return
    }
    if (draft.partyId) setPartyId(draft.partyId)
    if (draft.date) {
      try {
        const d = new Date(draft.date)
        if (!isNaN(d.getTime())) setDate(istDateString(d))
      } catch {}
    }
    if (draft.invoiceNo !== undefined) setInvoiceNo(draft.invoiceNo)
    if (typeof draft.isInterState === 'boolean') setIsInterState(draft.isInterState)
    if (draft.paymentMode) setPaymentMode(draft.paymentMode)
    if (draft.paidAmount !== undefined) setPaidAmount(draft.paidAmount)
    if (draft.discountAmount !== undefined) setDiscountAmount(draft.discountAmount)
    if (draft.notes !== undefined) setNotes(draft.notes)
    // CRITICAL: Normalize item fields — drafts may have string quantities
    // or missing fields if saved from an older version. Without this,
    // restored items don't render in the form.
    if (draft.items?.length > 0) {
      setItems(draft.items.map((item: any) => ({
        productId: item.productId || '',
        productName: item.productName || item.name || '',
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice) || 0,
        gstRate: Number(item.gstRate) || 0,
        unit: item.unit || 'pcs',
        // #130: a line refilled from a saved bill keeps its own GST setting
        // through a draft — dropping it hands the line back to the product's
        // flag, which takes GST out of an ex-GST price a second time.
        priceIncludesGst: typeof item.priceIncludesGst === 'boolean' ? item.priceIncludesGst : undefined,
      })))
    }
    // 🔒 ROUND 10b: restore WHAT the form is, not just what is on it.
    // Older drafts predate these fields; `undefined` leaves the current mode
    // alone rather than silently downgrading a note to a sale.
    if (draft.actualType) setActualType(draft.actualType)
    if (draft.noteReason !== undefined) setNoteReason(draft.noteReason)
    if (typeof draft.affectsStock === 'boolean') setAffectsStock(draft.affectsStock)
    if (draft.originalTransactionId !== undefined) setOriginalTransactionId(draft.originalTransactionId)
    // 🔒 R10b-4 (Phase 3): Restore cashRefund toggle. Was: not restored →
    // a credit note that had cash refund ON came back with it OFF.
    if (typeof draft.cashRefund === 'boolean') setCashRefund(draft.cashRefund)
    if (typeof draft.purchaseRatesIncludeGst === 'boolean') setPurchaseRatesIncludeGst(draft.purchaseRatesIncludeGst)
    if (typeof draft.shipElsewhere === 'boolean') setShipElsewhere(draft.shipElsewhere)
    if (draft.deliveryState !== undefined) setDeliveryState(draft.deliveryState)
    if (draft.deliveryAddress !== undefined) setDeliveryAddress(draft.deliveryAddress)

    try { haptic.success() } catch {}
    const restoredAs = draft.actualType && draft.actualType !== type
      ? ({ 'credit-note': 'credit note', 'debit-note': 'debit note', estimate: 'estimate' } as Record<string, string>)[draft.actualType] || draft.actualType
      : null
    sonnerToast.success(
      `Bill back — ${draft.items?.length || 0} item${(draft.items?.length || 0) === 1 ? '' : 's'}`
      + (restoredAs ? ` (${restoredAs})` : ''),
    )
  }, [restoreDraft, type])

  // Autosave on form changes (debounced inside the hook).
  // Phase 7f: what a bill on this screen IS — one list, used by autosave and by Hold.
  const draftData = useMemo(() => ({
      partyId,
      date,
      invoiceNo,
      isInterState,
      paymentMode,
      paidAmount,
      discountAmount,
      notes,
      items,
      // 🔒 ROUND 10b (2026-07-22): a credit/debit note or an estimate
      // autosaves into the SAME bucket as a plain sale (`txn-sale`), and the
      // saved payload carried none of the fields that make it a note. So a
      // shopkeeper who started a return worth 500, got interrupted, then
      // restored the draft and saved it recorded a 500 SALE instead: the
      // customer's dues went UP 500 rather than DOWN 500 — a 1,000 swing the
      // wrong way — and GST reported an outward supply instead of a credit
      // note. Persisting the mode makes a restored draft what it was.
      actualType,
      noteReason,
      affectsStock,
      originalTransactionId,
      // 🔒 R10b-4 (Phase 3): Persist cashRefund in autosave. Was: not saved →
      // restoring a draft silently flipped a cash refund to a khata adjustment.
      cashRefund: cashRefund ?? undefined,
      purchaseRatesIncludeGst,
      shipElsewhere,
      deliveryState,
      deliveryAddress,
  }), [partyId, date, invoiceNo, isInterState, paymentMode, paidAmount, discountAmount, notes, items, actualType, noteReason, affectsStock, originalTransactionId, cashRefund, purchaseRatesIncludeGst, shipElsewhere, deliveryState, deliveryAddress])
  // Skip autosave when:
  // - preset check hasn't completed yet (avoid empty drafts during mount)
  // - form was filled by a preset (Repeat Last Sale / Scanner) — the user
  //   intends to save immediately, not come back later. Autosave resumes
  //   once the user manually modifies the form (presetLoaded cleared).
  useEffect(() => {
    if (!presetChecked) return
    if (presetLoaded) return // Don't autosave preset-filled forms
    save(draftData)
  }, [draftData, presetChecked, presetLoaded, save])

  // Fetch products
  const { data: productsData } = useQuery({
    queryKey: ['products', 'for-entry'],
    queryFn: async () => {
      const r = await offlineFetch('/api/products')
      return r.json()
    },
  })
  const products: any[] = productsData?.products || []
  // #71 / Phase 7a: past the declared fuse (lib/catalog-etag.ts) the list is the first N items — said on screen.
  const catalogCutNote = productsData?.truncated ? `First ${products.length.toLocaleString('en-IN')} of ${Number(productsData.total).toLocaleString('en-IN')} items` : null
  // Memoize productMap — only rebuilds when products array changes
  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  // 🔒 V11 STOCK POLICY: Fetch the shop's stock policy so we can do a LIVE
  // check in the cart (block input or show warning) BEFORE the user hits Save.
  // Without this, the user fills the whole form, hits Save, then gets a 400 —
  // frustrating UX. Now they see the warning as they type.
  // 🔒 V26 Phase 8 R10-2: Added staleTime matching useSetting hook (5 min).
  // Without this, the TransactionEntry's own useQuery for ['setting'] could
  // serve stale data after the user changed roundOffEnabled in another tab.
  const { data: settingData } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await offlineFetch('/api/settings')
      return r.json()
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — matches useSetting hook
  })
  const stockPolicy: 'block' | 'allow' = settingData?.setting?.stockPolicy || 'block'
  // #165: the shop's GST status (lib/shop-tax.ts) — not registered or
  // composition shops put no GST on the bills they issue.
  const shopGstStatus = gstStatus(settingData?.setting)
  const shopChargesGst = chargesGstOnSales(shopGstStatus)
  // Phase 1c-2: what this screen SHOWS about GST. The shop's own bills (sale,
  // credit note, estimate) show it only when the shop charges GST. A
  // supplier's bill always carries its GST, but the claim-back controls
  // (bill number for GSTR-2B, reverse charge, blocked credit) need a shop that
  // can claim it.
  const showsGst = isOutwardDocument(actualType) ? shopChargesGst : true
  const canClaimGst = claimsInputCredit(shopGstStatus)

  // Fetch parties
  const { data: partiesData, refetch: refetchParties } = useQuery({
    queryKey: ['parties'],
    queryFn: async () => {
      const r = await offlineFetch('/api/parties')
      return r.json()
    },
  })
  const allParties: any[] = partiesData?.parties || []
  // Memoize filtered parties — only recomputes when allParties, isSale, or partySearch changes
  // 6c-2: "98290 11223" or "+91 98290…" finds the customer stored as 9829011223 (lib/party-search.ts).
  const filteredParties = useMemo(() => allParties.filter(p =>
    (p.type === (isSale ? 'customer' : 'supplier') || p.type === 'both') &&
    partyMatchesSearch(p, partySearch)
  ), [allParties, isSale, partySearch])
  // What "Add new" starts with when the search found nobody: a mobile number goes in Phone, a name in Name.
  const addPartyPrefill = useMemo(() => partyPrefillFromSearch(partySearch), [partySearch])

  /*
   * Phase 6c/6d — a plain sale is paid on the Pay sheet (change, UPI QR, udhaar
   * to a named customer) and stays open for the next bill. Kept in Phase 7c;
   * its tile grid is gone (#294).
   */
  const counterMode = actualType === 'sale' && !estimateMode
  /*
   * Phase 7c — THE BILL PICKER, one for every bill (components/ledger/ItemPicker.tsx).
   * "Often sold" (or "Often bought" on a purchase) is the shop's own bills over 90
   * days; once a party is picked, what THEY usually take comes first. The order is
   * FROZEN while a bill is open (#181/#146), so a second tap never lands on a row
   * that moved. A shop with no history yet falls back to the items used last on
   * this phone.
   */
  const pickType = isSale ? 'sale' : 'purchase'
  const { data: topSellersData } = useQuery({
    queryKey: ['products', 'top-sellers', pickType],
    queryFn: async () => (await offlineFetch(`/api/products/top-sellers?type=${pickType}`)).json(),
    staleTime: 10 * 60 * 1000,
  })
  const { data: usualData } = useQuery({
    queryKey: ['products', 'top-sellers', pickType, partyId],
    queryFn: async () => (await offlineFetch(`/api/products/top-sellers?type=${pickType}&partyId=${encodeURIComponent(partyId)}`)).json(),
    enabled: !!partyId,
    staleTime: 10 * 60 * 1000,
  })
  const liveOftenIds = useMemo(() => {
    const ranked = (topSellersData?.ids as string[] | undefined) ?? []
    // products: a bill just saved changes "recent"; re-read it when the list refreshes.
    return ranked.length ? ranked : getRecentProductIds()
  }, [topSellersData, products])
  const oftenRef = useRef<string[] | undefined>(undefined)
  const oftenIds = freezeWhileBillOpen(liveOftenIds, oftenRef.current, items.length > 0)
  oftenRef.current = oftenIds
  const usualIds: string[] = (partyId && (usualData?.ids as string[] | undefined)) || []
  // Phase 7a (#296): the app's ONE item search (lib/item-search.ts) — word starts in any
  // order, shop words, spelling slips, codes — ranked, with the shop's best sellers lifted
  // among equal matches. Every match is kept; the picker says "8 of N" when it shows fewer.
  const searchBoost = useMemo(() => {
    const ids = (topSellersData?.ids as string[] | undefined) ?? []
    return new Map(ids.map((id, i) => [id, 1 - i / Math.max(ids.length, 1)]))
  }, [topSellersData])
  // C12: a typed line keeps its amount out of the search — "toor 400" lists the toor rows — while
  // "parle 10" still finds the ₹10 packs. In a typed list the rows follow the line being typed.
  const typedOn = features?.billTypedAmounts !== false
  const listOn = features?.billListEntry !== false
  const searchText = listOn && isTypedList(productSearch) ? (splitTypedList(productSearch).slice(-1)[0] ?? '') : productSearch
  const productSearchResult = useMemo(() => {
    const full = itemSearch(products, searchText, { boost: searchBoost })
    if (!typedOn || (full.items.length && !full.close)) return full
    const line = parseTypedLine(searchText)
    const byName = line.name ? itemSearch(products, [line.name, ...line.sizes].join(' '), { boost: searchBoost }) : full
    return byName.items.length ? byName : full
  }, [products, searchText, searchBoost, typedOn])
  const filteredProducts = productSearchResult.items
  // Phase 6d: Pay opens one sheet; after saving, the Saved sheet offers Share / Print / Next bill (#145).
  const [paySheetOpen, setPaySheetOpen] = useState(false)
  const [savedBill, setSavedBill] = useState<SavedBill | null>(null)
  const [sharingBill, setSharingBill] = useState(false)

  // Check for preset data (from scanner, party profile, or repeat last sale)
  // Uses a small delay to ensure the component is fully mounted (it's lazy-loaded)
  useEffect(() => {
    const checkPreset = () => {
      const stored = (window as any).__ledgerPreset
      if (!stored) return

      // V17-Ext Tier 3: Credit notes come from the sale form, debit notes from purchase form.
      // The preset type may be 'credit-note' (when component type is 'sale') or
      // 'debit-note' (when component type is 'purchase'). Check both.
      const isMatchingPreset =
        stored.type === type ||
        (stored.type === 'credit-note' && type === 'sale') ||
        (stored.type === 'debit-note' && type === 'purchase')
      if (!isMatchingPreset) return

      // V17-Ext Tier 3: If preset is a credit/debit note, switch the actual type
      if (stored.type === 'credit-note' || stored.type === 'debit-note') {
        setActualType(stored.type)
        if (stored.data.noteType) {/* noteType is derived from actualType */}
        if (stored.data.noteReason) setNoteReason(stored.data.noteReason)
        if (stored.data.affectsStock) setAffectsStock(stored.data.affectsStock)
        if (stored.data.originalTransactionId) setOriginalTransactionId(stored.data.originalTransactionId)
      }

      // 🔒 R10b-2 (Phase 2b): Was: `localStorage.removeItem(KEY)` — wiped ALL
      // saved drafts for this form type when a preset arrived with items. A
      // shopkeeper with 5 in-progress sale drafts who taps "Repeat Last Sale"
      // lost all 5 with no warning. (Phase 7f: drafts are held bills, kept
      // until finished or discarded — use-drafts.ts MAX_HELD.) Now:
      // only clear the ACTIVE draft (so the new preset starts fresh), but
      // leave all other saved drafts intact.
      if (stored.data.items?.length > 0) {
        clearActive()
        refreshDrafts()
      }

      // 🔒 BUG-15 (Phase 6): Was: only read partyId — sellerName/partyName from
      // the scanner was silently dropped. Now: if no partyId but a name exists,
      // try to match against existing parties (same pattern as VoiceEntry).
      if (stored.data.partyId) {
        setPartyId(stored.data.partyId)
      } else {
        const sellerName = stored.data.sellerName || stored.data.partyName
        if (sellerName && allParties.length > 0) {
          const matched = allParties.find(p =>
            p.name?.toLowerCase().includes(sellerName.toLowerCase()) ||
            sellerName.toLowerCase().includes(p.name?.toLowerCase() || '')
          )
          if (matched) {
            setPartyId(matched.id)
          } else {
            // Pre-fill the party search so the user sees the extracted name
            setPartySearch(sellerName)
          }
        }
      }
      if (stored.data.invoiceNo) setInvoiceNo(stored.data.invoiceNo)
      if (stored.data.date) {
        try {
          const d = new Date(stored.data.date)
          if (!isNaN(d.getTime())) setDate(istDateString(d))
        } catch {}
      }
      if (stored.data.items?.length > 0) {
        const newItems = stored.data.items.map((item: any) => ({
          productId: item.productId || '',
          productName: item.name || item.productName || '',
          quantity: Number(item.quantity) || 1,
          unitPrice: Number(item.unitPrice) || 0,
          gstRate: Number(item.gstRate) || 0,
          unit: item.unit || 'pcs',
          // A preset built from a saved bill states its own GST setting (#130);
          // scanner / inventory presets leave it to lineIncludesGst().
          priceIncludesGst: typeof item.priceIncludesGst === 'boolean' ? item.priceIncludesGst : undefined,
        }))
        setItems(newItems)
        // Mark that form was filled by a preset — suppresses autosave
        // until the user manually modifies the form
        setPresetLoaded(true)
      }
      if (stored.data.totalAmount) setPaidAmount(String(stored.data.totalAmount))
      // 🔒 R10b-5 (Phase 3): Set presetLoaded=true for ANY non-empty preset,
      // not just ones with items. Party-only presets (from PartyProfile,
      // credit/debit note flows) carry partyId/originalTransactionId but no
      // items. Without this, the autosave effect fires immediately and creates
      // a spurious draft before the user types anything.
      if (stored.data.partyId || stored.data.originalTransactionId || (stored.data.items?.length ?? 0) > 0) {
        setPresetLoaded(true)
      }
      ;(window as any).__ledgerPreset = null
    }

    // 🔒 R10b-8 (Phase 6): Was: setTimeout(100ms) — served no purpose (useEffect
    // already runs after mount) and was fragile (if deps changed within 100ms,
    // the timer was cleared and the preset never loaded). Now: synchronous.
    checkPreset()
    setPresetChecked(true)
  }, [type, clearActive, refreshDrafts])

  const partyDropdownRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (partyDropdownRef.current && !partyDropdownRef.current.contains(e.target as Node)) {
        setPartyDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selectedParty = allParties.find(p => p.id === partyId)

  // 🔒 R10-1 (2026-07-22): mirror the SERVER's inter-state rule on screen.
  //
  // The bug this fixes: the screen showed a freely editable "Inter-state
  // (IGST)" switch. The server correctly ignores a client-supplied tax flag
  // (otherwise anyone could move tax between heads), so a shopkeeper who
  // flipped the switch saw IGST in the on-screen total and got CGST+SGST in
  // the saved bill. The printed invoice, the GSTR-1 return and the customer's
  // GSTR-2B then disagree, and the return is filed under the wrong heading.
  //
  // Same pure function the server calls, so the two cannot drift.
  const shopState: string | undefined = settingData?.setting?.state
  // Phase 2 (#118): state CODES, GSTIN first — "UP" and "Uttar Pradesh" are
  // one state, and a buyer with no state recorded is at the shop's own state
  // (IGST Act s.10(1)(ca)). Same supplyKind() the server and GSTR-1 use.
  //
  // Phase 2c (#114): a regular shop's sale or estimate can send the goods
  // elsewhere; the delivery state then decides the place of supply.
  const offersShipTo = showsGst && (actualType === 'sale' || actualType === 'estimate' || (actualType === 'credit-note' && !originalTransactionId))
  const deliveryInUse = offersShipTo && shipElsewhere
  const supplyPlaces = {
    shop: { gstin: settingData?.setting?.gstin, state: shopState },
    party: selectedParty ? { gstin: selectedParty.gstin, state: selectedParty.state } : null,
    delivery: deliveryInUse ? deliveryState : null,
    billToShipTo,
  }
  const derivedInterState = originalSupply
    ? { isInterState: originalSupply.isInterState, indeterminate: false, shopCode: stateCodeOf(supplyPlaces.shop), posCode: billPlaceOfSupply(originalSupply, supplyPlaces.shop) }
    : supplyKind(supplyPlaces)
  const shipCheck = deliveryCheck(supplyPlaces)
  const deliveryCode = deliveryInUse ? resolveStateCode(deliveryState) : null
  const buyerGstinCode = gstinStateCode(selectedParty?.gstin)
  // Ask only when it matters: a registered buyer, goods to another state than their GSTIN's.
  const asksShipTo = !!deliveryCode && !!buyerGstinCode && deliveryCode !== buyerGstinCode
  // #227 (6c-2): until "Who gets the goods" is answered the tax split is not known — the badge and the summary both wait.
  const taxSplitPending = asksShipTo && shipCheck.needsShipToChoice
  const compositionElsewhere = isOutwardDocument(actualType) && compositionInterStateBlocked(shopGstStatus, supplyPlaces)
  const partyHasNoState = !!selectedParty && !stateCodeOf({ gstin: selectedParty.gstin, state: selectedParty.state })
  // A changed customer is a new question — never carry the last answer over.
  useEffect(() => { setBillToShipTo(null) }, [partyId])
  useEffect(() => {
    if (actualType !== 'credit-note' || !originalTransactionId) { setOriginalSupply(null); return }
    let alive = true
    offlineFetch(`/api/transactions/${originalTransactionId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const t = data?.transaction
        if (!alive || !t) return
        setOriginalSupply({
          isInterState: !!t.isInterState,
          placeOfSupply: t.placeOfSupply ?? null,
          deliveryState: t.deliveryState ?? null,
          party: t.party ? { gstin: t.party.gstin, state: t.party.state } : null,
        })
      })
      .catch(() => { /* offline: the server still keeps the bill's tax head */ })
    return () => { alive = false }
  }, [actualType, originalTransactionId])

  /*
   * #91 — a registered buyer cannot take taxable and exempt items on ONE bill.
   *
   * Tax invoice for the taxable lines (Section 31(1)), bill of supply for the
   * rest (Section 31(3)(c)). Rule 46A permits a single combined document only
   * where the buyer is UNREGISTERED — which is most of a kirana's day, and is
   * why this is computed from the customer's GSTIN rather than warned on
   * every mixed basket.
   *
   * Recomputed as lines are added, which is free: a scan of the rows already
   * on screen.
   */
  const mixedSupply = useMemo(
    () => checkMixedSupply(
      items.map(i => ({ gstRate: Number(i.gstRate) || 0, gstTreatment: i.gstTreatment })),
      selectedParty?.gstin,
    ),
    [items, selectedParty?.gstin],
  )

  // The preview is what the shopkeeper checks before saving, so it has to
  // agree with what the server will store. Whenever the answer is knowable,
  // force the flag to the derived value — including over a restored draft or
  // a value the user set earlier while the party still had no state.
  useEffect(() => {
    if (!derivedInterState.indeterminate) {
      setIsInterState(prev => prev === derivedInterState.isInterState ? prev : derivedInterState.isInterState)
    }
  }, [derivedInterState.indeterminate, derivedInterState.isInterState])

  // 🔒 R10b-3 (Phase 3): markDirty — clears presetLoaded so autosave resumes.
  // Was: only handleAddProduct/handleUpdateItem/handleRemoveItem/handleLoadOriginalItems
  // called setPresetLoaded(false). After a preset loaded (Repeat Last Sale /
  // Scanner / Inventory), every OTHER edit — date, party, payment mode, paid
  // amount, discount, notes, note reason, affectsStock, cashRefund, invoiceNo
  // — left presetLoaded=true, so the autosave effect never ran. If the user
  // refreshed or closed the tab, all of those changes were lost silently.
  // Now: every input onChange calls markDirty() first.
  const markDirty = useCallback(() => { setPresetLoaded(false) }, [])

  /*
   * Ask before leaving a half-written sale.
   *
   * Autosave has already stored it, so nothing is at risk — what was missing
   * was the user KNOWING that. Backing out used to drop the screen in silence,
   * and recovering the work meant already knowing Drafts existed and that this
   * is where it went. Nothing said so.
   *
   * The prompt is therefore about location, not rescue: "it is in Drafts".
   * Offering a "Save" button would be theatre — the save has happened. Deleting
   * it is a separate, deliberate act and lives in the Drafts manager, where the
   * user can see what they are deleting.
   *
   * Not registered while saving: the navigation that follows a successful save
   * is ours, not the user's, and must not be interrupted.
   */
  useEffect(() => {
    if (items.length === 0 || saving) return
    return registerExitGuard(
      () =>
        new Promise<boolean>((resolve) => {
          leaveResolverRef.current = resolve
          setLeavePromptOpen(true)
        }),
    )
  }, [items.length, saving])

  /*
   * Three answers, because there are three.
   *
   * The first version offered Leave and Cancel — and BOTH kept the draft, so a
   * sale typed by mistake could only be got rid of by leaving, going to Drafts,
   * and deleting it there. Reported as "there is no option to discard".
   *
   * Keep editing / Discard / Keep draft are genuinely distinct intents, and a
   * two-button dialog cannot express three. Discard deletes the autosaved
   * draft before navigating, so the mistake leaves nothing behind.
   */
  const resolveLeave = (allow: boolean) => {
    setLeavePromptOpen(false)
    leaveResolverRef.current?.(allow)
    leaveResolverRef.current = null
  }

  const handleDiscardAndLeave = () => {
    if (activeDraftId) deleteDraft(activeDraftId)
    clearActive()
    resolveLeave(true)
  }

  // Phase 7f: "Hold bill" writes the bill at once — leaving inside the 600 ms
  // autosave pause used to drop the last change (the pending save was cancelled
  // on unmount). At MAX_HELD nothing could hold it, so the shop stays on it.
  const handleHoldAndLeave = () => {
    if (holdNow(draftData) === 'full') {
      sonnerToast.error(`${MAX_HELD} bills are on hold`, { description: 'Finish or discard one first.' })
      resolveLeave(false)
      return
    }
    resolveLeave(true)
  }


  const handleAddProduct = (product: any, qty = 1) => {
    // User manually added a product — clear presetLoaded so autosave resumes
    setPresetLoaded(false)
    /*
     * Adding a product by hand closes the voice panel.
     *
     * The two panels are chosen by whether the form has items, so leaving
     * "Voice Entry" open and then tapping + in the list SWAPPED it for "Add
     * More Items via Voice" — a different tool, with a different heading, that
     * the user never asked for and which simply appeared at the bottom of the
     * screen. Reported exactly that way.
     *
     * Closing is the honest response: the user has just answered the question
     * the panel was open to ask, and by hand. If they want to keep dictating,
     * the mic is one tap away and will now open the right panel for a form
     * that has items in it.
     */
    setShowVoiceEntry(false)
    // Check if product already in list
    const existing = items.find(i => i.productId === product.id)
    if (existing) {
      setItems(items.map(i =>
        i.productId === product.id
          ? { ...i, quantity: i.quantity + qty }
          : i
      ))
      // Phase 6c: on the Counter the tile's count and the bill line say it; a toast per tap is noise.
      if (!counterMode) sonnerToast.info(`Increased quantity of ${product.name}`)
    } else {
      setItems([...items, newLineFor(product, qty)])
    }
    setProductSearch('')
  }
  /** A product's new bill line — the one shape for a tap, the keypad bar and a weight button. */
  const newLineFor = (product: any, qty: number): ItemRow => ({
    productId: product.id,
    productName: product.name,
    quantity: qty,
    // #175: a non-claiming shop's saved cost includes GST — take it out
    // before pre-filling the supplier's rate (purchaseRateFromCost).
    unitPrice: isSale ? product.salePrice : purchaseRateFromCost(product, { claimsItc: canClaimGst }),
    gstRate: product.gstRate,
    gstTreatment: product.gstTreatment ?? null,
    unit: product.unit,
  })
  /** Step 2b (C11): the keypad bar sets a quantity outright (0 takes the line off). */
  const setQtyFor = (product: any, q: number) => {
    setPresetLoaded(false)
    setItems((now) => {
      const at = now.findIndex((x) => x.productId === product.id)
      if (q <= 0) return at < 0 ? now : now.filter((_, k) => k !== at)
      if (at >= 0) return now.map((x, k) => (k === at ? { ...x, quantity: q } : x))
      return [...now, newLineFor(product, q)]
    })
  }
  /** Step 2b: a new price for this sale from the keypad bar (the bar refuses above-MRP first). */
  const setPriceFor = (product: any, price: number) => {
    setPresetLoaded(false)
    setItems((now) => (now.some((x) => x.productId === product.id)
      ? now.map((x) => (x.productId === product.id ? { ...x, unitPrice: price } : x))
      : [...now, { ...newLineFor(product, 1), unitPrice: price }]))
  }

  /**
   * Take one off a product's quantity from the PICKER, dropping the line when
   * it reaches zero.
   *
   * The picker previously offered no way down. Once a product was in the sale
   * it showed a static "✓ Added" badge — a statement, not a control — so the
   * only way to correct an over-tap was to hunt for the line further down the
   * form. And because the badge replaced the "+", nothing suggested you could
   * add a second one either. Reported exactly that way: "how does the user
   * know he has to click the added".
   */
  const handleDecrementProduct = (productId: string) => {
    setPresetLoaded(false)
    const existing = items.find(i => i.productId === productId)
    if (!existing) return
    if (existing.quantity <= 1) {
      setItems(items.filter(i => i.productId !== productId))
    } else {
      setItems(items.map(i =>
        i.productId === productId ? { ...i, quantity: i.quantity - 1 } : i
      ))
    }
  }

  const handleUpdateItem = (index: number, field: keyof ItemRow, value: any) => {
    setPresetLoaded(false) // User manually edited — resume autosave
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
  }

  const handleRemoveItem = (index: number) => {
    setPresetLoaded(false) // User manually removed — resume autosave
    const removed = items[index]
    setItems(items.filter((_, i) => i !== index))
    setByAmount(null)
    // Phase 7e: a wrong tap on ✕ is one tap to put right — the line comes back where it was.
    if (removed) {
      sonnerToast(`${removed.productName} removed`, {
        action: { label: 'Undo', onClick: () => setItems((now) => [...now.slice(0, index), removed, ...now.slice(index)]) },
        duration: 6000,
      })
    }
  }

  /*
   * Phase 7e — loose goods by rupees ("₹50 of sugar" at ₹44 a kg = 1.136 kg):
   * the line's quantity from what the customer pays, by the bill's own price
   * rule (lib/loose-amount.ts). The line then shows what it comes to (₹49.98).
   */
  const [byAmount, setByAmount] = useState<{ line: number; value: string } | null>(null)
  const setLineByAmount = (index: number, value: string) => {
    setByAmount({ line: index, value })
    const item = items[index]
    if (!item) return
    const p = item.productId ? productMap.get(item.productId) : null
    const q = quantityForAmount(
      parseFloat(value) || 0,
      { unitPrice: Number(item.unitPrice) || 0, gstRate: Number(item.gstRate) || 0, priceIncludesGst: lineIncludesGst(item, p), unit: item.unit },
      p?.unit,
      { chargesGst: shopChargesGst },
    )
    if (q !== null) handleUpdateItem(index, 'quantity', q)
  }
  /** Phase 7e: one tap from "above MRP" to the MRP — an MRP includes GST, so the line does too. */
  const sellAtMrp = (index: number, mrp: number) => {
    setPresetLoaded(false)
    setItems((now) => now.map((it, i) => (i === index ? { ...it, unitPrice: mrp, priceIncludesGst: true } : it)))
  }

  // V17 Audit §1: Load items from the original sale when creating a credit note.
  // The form starts BLANK (partial returns are the common case). This button lets
  // the user pull in ALL items from the original sale for full returns — they then
  // adjust quantities or delete non-returned items. Fetches the original transaction
  // by ID and maps its items to the ItemRow shape.
  const [loadingOriginal, setLoadingOriginal] = useState(false)
  /*
   * Phase 7c-2 (from 6e, now for every bill) — ONE add step: a picker row, a
   * search pick, a gun scan and the camera all come here. Quantity first ("6,
   * then tap or scan"); on a sale, price check shows price, MRP and stock and
   * adds nothing.
   */
  // Step 2c (C11): Qty first — an amount with its unit (× 23, 400 g, ₹50) for the next item tapped or scanned.
  const [next, setNext] = useState<NextQty | null>(null)
  const [nextErr, setNextErr] = useState('')
  const [qtyOpen, setQtyOpen] = useState(false)
  const [priceCheck, setPriceCheck] = useState(false)
  // C12: the bill screen's switches, changed from ⚙ on this screen (lib/bill-screen-settings.ts).
  const voiceOn = features?.voiceEntry !== false
  const scanBillOn = features?.aiScanner !== false
  const qtyButtonOn = features?.billQtyButton !== false
  const priceCheckOn = isSale && features?.billPriceCheck !== false
  // In the store, not here: on a phone ⚙ sits in the app's top bar (Header.tsx), beside the mic.
  const billSettingsOpen = useAppStore((s) => s.billSettingsOpen)
  const setBillSettingsOpen = useAppStore((s) => s.setBillSettingsOpen)
  // Leaving the bill screen never leaves the sheet open for the next visit.
  useEffect(() => () => setBillSettingsOpen(false), [setBillSettingsOpen])
  const switchesRef = useRef({ qtyButtonOn, priceCheckOn })
  switchesRef.current = { qtyButtonOn, priceCheckOn }
  // A switch turned off while its tool is in use puts the tool away: nothing hidden stays active.
  useEffect(() => { if (!priceCheckOn) setPriceCheck(false) }, [priceCheckOn])
  useEffect(() => { if (!qtyButtonOn) { setQtyOpen(false); setNext(null) } }, [qtyButtonOn])
  useEffect(() => { if (!voiceOn) setShowVoiceEntry(false) }, [voiceOn])
  // Step 2b: the keypad bar for one row (✎, or a loose good's amount); closes when ✎ is switched off.
  const [kb, setKb] = useState<KeypadRow | null>(null)
  // Step 2d: typed lines the bill was not sure of, waiting as cards (Save waits for them).
  const [checks, setChecks] = useState<TypedCheck[]>([])
  const checkSeq = useRef(0)
  // A new item from a typed line or an empty search; checkId closes its card once saved.
  const [newItemFor, setNewItemFor] = useState<{ name: string; checkId: number | null } | null>(null)
  // C11 "Not in list": a one-off line (a shop that charges no GST; a GST shop adds the item).
  const [oneOff, setOneOff] = useState<{ name: string; checkId: number | null } | null>(null)
  const pencilOn = features?.billPencil !== false
  const notInListOn = features?.billNotInList !== false
  const oneOffOn = notInListOn && !shopChargesGst
  useEffect(() => { if (!pencilOn) setKb(null) }, [pencilOn])
  const [checkedProduct, setCheckedProduct] = useState<any | null>(null)
  const [unknownCode, setUnknownCode] = useState<string | null>(null)
  const [newItemCode, setNewItemCode] = useState<string | null>(null)
  const pickAdd = (p: any) => {
    if (priceCheck && isSale) { setCheckedProduct(p); return }
    if (next) { addWithNext(p); return }
    handleAddProduct(p, 1)
  }
  /** The waiting Qty goes on the tapped item in its unit — or says why it cannot, and keeps waiting. */
  const addWithNext = (p: any) => {
    if (!next) return
    const r = nextQtyFor(next, p.unit, features?.billGramsRule !== false, (rupees) => kbQtyForRupees(p, rupees))
    if ('error' in r) { setNextErr(`${r.error}: ${nextLabel(next)} on ${p.name}`); return }
    handleAddProduct(p, r.qty)
    setNext(null); setNextErr(''); setQtyOpen(false)
  }
  // An unknown barcode asks "New item?" instead of leaving a number in the search box.
  const handleScannedCode = (code: string) => {
    const match = findProductByScannedCode(products, code)
    if (match) pickAdd(match)
    else setUnknownCode(code)
  }
  const scanBufferRef = useRef(createScanBuffer())
  const handleScannedRef = useRef(handleScannedCode)
  handleScannedRef.current = handleScannedCode
  const itemCountRef = useRef(0)
  itemCountRef.current = items.length
  // F10: Pay on a plain sale (the Pay sheet), Save on every other bill — the same as tapping it.
  const finishRef = useRef<() => void>(() => {})
  // F8 (7f): hold this bill and start the next one — the same as tapping Hold.
  const holdRef = useRef<() => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      const sheetOpen = !!document.querySelector('[role=dialog]')
      // The bill's keys (final plan §5) work while typing too; never under an open sheet.
      if (!sheetOpen && /^F(2|3|4|6|8|10)$/.test(e.key)) {
        e.preventDefault()
        if (e.key === 'F2') document.getElementById('field-search-product')?.focus()
        else if (e.key === 'F3') document.getElementById('field-party-search')?.focus()
        else if (e.key === 'F4' && switchesRef.current.qtyButtonOn) { setKb(null); setQtyOpen(true) }
        else if (e.key === 'F6' && switchesRef.current.priceCheckOn) setPriceCheck((v) => !v)
        else if (e.key === 'F8' && itemCountRef.current > 0) holdRef.current()
        else if (e.key === 'F10' && itemCountRef.current > 0) finishRef.current()
        return
      }
      // A barcode gun works anywhere a text box does not have the cursor (lib/scanner-burst.ts).
      if (typing || sheetOpen || e.ctrlKey || e.metaKey || e.altKey) { scanBufferRef.current.reset(); return }
      const code = scanBufferRef.current.push(e.key, e.timeStamp)
      if (code) { e.preventDefault(); handleScannedRef.current(code) }
    }
    // Esc with a bill open (capture, so it runs before the app's Escape = go back): clears the
    // search, the quantity or price check — it never leaves the bill. A sheet takes its own Esc
    // first; the app's shortcut skips an Escape already handled (escapeIsOurs).
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role=dialog]') || itemCountRef.current === 0) return
      e.preventDefault()
      setProductSearch('')
      setNext(null)
      setNextErr('')
      setQtyOpen(false)
      setPriceCheck(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keydown', onEscape, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', onEscape, true)
    }
  }, [isSale])
  const handleLoadOriginalItems = async () => {
    if (!originalTransactionId) return
    setLoadingOriginal(true)
    try {
      const r = await offlineFetch(`/api/transactions/${originalTransactionId}`)
      if (!r.ok) throw new Error(await readError(r))
      const data = await r.json()
      const originalItems = data.transaction?.items || []
      if (originalItems.length === 0) {
        sonnerToast.info('The original sale has no items to load.')
        setLoadingOriginal(false)
        return
      }
      setPresetLoaded(false) // resume autosave — user is making changes
      setItems(originalItems.map((item: any) => ({
        productId: item.productId || '',
        productName: item.productName || '',
        // 🔒 V17 Audit Phase 10: Use enteredQuantity/enteredUnit if available
        // (preserves the user's original input like "500ml" instead of "0.5ltr")
        quantity: item.enteredQuantity ?? item.quantity ?? 1,
        ...refillPrice(item),
        gstRate: item.gstRate || 0,
        unit: item.enteredUnit ?? item.unit ?? 'pcs',
        discountAmount: 0,
      })))
      sonnerToast.success(`Loaded ${originalItems.length} item${originalItems.length !== 1 ? 's' : ''} from the original sale`)
    } catch (e: any) {
      sonnerToast.error(e?.message || "Couldn\'t load items from the original sale")
    } finally {
      setLoadingOriginal(false)
    }
  }

  // Totals — 🔒 V12: Use the SAME computeLineItems() the server uses. Because
  // line-items.ts is pure (no DB), importing it here guarantees the preview the
  // shopkeeper sees EXACTLY matches what the server will store — including unit
  // normalization (500 gm on a ₹20/kg product → 0.5 kg × ₹20 = ₹10) and
  // GST-inclusive (MRP) back-calculation. Single source of truth, no drift.
  const totalDiscount = parseFloat(discountAmount) || 0
  // One rule for a line's "price includes GST", used by the preview AND the
  // save (#130, #135) — see resolveLineIncludesGst().
  const lineIncludesGst = (item: ItemRow, p: any): boolean =>
    resolveLineIncludesGst({
      lineFlag: item.priceIncludesGst,
      isPurchaseSide,
      purchaseRatesIncludeGst,
      productFlag: p?.priceIncludesGst,
    })
  // Step 2b (C11): the keypad bar works on a product's line by the bill's own rules —
  // its price, what the customer pays (lineIncludesGst), ₹ → quantity (loose-amount.ts)
  // and the printed MRP (lineAboveMrp, the same rule Save and the server apply).
  const lineOf = (product: any): ItemRow => items.find((x) => x.productId === product.id) ?? newLineFor(product, 0)
  const kbPriceOf = (product: any) => Number(lineOf(product).unitPrice) || 0
  const kbPaysAt = (product: any, price: number) =>
    customerPaysPerUnit({ salePrice: price, gstRate: Number(product.gstRate) || 0, priceIncludesGst: lineIncludesGst(lineOf(product), product) }, { chargesGst: shopChargesGst })
  const kbQtyForRupees = (product: any, rupees: number) => {
    const line = lineOf(product)
    return quantityForAmount(rupees, { unitPrice: Number(line.unitPrice) || 0, gstRate: Number(line.gstRate) || 0, priceIncludesGst: lineIncludesGst(line, product), unit: line.unit }, product.unit, { chargesGst: shopChargesGst })
  }
  // Step 2d (C12): Enter on a typed line or list — straight on when certain (lib/typed-pick.ts), a card when not.
  const learnedPicks = useAppStore((s) => s.learnedPicks)
  const setLearnedPicks = useAppStore((s) => s.setLearnedPicks)
  const learnOn = features?.billLearnPicks !== false
  const pickTyped = (text: string) => pickTypedLine(text, {
    search: (q) => itemSearch(products, q, { boost: searchBoost, nameOnly: true }),
    gramsRule: features?.billGramsRule !== false,
    rupeesToQty: (p, rupees) => kbQtyForRupees(p, rupees),
    learned: learnOn ? (k) => learnedId(learnedPicks, k) : undefined,
  })
  /** "400 g · ₹56", "× 3 · ₹30": what a typed choice puts on the bill. */
  const describeQty = (product: any, qty: number) =>
    `${isLooseUnit(product.unit) ? looseLabel(qty, product.unit) : `× ${qty}`} · ${formatINR(qty * kbPaysAt(product, kbPriceOf(product)))}`
  const addQtyNow = (product: any, q: number) => setItems((now) => {
    const at = now.findIndex((x) => x.productId === product.id)
    if (at >= 0) return now.map((x, k) => (k === at ? { ...x, quantity: x.quantity + q } : x))
    return [...now, newLineFor(product, q)]
  })
  /** Did the typed path take this Enter? A plain name or a barcode is left to the old path. */
  const enterTyped = (text: string): boolean => {
    if (priceCheck && isSale) return false
    const parts = listOn && isTypedList(text) ? splitTypedList(text) : [text]
    if (parts.length === 1) {
      const line = parseTypedLine(parts[0])
      if (!typedOn || !line.name || (line.amount === null && line.tail === null && line.count === null)) return false
    }
    setPresetLoaded(false)
    setShowVoiceEntry(false)
    const asked: TypedCheck[] = []
    let added = 0
    for (const part of parts) {
      const r = pickTyped(part)
      if (r.kind === 'add') { addQtyNow(r.product, r.qty); added++ }
      else if (r.kind === 'ask') asked.push({ id: ++checkSeq.current, said: r.said, key: r.key, choices: r.choices, more: r.more })
    }
    if (asked.length) setChecks((c) => [...c, ...asked])
    if (parts.length > 1) sonnerToast.info(`${added} added${asked.length ? ` · ${asked.length} to check on the bill` : ''}`)
    setProductSearch('')
    return true
  }
  /** What Enter will do, said under the search while typing. */
  const typedHint = (() => {
    const t = productSearch.trim()
    if (!t || (priceCheck && isSale)) return null
    if (listOn && isTypedList(t)) {
      const rs = splitTypedList(t).map(pickTyped)
      const asks = rs.filter((r) => r.kind === 'ask').length
      return `Enter adds ${rs.filter((r) => r.kind === 'add').length} of ${rs.length}${asks ? ` · ${asks} to check on the bill` : ''}`
    }
    const line = parseTypedLine(t)
    if (!typedOn || !line.name || (line.amount === null && line.tail === null && line.count === null)) return null
    const r = pickTyped(t)
    if (r.kind === 'add') return `Enter adds ${isLooseUnit(r.product.unit) ? `${looseLabel(r.qty, r.product.unit)} of` : `${r.qty} ×`} ${r.product.name}${r.learned ? ' (learned)' : ''}`
    return r.kind === 'ask' ? 'Not sure which · Enter puts it on the bill to check' : null
  })()
  const kbPriceProblem = (product: any, price: number) => {
    if (actualType !== 'sale') return null
    const line = lineOf(product)
    return lineAboveMrp({ unitPrice: price, gstRate: Number(line.gstRate) || 0, priceIncludesGst: lineIncludesGst(line, product) }, product, { chargesGst: shopChargesGst }) !== null
      ? `Above the printed MRP ${formatINR(Number(product.mrp))} — not allowed`
      : null
  }
  // Phase 7f: the same reading of a line as every held bill's total (lib/bill-total.ts, #187).
  const computeInput = entryLineInputs(items, productMap, { isPurchaseSide, purchaseRatesIncludeGst })
  const preview = computeLineItems({
    items: computeInput,
    productMap,
    isInterState,
    orderDiscount: totalDiscount,
    // 🔒 AUDIT V25 FIX BUG-030 (Batch 5): Was passing `type` (the prop, always
    // 'sale' or 'purchase'). When entering a credit/debit note, `actualType`
    // is 'credit-note'/'debit-note' but `type` is still 'sale'/'purchase'.
    // computeLineItems uses the type to decide profit sign — credit notes
    // should compute NEGATIVE profit (reversal). Passing `type` meant the
    // preview showed positive green "Gross Profit ₹90" for a ₹300 credit note,
    // which is profit being REVERSED, not earned. Now passes `actualType` so
    // the preview matches the server's stored sign.
    type: actualType,
    // #165: same rule as the server — a shop that may not collect tax puts no
    // GST on its own bills. Without it the preview showed GST the server then
    // removed, so the total on screen was not the total saved.
    chargesGst: shopChargesGst,
  })
  const subtotal = preview.subtotal
  const totalGst = roundMoney(preview.cgst + preview.sgst + preview.igst)

  /*
   * Which products this bill would re-cost, and by how much.
   *
   * Compares each line's TAXABLE price per the product's unit against the cost
   * currently stored on the product — the same two numbers the profit
   * calculation subtracts, so they are on the same basis by construction.
   *
   * Only shown when something actually differs. A bill at the usual prices
   * should say nothing at all; a panel that appears on every purchase to report
   * "no change" is a panel people stop reading.
   */
  const costChanges = useMemo(() => {
    if (isSale || isNote) return []
    // #175: same rule as the server's cost update (purchaseCostPerUnit) — the
    // GST is part of the cost when the shop cannot claim it back.
    const claimsItc = claimsInputCredit(shopGstStatus) && !itcBlockedReason
    const seen = new Map<string, { name: string; unit: string; from: number; to: number }>()
    for (const line of preview.txItems) {
      if (!line.productId || !(line.unitPrice > 0)) continue
      const product = products.find((p: any) => p.id === line.productId)
      if (!product) continue
      const from = roundMoney(product.purchasePrice || 0)
      const to = purchaseCostPerUnit(line, { claimsItc })
      if (Math.abs(to - from) < 0.01) continue
      // Last line wins, matching what the server will store.
      seen.set(line.productId, { name: product.name, unit: line.unit, from, to })
    }
    return [...seen.entries()].map(([productId, v]) => ({ productId, ...v }))
  }, [preview.txItems, products, isSale, isNote, shopGstStatus, itcBlockedReason])
  // 🔒 BUG-11 (Phase 6): Was: computed unconditionally even when hideProfit.
  // For staff with hideProfit, purchasePrice is stripped from /api/products,
  // so cost=0 → whole sale = profit (wrong value in memory). Now: skip the
  // calc entirely when hideProfit is true.
  const totalProfit = hideProfit ? 0 : preview.grossProfit
  // #134: margin on the value BEFORE GST (the GST is not the shop's), the
  // same basis as the product form and inventory (lib/unit-profit.ts).
  const taxableTotal = preview.txItems.reduce((s, l) => s + lineTaxable(l), 0)
  // Rule 46(e): what a ₹50,000+ bill to a buyer with no GST number still lacks.
  const rule46e = rule46eMissing({ taxableValue: taxableTotal, party: selectedParty ?? null, deliveryState: deliveryCode ? deliveryState : null })
  // On a phone Details is folded; a legal warning must not hide behind it.
  const detailsWarn = compositionElsewhere || (showsGst && actualType === 'sale' && rule46e.length > 0)
  useEffect(() => { if (detailsWarn) setDetailsOpen(true) }, [detailsWarn])
  // #254: lines with no cost price book no profit, so the margin is over the lines that have one.
  const noCostTaxable = preview.txItems.reduce((s, l) => s + (isNoCostLine(l) ? lineTaxable(l) : 0), 0)
  const marginPct = (amount: number) => marginOnCosted(amount, taxableTotal, noCostTaxable) ?? 0
  // 🔒 FIX C5: Apply round-off on the client too, so the preview matches the
  // server exactly. Was: `totalAmount = preview.totalBeforeRoundOff` — the
  // client used the pre-round-off total, but the server applied round-off.
  // When the user left "Paid Amount" empty (meaning "full payment"), the
  // client sent the pre-round-off total as paidAmount, but the server stored
  // the post-round-off total as totalAmount → phantom due (e.g., ₹0.50).
  // Now: the client computes the same round-off as the server, so the preview
  // total matches the stored total.
  const roundOffEnabled = settingData?.setting?.roundOffEnabled ?? false
  const totalAmount = billTotalAfterRoundOff(preview.totalBeforeRoundOff, roundOffEnabled)
  const cgst = preview.cgst
  const sgst = preview.sgst
  const igst = preview.igst
  // Per-row computed lines (normalized quantity/unit + line total) for display.
  const previewLines = preview.txItems
  const paid = parseFloat(paidAmount) || 0
  // 🔒 AUDIT V24 §1: For notes, "paid" = cash refunded (0 unless the refund
  // toggle is ON). For sales/purchases, empty = full payment (unchanged).
  const finalPaid = isNote
    ? (cashRefundOn ? (paidAmount === '' ? totalAmount : paid) : 0)
    : (paidAmount === '' ? totalAmount : paid)
  const due = roundMoney(totalAmount - finalPaid)

  // 🔒 V11 STOCK POLICY: Live stock check per cart item. Computes which items
  // would push stock below 0 (using the same normalizeToUnit logic as the server).
  // Used to:
  //   - Show inline warnings next to the quantity input (red text)
  //   - Disable the Save button in 'block' mode (with a clear message)
  //
  // 🔒 R10b-1 (Phase 2b): Was `if (type !== 'sale') return []` — but credit
  // notes use type='sale' (actualType is 'credit-note'), so the check ran and
  // computed resultingStock = currentStock - qty. A credit note with
  // affectsStock=true INCREMENTS stock (customer return), so the warning is
  // wrong — it blocks legitimate returns. And debit notes (type='purchase')
  // skipped the check entirely, so a debit note that pushes stock negative
  // got no warning. Now: gate on actualType + affectsStock direction.
  const liveStockWarnings = useMemo(() => {
    // Only warn for stock-decrementing transactions: regular sales and
    // debit-notes with affectsStock=true. Credit notes ADD stock (returns),
    // so they can never push it negative. Purchases ADD stock too.
    const shouldCheckStock = (actualType === 'sale')
      || (actualType === 'debit-note' && affectsStock)
    if (!shouldCheckStock) return []
    const warnings: Array<{
      itemIndex: number
      productName: string
      currentStock: number
      requestedQty: number
      resultingStock: number
    }> = []
    items.forEach((item, i) => {
      if (!item.productId) return
      const product = productMap.get(item.productId)
      if (!product) return
      // A service has no stock to run out of. This must mirror the server
      // exactly (POST /api/transactions skips the same rows): if the screen
      // warned where the server does not, the tailor would see a red "Not
      // enough stock" and a disabled Save on a bill that would have saved.
      if (!tracksStock(product)) return
      // Normalize the entered quantity into the product's unit (e.g., 500 gm → 0.5 kg)
      const enteredQty = Number(item.quantity) || 0
      const requestedQty = product.unit
        ? normalizeToUnit(enteredQty, item.unit || product.unit, product.unit).quantity
        : enteredQty
      const resultingStock = roundMoney(product.currentStock - requestedQty)
      if (resultingStock < 0) {
        warnings.push({
          itemIndex: i,
          productName: product.name,
          currentStock: product.currentStock,
          requestedQty,
          resultingStock,
        })
      }
    })
    return warnings
  }, [items, productMap, actualType, affectsStock])

  // In 'block' mode, the Save button is disabled if any item would go negative.
  const hasStockBlock = stockPolicy === 'block' && liveStockWarnings.length > 0
  // Phase 7e: no sale above the printed MRP — shown on the line, Save waits. The
  // server refuses the same lines (lib/unit-profit.ts linesAboveMrp, one rule).
  const mrpOver = actualType === 'sale'
    ? linesAboveMrp(computeInput, (id) => productMap.get(id), { chargesGst: shopChargesGst })
    : []
  const hasMrpBlock = mrpOver.length > 0
  // C12: a typed line still waiting as a card is not on the bill yet — Save waits, nothing is dropped silently.
  const hasChecks = checks.length > 0
  const saveBlocked = hasStockBlock || hasMrpBlock || hasChecks

  const handleSave = async (payOpts?: { paymentMode?: string; paidAmount?: string; given?: number | null }) => {
    // Phase 6d: the Counter's Pay sheet passes its choice here; the form's own fields otherwise.
    // (Setting state and then reading it in the same tap would read the old values.)
    const pm = payOpts?.paymentMode ?? paymentMode
    const pa = payOpts?.paidAmount ?? paidAmount
    const paidNum = parseFloat(pa) || 0
    // Set when an estimate is saved; shown once the screen has moved on.
    let estimateToast: (() => void) | null = null
    // What the Counter's Saved sheet shows; and how long the old screens wait before leaving (stock warning).
    let savedInfo: SavedBill | null = null
    let leaveAfterMs = 0
    if (items.length === 0) {
      sonnerToast.error('Add at least one item')
      return
    }
    // 🔒 AUDIT V25 FIX §6.2 (Batch 7): Credit/debit notes require a party.
    // A return without a party can't reduce any balance — it's a silent no-op.
    // Block early on the client so the user gets immediate feedback.
    // The old copy here sent walk-in returns to a stock adjustment, which
    // does not reduce output GST — so the shop paid tax on a sale that came
    // back. See the note in app/api/transactions/route.ts. Point at the
    // action that is actually correct instead.
    // #276 (Phase 6b): a CREDIT note with no customer is a counter return — the server files it under
    // the shop's Walk-in Customer (lib/walk-in-party.ts) and matches it to a walk-in bill
    // (note-validation notePartiesMatch). Refusing it here made every walk-in return impossible.
    if (isDebitNote && !partyId) {
      sonnerToast.error('Add a customer to this return', {
        description: 'Pick the customer above, or add them in one tap. Recording it as a stock adjustment instead would change your stock but not your GST — you would pay tax on a sale that came back.',
        duration: 8000,
      })
      document.getElementById('field-party-search')?.focus()
      return
    }
    /*
     * A purchase with no supplier bill number can never be matched to GSTR-2B,
     * and since Rule 36(4) changed on 1 Jan 2022 that is the only lawful route
     * to input tax credit. Left blank, the API assigns PUR-0001 — our number
     * for their document — so the record LOOKS complete while being unusable
     * for the one thing it is needed for.
     *
     * Asked, not blocked. A shopkeeper entering a bill from memory, or a cash
     * purchase from an unregistered seller, genuinely may not have a number,
     * and refusing to save would be worse than saving something imperfect. The
     * point is that they find out now, while the bill is still in their hand,
     * rather than at filing time.
     */
    // Phase 2c (#114): the place of supply is decided, never assumed.
    if (deliveryInUse && !deliveryCode) {
      sonnerToast.error('Choose the state the goods are going to.')
      document.getElementById('field-delivery-state')?.focus()
      return
    }
    if (shipCheck.needsShipToChoice) {
      sonnerToast.error('Choose who gets the goods — the buyer or the buyer’s customer.')
      document.getElementById('field-ship-to-choice')?.scrollIntoView({ block: 'center' })
      return
    }
    if (!isSale && !isNote && canClaimGst && !invoiceNo.trim()) {
      const proceed = await confirmSave(
        'Without it, this purchase cannot be matched to your GSTR-2B, so you may not be able to claim the GST back on it.',
        { title: 'Save without the supplier’s bill number?', confirmLabel: 'Save anyway', destructive: false },
      )
      if (!proceed) {
        document.getElementById('field-supplier-bill-no')?.focus()
        return
      }
    }
    // 🔒 V11 STOCK POLICY: Block save if stock would go negative (block mode).
    // The Save button is also disabled, but the user might press Enter to save.
    if (hasStockBlock) {
      const lines = liveStockWarnings.map(w =>
        `• ${w.productName}: have ${w.currentStock}, selling ${w.requestedQty}`
      ).join('\n')
      sonnerToast.error('Not enough stock', {
        description: `${lines}\n\nRecord a purchase first, or enable "Allow overselling" in Settings.`,
        duration: 8000,
      })
      return
    }
    if (hasMrpBlock) {
      sonnerToast.error('Price above MRP', {
        description: mrpOver.map((m) => `• ${m.name}: ${formatINR(m.pays)} each, MRP ${formatINR(m.mrp)}`).join('\n'),
        duration: 8000,
      })
      return
    }
    // Phase 5c-2: the server's rule (lib/paid-amount.ts) before saving — and before
    // an offline sale is queued, which would otherwise fail later at sync.
    const paidAsSaved = pa === '' ? (pm === 'credit' ? 0 : totalAmount) : paidNum
    if (owedByNobody(actualType, partyId, totalAmount, paidAsSaved)) {
      sonnerToast.error(owedByNobodyMessage(actualType))
      document.getElementById('field-party-search')?.focus()
      return
    }
    setSaving(true)
    try {
      const r = await offlineFetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: actualType,  // 🔒 Feature Phase 3: sends 'estimate' when in estimateMode
          partyId: partyId || null,
          /*
           * Send a real clock time when the entry is for TODAY.
           *
           * The date picker yields "2026-08-06", which the server turns into
           * midnight UTC — and midnight UTC read back in IST is 05:30, which is
           * why every row in the ledger used to claim it happened at half past
           * five in the morning.
           *
           * For a same-day entry the moment of entry IS the moment of the sale,
           * near enough for a shop, so we record it. For a BACKDATED entry we
           * genuinely do not know what time it happened, so the date-only value
           * stands and the UI shows no time rather than inventing one.
           */
          date: date === istDateString(new Date())
            ? new Date().toISOString()
            : date,
          invoiceNo: invoiceNo || null,
          isInterState,
          // Phase 2c (#114): only when the shop said the goods go elsewhere.
          deliveryState: deliveryCode ? deliveryState : null,
          deliveryAddress: deliveryCode ? (deliveryAddress.trim() || null) : null,
          billToShipTo: deliveryCode ? billToShipTo : null,
          // Purchases only; the server also enforces that (see the route).
          isReverseCharge: !isSale && !isNote ? isReverseCharge : false,
          itcBlockedReason: !isSale && !isNote ? (itcBlockedReason || null) : null,
          // Only meaningful on a purchase, and only when something differs.
          updateProductCosts: !isSale && !isNote && costChanges.length > 0 && updateProductCosts,
          paymentMode: estimateMode ? 'cash' : pm,  // Estimates don't have payment
          // 🔒 AUDIT V24 §1: Notes ALWAYS send an explicit paidAmount (cash
          // refunded): 0 when the refund toggle is off (khata adjustment — the
          // common case), the entered refund (or the full total) when on. The
          // server defaults a missing note paidAmount to 0, so "full refund with
          // empty field" must be sent explicitly (the server's ₹1 snap absorbs
          // any round-off residue). Sales/purchases keep "empty = full payment".
          paidAmount: isNote
            ? (cashRefundOn ? (paidAmount === '' ? totalAmount : Number(paidAmount)) : 0)
            : (pa === '' ? undefined : Number(pa)),
          discountAmount: totalDiscount,
          notes,
          // V17-Ext Tier 3: Credit/Debit Note fields
          originalTransactionId: originalTransactionId || undefined,
          noteType: isCreditNote ? 'C' : isDebitNote ? 'D' : undefined,
          noteReason: noteReason || undefined,
          affectsStock: affectsStock || undefined,
          items: items.map((i, idx) => {
            const p = i.productId ? productMap.get(i.productId) : null
            return {
              productId: i.productId || null,
              productName: i.productName,
              quantity: Number(i.quantity),
              unitPrice: Number(i.unitPrice),
              gstRate: Number(i.gstRate) || 0,
              discountAmount: 0,
              // 🔒 V12: send the unit + GST-inclusive flag so the server can
              // normalize the quantity into the product's unit and back-
              // calculate the taxable price for MRP-priced goods.
              unit: i.unit || p?.unit || 'pcs',
              priceIncludesGst: lineIncludesGst(i, p),
              // 📄 Phase 5 — typed and validated on the server against the
              // shop's own definitions; this only carries what was typed.
              customCols: itemFields[idx] || undefined,
            }
          }),
          customFields: billDefs.length ? billFields : undefined,
        }),
        offline: { invalidate: ['/api/transactions', '/api/dashboard', '/api/products', '/api/parties', '/api/insights'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      if (isQueuedResponse(r)) {
        if (counterMode) {
          savedInfo = { id: null, invoiceNo: null, total: totalAmount, change: null, offline: true }
        } else {
          sonnerToast.info(`${isNote ? (isCreditNote ? 'Credit Note' : 'Debit Note') : estimateMode ? 'Estimate' : (isSale ? 'Sale' : 'Purchase')} saved offline — will sync when online`, {
            icon: '☁️',
            description: 'Not yet sent to server. Will sync automatically when online.',
          })
        }
      } else {
        const data = await r.json()
        if (counterMode) {
          const saved = data.transaction ?? data
          const given = payOpts?.given ?? null
          savedInfo = {
            id: saved?.id ?? null,
            invoiceNo: saved?.invoiceNo ?? null,
            total: roundMoney(saved?.totalAmount ?? totalAmount),
            change: given !== null && changeFor(saved?.totalAmount ?? totalAmount, given) > 0 ? changeFor(saved?.totalAmount ?? totalAmount, given) : null,
            offline: false,
          }
        }
        // 🔒 V26 Phase 6 §2.2: Differentiate money-success toasts — include
        // amount + party. Was: "Sale recorded successfully!" (identical weight
        // to "language changed"). Now: "Sale recorded — ₹12,450 · Sharma
        // General Store" — the money moment carries more weight.
        const txLabel = isNote ? (isCreditNote ? 'Credit Note' : 'Debit Note') : estimateMode ? 'Estimate' : (isSale ? 'Sale' : 'Purchase')
        const amount = roundMoney(data.totalAmount || totalAmount || 0)
        const partyName = selectedParty?.name || (data as any)?.partyName || ''
        const toastDesc = partyName ? `₹${amount.toLocaleString('en-IN')} · ${partyName}` : `₹${amount.toLocaleString('en-IN')}`
        // An estimate's message comes after the screen has moved on (below), so its button cannot be overtaken.
        if (!estimateMode && !counterMode) sonnerToast.success(`${txLabel} recorded`, { description: toastDesc })
        else estimateToast = () => sonnerToast.success(`${txLabel} recorded`, {
          description: toastDesc,
          // #185: an estimate used to vanish after saving; say where it is and offer the way there.
          // Long enough to read and tap (a message with a button gone in 4 s was missed on the first try).
          duration: 8000,
          action: { label: 'See estimates', onClick: () => { useAppStore.getState().requestOnArrival('sales', 'show-estimates'); useAppStore.getState().setView('sales') } },
        })

        // 🔒 V20-025: Track transaction creation event
        const txType = isNote ? (isCreditNote ? 'credit-note' : 'debit-note') : (isSale ? 'sale' : 'purchase')
        const event = isSale ? EVENTS.SALE_CREATED : isNote ? EVENTS.TRANSACTION_CREATED : EVENTS.PURCHASE_CREATED
        track(event, {
          type: txType,
          itemCount: items.length,
          totalAmount: roundMoney(data.totalAmount || 0),
          paymentMode: data.paymentMode || 'cash',
          isInterState: !!isInterState,
        })

        // 🔒 AUDIT FIX V5 MD: Surface negative-stock warnings from the API.
        // The server returns `stockWarnings: [{ productName, currentStock,
        // requestedQuantity, resultingStock }]` for any sale item that pushed
        // stock below zero. Show a visible warning so the shopkeeper knows
        // their stock went negative (and can record the missing purchase).
        if (Array.isArray(data.stockWarnings) && data.stockWarnings.length > 0) {
          // 🔒 BUG-13 (Phase 6 fix): The persistent banner was dead code — setView
          // navigated away before it could render. Now: delay navigation by 2.5s
          // so the banner is visible, and the user can read which products went
          // negative before being taken to the ledger.
          setStockWarnings(data.stockWarnings)
          const lines = data.stockWarnings.map((w: any) =>
            `• ${w.productName}: had ${w.currentStock}, sold ${w.requestedQuantity}, now ${w.resultingStock}`
          )
          sonnerToast.warning(
            `Stock went negative:\n${lines.join('\n')}\nRecord the missing purchase to fix this.`,
            { duration: 8000 }
          )
          // Delay leaving so the banner is visible. NOT an early return any more (6d, #292): that
          // skipped clearing the draft of a sale that had just saved, so restoring the draft later
          // and saving it would record the same sale twice.
          leaveAfterMs = 2500
        }
        // 🔒 V12: Surface price/unit anomaly warnings (e.g. ₹20/gm looks wrong).
        if (Array.isArray(data.priceWarnings) && data.priceWarnings.length > 0) {
          sonnerToast.warning(
            data.priceWarnings.map((w: any) => `⚠️ ${w.message}`).join('\n'),
            { duration: 9000 }
          )
        }
      }
      haptic.success()
      // Clear the active draft now that the transaction is saved
      if (activeDraftId) {
        deleteDraft(activeDraftId)
      }
      clearActive()
      // Track recently used products for quick-pick next time
      items.forEach((i) => {
        if (i.productId) trackRecentProduct(i.productId, i.productName)
      })
      // Increment rate-prompt counter (shows rating modal at milestones)
      incrementRateCount()
      // 🔒 R9-6/R9-7/R9-10: Invalidate every cache a money mutation can touch —
      // transactions, dashboard, parties (list + profile), products (all variants:
      // for-entry/for-picker/for-edit/search), insights, analytics, setting.
      // Was: only ['transactions'] + ['dashboard'] + ['parties'] were invalidated,
      // leaving party-profile and product caches stale for up to 2 minutes.
      await invalidateMoneyCaches(queryClient)
      // Phase 6d (#145): the Counter stays open — the Saved sheet offers Share, Print, Next bill.
      if (counterMode) {
        triggerRefresh()
        setPaySheetOpen(false)
        setSavedBill(savedInfo)
        return
      }
      // 🔒 V26 Phase 8 NAV-3: Honor the origin — if we came from a party profile,
      // return there instead of landing on the ledger (a root view with no back).
      // Was: always setView('sales'/'purchases') → dead end after purchase from party.
      const leave = () => {
        triggerRefresh()
        if (previousView && !isEntryView(previousView)) {
          setView(previousView)
        } else {
          setView(estimateMode ? 'sales' : (isSale ? 'sales' : 'purchases'))
        }
      }
      if (leaveAfterMs > 0) setTimeout(leave, leaveAfterMs)
      else leave()
      estimateToast?.()
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e?.message || "Couldn\'t save transaction")
    } finally {
      setSaving(false)
    }
  }

  // F10 (7c-2): exactly what the bar's button does — Pay on a plain sale, Save on any other bill.
  finishRef.current = () => {
    if (saving || saveBlocked) return
    if (counterMode) setPaySheetOpen(true)
    else handleSave()
  }

  /** Phase 6d: a fresh bill on the Counter — the same screen, nothing carried over but the date. */
  const resetBill = () => {
    setItems([])
    setChecks([])
    setPartyId('')
    setPartySearch('')
    setPaidAmount('')
    setPaymentMode('cash')
    setDiscountAmount('')
    setNotes('')
    setInvoiceNo('')
    setBillFields({})
    setItemFields({})
    setShipElsewhere(false)
    setDeliveryState('')
    setDeliveryAddress('')
    setBillToShipTo(null)
    setStockWarnings([])
    setProductSearch('')
    setPresetLoaded(false)
  }
  const handleNextBill = () => {
    setSavedBill(null)
    resetBill()
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }

  /*
   * Phase 7f — hold this bill and start the next customer's (Hold beside Pay,
   * or F8). Written at once (use-drafts holdNow) and kept on this phone until
   * it is finished or discarded; the Held row brings it back in one tap.
   */
  const holdBill = (opts: { quiet?: boolean } = {}): boolean => {
    const name = heldBillName(draftData, selectedParty?.name)
    const r = holdNow(draftData)
    if (r === 'full') {
      sonnerToast.error(`${MAX_HELD} bills are on hold`, { description: 'Finish or discard one first.' })
      return false
    }
    if (r === 'held' && !opts.quiet) {
      try { haptic.success() } catch {}
      sonnerToast.success(`Held · ${name}`, { duration: 3000 })
    }
    resetBill()
    return true
  }
  holdRef.current = () => { if (!saving) holdBill() }
  /** Bring a held bill back; a bill already on screen is held in its place, never lost. */
  const resumeHeld = (id: string) => {
    if (id === activeDraftId) return
    if ((items.length > 0 || !!partyId) && !holdBill({ quiet: true })) return
    handleRestoreDraft(id)
  }
  // The held bills other than the one on screen, newest first, with the engine's totals (#187).
  const heldOthers = useMemo(() => drafts
    .filter((d) => d.id !== activeDraftId)
    .map((d) => {
      const data = d.data as any
      const party = data?.partyId ? allParties.find((p) => p.id === data.partyId) : null
      return {
        id: d.id,
        name: heldBillName(data, party?.name),
        when: heldBillWhen(d.savedAt),
        total: heldBillFigures(data, { formType: type, productMap, chargesGst: shopChargesGst, roundOffEnabled }).total,
      }
    }), [drafts, activeDraftId, allParties, type, productMap, shopChargesGst, roundOffEnabled])
  // The same flow as the bill screen's "Send bill" (lib/share-bill-flow.ts), on the bill as saved.
  const handleShareSaved = async () => {
    if (!savedBill?.id) return
    setSharingBill(true)
    try {
      const r = await offlineFetch(`/api/transactions/${savedBill.id}`)
      if (!r.ok) throw new Error(await readError(r))
      const d = await r.json()
      const { shareBillOnWhatsApp } = await import('@/lib/share-bill-flow')
      await shareBillOnWhatsApp(d.transaction, settingData?.setting)
    } catch (e: any) {
      sonnerToast.error(e?.message || "Couldn't share the bill")
    } finally {
      setSharingBill(false)
    }
  }
  // Print uses the bill screen's own print layout: open the bill, which prints once it has loaded.
  const handlePrintSaved = () => {
    if (!savedBill?.id) return
    const st = useAppStore.getState()
    st.requestOnArrival('transaction-detail', 'print')
    st.setSelectedTransactionId(savedBill.id)
    st.setSelectedTransactionType('sale')
    st.setPreviousView('new-sale')
    setSavedBill(null)
    resetBill()
    st.setView('transaction-detail')
  }

  const handleCancel = () => {
    if (previousView) {
      setView(previousView)
    } else {
      setView(estimateMode ? 'sales' : (isSale ? 'sales' : 'purchases'))
    }
    setPreviousView(null)
  }

  const accentColor = isSale ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
  const accentBg = isSale ? 'bg-emerald-100' : 'bg-amber-100'
  const accentGradient = isSale ? 'bg-gradient-emerald' : 'bg-gradient-saffron'

  return (
    <div className="space-y-4 pb-24 lg:pb-4">
      {/* 🔒 V9 4.4: Persistent stock warning banner — stays visible until dismissed.
          Shows after a sale pushes stock below zero. Replaces toast-only warning. */}
      {stockWarnings.length > 0 && (
        <div className="rounded-xl border-2 border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/30 p-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-rose-800 dark:text-rose-300">Stock went negative</p>
            <div className="mt-1 space-y-0.5">
              {stockWarnings.map((w, i) => (
                <p key={i} className="text-xs text-rose-700 dark:text-rose-400">
                  • {w.productName}: had {w.currentStock}, sold {w.requestedQuantity}, now <strong>{w.resultingStock}</strong>
                </p>
              ))}
            </div>
            <p className="text-xs text-rose-600 dark:text-rose-500 mt-1.5">Record the missing purchase to fix this.</p>
          </div>
          <button
            onClick={() => setStockWarnings([])}
            className="min-h-12 min-w-12 inline-flex items-center justify-center p-1 rounded text-rose-400 hover:text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-900/30 flex-shrink-0"
            aria-label="Dismiss warning"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* Drafts button — opens modal showing all saved drafts from last 24h.
          Shows a badge with the count if there are any drafts. */}
      {/*
       * Only while the form is EMPTY.
       *
       * Autosave writes a draft the moment the first product is added, so this
       * banner appeared as a reward for starting work — announcing "1 saved
       * draft / Editing a restored draft" about the very sale still being
       * typed. It told the user something they already knew, at the top of the
       * screen, in the space the work needed.
       *
       * Old drafts are worth offering when there is nothing in progress: that
       * is the moment "carry on where you left off" is an answer. Once items
       * are on the form the offer is noise, and the draft is still being saved
       * either way — the banner was never what protected the work.
       *
       * Nothing is lost by hiding it: autosave still writes the draft on every
       * change, so leaving mid-sale keeps the work, and the banner reappears
       * next time the form opens empty — which is exactly when "restore a
       * draft" is a useful offer.
       *
       * (Checked rather than assumed: there is NO unsaved-changes guard on
       * exit today. markDirty() only resumes autosave. So leaving is currently
       * silent-but-safe. An explicit "leave / discard" confirmation on the way
       * out is the right completion of this and is tracked separately.)
       */}
      {/*
        * Phase 7f (#144): the Held row — one line, only the bills NOT on screen
        * (the one being typed is never announced to itself). Tap a bill to bring
        * it back; the bill on screen is held in its place. "All" opens the list
        * (delete lives there).
        */}
      {heldOthers.length > 0 && (
        <div className="flex items-center gap-2 min-w-0" role="group" aria-label="Held bills">
          <span className="text-xs font-semibold text-muted-foreground flex-shrink-0">Held</span>
          {heldOthers.slice(0, HELD_CHIPS).map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => { haptic.click(); resumeHeld(h.id) }}
              className="min-h-12 flex-1 min-w-0 px-3 py-1 rounded-xl border border-border bg-card text-left hover:border-primary/40 transition"
              aria-label={`Bring back ${h.name}, ${formatINR(h.total)}`}
            >
              <span className="block text-sm font-medium truncate">{h.name}</span>
              <span className="block text-xs text-muted-foreground tabular-nums truncate">{formatINR(h.total)} · {h.when}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => { haptic.click(); setDraftModalOpen(true) }}
            className="min-h-12 px-3 flex-shrink-0 rounded-xl text-sm font-semibold text-primary hover:bg-primary/10 transition"
          >
            All {heldOthers.length}
          </button>
        </div>
      )}

      {/* Asked before saving a purchase with no supplier bill number. */}
      {saveDialogEl}

      {/* Leaving a half-written entry — three answers, not two. */}
      <AlertDialog open={leavePromptOpen} onOpenChange={(o) => { if (!o) resolveLeave(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Leave this {estimateMode ? 'estimate' : isSale ? 'sale' : 'purchase'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Hold it to finish later, or discard it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <AlertDialogCancel className="mt-0 min-h-[44px]" onClick={() => resolveLeave(false)}>
              Keep editing
            </AlertDialogCancel>
            <Button variant="destructive" className="min-h-[44px]" onClick={handleDiscardAndLeave}>
              Discard
            </Button>
            <Button variant="outline" className="min-h-[44px]" onClick={handleHoldAndLeave}>
              Hold bill
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Draft manager modal */}
      <DraftManagerModal
        open={draftModalOpen}
        onOpenChange={setDraftModalOpen}
        drafts={drafts}
        activeDraftId={activeDraftId}
        onRestore={resumeHeld}
        onDelete={deleteDraft}
        figuresOf={(data) => heldBillFigures(data, { formType: type, productMap, chargesGst: shopChargesGst, roundOffEnabled })}
        nameOf={(data) => heldBillName(data, data?.partyId ? allParties.find((p) => p.id === data.partyId)?.name : null)}
      />

      <OneOffLine
        open={!!oneOff}
        initialName={oneOff?.name ?? ''}
        onClose={() => setOneOff(null)}
        onAdd={(l) => {
          setPresetLoaded(false)
          setItems((now) => [...now, { productId: '', productName: l.name, quantity: l.qty, unitPrice: l.price, gstRate: 0, gstTreatment: null, unit: 'pcs' }])
          const id = oneOff?.checkId ?? null
          if (id !== null) setChecks((now) => now.filter((x) => x.id !== id))
          setProductSearch('')
        }}
      />
      <BillScreenSettings open={billSettingsOpen} onClose={() => setBillSettingsOpen(false)} isSale={isSale} shopGst={shopGstStatus} />
      {qtyOpen && qtyButtonOn && !kb && (
        <QtyPad next={next} setNext={(n) => { setNext(n); setNextErr('') }} onClose={() => setQtyOpen(false)} error={nextErr} big={features?.billBigPad === true} />
      )}
      {kb && (
        <KeypadBar
          key={kb.key}
          row={kb}
          qtyOf={(id) => items.find((i) => i.productId === id)?.quantity ?? 0}
          priceOf={kbPriceOf}
          paysAt={kbPaysAt}
          setQty={setQtyFor}
          setPrice={setPriceFor}
          qtyForRupees={kbQtyForRupees}
          priceProblem={kbPriceProblem}
          allowPrice
          gramsRule={features?.billGramsRule !== false}
          checkAmounts={features?.billCheckAmounts !== false}
          big={features?.billBigPad === true}
          onClose={() => setKb(null)}
        />
      )}

      {/* Barcode scanner — scan to find and add product */}
      {barcodeOpen && (
        <BarcodeScanner
          onScan={(code) => {
            setBarcodeOpen(false)
            // 7c-2: the one add step — barcode, then SKU, then exact name (find-product-by-code);
            // quantity first; an unknown code asks "New item?" instead of leaving digits in the box.
            handleScannedCode(code)
          }}
          onClose={() => setBarcodeOpen(false)}
        />
      )}

      {/*
       * This whole strip is desktop-only now.
       *
       * On a phone it had become an empty band: the title was already in the
       * app header, so hiding the duplicate left a lone coloured cart icon
       * floating beside two buttons — decoration occupying a row on the screen
       * where room is scarcest. The mic and the scanner moved up into the app
       * header (see Header.tsx), which is where a hand reaching for them
       * already is, and the row goes with them.
       *
       * Desktop keeps it: there the header is wide, the title reads as a page
       * heading rather than a repetition, and nothing is competing for space.
       */}
      <div className="hidden lg:flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
            isSale ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-amber-100 dark:bg-amber-900/40'
          )}>
            {isSale
              ? <ShoppingCart className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              : <Truck className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
          </div>
          <div>
            <h2 className="text-lg font-bold font-heading tracking-tight">
              {isCreditNote ? 'Credit Note' : isDebitNote ? 'Debit Note' : estimateMode ? 'New Estimate' : `New ${isSale ? 'Sale' : 'Purchase'}`}
            </h2>
            <p className="text-xs text-muted-foreground">Fill in the details below</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {voiceOn && (
            <Button variant="outline" size="sm" onClick={() => setShowVoiceEntry(!showVoiceEntry)} className="gap-1.5">
              <Mic className="w-4 h-4" /> <span className="hidden sm:inline">Voice</span>
            </Button>
          )}
          {/* 🔒 BUG-14 (Phase 2b): Hide Scan Bill button on note/estimate forms.
              The scanner always sets preset type to 'sale'/'purchase', which would
              reset actualType and lose the note mode + any non-autosaved fields. */}
          {!isNote && !estimateMode && scanBillOn && (
            <Button variant="outline" size="sm" onClick={() => { setScannerBillType(type); setView('scanner') }} className="gap-1.5">
              <ScanLine className="w-4 h-4" /> <span className="hidden sm:inline">Scan Bill</span>
            </Button>
          )}
          {/* C12: the bill screen's own settings, here so a change is one tap away and shows at once. */}
          <Button variant="outline" size="sm" onClick={() => setBillSettingsOpen(true)} className="gap-1.5" aria-label="Bill screen settings">
            <Settings2 className="w-4 h-4" aria-hidden /> <span className="hidden sm:inline">Settings</span>
          </Button>
        </div>
      </div>

      {/* Voice Entry Section */}
      {/*
       * ONE voice panel at a time — `items.length === 0` here, and the
       * "add more items" panel below carries `items.length > 0`.
       *
       * Both were driven by the same showVoiceEntry flag with no such split, so
       * the moment a product was on the form BOTH opened: "Voice Entry" at the
       * top of the screen and "Add More Items via Voice" further down, two
       * microphones listening for different things. Reported, fairly, as a mess.
       *
       * They are genuinely different jobs — this one parses a whole sale
       * (customer, items, payment), the other only appends items — so the right
       * fix is to pick by what the form already holds, not to merge them.
       */}
      {voiceOn && showVoiceEntry && items.length === 0 && (
        <Card className="shadow-card border-border/60 border-primary/30">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Mic className="w-4 h-4 text-primary" /> Voice Entry
              </h3>
              {/* There was no way out of this panel. It opened from the header
                  mic and then stayed, with nothing on it that closed it. */}
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 -mr-1 -mt-1 flex-shrink-0 hit-48"
                onClick={() => setShowVoiceEntry(false)}
                aria-label="Close voice entry"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Speak naturally: &quot;Sold 2 kg sugar to Ramesh at 50 rupees cash&quot;
            </p>
            <VoiceEntry
              products={products}
              onTransactionParsed={(data) => {
              // Apply parsed data to the form
              /*
               * 🔒 D1: A NAME THEY SAID IS NEVER SILENTLY DROPPED.
               *
               * This was `if (matched) setPartyId(matched.id)` with no else.
               * Say "sold 2 kg sugar to Ramesh", have the name not match, and
               * the customer simply vanished — the sale kept whatever party
               * was already selected, or none. A sale recorded against the
               * wrong person is a debt the right person never sees, and the
               * shopkeeper had no way to know it happened.
               *
               * The matching was also substring-both-ways, which is the weak
               * lookup the resolver replaces: "Ramesh" would match "Rameshwar
               * Traders", and one misheard letter matched nothing at all.
               * Same resolver as Ask uses — one idea of who a name means,
               * everywhere.
               */
              if (data.partyName) {
                const decision = resolveName(
                  data.partyName,
                  allParties.map(p => ({ id: p.id, name: p.name })),
                )

                if (decision.status === 'exact' || decision.status === 'confident') {
                  setPartyId(decision.matches[0].candidate.id)
                } else if (decision.status === 'ambiguous') {
                  /*
                   * Several people could be meant. Picking one would be the
                   * guess this whole resolver exists to refuse — so say so and
                   * leave the field for them, with the names in the message so
                   * they know what it is asking between.
                   */
                  sonnerToast.warning(
                    `Which ${decision.matches.map(m => m.candidate.name).join(' or ')}?`,
                    { description: 'Choose the customer below — I did not want to guess.' },
                  )
                } else {
                  sonnerToast.warning(
                    `No customer called “${data.partyName}”`,
                    { description: 'Everything else was filled in. Choose or add the customer below.' },
                  )
                }
              }
              if (data.paymentMode) setPaymentMode(data.paymentMode)
              if (data.items?.length > 0) {
                // APPEND items instead of replacing (so "Add More" works)
                // 🔒 V12: Match to inventory, then normalize the spoken quantity
                // into the product's (or base) unit so "500 gm @ ₹20/kg" becomes
                // 0.5 kg × ₹20 = ₹10 instead of 500 × 20 = ₹10,000.
                /*
                 * 🔒 D2 (#56): WHY EVERY HINDI ITEM CAME OUT AT ₹0.
                 *
                 * The lookup was a substring test against Latin product names,
                 * so "आम" matched nothing — Devanagari and Latin share no
                 * characters. With no product matched and no price spoken, the
                 * line below fell to `unitPrice: 0`, and the toast still said
                 * "Added 2 items to sale". A success message for a line worth
                 * nothing, in the app's most-used entry path.
                 *
                 * Same resolver as Ask and D1 — it transliterates, folds the
                 * spelling variants Hindi-in-Latin always has (doodh/dudh,
                 * chawal/chaval) and refuses when two products could be meant.
                 */
                const unmatched: string[] = []
                const newItems = data.items.map((item: any) => {
                  const spokenName = item.productName || item.name || ''
                  let product = item.productId
                    ? products.find(p => p.id === item.productId)
                    : undefined

                  if (!product && spokenName) {
                    const decision = resolveName(
                      spokenName,
                      products.map(p => ({ id: p.id, name: p.name })),
                    )
                    if (decision.status === 'exact' || decision.status === 'confident') {
                      product = products.find(p => p.id === decision.matches[0].candidate.id)
                    } else {
                      /*
                       * Ambiguous or nothing. The line is still ADDED, because
                       * dropping what they said is the D1 mistake — but it is
                       * named in the warning below rather than slipped in at
                       * zero and called a success.
                       */
                      unmatched.push(spokenName)
                    }
                  }
                  const spokenPrice = Number(item.unitPrice) || 0
                  const resolved = resolveEnteredQuantity(
                    Number(item.quantity) || 1,
                    item.unit || product?.unit || 'pcs',
                    product?.unit,
                  )
                  return {
                    productId: product?.id || '',
                    productName: product?.name || item.productName || item.name,
                    quantity: roundMoney(resolved.quantity),
                    // If no price was spoken, use the catalog price (per product unit).
                    unitPrice: spokenPrice > 0 ? spokenPrice : (product ? (isSale ? product.salePrice : purchaseRateFromCost(product, { claimsItc: canClaimGst })) : 0),
                    gstRate: product?.gstRate ?? Number(item.gstRate) ?? 0,
                    unit: resolved.unit,
                  }
                })
                setItems(prev => [...prev, ...newItems])

                /*
                 * NEVER CALL A ₹0 LINE A SUCCESS. The count is what actually
                 * matched; anything else is named so the shopkeeper can price
                 * it before saving, instead of discovering a zero later in a
                 * report.
                 */
                const matchedCount = newItems.length - unmatched.length
                if (matchedCount > 0) {
                  sonnerToast.success(`Added ${matchedCount} item${matchedCount === 1 ? '' : 's'} to sale`)
                }
                if (unmatched.length > 0) {
                  sonnerToast.warning(
                    `Not in your products: ${unmatched.join(', ')}`,
                    { description: 'Added with no price — set it, or pick the product, before saving.' },
                  )
                }
              }
              setShowVoiceEntry(false)
              sonnerToast.success('Voice entry applied! Review and save.')
            }} />
          </CardContent>
        </Card>
      )}

      {/*
       * MOBILE ORDER IS NOT DOM ORDER, deliberately.
       *
       * On a phone this used to stack as the desktop columns happen to sit in
       * the markup: products, items, NOTES, customer, details, summary. Measured
       * on production, "Customer" began 1120px down — past a screen and a half —
       * and Notes, the least urgent field on the form, came before it.
       *
       * A sale is answered in a fixed order: who is it for, what did they buy,
       * how are they paying. Every billing app worth copying (Vyapar, myBillBook,
       * Zoho Invoice, Swipe) leads with the customer, because that choice decides
       * the GST treatment and the pricing for everything after it. Asking last
       * for the thing that governs the rest is backwards.
       *
       * `contents` dissolves the two column wrappers on mobile so their cards
       * become direct flex children and `order-*` can sequence them. At lg the
       * wrappers become blocks again and the original two-column grid is restored
       * EXACTLY — no desktop regression, because desktop never sees the reorder.
       */}
      {/* Phase 7c: one layout for every bill (#298) — customer, then items and the bill, details, summary, notes. */}
      <div className="flex flex-col gap-3 lg:grid lg:gap-4 lg:grid-cols-3">
        {/* LEFT: the picker + the bill (takes 2 cols) */}
        <div className="contents lg:block lg:space-y-4 lg:col-span-2">
          <Card className="shadow-card border-border/60 order-2 lg:order-none py-0">
            {/* Phase 7c: the ONE item picker (components/ledger/ItemPicker.tsx) — a row per brand with its
                sizes as buttons, "Often sold", the customer's usual items, Groups; nothing cut silently. */}
            <div className="p-3 sm:p-4 border-b border-border">
              <ItemPicker
                products={products}
                query={productSearch}
                onQuery={setProductSearch}
                onEnter={() => {
                  // C12: a typed amount ("toor 400") or a whole list goes through the typed path first.
                  if (enterTyped(productSearch)) return
                  // A wedge scanner gun types the code then presses Enter.
                  const match = resolveProductForEnterKey(productSearch, products, filteredProducts)
                  if (match) {
                    pickAdd(match)
                    setProductSearch('')  // ready for the next scan
                  } else if (/^\d{6,}$/.test(productSearch.trim())) {
                    // A barcode nobody knows yet: offer to add it, never leave digits in the box.
                    setUnknownCode(productSearch.trim())
                    setProductSearch('')
                  }
                }}
                result={productSearchResult}
                oftenIds={features?.billOftenList !== false ? oftenIds : []}
                oftenLabel={isSale ? 'Often sold' : 'Often bought'}
                usualIds={features?.billUsualList !== false ? usualIds : []}
                sizeStock={features?.billSizeStock !== false}
                sizeMark={features?.billSizeMark !== false}
                sideView={features?.billSideView === true}
                searchHint={typedHint}
                notFound={notInListOn ? (oneOffOn
                  ? { label: '+ Bill it once', run: (t) => setOneOff({ name: parseTypedLine(t).name || t.trim(), checkId: null }) }
                  : { label: '+ Add it as a new item', run: (t) => setNewItemFor({ name: parseTypedLine(t).name || t.trim(), checkId: null }) }) : null}
                listPaste={listOn}
                onPencil={pencilOn ? (row) => { setQtyOpen(false); setKb(row) } : undefined}
                kbRowKey={kb?.key ?? null}
                weightButtons={features?.billWeightButtons !== false}
                onAddQty={(p, q) => { if (priceCheck && isSale) { setCheckedProduct(p); return } if (next) { addWithNext(p); return } handleAddProduct(p, q) }}
                customerName={selectedParty?.name ?? null}
                billLines={items.length}
                qtyOf={(id) => items.find((i) => i.productId === id)?.quantity ?? 0}
                priceOf={(p) => (isSale ? p.salePrice : p.purchasePrice)}
                showsGst={showsGst}
                onAdd={(p) => pickAdd(p)}
                onDecrement={(id) => handleDecrementProduct(id)}
                catalogCutNote={catalogCutNote}
                belowSearch={(
                  <>
                    {/* 7c-2: quantity first ("6, then tap or scan"); on a sale, price check (nothing is added). */}
                    {(qtyButtonOn || priceCheckOn) && (
                    <div className="flex items-center gap-2">
                      {qtyButtonOn && (
                        <Button type="button" variant={next ? 'default' : 'outline'} className="h-12 tabular-nums" aria-pressed={qtyOpen}
                          onClick={() => { setKb(null); setQtyOpen((o) => !o) }}>
                          {next ? `${nextLabel(next)} next` : 'Qty'}
                        </Button>
                      )}
                      {priceCheckOn && (
                        <Button type="button" variant={priceCheck ? 'default' : 'outline'} className="h-12 shrink-0" aria-pressed={priceCheck} onClick={() => setPriceCheck((v) => !v)}>
                          Price check
                        </Button>
                      )}
                    </div>
                    )}
                    {priceCheck && isSale && <p className="text-xs font-semibold text-check">Price check: tap or scan an item — nothing is added</p>}
                    {nextErr && !qtyOpen && <p role="status" className="text-xs font-semibold text-bad">{nextErr} · still waiting on Qty</p>}
                    <p className="hidden lg:block text-xs text-muted-foreground">F2 search · F3 {isSale ? 'customer' : 'supplier'}{qtyButtonOn ? ' · F4 quantity' : ''}{priceCheckOn ? ' · F6 price check' : ''} · F8 hold · F10 {counterMode ? 'pay' : 'save'} · a barcode gun works anywhere</p>
                  </>
                )}
                scanButton={features?.barcodeScanner ? (
                  <button
                    type="button"
                    onClick={() => setBarcodeOpen(true)}
                    className="min-h-12 min-w-12 inline-flex items-center justify-center rounded-md hover:bg-muted text-primary"
                    aria-label="Scan barcode"
                  >
                    <ScanLine className="w-5 h-5" />
                  </button>
                ) : null}
                empty={(
                  <EmptyState
                    icon={Package}
                    title="No products yet"
                    description="Add your first product, or scan a bill."
                    action={{ label: 'Add Product', onClick: () => setView('inventory') }}
                    secondaryAction={scanBillOn ? { label: 'Scan a Bill', onClick: () => { setScannerBillType(isSale ? 'sale' : 'purchase'); setView('scanner') } } : undefined}
                    color="blue"
                    compact
                  />
                )}
              />
            </div>

            {/* Items list */}
            <div className="p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4" /> Bill
                  {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
                </h3>
                {items.length > 0 && voiceOn && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowVoiceEntry(!showVoiceEntry)}
                    className="gap-1.5 text-xs"
                  >
                    <Mic className="w-3.5 h-3.5" /> {showVoiceEntry ? 'Close Voice' : 'Add via Voice'}
                  </Button>
                )}
              </div>

              <TypedChecks
                checks={checks}
                describe={describeQty}
                onPick={(c, ch) => {
                  setPresetLoaded(false)
                  addQtyNow(ch.product, ch.qty)
                  setChecks((now) => now.filter((x) => x.id !== c.id))
                  if (learnOn && c.key) {
                    const t = teach(learnedPicks, c.key, ch.product.id)
                    setLearnedPicks(t.picks)
                    if (t.learnedNow) sonnerToast.success(`Learned: next time “${c.key}” is ${ch.product.name}`)
                  }
                }}
                onDrop={(id) => setChecks((now) => now.filter((x) => x.id !== id))}
                onNewItem={(c) => setNewItemFor({ name: parseTypedLine(c.said).name, checkId: c.id })}
                onOneOff={oneOffOn ? (c) => setOneOff({ name: parseTypedLine(c.said).name, checkId: c.id }) : undefined}
              />

              {/* Inline voice entry for adding more items */}
              {voiceOn && showVoiceEntry && items.length > 0 && (
                <Card className="shadow-card border-border/60 border-primary/30 mb-3">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Mic className="w-4 h-4 text-primary" /> Add More Items via Voice
                      </h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 p-0 -mr-1 -mt-1 flex-shrink-0"
                        onClick={() => setShowVoiceEntry(false)}
                        aria-label="Close voice entry"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Speak items to ADD to the existing sale. Previous items will not be removed.
                    </p>
                    <VoiceEntry
                      products={products}
                      onTransactionParsed={(data) => {
                        if (data.items?.length > 0) {
                          const newItems = data.items.map((item: any) => {
                            if (item.unitPrice && item.unitPrice > 0) {
                              return {
                                productId: item.productId || '',
                                productName: item.productName || item.name,
                                quantity: Number(item.quantity) || 1,
                                unitPrice: Number(item.unitPrice) || 0,
                                gstRate: Number(item.gstRate) || 0,
                                unit: item.unit || 'pcs',
                              }
                            }
                            /*
                             * 🔒 D2/D3: the SAME substring match, in the bill
                             * scan. Found by D2's guard four hundred lines from
                             * where I was working — which is the guard doing
                             * its job: I would not have looked here.
                             *
                             * Lower stakes than voice, because a scanned bill
                             * usually carries its own price and short-circuits
                             * above. But when it does not, this fell through to
                             * the same ₹0 — so it gets the same resolver rather
                             * than a note in the tasklog saying it should.
                             */
                            const scannedName = item.productName || item.name || ''
                            const scanMatch = scannedName
                              ? resolveName(scannedName, products.map(p => ({ id: p.id, name: p.name })))
                              : null
                            const product = scanMatch
                              && (scanMatch.status === 'exact' || scanMatch.status === 'confident')
                              ? products.find(p => p.id === scanMatch.matches[0].candidate.id)
                              : undefined
                            return {
                              productId: product?.id || '',
                              productName: item.productName || item.name,
                              quantity: Number(item.quantity) || 1,
                              unitPrice: product ? (isSale ? product.salePrice : purchaseRateFromCost(product, { claimsItc: canClaimGst })) : (Number(item.unitPrice) || 0),
                              gstRate: product?.gstRate || 0,
                              unit: product?.unit || item.unit || 'pcs',
                            }
                          })
                          setItems(prev => [...prev, ...newItems])
                          sonnerToast.success(`Added ${newItems.length} items to sale`)
                        }
                        setShowVoiceEntry(false)
                      }}
                    />
                  </CardContent>
                </Card>
              )}

              {/* V17 Audit §1: "Load items from original" button for credit/debit notes.
                  🔒 R10b-6 (Phase 3): Was gated on isCreditNote only — debit notes
                  (purchase returns) also have originalTransactionId and benefit from
                  loading all items for a full return. Now: gate on isNote. */}
              {isNote && originalTransactionId && (
                <button
                  type="button"
                  onClick={handleLoadOriginalItems}
                  disabled={loadingOriginal}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-violet-300 bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300 text-sm font-medium hover:bg-violet-100 dark:hover:bg-violet-950/30 transition mb-2',
                    loadingOriginal && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  <FileDown className="w-4 h-4" />
                  {loadingOriginal
                    ? 'Loading...'
                    : items.length > 0
                      ? `Reload all items from original ${isCreditNote ? 'sale' : 'purchase'}`
                      : `Load all items from original ${isCreditNote ? 'sale' : 'purchase'}`
                  }
                </button>
              )}

              {items.length === 0 && counterMode ? (
                /* 6c: on a phone the tiles must be in the first screen; an empty bill is one line, not a 140px box. */
                <p className="text-sm text-muted-foreground text-center py-2">Tap an item, type its name, or scan</p>
              ) : items.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                  <ShoppingCart className="w-10 h-10 mx-auto mb-2 text-muted-foreground/40" />
                  <p>No items added yet</p>
                  <p className="text-xs mt-1">Click products above to add them here</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {items.map((item, i) => {
                    // 🔒 V12: Use the server-identical computed line (normalized
                    // quantity/unit + correct total). Fixes the "500 gm × ₹20 =
                    // ₹10,000" display — now shows 0.5 kg × ₹20/kg = ₹10.
                    const line = previewLines[i]
                    const itemTotal = line?.total ?? 0
                    const normUnit = line?.unit || item.unit || 'pcs'
                    const normQty = line?.quantity ?? item.quantity
                    const converted = normalizeUnitName(item.unit) !== normUnit
                    const unitOptions = subUnitsFor(baseUnitOf(item.unit || 'pcs'))
                    // The line's own GST setting, as the preview used it.
                    const lineInclusive = !!computeInput[i]?.priceIncludesGst
                    // The rate the line was CALCULATED at — 0% for a shop that
                    // charges no GST (#165), whatever the product says.
                    const lineRate = Number(line?.gstRate ?? item.gstRate) || 0
                    return (
                      <div key={i} className="rounded-lg bg-muted/20 border border-border/40 p-2 transition hover:bg-muted/30">
                        {/* Row 1: Number + Product name + Total + Delete */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-muted-foreground w-4 text-center flex-shrink-0">{i + 1}</span>
                          <p className="flex-1 min-w-0 text-sm font-medium truncate">{item.productName}</p>
                          <span className="text-xs font-bold tabular-nums flex-shrink-0">{formatINR(itemTotal)}</span>
                          {/* #182: a 48px tap area around the same small ✕ (it was 22px). */}
                          <button
                            className="w-12 h-12 -my-3 -mr-2 flex items-center justify-center rounded-lg text-muted-foreground hover:text-bad hover:bg-bad-soft transition flex-shrink-0"
                            onClick={() => handleRemoveItem(i)}
                            aria-label={`Remove ${item.productName}`}
                          >
                            <X className="w-4 h-4" aria-hidden />
                          </button>
                        </div>
                        {/* Row 2: Qty + Unit selector + Price + GST — fills FULL width */}
                        <div className="flex items-center gap-1 pl-5 mt-1">
                          <NumberField
                            compact
                            aria-label="Quantity"
                            value={item.quantity}
                            onValueChange={(v) => {
                              const val = parseFloat(v) || 0
                              // 🔒 V17 Audit Phase 10: Round to integer for count units
                              // Prevents 22.02 pcs (milk packs must be whole numbers)
                              // 🔒 BUG-12 (Phase 2b): Clamp to ≥ 0. Was: Math.round(-5) = -5
                              // (passes through), and a negative quantity on a sale would
                              // INCREMENT stock on the server (decrement with negative = increment)
                              // — a real stock/money corruption vector.
                              const rounded = isCountUnit(item.unit) ? Math.round(val) : val
                              const finalVal = Math.max(0, rounded)
                              handleUpdateItem(i, 'quantity', finalVal)
                            }}
                            className="flex-1 min-w-0"
                            inputClassName="tabular-nums"
                            min={0}
                            // stepForUnit() is the INPUT precision (0.001 for
                            // kg) — using it as the tap increment made "+" go
                            // 1 → 1.001, which is useless at a counter. Taps
                            // move by a unit a shopkeeper actually sells in;
                            // any precise value can still be typed.
                            // 🔒 BUG-18 (Phase 6): Was: hardcoded 0.5 for all non-count
                            // units. 0.5gm is useless at a counter. Now: sensible per-unit
                            // tap increments (10 for gm/ml, 0.5 for kg/ltr/m, 5 for cm).
                            step={
                              isCountUnit(item.unit) ? 1
                              : (item.unit === 'gm' || item.unit === 'ml') ? 10
                              : (item.unit === 'cm') ? 5
                              : 0.5
                            }
                            decimals={isCountUnit(item.unit) ? 0 : 3}
                            placeholder="Qty"
                          />
                          {/* 🔒 V12: Unit is now an editable selector (kg/gm, ltr/ml, ...) */}
                          <Select
                            value={normalizeUnitName(item.unit)}
                            onValueChange={(v) => handleUpdateItem(i, 'unit', v)}
                          >
                            <SelectTrigger className="w-16 h-12 lg:pointer-fine:h-8 text-sm lg:pointer-fine:text-xs px-1 flex-shrink-0" aria-label="Unit">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {unitOptions.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <span className="text-xs text-muted-foreground flex-shrink-0">×</span>
                          <span className="text-xs text-muted-foreground flex-shrink-0">₹</span>
                          <NumberField
                            compact
                            aria-label="Price"
                            value={item.unitPrice}
                            onValueChange={(v) => {
                              handleUpdateItem(i, 'unitPrice', parseFloat(v) || 0)
                              if (byAmount?.line === i) setByAmount(null)
                            }}
                            className="flex-1 min-w-0"
                            inputClassName="tabular-nums"
                            min={0}
                            step={1}
                            decimals={2}
                            placeholder="Price"
                          />
                          {showsGst && (
                          <Select
                            value={String(item.gstRate)}
                            onValueChange={(v) => handleUpdateItem(i, 'gstRate', parseFloat(v))}
                          >
                            <SelectTrigger className="w-14 h-12 lg:pointer-fine:h-8 text-sm lg:pointer-fine:text-xs px-1 flex-shrink-0" aria-label="GST rate">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {/* See #86 — the line's own rate stays on the list so an old bill
                                  being edited keeps its 12%. */}
                              {ratesForPicker(item.gstRate).map(r => (
                                <SelectItem key={r} value={String(r)}>
                                  {r}%{isLegacyGstRate(r) ? ' (old rate)' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          )}
                        </div>
                        {/* 🔒 V12: Inline, self-verifying math so the shopkeeper
                            instantly sees the real per-unit calculation. */}
                        <div className="pl-5 mt-1 flex items-center gap-2">
                          <p className="flex-1 min-w-0 text-xs text-muted-foreground tabular-nums">
                            {item.quantity} {normalizeUnitName(item.unit)}
                            {converted && <span className="text-primary"> = {roundMoney(normQty)} {normUnit}</span>}
                            {' '}× ₹{item.unitPrice}/{normUnit}
                            {/* "1 × ₹230 = ₹241.50" read as bad maths: say where the GST went. */}
                            {lineRate > 0 && (lineInclusive ? ' (incl. GST)' : ` + ${lineRate}% GST`)}
                            {' '}= <span className="font-semibold text-foreground">{formatINR(itemTotal)}</span>
                          </p>
                          {/* Phase 7e: loose goods by rupees — on the line's own row, so it adds no height. */}
                          {!isCountUnit(item.unit) && Number(item.unitPrice) > 0 && byAmount?.line !== i && (
                            <button type="button" className="min-h-12 px-2 -mr-1 flex-shrink-0 rounded-lg text-xs font-semibold text-primary hover:bg-primary/10" onClick={() => setByAmount({ line: i, value: '' })}>
                              Sell by ₹
                            </button>
                          )}
                        </div>
                        {byAmount?.line === i && (
                          <div className="pl-5 mt-1 flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground flex-shrink-0">Customer pays</span>
                            <NumberField
                              compact
                              prefix="₹"
                              aria-label={`Amount for ${item.productName}`}
                              value={byAmount.value}
                              onValueChange={(v) => setLineByAmount(i, v)}
                              className="flex-1 min-w-0"
                              inputClassName="tabular-nums"
                              min={0}
                              step={10}
                              decimals={2}
                              placeholder="Amount"
                            />
                            <button type="button" className="min-h-12 px-2 -mr-1 flex-shrink-0 rounded-lg text-xs font-semibold text-primary hover:bg-primary/10" onClick={() => setByAmount(null)}>
                              Done
                            </button>
                          </div>
                        )}
                        {/* 🔒 V11 STOCK POLICY: Live stock warning per item.
                            Shows immediately when the user enters a quantity
                            that exceeds available stock — no need to hit Save. */}
                        {(() => {
                          const warning = liveStockWarnings.find(w => w.itemIndex === i)
                          if (!warning) return null
                          const isBlock = stockPolicy === 'block'
                          return (
                            <div className={cn(
                              'pl-5 mt-1 text-xs font-medium flex items-center gap-1',
                              isBlock ? 'text-rose-600' : 'text-amber-600 dark:text-amber-400'
                            )}>
                              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                              {isBlock ? 'Not enough stock' : 'Will go negative'}: have {warning.currentStock}, selling {warning.requestedQty} → {warning.resultingStock}
                            </div>
                          )
                        })()}
                        {/* Phase 7e: above the printed MRP — said on the line, fixed in one tap. */}
                        {(() => {
                          const over = mrpOver.find((m) => m.index === i)
                          if (!over) return null
                          return (
                            <div className="pl-5 mt-1 flex items-center gap-2 text-xs font-medium text-bad">
                              <AlertTriangle className="w-3 h-3 flex-shrink-0" aria-hidden />
                              <span className="flex-1 min-w-0 tabular-nums">Above MRP: {formatINR(over.pays)} each, MRP {formatINR(over.mrp)}</span>
                              <button type="button" className="min-h-12 px-2 -mr-1 flex-shrink-0 rounded-lg font-semibold text-primary hover:bg-primary/10" onClick={() => sellAtMrp(i, over.mrp)}>
                                Sell at MRP
                              </button>
                            </div>
                          )
                        })()}

                        {/*
                          * 📄 Phase 5 — the shop's own columns for THIS line.
                          *
                          * Inside the line's own card, under its numbers, so a
                          * chemist filling batch and expiry on a nine-item bill
                          * can see which medicine each pair belongs to. A
                          * separate panel would make that a memory test.
                          */}
                        {itemDefs.length > 0 && (
                          <div className="pl-5 mt-2">
                            <CustomFieldInputs
                              compact
                              idPrefix={`line-${i}`}
                              defs={itemDefs}
                              values={itemFields[i] || {}}
                              onChange={(key, value) =>
                                setItemFields(prev => ({ ...prev, [i]: { ...(prev[i] || {}), [key]: value } }))
                              }
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Card>

          {/* 📄 Phase 5 — the shop's own fields for the whole bill.

              Beside Notes rather than up with the party, because these are
              things about the SALE — a PO number, a vehicle number — and
              the top of this screen already carries the customer and the
              date, which is as much as fits before the item list. */}
          {billDefs.length > 0 && (
            <Card className="shadow-card border-border/60 lg:order-none order-5 py-0">
              <div className="p-3 sm:p-4">
                <CustomFieldInputs
                  idPrefix="bill"
                  defs={billDefs}
                  values={billFields}
                  onChange={(key, value) => setBillFields(prev => ({ ...prev, [key]: value }))}
                />
              </div>
            </Card>
          )}

          {/* Notes */}
          <Card className="shadow-card border-border/60 lg:order-none order-5 py-0">
            <div className="p-3 sm:p-4">
              <Label htmlFor="field-notes-optional">Notes (optional)</Label>
              <Input id="field-notes-optional"
                value={notes}
                onChange={(e) => { markDirty(); setNotes(e.target.value) }}
                placeholder="Any additional notes about this transaction..."
                className="mt-1"
              />
              {/* V17-Ext Tier 3: Credit/Debit Note specific fields */}
              {isNote && (
                <div className="mt-4 space-y-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 p-3 border border-violet-200 dark:border-violet-900">
                  <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                    {isCreditNote ? 'Credit Note' : 'Debit Note'} Details
                  </p>
                  <div>
                    <Label className="text-xs" htmlFor="field-reason">Reason</Label>
                    <select
                      value={noteReason}
                      onChange={(e) => { markDirty(); setNoteReason(e.target.value) }}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Select a reason...</option>
                      <option value="post-sale-discount">Post-sale discount</option>
                      <option value="deficiency">Deficiency in goods</option>
                      <option value="return">Goods returned</option>
                      <option value="price-revision">Price revision</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="affectsStock"
                      checked={affectsStock}
                      onChange={(e) => { markDirty(); setAffectsStock(e.target.checked) }}
                      className="w-4 h-4 rounded"
                    />
                    <Label htmlFor="affectsStock" className="text-xs cursor-pointer">
                      Goods physically returned (adjust stock)
                    </Label>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* RIGHT: Party, date, payment, summary */}
        <div className="contents lg:block lg:space-y-4">
          {/* Party selection */}
          {/* 6c: the Card's own py-4 sat on top of this p-3 (28px above the first line); the Counter drops it. */}
          <Card className="shadow-card border-border/60 order-1 lg:order-none py-0">
            <div className="p-3 sm:p-4">
              {/*
                🔒 "Add New" lives beside the heading (2026-08-03, reported by
                Rahul). It used to exist only at the BOTTOM of the dropdown's
                scroll area — under up to 20 parties in a max-h-64 box — so the
                one action a shopkeeper needs for a brand-new walk-in customer
                was the hardest thing on the screen to reach.

                Here it is visible before the dropdown is even opened, and it
                does not move as the list scrolls.
              */}
              <div className={cn('items-center justify-between gap-2 mb-3', counterMode && !selectedParty ? 'hidden lg:flex' : 'flex')}>
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <User className="w-4 h-4" /> {isSale ? 'Customer' : 'Supplier'}
                </h3>
                {!selectedParty && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs border-primary/40 text-primary hover:bg-primary/5 shrink-0"
                    onClick={() => { setPartyDropdownOpen(false); setAddPartyOpen(true) }}
                  >
                    <Plus className="w-3.5 h-3.5" /> Add New
                  </Button>
                )}
              </div>

              {selectedParty ? (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className={cn(
                      'text-white text-xs font-semibold',
                      selectedParty.type === 'customer' ? 'bg-gradient-to-br from-emerald-500 to-teal-600' :
                      selectedParty.type === 'supplier' ? 'bg-gradient-to-br from-amber-500 to-orange-600' :
                      'bg-gradient-to-br from-violet-500 to-purple-600'
                    )}>
                      {getInitials(selectedParty.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{selectedParty.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      {selectedParty.phone && <span className="flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{selectedParty.phone}</span>}
                      {selectedParty.balance !== 0 && (
                        <Badge variant="outline" className={cn('text-xs py-0', selectedParty.balance > 0 ? 'text-emerald-600 dark:text-emerald-400 border-emerald-300' : 'text-rose-600 border-rose-300')}>
                          {selectedParty.balance > 0 ? `Owes ₹${selectedParty.balance}` : `You owe ₹${Math.abs(selectedParty.balance)}`}
                        </Badge>
                      )}
                      {/*
                       * The supplier's GSTIN, shown on purchases only.
                       *
                       * It is half the key GSTR-2B reconciles on — the other
                       * half is their bill number below. Without it the
                       * purchase can never be matched, and therefore the input
                       * tax credit can never be confirmed. That was invisible:
                       * nothing on this screen mentioned GSTIN at all, so a
                       * supplier saved without one looked complete. Six of the
                       * sixteen suppliers in this shop have one.
                       */}
                      {!isSale && (
                        selectedParty.gstin ? (
                          <Badge variant="outline" className="text-xs py-0 font-mono">
                            {selectedParty.gstin}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs py-0 text-amber-600 border-amber-300 gap-0.5">
                            <AlertTriangle className="w-2.5 h-2.5" /> No GSTIN — can&apos;t claim GST
                          </Badge>
                        )
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { markDirty(); setPartyId('') }}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="relative" ref={partyDropdownRef}>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                  <Input
                    /* Named so the "add a customer to this return" error can
                       put the cursor here. Without an id that focus call is a
                       silent no-op — the toast tells you to pick a customer
                       and then leaves you to find the field yourself. */
                    id="field-party-search"
                    placeholder={counterMode ? 'Customer: name or phone (empty = cash sale)' : `Search ${isSale ? 'customer' : 'supplier'} by name or phone...`}
                    value={partySearch}
                    onChange={(e) => { setPartySearch(e.target.value); setPartyDropdownOpen(true) }}
                    /*
                     * Lift the field towards the top of the screen on focus.
                     *
                     * The dropdown opens BELOW the input, and the on-screen
                     * keyboard covers roughly the bottom half of a phone. With
                     * the field sitting mid-screen, the results it opened were
                     * behind the keyboard — you typed a name and could not see
                     * whether it had matched.
                     *
                     * The delay lets the keyboard finish animating in, so the
                     * scroll is measured against the viewport that will actually
                     * exist rather than the one being replaced.
                     */
                    onFocus={(e) => {
                      setPartyDropdownOpen(true)
                      const el = e.currentTarget
                      setTimeout(() => {
                        // scrollIntoView, not a computed scrollBy.
                        //
                        // The first version measured the field and scrolled by
                        // the difference. Verified on production: the handler
                        // ran, the dropdown opened, and the page did not move —
                        // the measurement was taken before the dropdown had
                        // finished changing the layout under it, so the sum it
                        // scrolled by was already wrong.
                        //
                        // Letting the browser do it removes the arithmetic:
                        // scroll-mt-24 below declares how much room to leave for
                        // the sticky header, and the browser resolves the rest
                        // against whatever the layout actually is at that moment.
                        el.scrollIntoView({ block: 'start', behavior: 'smooth' })
                      }, 320)
                    }}
                    className="pl-9 scroll-mt-24"
                  />

                  {partyDropdownOpen && (
                    <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-popover border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                      {filteredParties.length === 0 ? (
                        <div className="p-4 text-center">
                          <p className="text-sm text-muted-foreground mb-2">
                            {partySearch ? `No match for "${partySearch}"` : `No ${isSale ? 'customers' : 'suppliers'} yet`}
                          </p>
                          <Button size="sm" className="bg-gradient-saffron gap-1" onClick={() => { setPartyDropdownOpen(false); setAddPartyOpen(true) }}>
                            <Plus className="w-3.5 h-3.5" /> {addPartyPrefill.phone
                              ? `Add ${isSale ? 'customer' : 'supplier'} · ${addPartyPrefill.phone}`
                              : `Add New ${isSale ? 'Customer' : 'Supplier'}`}
                          </Button>
                        </div>
                      ) : (
                        <>
                          {/*
                           * The sticky "Add New Customer" that used to head this
                           * list is gone. There is an "Add New" button beside the
                           * Customer heading, three centimetres above and always
                           * visible, doing exactly the same thing — so the
                           * dropdown was spending its first row, and a chunk of
                           * the little space left above the keyboard, on a
                           * duplicate of a button already on screen.
                           *
                           * The empty-state button below is NOT a duplicate: when
                           * there are no matches it is the only thing to do, and
                           * it carries the searched name into the new record.
                           */}
                          {partySearch && (
                            <div className="px-3 py-1.5 text-xs text-muted-foreground font-medium border-b border-border">
                              {filteredParties.length} match{filteredParties.length !== 1 ? 'es' : ''}
                            </div>
                          )}
                          {filteredParties.slice(0, 20).map(p => (
                            <button
                              key={p.id}
                              onClick={() => { markDirty(); setPartyId(p.id); setPartyDropdownOpen(false); setPartySearch('') }}
                              className="w-full flex items-center gap-2 p-2 hover:bg-muted transition text-left"
                            >
                              <Avatar className="w-8 h-8 flex-shrink-0">
                                <AvatarFallback className={cn(
                                  'text-white text-xs font-semibold',
                                  p.type === 'customer' ? 'bg-gradient-to-br from-emerald-500 to-teal-600' :
                                  p.type === 'supplier' ? 'bg-gradient-to-br from-amber-500 to-orange-600' :
                                  'bg-gradient-to-br from-violet-500 to-purple-600'
                                )}>
                                  {getInitials(p.name)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{p.name}</p>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  {p.phone && <span className="flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{p.phone}</span>}
                                  {p.state && <span>{p.state}</span>}
                                </div>
                              </div>
                              {p.balance !== 0 && (
                                <Badge variant="outline" className={cn('text-xs py-0', p.balance > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600')}>
                                  {p.balance > 0 ? `+₹${p.balance}` : `-₹${Math.abs(p.balance)}`}
                                </Badge>
                              )}
                            </button>
                          ))}
                          {filteredParties.length > 20 && (
                            <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
                              Showing 20 of {filteredParties.length} — keep typing to narrow it down.
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/*
               * THE SUPPLIER'S BILL NUMBER — purchases only, and not optional
               * in the way the old field pretended.
               *
               * This is the single field that decides whether a purchase can
               * be matched to GSTR-2B, and since Rule 36(4) changed on
               * 1 Jan 2022, appearing in GSTR-2B is the ONLY lawful route to
               * input tax credit. Reconciliation keys on
               * supplier GSTIN + this number.
               *
               * It used to sit in the collapsed Details section labelled
               * "Invoice No." with the placeholder "Optional" — our words for
               * their document. Left blank, the API generates PUR-0001 and
               * stores THAT as the invoice number, so the record looks complete
               * and can never match. Measured on this shop: 10 of 16 purchases
               * could never reconcile.
               *
               * On a sale the number is genuinely ours to issue and can stay
               * auto-assigned and out of the way. That asymmetry is the real
               * difference between the two screens.
               */}
              {/*
               * 7g (master plan: "a purchase asks for the supplier's bill number
               * and date first"): the bill's DATE sits beside its number, both
               * copied off the supplier's paper — it was folded away in Details.
               * Side by side on a phone; stacked in the narrow desktop column,
               * where the "needed to claim GST" tag beside the label wrapped (#189)
               * and now sits under the field.
               */}
              {!isSale && (
                <div className="mt-3 pt-3 border-t border-border grid grid-cols-[minmax(0,1fr)_9.5rem] lg:grid-cols-1 gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-h-12 lg:min-h-0">
                      <Label htmlFor="field-supplier-bill-no">Supplier&apos;s bill no.</Label>
                      {canClaimGst && <InfoHint
                        label="Supplier's bill no."
                        text="Copy it exactly as printed. GST matches your purchase to the supplier's filing by this number, so a different number will not match."
                      />}
                    </div>
                    <Input
                      id="field-supplier-bill-no"
                      value={invoiceNo}
                      onChange={(e) => { markDirty(); setInvoiceNo(e.target.value) }}
                      placeholder="As printed"
                      className="mt-1"
                    />
                    {canClaimGst && !invoiceNo.trim() && (
                      <p className="text-xs text-amber-600 mt-1">Needed to claim GST</p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor="field-date" className="flex items-center min-h-12 lg:min-h-0">Bill date</Label>
                    <Input id="field-date" type="date" value={date} onChange={(e) => { markDirty(); setDate(e.target.value) }} className="mt-1" />
                  </div>
                </div>
              )}

              {/*
               * #135 — do the supplier's rates include GST? Asked once per
               * bill, on the purchase side only. The product's own "price
               * includes GST" flag describes what the SHOP charges (its MRP),
               * so borrowing it for a supplier's rate turned a ₹230 cost into
               * ₹219.05 + GST and re-costed the product without asking.
               * Default off: a GST tax invoice prints rates before tax.
               * Shown on an empty bill; hidden once every line came from a
               * saved bill (a debit note loaded from the purchase) — those
               * lines carry their own setting.
               */}
              {isPurchaseSide && (items.length === 0 || items.some(i => typeof i.priceIncludesGst !== 'boolean')) && (
                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-3">
                  {/* Not a <label>: the ⓘ inside must not also flip the switch. */}
                  <span className="text-sm font-medium min-w-0">
                    <SettingLabel
                      title="Rates include GST"
                      hint="Turn on when the supplier's rates already have GST in them, like an MRP or a kachcha bill. Leave off for a GST tax invoice, which shows rates before GST and adds it at the bottom."
                    />
                  </span>
                  <Switch
                    id="field-rates-include-gst"
                    aria-label="Rates include GST"
                    checked={purchaseRatesIncludeGst}
                    onCheckedChange={(v) => { markDirty(); setPurchaseRatesIncludeGst(v) }}
                  />
                </div>
              )}
            </div>
          </Card>

          {/* Transaction details */}
          {/*
           * Collapsed on a phone, open on desktop.
           *
           * Details holds Date, Invoice No., GST type, Discount, Payment mode
           * and Paid amount — roughly 470px of form. On the overwhelming
           * majority of sales none of it is touched: the date defaults to
           * today, the invoice number is optional and auto-assigned, GST is
           * derived from the customer, there is no discount, and payment is
           * cash in full. Six controls held permanent space to be left alone.
           *
           * The header states what is inside, so it never has to be opened to
           * be checked — "7 Aug · Cash" answers the question the section exists
           * to answer. Desktop keeps everything expanded, because there the
           * right-hand column is otherwise empty space.
           */}
          <Card className="shadow-card border-border/60 lg:order-none order-3 py-0">
            <div className="p-3 sm:p-4 space-y-3">
              <button
                type="button"
                onClick={() => setDetailsOpen(v => !v)}
                className="w-full flex items-center justify-between gap-2 min-h-12 lg:pointer-events-none"
                aria-expanded={detailsOpen}
              >
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Calendar className="w-4 h-4" /> Details
                </h3>
                <span className="flex items-center gap-2 lg:hidden">
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {[
                      // 7g: a purchase's date is on screen beside the supplier's bill no.
                      isSale && new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                      // 6d: on the Counter the Pay sheet holds the payment, so the fold does not name one.
                      !counterMode && paymentMode.charAt(0).toUpperCase() + paymentMode.slice(1),
                      // Phase 2c: a delivery elsewhere changes the tax — visible while folded.
                      deliveryCode && `to ${stateNameForCode(deliveryCode)}`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                  <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', detailsOpen && 'rotate-180')} />
                </span>
              </button>
              <div className={cn('space-y-3', !detailsOpen && 'hidden lg:block')}>
              {/*
               * On a SALE the date and invoice number stay here, optional — the
               * number is ours to issue, and the app assigns one.
               *
               * On a PURCHASE both are copied off the supplier's bill, and they
               * sit above the item list instead (7g). One date field per screen.
               */}
              {isSale && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="field-date">Date</Label>
                    <Input id="field-date" type="date" value={date} onChange={(e) => { markDirty(); setDate(e.target.value) }} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="field-invoice-no">Invoice No.</Label>
                    <Input id="field-invoice-no" value={invoiceNo} onChange={(e) => { markDirty(); setInvoiceNo(e.target.value) }} placeholder="Auto" className="mt-1" />
                  </div>
                </div>
              )}

              {/* 🔒 R10-1: the tax head is DERIVED, not chosen.
                  Editable only while the app genuinely cannot tell.
                  Phase 1c-2: hidden on a bill that carries no GST. */}
              {showsGst && (
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm" htmlFor="field-inter-state-igst">GST type</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {derivedInterState.indeterminate
                        ? 'Set your shop\u2019s state to decide this automatically'
                        : taxSplitPending
                          ? 'Answer \u201cWho gets the goods\u201d below'
                          : derivedInterState.isInterState
                          ? `${stateNameForCode(derivedInterState.shopCode)} \u2192 ${stateNameForCode(derivedInterState.posCode)} \u2014 different states`
                          : `Both in ${stateNameForCode(derivedInterState.shopCode)}`}
                    </p>
                  </div>
                  {derivedInterState.indeterminate ? (
                    <Switch checked={isInterState} onCheckedChange={setIsInterState} />
                  ) : (
                    <Badge variant="outline" className="text-xs font-semibold">
                      {/* Not answered yet: no tax head is shown as if decided. */}
                      {taxSplitPending ? '—' : derivedInterState.isInterState ? 'IGST' : 'CGST + SGST'}
                    </Badge>
                  )}
                </div>
                {derivedInterState.indeterminate ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                    Your shop&apos;s state is not set &mdash; add it in Shop profile so GST is worked out for you.
                  </p>
                ) : partyHasNoState && !deliveryCode && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                    {`${selectedParty?.name} has no state saved \u2014 counted as a local sale. Add it on their profile if they are in another state.`}
                  </p>
                )}
                {offersShipTo && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Label htmlFor="field-ship-elsewhere" className="text-sm">Ship to another address</Label>
                        <InfoHint
                          label="Ship to another address"
                          text="For goods sent by courier or transport. GST follows the state the goods are delivered to, and the bill prints the delivery address."
                        />
                      </div>
                      <Switch id="field-ship-elsewhere" checked={shipElsewhere} onCheckedChange={(v) => { markDirty(); setShipElsewhere(v); setBillToShipTo(null) }} />
                    </div>
                    {shipElsewhere && (
                      <div className="mt-2 space-y-2">
                        <div>
                          <Label htmlFor="field-delivery-state" className="text-xs">Delivery state</Label>
                          <StateField id="field-delivery-state" value={deliveryState} onChange={(v) => { markDirty(); setDeliveryState(v); setBillToShipTo(null) }} />
                        </div>
                        <div>
                          <Label htmlFor="field-delivery-address" className="text-xs">Delivery address</Label>
                          <Input id="field-delivery-address" value={deliveryAddress} onChange={(e) => { markDirty(); setDeliveryAddress(e.target.value) }} placeholder="Street, city, PIN" maxLength={300} className="mt-1 h-11" />
                        </div>
                        {asksShipTo && (
                          <div id="field-ship-to-choice" role="radiogroup" aria-label="Who gets the goods">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-medium">{`Who gets the goods in ${stateNameForCode(deliveryCode)}?`}</p>
                              <InfoHint
                                label="Who gets the goods"
                                text={`If ${selectedParty?.name} asked you to send the goods to their own customer, GST follows ${selectedParty?.name}\u2019s GST state, ${stateNameForCode(buyerGstinCode)} (bill-to-ship-to). If the goods are for ${selectedParty?.name}, GST follows the delivery state.`}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-1">
                              <Button type="button" role="radio" aria-checked={billToShipTo === true} variant={billToShipTo === true ? 'default' : 'outline'} className="h-auto min-h-11 py-2 px-2 whitespace-normal leading-tight" onClick={() => { markDirty(); setBillToShipTo(true) }}>Buyer&apos;s customer</Button>
                              <Button type="button" role="radio" aria-checked={billToShipTo === false} variant={billToShipTo === false ? 'default' : 'outline'} className="h-auto min-h-11 py-2 px-2 whitespace-normal leading-tight" onClick={() => { markDirty(); setBillToShipTo(false) }}>The buyer</Button>
                            </div>
                            {shipCheck.buyerLosesCredit && (
                              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                                {`${selectedParty?.name} can\u2019t claim this GST \u2014 their GSTIN is from ${stateNameForCode(buyerGstinCode)}.`}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* Rule 46(e): a buyer with no GST number, ₹50,000+ before GST. */}
              {showsGst && actualType === 'sale' && rule46e.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {`Bills of \u20b950,000 or more need the buyer\u2019s ${rule46e.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`}
                  </p>
                  <InfoHint
                    label="Bills of \u20b950,000 or more"
                    text="Rule 46(e) of the CGST Rules: when the buyer has no GST number and the bill is \u20b950,000 or more before GST, it must show their name, address and state."
                  />
                </div>
              )}

              {/* CGST Act s.10(2)(c): a composition shop may not sell to another state. */}
              {compositionElsewhere && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-1.5">
                  <p className="text-sm text-amber-800 dark:text-amber-300">A composition shop can&apos;t sell to another state.</p>
                  <InfoHint
                    label="Composition and other states"
                    text="Section 10(2)(c) of the CGST Act: a shop in the composition scheme may not sell to a buyer in another state. Speak to your CA before billing this."
                  />
                </div>
              )}

              {/*
               * REVERSE CHARGE — purchases only.
               *
               * The column has existed since V17-Ext and GSTR-3B reads it in
               * six places: it drives 3.1(d), the tax the shop owes directly,
               * and the matching credit in 4(A)(3). Nothing in the app could
               * ever set it, so 3.1(d) reported zero for every shop, always. A
               * kirana paying a transporter owes that tax and the return did
               * not say so — invisible until an audit.
               *
               * Placed under GST type because it answers the same question
               * from the other side: that one decides WHICH tax, this one
               * decides WHO pays it.
               *
               * The GST amounts are still computed from the item rates exactly
               * as before. Under reverse charge the supplier does not collect
               * the tax, but it is still owed at the same rate — which is why
               * GSTR-3B sums cgst/sgst/igst on these rows too. Nothing about
               * the money maths changes; only who hands it over.
               */}
              {!isSale && !isNote && shopGstStatus !== 'unregistered' && (
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label className="text-sm" htmlFor="field-reverse-charge">Reverse charge</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        The supplier did not charge GST — you pay it directly
                      </p>
                    </div>
                    <Switch
                      id="field-reverse-charge"
                      checked={isReverseCharge}
                      onCheckedChange={(v) => { markDirty(); setIsReverseCharge(v) }}
                    />
                  </div>
                  {isReverseCharge && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                      {formatINR(totalGst)} will be added to what you owe in GSTR-3B, and claimed
                      back as credit in the same return. Usual for transport, legal services, and
                      unregistered suppliers.
                    </p>
                  )}
                </div>
              )}

              {/*
                * Section 17(5) — purchases whose GST can never be claimed back.
                *
                * Worded as the shopkeeper experiences it, not as the Act states
                * it. Nobody buying a delivery van thinks "clause (a) of
                * sub-section (5)"; they think "can I get this tax back?". So
                * the control asks that, and the reasons are the things a real
                * shop actually buys.
                *
                * Off by default: most purchases ARE claimable, and defaulting
                * to blocked would quietly cost shopkeepers money — the mirror
                * of the fault this fixes.
                */}
              {!isSale && !isNote && canClaimGst && totalGst > 0 && (
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label className="text-sm" htmlFor="field-itc-blocked">Can&apos;t claim this GST back</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Some purchases don&apos;t give input credit, whatever they&apos;re for
                      </p>
                    </div>
                    <Switch
                      id="field-itc-blocked"
                      checked={!!itcBlockedReason}
                      onCheckedChange={(v) => { markDirty(); setItcBlockedReason(v ? 'personal' : '') }}
                    />
                  </div>
                  {!!itcBlockedReason && (
                    <div className="mt-3">
                      <Label className="text-xs text-muted-foreground" htmlFor="field-itc-reason">Reason</Label>
                      <select
                        id="field-itc-reason"
                        value={itcBlockedReason}
                        onChange={(e) => { markDirty(); setItcBlockedReason(e.target.value) }}
                        className="mt-1 w-full h-11 rounded-lg border border-input bg-background px-3 text-sm"
                      >
                        <option value="personal">For personal or family use</option>
                        <option value="staffWelfare">Food, drinks or staff welfare</option>
                        <option value="motorVehicle">Car or bike for carrying people</option>
                        <option value="construction">Building or repairing the shop</option>
                        <option value="lostOrFree">Given free, lost or damaged</option>
                        <option value="compositionSupplier">Supplier is under composition scheme</option>
                        <option value="other">Something else</option>
                      </select>
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                        {formatINR(totalGst)} won&apos;t be claimed as credit in GSTR-3B. Keep this
                        on — claiming it anyway means paying it back later with interest.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div>
                <Label htmlFor="field-discount">Discount (₹)</Label>
                <NumberField id="field-discount" value={discountAmount} onValueChange={(v) => { markDirty(); setDiscountAmount(v) }} placeholder="0" className="mt-1" min={0} step={1} decimals={2} prefix="₹" />
              </div>

              {/* 🔒 R10b-7 (Phase 3): Hide payment mode + paid amount on estimate
                  forms. Estimates are quotes — no payment is collected. Was: the
                  payment card showed, the user could pick "Card" and enter 500,
                  then on save paymentMode was silently forced to 'cash' while
                  paidAmount was sent through unchanged. */}
              {/* 6d: on the Counter, payment is chosen on the Pay sheet — one place, never two. */}
              {!estimateMode && !counterMode && (
                <div>
                  <Label htmlFor="field-payment-mode">Payment Mode</Label>
                  <Select value={paymentMode} onValueChange={(v) => { markDirty(); setPaymentMode(v) }}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* 🔒 AUDIT V24 §1: For credit/debit notes, "Paid Amount" means CASH
                  REFUNDED — and the common case is a pure khata adjustment (no cash).
                  The old sale-style field ("Leave empty for full payment") silently
                  meant "fully cash-refunded", so the return never reduced the
                  customer's balance. Notes now get an explicit refund toggle:
                  OFF (default) = adjust in khata (paidAmount 0), ON = cash refund. */}
              {isNote ? (
                <>
                  <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                    <div>
                      <Label className="cursor-pointer text-sm">
                        {isCreditNote ? 'Cash refunded to customer?' : 'Cash refunded by supplier?'}
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {cashRefundOn
                          ? 'Money was returned in cash/UPI — balance stays unchanged'
                          : partyId
                            ? `OFF: adjusts the party's khata by ${formatINR(totalAmount)}`
                            : `OFF: ${formatINR(totalAmount)} stays owed to the counter customer`}
                      </p>
                    </div>
                    <Switch checked={cashRefundOn} onCheckedChange={(v) => { markDirty(); setCashRefund(v) }} />
                  </div>
                  {cashRefundOn && (
                    <div>
                      <Label htmlFor="field-refund-amount">Refund Amount (₹)</Label>
                      <NumberField id="field-refund-amount"
                        value={paidAmount}
                        onValueChange={(v) => { markDirty(); setPaidAmount(v) }}
                        placeholder={`Full refund: ${formatINR(totalAmount, false)}`}
                        className="mt-1"
                        min={0}
                        step={10}
                        decimals={2}
                        prefix="₹"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Leave empty for a full cash refund. Any un-refunded portion adjusts the khata.
                      </p>
                    </div>
                  )}
                </>
              ) : !estimateMode && !counterMode ? (
                <div>
                  <Label htmlFor="field-paid-amount">Paid Amount (₹)</Label>
                  <NumberField id="field-paid-amount"
                    value={paidAmount}
                    onValueChange={(v) => { markDirty(); setPaidAmount(v) }}
                    /*
                     * 🔒 2026-08-05 (Phase 10): the placeholder and hint follow
                     * the payment mode. They used to say "Full" and "Leave empty
                     * for full payment" in every mode — including Credit
                     * (Udhaar), where an empty field means the customer paid
                     * NOTHING. A shopkeeper recording udhaar did exactly as the
                     * hint said and the debt was stored as fully paid.
                     */
                    placeholder={paymentMode === 'credit' ? 'Unpaid: 0' : `Full: ${formatINR(totalAmount, false)}`}
                    className="mt-1"
                    min={0}
                    step={10}
                    decimals={2}
                    prefix="₹"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {paymentMode === 'credit'
                      ? `Leave empty for full udhaar — ${formatINR(totalAmount)} stays owing. Enter an amount if they paid part of it.`
                      : 'Leave empty for full payment'}
                  </p>
                </div>
              ) : null}
              </div>
            </div>
          </Card>

          {/*
           * COST PRICE — offered only when this bill actually changes one.
           *
           * `purchasePrice` was read everywhere and written by nothing: stock
           * valuation is currentStock × purchasePrice, and every sale's profit
           * is salePrice − purchasePrice. A shop whose supplier raised prices
           * kept valuing stock at the old cost and reporting profit it had not
           * made, until someone remembered to edit each product by hand.
           *
           * Asked rather than done silently. Cost is the number the shop's
           * profit is measured against, and a bill can legitimately be a
           * one-off — a rush purchase at a bad price should not quietly
           * redefine what everything is worth. Default on, because the usual
           * case is that the price genuinely moved.
           */}
          {costChanges.length > 0 && (
            <Card className="shadow-card border-border/60 border-primary/30 order-3 lg:order-none">
              <div className="p-3 sm:p-4">
                {/* Not a <label>: the ⓘ inside must not also flip the switch. */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold min-w-0">
                    <SettingLabel
                      title={`Update cost ${costChanges.length === 1 ? 'price' : 'prices'}?`}
                      hint="This bill's before-GST price differs from the cost saved on the product. Stock value and future profit use the saved cost."
                    />
                  </span>
                  <Switch
                    aria-label="Update cost price"
                    checked={updateProductCosts}
                    onCheckedChange={(v) => { markDirty(); setUpdateProductCosts(v) }}
                  />
                </div>
                <div className="mt-3 space-y-1.5">
                  {costChanges.map((c) => (
                    <div key={c.productId} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate min-w-0">{c.name}</span>
                      <span className="flex-shrink-0 tabular-nums">
                        <span className="text-muted-foreground line-through">{formatINR(c.from)}</span>
                        {' → '}
                        <span className={cn('font-semibold', c.to > c.from ? 'text-rose-600' : 'text-emerald-600')}>
                          {formatINR(c.to)}
                        </span>
                        <span className="text-muted-foreground">/{c.unit}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* Live summary */}
          <Card className="shadow-card border-border/60 sticky top-20 lg:order-none order-4 py-0">
            <div className="p-3 sm:p-4">
              <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                <IndianRupee className="w-4 h-4" /> Summary
              </h3>

              {/*
                * #91 — this bill needs to be TWO documents.
                *
                * IN THE SUMMARY, and that placement is the fix for a real bug.
                * It was first put beside the IGST/CGST indicator, which reads
                * as the natural home — both answer "what kind of bill is
                * this?". That block is marked `hidden lg:block`: DESKTOP ONLY.
                * So on a phone, which is what this app is for, the warning did
                * not exist. Found by opening the sale screen at 375px and
                * finding the panel in the DOM with zero height.
                *
                * The Summary renders at every width and is what a shopkeeper
                * checks before saving, so a warning about the document they
                * are about to produce belongs here.
                *
                * It WARNS and does not block — someone at the counter with a
                * customer waiting is the worst moment to refuse a sale over a
                * documentation rule they have never heard of.
                */}
              {mixedSupply.needsSplit && (
                <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-2.5">
                  <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                    This needs two bills, not one
                  </p>
                  <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                    {mixedSupply.message}
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {mixedSupply.documents.map(d => (
                      <li key={d} className="text-xs text-amber-800 dark:text-amber-300 flex gap-1.5">
                        <span>&bull;</span><span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal ({items.length} items)</span>
                  <span className="font-medium">{formatINR(subtotal)}</span>
                </div>
                {totalDiscount > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="font-medium text-rose-600">-{formatINR(totalDiscount)}</span>
                  </div>
                )}
                {showsGst && (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">GST Total</span>
                      <span className="font-medium">{formatINR(totalGst)}</span>
                    </div>
                    {taxSplitPending ? (
                      <div className="flex items-center justify-between text-xs text-check pl-4">
                        <span>Tax split: answer &ldquo;Who gets the goods&rdquo;</span>
                      </div>
                    ) : !isInterState ? (
                      <div className="flex items-center justify-between text-xs text-muted-foreground pl-4">
                        <span>CGST + SGST</span>
                        <span>{formatINR(cgst)} + {formatINR(sgst)}</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-xs text-muted-foreground pl-4">
                        <span>IGST</span>
                        <span>{formatINR(igst)}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="border-t border-border pt-2 flex items-center justify-between">
                  <span className="font-semibold">Total</span>
                  <span className="text-xl font-bold">{formatINR(totalAmount)}</span>
                </div>
                {/* 🔒 AUDIT V24 §1: For notes, the "unpaid" portion is the khata
                    ADJUSTMENT (it reduces/increases the party balance) — show it
                    as such, not as scary red "Outstanding".
                    🔒 BUG-17 (Phase 6): Different label + color for credit notes
                    (customer khata) vs debit notes (supplier khata). */}
                {isNote && due > 0 && (
                  <div className={cn(
                    'flex items-center justify-between text-sm -mx-4 px-4 py-2 rounded-lg',
                    isCreditNote
                      ? 'bg-emerald-50 dark:bg-emerald-950/30'
                      : 'bg-amber-50 dark:bg-amber-950/30'
                  )}>
                    <span className={cn(
                      'font-medium flex items-center gap-1',
                      isCreditNote
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-amber-700 dark:text-amber-300'
                    )}>
                      <AlertCircle className="w-3.5 h-3.5" />
                      {isCreditNote ? 'Adjusted in customer khata' : 'Adjusted in supplier khata'}
                    </span>
                    <span className={cn(
                      'font-bold',
                      isCreditNote
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-amber-700 dark:text-amber-300'
                    )}>{formatINR(due)}</span>
                  </div>
                )}
                {!isNote && due > 0 && (
                  <div className="flex items-center justify-between text-sm bg-rose-50 dark:bg-rose-950/30 -mx-4 px-4 py-2 rounded-lg">
                    <span className="text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> Outstanding
                    </span>
                    <span className="font-bold text-rose-600 dark:text-rose-400">{formatINR(due)}</span>
                  </div>
                )}
                {!hideProfit && isSale && !isNote && totalProfit > 0 && (
                  <div className="flex items-center justify-between text-sm bg-emerald-50 -mx-4 px-4 py-2 rounded-lg">
                    <span className="text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5" /> Gross Profit
                    </span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-300">
                      {formatINR(totalProfit)}
                      <span className="text-xs ml-1">({marginPct(totalProfit)}%)</span>
                    </span>
                  </div>
                )}
                {!hideProfit && isSale && !isNote && noCostTaxable >= 0.01 && (
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>No cost price: profit not counted</span>
                    <span className="tabular-nums">{formatINR(noCostTaxable)}</span>
                  </div>
                )}
                {/* 🔒 AUDIT V25 FIX BUG-030 (Batch 5): Credit/debit notes REVERSE
                    profit, not earn it. Show a rose "Profit reversed" row with
                    the absolute value + negative sign so the user understands
                    the direction. Server stores negative; UI shows the magnitude
                    with a clear "reversed" label + down-arrow icon. */}
                {!hideProfit && isNote && totalProfit < 0 && (
                  <div className="flex items-center justify-between text-sm bg-rose-50 dark:bg-rose-950/20 -mx-4 px-4 py-2 rounded-lg">
                    <span className="text-rose-700 dark:text-rose-300 font-medium flex items-center gap-1">
                      <TrendingDown className="w-3.5 h-3.5" /> Profit Reversed
                    </span>
                    <span className="font-bold text-rose-700 dark:text-rose-300">
                      −{formatINR(Math.abs(totalProfit))}
                      <span className="text-xs ml-1">({marginPct(Math.abs(totalProfit))}%)</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* 🔒 V11 FIX: Mobile sticky save bar — shows total + save.
          Also disables Save when stock would go negative (block mode). */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-md border-t border-border p-2.5 flex items-center gap-2 z-30" style={{ paddingBottom: 'calc(0.625rem + var(--safe-bottom))' }}>
        {/*
         * The two numbers that decide a sale, always visible.
         *
         * This strip is the most valuable space on a phone and it held one
         * figure. The item count answers "did everything I scanned go in?"
         * without scrolling back up, and the amount due answers "how much am I
         * collecting right now?" — which matters more since Paid Amount moved
         * into the collapsed Details section and is no longer on screen.
         *
         * Due is shown only when it differs from the total, because on a
         * paid-in-full cash sale — most of them — repeating the same number
         * under a second label teaches the eye to stop reading the strip.
         */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">
            Total{items.length > 0 && ` · ${items.length} item${items.length === 1 ? '' : 's'}`}
          </p>
          <p className="text-lg font-bold tabular-nums leading-tight">{formatINR(totalAmount)}</p>
          {hasStockBlock ? (
            <p className="text-xs text-rose-600 font-medium">Not enough stock</p>
          ) : hasMrpBlock ? (
            <p className="text-xs text-bad font-medium">Price above MRP</p>
          ) : hasChecks ? (
            <p className="text-xs text-check font-medium">{checks.length} to check</p>
          ) : due > 0 && items.length > 0 ? (
            <p className="text-xs text-rose-600 font-medium tabular-nums">
              {formatINR(due)} due
            </p>
          ) : null}
        </div>
        {/* 7f: Hold beside Pay — this bill waits, the next customer starts. On a phone Cancel
            becomes ✕ while a bill has lines, so the three fit at 375 px. */}
        {items.length > 0 ? (
          <>
            <Button variant="outline" size="icon" onClick={handleCancel} className="h-11 w-11" aria-label="Cancel this bill">
              <X className="w-4 h-4" aria-hidden />
            </Button>
            <Button variant="outline" size="sm" onClick={() => { if (!saving) holdBill() }} className="h-11 px-3" aria-label="Hold this bill and start the next">
              Hold
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={handleCancel} className="h-11 px-4">
            Cancel
          </Button>
        )}
        {counterMode ? (
          <Button className="bg-gradient-saffron gap-2 shadow-md h-11 px-6 tabular-nums" onClick={() => setPaySheetOpen(true)} disabled={saving || saveBlocked || items.length === 0}>
            Pay {formatINR(totalAmount)}
          </Button>
        ) : (
          <Button className="bg-gradient-saffron gap-2 shadow-md h-11 px-6" onClick={() => handleSave()} disabled={saving || saveBlocked}>
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
          </Button>
        )}
      </div>

      {/* 🔒 V11 FIX: Desktop save bar — was MISSING entirely (only mobile had
          a Save button). Desktop users couldn't save transactions! Now shows
          a sticky bar at the bottom of the content area on lg+ screens. */}
      <div className="hidden lg:flex sticky bottom-0 bg-background/95 backdrop-blur-md border-t border-border p-3 items-center gap-3 z-20 -mx-4 px-4">
        <div className="flex-1 flex items-center gap-4">
          {/* Same two numbers as the mobile bar. The platforms should not
              disagree about what a sale's headline figures are. */}
          <div>
            <p className="text-xs text-muted-foreground">
              Total{items.length > 0 && ` · ${items.length} item${items.length === 1 ? '' : 's'}`}
            </p>
            <p className="text-xl font-bold tabular-nums">{formatINR(totalAmount)}</p>
          </div>
          {due > 0 && items.length > 0 && !saveBlocked && (
            <div className="text-sm font-medium text-rose-600 tabular-nums">
              {formatINR(due)} due
            </div>
          )}
          {hasStockBlock && (
            <div className="flex items-center gap-1.5 text-sm text-rose-600 font-medium bg-rose-50 dark:bg-rose-950/30 px-3 py-1.5 rounded-lg">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Not enough stock — record a purchase or enable overselling in Settings</span>
            </div>
          )}
          {!hasStockBlock && hasMrpBlock && (
            <div className="flex items-center gap-1.5 text-sm text-bad font-medium bg-bad-soft px-3 py-1.5 rounded-lg">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Price above MRP — lower it on the line</span>
            </div>
          )}
        </div>
        <Button variant="outline" onClick={handleCancel} className="h-11 px-5">
          Cancel
        </Button>
        {items.length > 0 && (
          <Button variant="outline" onClick={() => { if (!saving) holdBill() }} className="h-11 px-5" title="Hold this bill (F8)">
            Hold
          </Button>
        )}
        {counterMode ? (
          <Button className="bg-gradient-saffron gap-2 shadow-md h-11 px-8 tabular-nums" onClick={() => setPaySheetOpen(true)} disabled={saving || saveBlocked || items.length === 0}>
            Pay {formatINR(totalAmount)}
          </Button>
        ) : (
          <Button className="bg-gradient-saffron gap-2 shadow-md h-11 px-8" onClick={() => handleSave()} disabled={saving || saveBlocked}>
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
          </Button>
        )}
      </div>

      {counterMode && (
        <>
          <PaySheet
            open={paySheetOpen}
            onOpenChange={setPaySheetOpen}
            total={totalAmount}
            customerName={selectedParty?.name ?? null}
            upiLink={buildUpiLink(invoiceShopFromSetting(settingData?.setting), totalAmount)}
            saving={saving}
            onSave={(choice) => handleSave(choice)}
            onPickCustomer={() => {
              setPaySheetOpen(false)
              setTimeout(() => document.getElementById('field-party-search')?.focus(), 250)
            }}
          />
          <SavedSheet
            bill={savedBill}
            sharing={sharingBill}
            onShare={handleShareSaved}
            onPrint={handlePrintSaved}
            onNext={handleNextBill}
          />
        </>
      )}

      {/* 7c-2: price check (a sale) — price, MRP and stock; nothing is added unless asked. */}
      <Sheet open={!!checkedProduct} onOpenChange={(o) => { if (!o) setCheckedProduct(null) }}>
        <SheetContent side="bottom" className="rounded-t-3xl gap-0 pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-md">
          <SheetHeader className="pb-1">
            <SheetTitle className="text-base">{checkedProduct?.name}</SheetTitle>
            <SheetDescription className="sr-only">Price check</SheetDescription>
          </SheetHeader>
          {checkedProduct && (
            <div className="px-4 space-y-3">
              <p className="text-3xl font-bold tabular-nums">{formatINR(checkedProduct.salePrice)}<span className="text-sm font-normal text-muted-foreground">/{checkedProduct.unit}</span></p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p className="text-muted-foreground">MRP <span className="font-semibold text-foreground tabular-nums">{checkedProduct.mrp ? formatINR(checkedProduct.mrp) : '—'}</span></p>
                <p className="text-muted-foreground">In stock <span className="font-semibold text-foreground tabular-nums">{isService(checkedProduct) ? 'Service' : `${checkedProduct.currentStock} ${checkedProduct.unit}`}</span></p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" className="h-12" onClick={() => setCheckedProduct(null)}>Done</Button>
                <Button type="button" className="h-12" onClick={() => { handleAddProduct(checkedProduct, 1); setCheckedProduct(null) }}>Add to bill</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      {/* 7c-2: a barcode nobody knows yet. */}
      <Sheet open={!!unknownCode} onOpenChange={(o) => { if (!o) setUnknownCode(null) }}>
        <SheetContent side="bottom" className="rounded-t-3xl gap-0 pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-md">
          <SheetHeader className="pb-1">
            <SheetTitle className="text-base">New item?</SheetTitle>
            <SheetDescription>Barcode <span className="font-mono tabular-nums">{unknownCode}</span> is not in your items.</SheetDescription>
          </SheetHeader>
          <div className="px-4 grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-12" onClick={() => setUnknownCode(null)}>Not now</Button>
            <Button type="button" className="h-12" onClick={() => { setNewItemCode(unknownCode); setUnknownCode(null) }}>Add new item</Button>
          </div>
        </SheetContent>
      </Sheet>
      <ProductDialog
        open={!!newItemCode || !!newItemFor}
        onOpenChange={(o) => { if (!o) { setNewItemCode(null); setNewItemFor(null) } }}
        product={null}
        initial={{ barcode: newItemCode ?? undefined, name: newItemFor?.name || undefined }}
        onSuccess={(saved) => {
          queryClient.invalidateQueries({ queryKey: ['products'] })
          // The new item goes straight on the bill — what the scan (or the typed line) was for.
          if (saved) handleAddProduct(saved, 1)
          if (newItemFor) { const id = newItemFor.checkId; if (id !== null) setChecks((now) => now.filter((x) => x.id !== id)); setNewItemFor(null) }
        }}
      />

      {/* Add Party Dialog */}
      <AddPartyInline
        open={addPartyOpen}
        onOpenChange={setAddPartyOpen}
        defaultType={isSale ? 'customer' : 'supplier'}
        prefill={partySearch ? addPartyPrefill : undefined}
        onAdded={(newParty) => {
          refetchParties()
          setPartyId(newParty.id)
        }}
      />
    </div>
  )
}

function AddPartyInline({ open, onOpenChange, defaultType, onAdded, prefill }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultType: 'customer' | 'supplier'
  onAdded: (party: any) => void
  /** 6c-2: what was typed in the search that found nobody (phone or name). */
  prefill?: { name: string; phone: string }
}) {
  const [form, setForm] = useState({
    name: '', type: defaultType, phone: '', gstin: '', state: '', address: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({ name: prefill?.name ?? '', type: defaultType, phone: prefill?.phone ?? '', gstin: '', state: '', address: '' })
    }
    // Only when the dialog opens: typing in it must not be reset by the search behind it.
  }, [open, defaultType])

  const handleSave = async () => {
    if (!form.name.trim()) {
      sonnerToast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      const r = await offlineFetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        offline: { invalidate: ['/api/parties', '/api/dashboard'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      if (isQueuedResponse(r)) {
        sonnerToast.info('Saved offline — will sync when online', {
          icon: '☁️',
          description: 'Not yet sent to server. Will sync automatically when online.',
        })
        onOpenChange(false)
        return
      }
      const data = await r.json()
      sonnerToast.success(`${defaultType === 'customer' ? 'Customer' : 'Supplier'} added`)
      // 🔒 V20-025: Track party added event
      track(EVENTS.PARTY_ADDED, { type: defaultType })
      onAdded(data.party)
      onOpenChange(false)
    } catch (e: any) {
      sonnerToast.error(e?.message || 'Failed to add')
    } finally {
      setSaving(false)
    }
  }

  return (
    // 🔒 FIX M7: Was a Card with fixed positioning — no backdrop, no Esc, no
    // focus trap, no outside-click close. Now uses Radix Dialog (same as
    // ProductDialog) — gets all of these for free.
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" /> Add New {defaultType === 'customer' ? 'Customer' : 'Supplier'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="field-name">Name *</Label>
            <Input id="field-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus className="mt-1" />
          </div>
          <div>
            <Label htmlFor="field-phone">Phone</Label>
            <Input id="field-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1" />
          </div>
          {/* GSTIN before State: its first two digits fill the state (Phase 2b). */}
          <div>
            <Label htmlFor="field-gstin">GSTIN</Label>
            <GstinField id="field-gstin" value={form.gstin} onChange={(g, st) => setForm({ ...form, gstin: g, ...(st ? { state: st } : {}) })} />
          </div>
          <div>
            <Label htmlFor="field-state">State</Label>
            <StateField id="field-state" value={form.state} onChange={(v) => setForm({ ...form, state: v })} gstin={form.gstin} />
          </div>
          <div>
            <Label htmlFor="field-address">Address</Label>
            <Input id="field-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1 bg-gradient-saffron" onClick={handleSave} disabled={saving}>
            {saving ? 'Adding...' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
