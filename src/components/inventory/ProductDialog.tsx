'use client'

import { useEffect, useMemo, useState } from 'react'
import { describeSaveOutcome } from '@/lib/edit-conflict'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberField } from '@/components/ui/number-field'
import { Label } from '@/components/ui/label'
import { ScanLine } from 'lucide-react'
import { BarcodeScanner } from '@/components/common/BarcodeScanner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { haptic } from '@/lib/haptic'
import { track, EVENTS } from '@/lib/analytics'
import { TrendingUp } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { readError } from '@/lib/read-error'
import { useSetting } from '@/hooks/use-setting'
import { defaultTracksInventory } from '@/lib/inventory-tracking'
import { ratesForPicker, isLegacyGstRate } from '@/lib/gst-rates'
import { lookupExemption, CONDITION_QUESTION } from '@/lib/exempt-goods-lookup'


const UNITS = ['pcs', 'kg', 'gm', 'ltr', 'ml', 'm', 'box', 'dozen', 'packet']
// 🔒 V17 Audit §4.2: GST treatment options for GSTR-3B 3.1(c) breakdown
const GST_TREATMENTS = [
  { value: 'taxable', label: 'Taxable', desc: 'Normal GST applies' },
  { value: 'nil', label: 'Nil-rated', desc: '0% GST but taxable supply' },
  { value: 'exempt', label: 'Exempt', desc: 'No GST — not taxable' },
  { value: 'nonGst', label: 'Non-GST', desc: 'Outside GST scope' },
]

const EMPTY_FORM = {
  name: '', sku: '', barcode: '', hsn: '', category: '', unit: 'pcs',
  purchasePrice: '', salePrice: '', mrp: '', gstRate: '0',
  openingStock: '', lowStockThreshold: '5', notes: '',
  priceIncludesGst: false,
  gstTreatment: 'taxable',  // 🔒 V17 Audit §4.2
  // Goods by default. Flipped automatically when the shopkeeper types a SAC
  // (99xx), and always overridable — see the effect below.
  tracksInventory: true,
}

export function ProductDialog({ open, onOpenChange, product, onSuccess }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: any
  onSuccess?: () => void
}) {
  const [form, setForm] = useState(EMPTY_FORM)
  // Has the shopkeeper answered the goods/service question themselves? Once
  // they have, typing an HSN must stop re-deciding it for them.
  const [serviceTouched, setServiceTouched] = useState(false)
  const [barcodeOpen, setBarcodeOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  // 🔒 R15-5 (Round 15): Read hideProfit so the margin preview box is hidden
  // for staff-with-hideProfit. Was: shown unconditionally when both prices > 0.
  const { hideProfit } = useSetting()

  /*
   * What Notification 10/2025 says about this HSN (#84, #93).
   *
   * ONLY ASKED AT 0%. A rate above zero means the shopkeeper has told us they
   * charge tax on this item, and that settles it — the exemption question is
   * about which zero applies, not whether to override a rate they typed. The
   * same precedence the suggester uses server-side, so the screen and the API
   * cannot disagree about the same product.
   *
   * A pure lookup over a 182-key object, so it costs nothing to recompute as
   * the code is typed and needs no query.
   */
  const exemption = useMemo(() => {
    const rate = parseFloat(form.gstRate) || 0
    if (rate > 0) return null
    const code = form.hsn.trim()
    if (!code) return null
    const r = lookupExemption(code)
    return r.outcome === 'not-listed' ? null : r
  }, [form.hsn, form.gstRate])

  /*
   * One answer per condition, because a rule can carry two ("other than fresh
   * or chilled, other than pre-packaged and labelled") and BOTH must hold for
   * the exemption to apply.
   */
  const [conditionAnswers, setConditionAnswers] = useState<Record<string, 'exempt' | 'taxable'>>({})

  /* Memoised: a fresh array each render would re-fire the effect below on
     every keystroke, and it is the effect that writes the treatment. */
  const requiredConditions = useMemo(
    () => exemption?.outcome === 'needs-confirmation'
      ? exemption.rules[0].conditions.filter(c => CONDITION_QUESTION[c])
      : [],
    [exemption],
  )
  const allConditionsAnswered =
    requiredConditions.length > 0 && requiredConditions.every(c => conditionAnswers[c])

  /*
   * Exempt only if EVERY condition was answered the exempt way. One "no" and
   * the exemption is lost, which is how the notification reads — the
   * conditions are cumulative, not alternatives.
   *
   * Written as an effect rather than inside the button handler because with
   * two conditions no single click knows whether the other has been answered.
   */
  useEffect(() => {
    if (!allConditionsAnswered) return
    const exempt = requiredConditions.every(c => conditionAnswers[c] === 'exempt')
    setForm(f => (
      f.gstTreatment === (exempt ? 'exempt' : 'taxable')
        ? f
        : { ...f, gstTreatment: exempt ? 'exempt' : 'taxable' }
    ))
  }, [allConditionsAnswered, conditionAnswers, requiredConditions])

  /* A different item is a different question — never inherit the last answer. */
  useEffect(() => { setConditionAnswers({}) }, [form.hsn, form.gstRate])

  // Sync form when dialog opens or product changes
  useEffect(() => {
    if (open) {
      if (product) {
        setForm({
          name: product.name || '',
          sku: product.sku || '',
          barcode: product.barcode || '',
          hsn: product.hsn || '',
          category: product.category || '',
          unit: product.unit || 'pcs',
          purchasePrice: String(product.purchasePrice ?? ''),
          salePrice: String(product.salePrice ?? ''),
          mrp: product.mrp ? String(product.mrp) : '',
          gstRate: String(product.gstRate ?? 0),
          openingStock: String(product.openingStock ?? ''),
          lowStockThreshold: String(product.lowStockThreshold ?? 5),
          notes: product.notes || '',
          priceIncludesGst: product.priceIncludesGst ?? false,
          gstTreatment: product.gstTreatment || 'taxable',  // 🔒 V17 Audit §4.2
          tracksInventory: product.tracksInventory ?? true,
        })
      } else {
        setForm(EMPTY_FORM)
      }
      // Reset per-open: the next product this dialog is used for starts with
      // the HSN hint live again. Without this, ticking the box once would
      // suppress the suggestion for every product added afterwards, since the
      // dialog instance is reused.
      setServiceTouched(false)
    }
  }, [open, product])

  const handleSave = async () => {
    if (!form.name.trim()) {
      sonnerToast.error('Product name required')
      return
    }
    // 🔒 V17 Audit Phase 1 P1.5: Client-side check for contradictory gstRate + gstTreatment.
    // Exempt/Non-GST products must have gstRate=0. The Zod schema also enforces this
    // server-side, but the client-side check gives immediate feedback before the API call.
    const gstRateNum = parseFloat(form.gstRate) || 0
    if ((form.gstTreatment === 'exempt' || form.gstTreatment === 'nonGst') && gstRateNum > 0) {
      sonnerToast.error('Contradictory GST settings', {
        description: `${form.gstTreatment === 'exempt' ? 'Exempt' : 'Non-GST'} products must have GST rate 0%. Change the GST rate to 0% or set GST Treatment to Taxable/Nil-rated.`,
      })
      return
    }
    // 🔒 R15-6 (Round 15): Client-side validation for negative values.
    // parseFloat("-50") || 0 = -50 (truthy) — the old code would send -50 to
    // the server, which rejects via zod with a 400. The user got a generic
    // error instead of inline guidance. Now: catch negatives before the API call.
    const purchasePriceNum = parseFloat(form.purchasePrice) || 0
    const salePriceNum = parseFloat(form.salePrice) || 0
    const openingStockNum = parseFloat(form.openingStock) || 0
    const lowStockThresholdNum = parseFloat(form.lowStockThreshold) || 0
    if (purchasePriceNum < 0 || salePriceNum < 0 || openingStockNum < 0 || lowStockThresholdNum < 0) {
      sonnerToast.error('Prices, stock, and thresholds cannot be negative', {
        description: 'Please enter zero or positive values only.',
      })
      return
    }
    setSaving(true)
    try {
      const url = product ? `/api/products?id=${product.id}` : '/api/products'
      const method = product ? 'PUT' : 'POST'
      // 🔒 FIX: Convert string form values to numbers before sending.
      // The form stores all numeric fields as strings (e.g., purchasePrice: "95")
      // because HTML inputs return strings. But the server's zod schema expects
      // numbers (z.number(), not z.string()). Without this conversion, every
      // product create/update fails with a 400 "Expected number, received string".
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        hsn: form.hsn.trim() || null,
        category: form.category.trim() || null,
        unit: form.unit || 'pcs',
        purchasePrice: parseFloat(form.purchasePrice) || 0,
        salePrice: parseFloat(form.salePrice) || 0,
        mrp: form.mrp ? parseFloat(form.mrp) : null,
        gstRate: parseFloat(form.gstRate) || 0,
        openingStock: parseFloat(form.openingStock) || 0,
        lowStockThreshold: parseFloat(form.lowStockThreshold) || 0,
        notes: form.notes.trim() || null,
        priceIncludesGst: form.priceIncludesGst,
        gstTreatment: form.gstTreatment,  // 🔒 V17 Audit §4.2
        /*
         * Only true when the shopkeeper actually answered EVERY condition on
         * this screen (#94). Sending it unconditionally would mark items
         * confirmed that nobody looked at, which is the silent decision this
         * whole task exists to remove — and it would empty the review list by
         * hiding rows rather than by resolving them.
         *
         * A flag, not a timestamp: the server owns the clock.
         */
        gstTreatmentConfirmed: allConditionsAnswered || undefined,
        tracksInventory: form.tracksInventory,
        /*
         * 🔒 #29 (2026-08-13): the stamp this product carried when it was
         * opened, so the server can tell whether anyone else changed it since.
         *
         * The server has computed a conflict warning since Phase 5, and it has
         * never fired once — because this line did not exist, so the check read
         * `if (null && …)`. Sending it is what turns the feature on.
         *
         * Only on an edit. A create has nothing to have conflicted with.
         */
        ...(product ? { updatedAt: product.updatedAt ?? null } : {}),
      }
      const r = await offlineFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        offline: { invalidate: ['/api/products', '/api/dashboard'] },
      })
      if (!r.ok) throw new Error(await readError(r))

      /*
       * 🔒 #29 (2026-08-13): SHOW the conflict warning.
       *
       * The server has returned `conflictWarning` for products since Phase 5
       * and nothing ever read it. A warning the server sends and the client
       * drops is not a warning.
       *
       * Same shared decision the invoice screen uses, so the two cannot drift.
       */
      const queuedOffline = isQueuedResponse(r)
      const saved = queuedOffline ? null : await r.clone().json().catch(() => null)
      const outcome = describeSaveOutcome(saved, {
        queuedOffline,
        subject: 'product',
        successTitle: product ? 'Product updated' : 'Product added successfully',
      })

      if (outcome.kind === 'warning') {
        haptic.warning()
        sonnerToast.warning(outcome.title, {
          description: outcome.description,
          duration: outcome.durationMs,
        })
      } else {
        sonnerToast.success(outcome.title, { duration: outcome.durationMs })
        haptic.success()
      }

      // 🔒 V20-025: Track product added/updated event
      if (!queuedOffline && !product) {
        track(EVENTS.PRODUCT_ADDED, { gstRate: payload.gstRate, unit: payload.unit })
      }
      onSuccess?.()
      onOpenChange(false)
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e?.message || "Couldn\'t save the product")
    } finally {
      setSaving(false)
    }
  }

  const purchasePrice = parseFloat(form.purchasePrice) || 0
  const salePrice = parseFloat(form.salePrice) || 0
  const profit = salePrice - purchasePrice
  const margin = salePrice > 0 ? (profit / salePrice) * 100 : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? 'Edit Product' : 'Add New Product'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          <div className="sm:col-span-2">
            <Label htmlFor="field-product-name">Product Name *</Label>
            <Input id="field-product-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Aashirvaad Atta 5kg" />
          </div>
          <div>
            <Label htmlFor="field-sku-code">SKU / Code</Label>
            <Input id="field-sku-code" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. ATA001" />
          </div>
          {/*
           * Barcode — the thing the camera reads, and the reason the scanner
           * has never worked.
           *
           * The app has had a barcode scanner since V8 and nowhere to store
           * what it scanned: ProductPicker and Inventory both matched on
           * `p.barcode`, a field that did not exist on the model, so every scan
           * silently matched nothing. Storing the EAN in "SKU" was the only
           * workaround, and it costs the shopkeeper their own code.
           *
           * The scan button matters more than the field. A 13-digit EAN typed
           * by hand is a transcription error waiting to happen, and the whole
           * point of a barcode is not typing it.
           */}
          <div>
            <Label htmlFor="field-barcode">Barcode</Label>
            <div className="flex gap-2 mt-1">
              <Input
                id="field-barcode"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                onKeyDown={(e) => {
                  // A wedge scanner gun presses Enter after typing the code.
                  // The product is still half-entered at this point, so Enter
                  // must not save it — swallow the key, keep the value.
                  if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
                }}
                placeholder="Scan or type the code on the packet"
                inputMode="numeric"
                className="flex-1 font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setBarcodeOpen(true)}
                className="flex-shrink-0 gap-1.5"
                aria-label="Scan barcode for this product"
              >
                <ScanLine className="w-4 h-4" />
                <span className="hidden sm:inline">Scan</span>
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground mt-1">
              Scan it once here and this product comes up instantly at billing.
            </p>
          </div>
          <div>
            <Label htmlFor="field-category">Category</Label>
            <Input id="field-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Flour" />
          </div>
          <div>
            <Label htmlFor="field-hsn-sac-code">HSN/SAC Code</Label>
            <Input
              id="field-hsn-sac-code"
              value={form.hsn}
              onChange={(e) => {
                const hsn = e.target.value
                // A SAC (99xx) says "service" — pre-tick the box for someone
                // who would never think to look for it. Only until they touch
                // the box themselves: after that their choice is the answer,
                // because a shop may legitimately want to count something the
                // code calls a service, and nothing here should argue.
                setForm(f => ({
                  ...f,
                  hsn,
                  ...(serviceTouched || product ? {} : { tracksInventory: defaultTracksInventory(hsn) }),
                }))
              }}
              placeholder="e.g. 1101 (goods) or 9971 (service)"
            />
          </div>
          <div>
            <Label htmlFor="field-unit">Unit</Label>
            <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="field-purchase-price">Purchase Price (₹) *</Label>
            <NumberField id="field-purchase-price" value={form.purchasePrice} onValueChange={(v) => setForm({ ...form, purchasePrice: v })} placeholder="0" min={0} step={1} decimals={2} />
          </div>
          <div>
            <Label htmlFor="field-sale-price">Sale Price (₹) *</Label>
            <NumberField id="field-sale-price" value={form.salePrice} onValueChange={(v) => setForm({ ...form, salePrice: v })} placeholder="0" min={0} step={1} decimals={2} />
          </div>
          <div>
            <Label htmlFor="field-mrp">MRP (₹)</Label>
            <NumberField id="field-mrp" value={form.mrp} onValueChange={(v) => setForm({ ...form, mrp: v })} placeholder="optional" min={0} step={1} decimals={2} />
          </div>
          <div>
            <Label htmlFor="field-gst-rate">GST Rate (%)</Label>
            <Select value={form.gstRate} onValueChange={(v) => setForm({ ...form, gstRate: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* Current slabs only, PLUS this product's own rate if it is a legacy
                    one (#86). Passing the value is what stops a pre-September
                    12% product being silently reset the moment someone opens
                    it to fix a typo. */}
                {ratesForPicker(parseFloat(form.gstRate)).map(r => (
                  <SelectItem key={r} value={String(r)}>
                    {r}%{isLegacyGstRate(r) ? ' (old rate)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/*
            * #93 — THE QUESTION THE APP MUST ASK INSTEAD OF GUESSING.
            *
            * Notification 10/2025 exempts most kirana staples only "other than
            * pre-packaged and labelled": loose rice is exempt, the same rice
            * branded and packed is 5%. Ninety-nine of its 210 rules turn on a
            * condition like that, and no HSN code carries the answer — 1006 is
            * 1006 either way.
            *
            * The old hand-written list answered "exempt" for all of them. The
            * new lookup refuses to, which left a 0% rice sitting on the schema
            * default of "taxable" — trading one silent wrong answer for
            * another. This is what closes that: the shopkeeper is looking
            * straight at the item, so this is the one moment the question is
            * cheap to answer and the answer is certain.
            *
            * Spans both columns because it is a question, not a field.
            */}
          {exemption?.outcome === 'needs-confirmation' && (
            <div className="sm:col-span-2 rounded-lg border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                This is GST-free only under a condition
              </p>
              <p className="text-2xs text-amber-800 dark:text-amber-300 mt-1 italic">
                “{exemption.rules[0].description}”
              </p>

              {/*
                * ONE QUESTION PER CONDITION, each in its own words.
                *
                * My first version asked "Is this sold loose, or pre-packaged?"
                * for every conditional entry. Only 41 of 99 are about
                * packaging — 26 turn on fresh-or-chilled, 13 on who sells it,
                * 11 on seed quality. A potato seller was being asked about
                * packaging when the law asks about freshness, and their answer
                * set a treatment on a question that was never posed.
                *
                * A rule with two conditions needs BOTH satisfied ("other than
                * fresh or chilled, other than pre-packaged and labelled"), so
                * each is asked separately rather than collapsed into one.
                */}
              {exemption.rules[0].conditions.map(code => {
                const q = CONDITION_QUESTION[code]
                if (!q) return null
                return (
                  <div key={code} className="mt-3">
                    <p className="text-2xs font-medium text-amber-900 dark:text-amber-200">{q.question}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Button
                        type="button" size="sm" variant="outline"
                        /* 48dp, not 44. §4's touch-target bar, and these are
                           the only controls here that decide a tax treatment. */
                        className="h-12"
                        onClick={() => setConditionAnswers(a => ({ ...a, [code]: 'exempt' }))}
                      >
                        {q.exemptLabel}
                      </Button>
                      <Button
                        type="button" size="sm" variant="outline"
                        className="h-12"
                        onClick={() => setConditionAnswers(a => ({ ...a, [code]: 'taxable' }))}
                      >
                        {q.taxableLabel}
                      </Button>
                      {conditionAnswers[code] && (
                        <span className="self-center text-2xs text-amber-900 dark:text-amber-200">
                          ✓ {conditionAnswers[code] === 'exempt' ? q.exemptLabel : q.taxableLabel}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}

              <p className="text-2xs text-amber-700 dark:text-amber-400 mt-3">
                {allConditionsAnswered
                  ? `Answered — this item is set to ${form.gstTreatment === 'exempt' ? 'Exempt' : 'Taxable'}.`
                  : 'Exempt and taxable go in different boxes of your GSTR-1, so this decides whether your return is right.'}
              </p>
              <p className="text-3xs text-amber-700 dark:text-amber-400 mt-2">
                {exemption.source} · entry {exemption.rules[0].serial}
              </p>
            </div>
          )}

          {/*
            * The confident case, shown for the same reason the question is:
            * so the shopkeeper can see WHY the app chose exempt, and which
            * line of which notification says so. §0 — every figure shows
            * receipts that open the real record.
            */}
          {exemption?.outcome === 'exempt' && (
            <div className="sm:col-span-2 rounded-lg border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3">
              <p className="text-2xs text-emerald-900 dark:text-emerald-200">
                <b>Exempt from GST.</b> {exemption.rules[0].description}
              </p>
              <p className="text-3xs text-emerald-700 dark:text-emerald-400 mt-1">
                {exemption.source} · entry {exemption.rules[0].serial}
              </p>
            </div>
          )}

          {/* 🔒 V17 Audit §4.2: GST treatment — for GSTR-3B 3.1(c) nil/exempt/non-GST breakdown */}
          <div>
            <Label htmlFor="field-gst-treatment">GST Treatment</Label>
            <Select value={form.gstTreatment} onValueChange={(v) => setForm({ ...form, gstTreatment: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GST_TREATMENTS.map(t => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex flex-col">
                      <span>{t.label}</span>
                      <span className="text-3xs text-muted-foreground">{t.desc}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* 🔒 V12: MRP / GST-inclusive pricing. When on, the Sale Price is
              treated as already including GST (the Indian retail norm) and the
              taxable value is back-calculated at sale time. */}
          <div className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-border/60 p-3">
            <input
              id="priceIncludesGst"
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
              checked={form.priceIncludesGst}
              onChange={(e) => setForm({ ...form, priceIncludesGst: e.target.checked })}
            />
            <label htmlFor="priceIncludesGst" className="text-sm cursor-pointer">
              <span className="font-medium">Sale price includes GST (MRP)</span>
              <span className="block text-xs text-muted-foreground">
                Turn on for MRP-priced goods (packaged items). GST is taken out of the price instead of added on top.
              </span>
            </label>
          </div>
          {/* Goods or a service? The single question that decides whether this
              product is counted at all. Placed directly above the stock fields
              it controls, so the two boxes disappearing is an obvious
              consequence of the tick rather than a mystery. */}
          <div className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-border/60 p-3">
            <input
              id="isService"
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
              checked={!form.tracksInventory}
              onChange={(e) => {
                setServiceTouched(true)
                setForm({ ...form, tracksInventory: !e.target.checked, openingStock: e.target.checked ? '' : form.openingStock })
              }}
            />
            <label htmlFor="isService" className="text-sm cursor-pointer">
              <span className="font-medium">This is a service — don&apos;t track stock</span>
              <span className="block text-xs text-muted-foreground">
                For work you do rather than goods you keep: stitching, repairs, haircuts, consulting.
                No stock count, no low-stock alerts, and it never blocks a bill.
              </span>
            </label>
          </div>
          {/* Hidden, not disabled, for a service. A greyed-out "Opening Stock: 0"
              still asks the shopkeeper to think about a number that does not
              exist for a haircut. */}
          {form.tracksInventory && (
            <>
              <div>
                <Label htmlFor="field-opening-stock">Opening Stock</Label>
                <NumberField id="field-opening-stock" value={form.openingStock} onValueChange={(v) => setForm({ ...form, openingStock: v })} placeholder="0" min={0} step={1} decimals={3} />
              </div>
              <div>
                <Label htmlFor="field-low-stock-alert-at">Low Stock Alert At</Label>
                <NumberField id="field-low-stock-alert-at" value={form.lowStockThreshold} onValueChange={(v) => setForm({ ...form, lowStockThreshold: v })} placeholder="5" min={0} step={1} decimals={3} />
              </div>
            </>
          )}
        </div>

        {/* 🔒 R15-5 (Round 15): Hide profit preview for hideProfit.
            Staff with hideProfit must not see the margin calculation. */}
        {!hideProfit && purchasePrice > 0 && salePrice > 0 && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="text-sm">
              <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                Profit per unit: {formatINR(profit)}
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                Margin: {margin.toFixed(1)}%
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {/*
            * type="button" stated explicitly.
            *
            * There is no <form> around these fields today, so a button defaults
            * to submit harmlessly — I checked, and that is why this was not a
            * live bug. But the safety is a property of the markup AROUND this
            * line, not of the line itself: wrap these fields in a <form> for
            * any reason and Cancel silently starts SAVING the product it exists
            * to discard. One word now, versus a very confusing bug report later.
            */}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-saffron">
            {saving ? 'Saving...' : (product ? 'Update Product' : 'Add Product')}
          </Button>
        </DialogFooter>
      </DialogContent>
      {/* Sits outside DialogContent: it is a full-screen overlay of its own and
          must not be clipped by the dialog it was opened from. */}
      {barcodeOpen && (
        <BarcodeScanner
          onScan={(code) => { setForm(f => ({ ...f, barcode: code })); setBarcodeOpen(false) }}
          onClose={() => setBarcodeOpen(false)}
        />
      )}
    </Dialog>
  )
}
