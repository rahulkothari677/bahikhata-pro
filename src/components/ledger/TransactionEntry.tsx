'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAppStore } from '@/store/app-store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useToast } from '@/hooks/use-toast'
import { toast as sonnerToast } from 'sonner'
import { formatINR, cn, getInitials } from '@/lib/utils'
import {
  ShoppingCart, Truck, Plus, X, Search, ChevronDown, ChevronRight,
  TrendingUp, Calendar, User, ScanLine, Folder, FolderOpen,
  Package, Phone, IndianRupee, Save, Trash2, Check, AlertCircle, Mic, Clock,
} from 'lucide-react'
import { VoiceEntry } from '@/components/common/VoiceEntry'
import { DraftManagerModal } from '@/components/common/DraftManagerModal'
import { BarcodeScanner } from '@/components/common/BarcodeScanner'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { useDrafts } from '@/hooks/use-drafts'
import { haptic } from '@/lib/haptic'
import { trackRecentProduct, getRecentProductIds } from '@/lib/recent-products'
import { useRatePrompt } from '@/hooks/use-rate-prompt'

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
}

export function TransactionEntry({ type }: { type: LedgerType }) {
  const isSale = type === 'sale'
  const { setView, triggerRefresh, setScannerBillType, previousView, setPreviousView, features } = useAppStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [partyId, setPartyId] = useState('')
  const [partySearch, setPartySearch] = useState('')
  const [partyDropdownOpen, setPartyDropdownOpen] = useState(false)
  const [addPartyOpen, setAddPartyOpen] = useState(false)

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [invoiceNo, setInvoiceNo] = useState('')
  const [isInterState, setIsInterState] = useState(false)
  const [paymentMode, setPaymentMode] = useState('cash')
  const [paidAmount, setPaidAmount] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')
  const [notes, setNotes] = useState('')

  // Cascading product selection
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [productSearch, setProductSearch] = useState('')
  const [items, setItems] = useState<ItemRow[]>([])

  const [saving, setSaving] = useState(false)
  const [showVoiceEntry, setShowVoiceEntry] = useState(false)
  const [draftModalOpen, setDraftModalOpen] = useState(false)
  const [barcodeOpen, setBarcodeOpen] = useState(false)
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
  const { drafts, activeDraftId, save, restoreDraft, deleteDraft, clearActive, refresh: refreshDrafts, hasDrafts } = useDrafts<{
    partyId: string
    date: string
    invoiceNo: string
    isInterState: boolean
    paymentMode: string
    paidAmount: string
    discountAmount: string
    notes: string
    items: ItemRow[]
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
        if (!isNaN(d.getTime())) setDate(d.toISOString().slice(0, 10))
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
      })))
    }
    try { haptic.success() } catch {}
    sonnerToast.success(`Draft restored — ${draft.items?.length || 0} item${(draft.items?.length || 0) === 1 ? '' : 's'}`)
  }, [restoreDraft])

  // Autosave on form changes (debounced inside the hook).
  // Skip autosave when:
  // - preset check hasn't completed yet (avoid empty drafts during mount)
  // - form was filled by a preset (Repeat Last Sale / Scanner) — the user
  //   intends to save immediately, not come back later. Autosave resumes
  //   once the user manually modifies the form (presetLoaded cleared).
  useEffect(() => {
    if (!presetChecked) return
    if (presetLoaded) return // Don't autosave preset-filled forms
    save({
      partyId,
      date,
      invoiceNo,
      isInterState,
      paymentMode,
      paidAmount,
      discountAmount,
      notes,
      items,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId, date, invoiceNo, isInterState, paymentMode, paidAmount, discountAmount, notes, items, presetChecked, presetLoaded])

  // Fetch products
  const { data: productsData } = useQuery({
    queryKey: ['products', 'for-entry'],
    queryFn: async () => {
      const r = await offlineFetch('/api/products')
      return r.json()
    },
  })
  const products: any[] = productsData?.products || []
  // Memoize productMap — only rebuilds when products array changes
  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  // Fetch parties
  const { data: partiesData, refetch: refetchParties } = useQuery({
    queryKey: ['parties', 'for-entry'],
    queryFn: async () => {
      const r = await offlineFetch('/api/parties')
      return r.json()
    },
  })
  const allParties: any[] = partiesData?.parties || []
  // Memoize filtered parties — only recomputes when allParties, isSale, or partySearch changes
  const filteredParties = useMemo(() => allParties.filter(p =>
    (p.type === (isSale ? 'customer' : 'supplier') || p.type === 'both') &&
    (!partySearch ||
      p.name?.toLowerCase().includes(partySearch.toLowerCase()) ||
      p.phone?.includes(partySearch))
  ), [allParties, isSale, partySearch])

  // Memoize categories — only rebuilds when products change
  const categories = useMemo(() =>
    Array.from(new Set(products.map(p => p.category || 'Uncategorized'))).sort(),
    [products]
  )
  // Recently used products — most recently used first.
  // Only show products that exist in current inventory (in case product was deleted).
  // Memoized: only recomputes when products array changes (not on every keystroke).
  const recentProducts = useMemo(() => {
    const recentIds = getRecentProductIds()
    return recentIds
      .map((id) => products.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .slice(0, 6)
  }, [products])
  const productsInCategory = useMemo(() =>
    selectedCategory
      ? products.filter(p => (p.category || 'Uncategorized') === selectedCategory)
      : products,
    [products, selectedCategory]
  )

  const filteredProducts = useMemo(() => productsInCategory.filter(p => {
    if (!productSearch) return true
    const q = productSearch.toLowerCase()
    return p.name?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      p.hsn?.toLowerCase().includes(q)
  }), [productsInCategory, productSearch])

  // Check for preset data (from scanner, party profile, or repeat last sale)
  // Uses a small delay to ensure the component is fully mounted (it's lazy-loaded)
  useEffect(() => {
    const checkPreset = () => {
      const stored = (window as any).__ledgerPreset
      if (!stored || stored.type !== type) return

      // If preset has items, clear any existing drafts first — we're starting
      // a fresh form with pre-filled data, so old drafts are stale.
      if (stored.data.items?.length > 0) {
        clearActive()
        // Also clear all existing drafts for this form type to prevent
        // accumulation of duplicate drafts from repeated "Repeat Last Sale" clicks
        try {
          const KEY = `bahikhata:drafts:txn-${type}:v2`
          localStorage.removeItem(KEY)
        } catch {}
        // Refresh the hook's state so it picks up the cleared localStorage
        refreshDrafts()
      }

      if (stored.data.partyId) setPartyId(stored.data.partyId)
      if (stored.data.invoiceNo) setInvoiceNo(stored.data.invoiceNo)
      if (stored.data.date) {
        try {
          const d = new Date(stored.data.date)
          if (!isNaN(d.getTime())) setDate(d.toISOString().slice(0, 10))
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
        }))
        setItems(newItems)
        // Mark that form was filled by a preset — suppresses autosave
        // until the user manually modifies the form
        setPresetLoaded(true)
      }
      if (stored.data.totalAmount) setPaidAmount(String(stored.data.totalAmount))
      ;(window as any).__ledgerPreset = null
    }

    // Small delay to ensure component is fully mounted after lazy-load
    const timer = setTimeout(() => {
      checkPreset()
      setPresetChecked(true)
    }, 100)
    return () => clearTimeout(timer)
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

  const handleAddProduct = (product: any) => {
    // User manually added a product — clear presetLoaded so autosave resumes
    setPresetLoaded(false)
    // Check if product already in list
    const existing = items.find(i => i.productId === product.id)
    if (existing) {
      setItems(items.map(i =>
        i.productId === product.id
          ? { ...i, quantity: i.quantity + 1 }
          : i
      ))
      sonnerToast.info(`Increased quantity of ${product.name}`)
    } else {
      setItems([...items, {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: isSale ? product.salePrice : product.purchasePrice,
        gstRate: product.gstRate,
        unit: product.unit,
      }])
    }
    setProductSearch('')
  }

  const handleUpdateItem = (index: number, field: keyof ItemRow, value: any) => {
    setPresetLoaded(false) // User manually edited — resume autosave
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
  }

  const handleRemoveItem = (index: number) => {
    setPresetLoaded(false) // User manually removed — resume autosave
    setItems(items.filter((_, i) => i !== index))
  }

  // Totals
  let subtotal = 0
  let totalGst = 0
  let totalProfit = 0
  const totalDiscount = parseFloat(discountAmount) || 0

  items.forEach(item => {
    const amount = (item.quantity || 0) * (item.unitPrice || 0)
    const itemGst = amount * (item.gstRate || 0) / 100
    subtotal += amount
    totalGst += itemGst
    if (isSale && item.productId) {
      const p = productMap.get(item.productId)
      if (p) totalProfit += (item.unitPrice - p.purchasePrice) * item.quantity
    }
  })

  // 💰 MONEY (Audit fix Phase 4): Round all money to 2 decimal places to
  // prevent float precision drift. Was: totalGst / 2 → 9.000000000000002
  const r = (n: number) => Math.round(n * 100) / 100
  const totalAmount = r(subtotal - totalDiscount + totalGst)
  const cgst = isInterState ? 0 : r(totalGst / 2)
  const sgst = isInterState ? 0 : r(totalGst - cgst)  // ensures cgst + sgst === totalGst exactly
  const igst = isInterState ? r(totalGst) : 0
  const paid = parseFloat(paidAmount) || 0
  const finalPaid = paidAmount === '' ? totalAmount : paid
  const due = r(totalAmount - finalPaid)

  const handleSave = async () => {
    if (items.length === 0) {
      toast({ title: 'Add at least one item', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const r = await offlineFetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          partyId: partyId || null,
          date,
          invoiceNo: invoiceNo || null,
          isInterState,
          paymentMode,
          paidAmount: finalPaid,
          discountAmount: totalDiscount,
          notes,
          items: items.map(i => ({
            productId: i.productId || null,
            productName: i.productName,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice),
            gstRate: Number(i.gstRate) || 0,
            discountAmount: 0,
          })),
        }),
        offline: { invalidate: ['/api/transactions', '/api/dashboard', '/api/products', '/api/parties', '/api/insights'] },
      })
      if (!r.ok) throw new Error('Failed')
      if (isQueuedResponse(r)) {
        sonnerToast.success(`${isSale ? 'Sale' : 'Purchase'} saved offline — will sync when online`)
      } else {
        sonnerToast.success(`${isSale ? 'Sale' : 'Purchase'} recorded successfully!`)
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
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      triggerRefresh()
      setView(isSale ? 'sales' : 'purchases')
    } catch (e) {
      haptic.error()
      toast({ title: 'Failed to save transaction', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    if (previousView) {
      setView(previousView)
    } else {
      setView(isSale ? 'sales' : 'purchases')
    }
    setPreviousView(null)
  }

  const accentColor = isSale ? 'text-emerald-600' : 'text-amber-600'
  const accentBg = isSale ? 'bg-emerald-100' : 'bg-amber-100'
  const accentGradient = isSale ? 'bg-gradient-emerald' : 'bg-gradient-saffron'

  return (
    <div className="space-y-4 pb-24 lg:pb-4">
      {/* Drafts button — opens modal showing all saved drafts from last 24h.
          Shows a badge with the count if there are any drafts. */}
      {hasDrafts && (
        <button
          onClick={() => { haptic.click(); setDraftModalOpen(true) }}
          className="w-full flex items-center justify-between gap-2 p-3 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 transition text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-primary">
                {drafts.length} saved draft{drafts.length === 1 ? '' : 's'}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {activeDraftId ? 'Editing a restored draft' : 'Tap to restore or delete previous drafts'}
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-primary flex-shrink-0" />
        </button>
      )}

      {/* Draft manager modal */}
      <DraftManagerModal
        open={draftModalOpen}
        onOpenChange={setDraftModalOpen}
        drafts={drafts}
        activeDraftId={activeDraftId}
        onRestore={handleRestoreDraft}
        onDelete={deleteDraft}
      />

      {/* Barcode scanner — scan to find and add product */}
      {barcodeOpen && (
        <BarcodeScanner
          onScan={(code) => {
            setBarcodeOpen(false)
            // Match scanned code against product SKU or name
            const match = products.find((p) =>
              p.sku === code || p.name?.toLowerCase() === code.toLowerCase()
            )
            if (match) {
              handleAddProduct(match)
            } else {
              // No match — put the code in the search field so user can see it
              setProductSearch(code)
            }
          }}
          onClose={() => setBarcodeOpen(false)}
        />
      )}

      {/* Top action bar — no Back button (app header has it) and no Save button (bottom bar has it) */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
            isSale ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-amber-100 dark:bg-amber-900/40'
          )}>
            {isSale
              ? <ShoppingCart className="w-5 h-5 text-emerald-600" />
              : <Truck className="w-5 h-5 text-amber-600" />}
          </div>
          <div>
            <h2 className="text-lg font-bold font-heading tracking-tight">New {isSale ? 'Sale' : 'Purchase'}</h2>
            <p className="text-xs text-muted-foreground">Fill in the details below</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setShowVoiceEntry(!showVoiceEntry)} className="gap-1.5">
            <Mic className="w-4 h-4" /> <span className="hidden sm:inline">Voice</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setScannerBillType(type); setView('scanner') }} className="gap-1.5">
            <ScanLine className="w-4 h-4" /> <span className="hidden sm:inline">Scan Bill</span>
          </Button>
        </div>
      </div>

      {/* Voice Entry Section */}
      {showVoiceEntry && (
        <Card className="shadow-card border-border/60 border-primary/30">
          <CardContent className="p-4">
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
              <Mic className="w-4 h-4 text-primary" /> Voice Entry
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Speak naturally: &quot;Sold 2 kg sugar to Ramesh at 50 rupees cash&quot;
            </p>
            <VoiceEntry
              products={products}
              onTransactionParsed={(data) => {
              // Apply parsed data to the form
              if (data.partyName) {
                const matched = allParties.find(p =>
                  p.name.toLowerCase().includes(data.partyName.toLowerCase()) ||
                  data.partyName.toLowerCase().includes(p.name.toLowerCase())
                )
                if (matched) setPartyId(matched.id)
              }
              if (data.paymentMode) setPaymentMode(data.paymentMode)
              if (data.items?.length > 0) {
                // APPEND items instead of replacing (so "Add More" works)
                const newItems = data.items.map((item: any) => {
                  // If price already filled by VoiceEntry, use it
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
                  // Otherwise try to match from inventory
                  const itemName = (item.productName || item.name || '').toLowerCase()
                  const product = products.find(p =>
                    p.name?.toLowerCase() === itemName
                  ) || products.find(p =>
                    p.name?.toLowerCase().includes(itemName) || itemName.includes(p.name?.toLowerCase())
                  )
                  return {
                    productId: product?.id || '',
                    productName: item.productName || item.name,
                    quantity: Number(item.quantity) || 1,
                    unitPrice: product ? (isSale ? product.salePrice : product.purchasePrice) : (Number(item.unitPrice) || 0),
                    gstRate: product?.gstRate || 0,
                    unit: product?.unit || item.unit || 'pcs',
                  }
                })
                setItems(prev => [...prev, ...newItems])
                sonnerToast.success(`Added ${newItems.length} items to sale`)
              }
              setShowVoiceEntry(false)
              sonnerToast.success('Voice entry applied! Review and save.')
            }} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: Product selection + items list (takes 2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Product selector card */}
          <Card className="shadow-card border-border/60">
            <div className="p-4 border-b border-border bg-muted/30">
              <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                <Package className="w-4 h-4" /> Add Products
              </h3>

              {/* Cascading: Category dropdown + Product search */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Category selector */}
                <div>
                  <Label className="text-[11px] uppercase text-muted-foreground">Category</Label>
                  <Select
                    value={selectedCategory || '__all__'}
                    onValueChange={(v) => setSelectedCategory(v === '__all__' ? null : v)}
                  >
                    <SelectTrigger className="mt-1 bg-background">
                      <Folder className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All Categories ({products.length})</SelectItem>
                      {categories.map(cat => {
                        const count = products.filter(p => (p.category || 'Uncategorized') === cat).length
                        return (
                          <SelectItem key={cat} value={cat}>
                            {cat} ({count})
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Product search */}
                <div className="sm:col-span-2">
                  <Label className="text-[11px] uppercase text-muted-foreground">Search Product</Label>
                  <div className="relative mt-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Type name, SKU, HSN, or scan barcode..."
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="pl-9 pr-12"
                    />
                    {features?.barcodeScanner && (
                      <button
                        type="button"
                        onClick={() => setBarcodeOpen(true)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-md hover:bg-muted text-primary"
                        aria-label="Scan barcode"
                        title="Scan barcode to find product"
                      >
                        <ScanLine className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Recently used products — quick-pick chips */}
              {!productSearch && !selectedCategory && recentProducts.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Recently Used
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {recentProducts.map((p) => {
                      const inList = items.find((i) => i.productId === p.id)
                      return (
                        <button
                          key={p.id}
                          onClick={() => handleAddProduct(p)}
                          className={cn(
                            'px-2.5 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-1.5',
                            inList
                              ? 'bg-emerald-100 dark:bg-emerald-950/40 border-emerald-300 text-emerald-700'
                              : 'bg-muted/50 border-border hover:bg-muted hover:border-primary/30'
                          )}
                        >
                          <Package className="w-3 h-3" />
                          <span className="truncate max-w-[100px]">{p.name}</span>
                          {inList && <Check className="w-3 h-3" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Product list - clickable to add */}
              {filteredProducts.length > 0 && (
                <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-border bg-background">
                  {filteredProducts.slice(0, 20).map(p => {
                    const inList = items.find(i => i.productId === p.id)
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleAddProduct(p)}
                        className="w-full flex items-center gap-3 p-2.5 hover:bg-muted/50 transition text-left border-b border-border/30 last:border-0"
                      >
                        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                          <Package className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            {p.category && <Badge variant="outline" className="text-[9px] py-0">{p.category}</Badge>}
                            <span>{formatINR(isSale ? p.salePrice : p.purchasePrice)}/{p.unit}</span>
                            <span>•</span>
                            <span>GST {p.gstRate}%</span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={cn(
                            'text-[11px] font-medium',
                            p.currentStock <= 0 ? 'text-rose-600' :
                            p.isLowStock ? 'text-amber-600' : 'text-emerald-600'
                          )}>
                            {p.currentStock} {p.unit}
                          </p>
                        </div>
                        <div className="flex-shrink-0">
                          {inList ? (
                            <Badge className="bg-emerald-100 text-emerald-700 text-[9px] gap-1">
                              <Check className="w-2.5 h-2.5" /> Added
                            </Badge>
                          ) : (
                            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                              <Plus className="w-4 h-4 text-primary" />
                            </div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                  {filteredProducts.length > 20 && (
                    <p className="text-center text-[11px] text-muted-foreground py-2">
                      Showing 20 of {filteredProducts.length} — refine search to see more
                    </p>
                  )}
                </div>
              )}

              {filteredProducts.length === 0 && (
                <div className="mt-3 text-center py-6 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                  <Package className="w-8 h-8 mx-auto mb-1 text-muted-foreground/50" />
                  {productSearch ? `No products match "${productSearch}"` : 'No products found. Add products in Inventory first.'}
                </div>
              )}
            </div>

            {/* Items list */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4" /> Selected Items
                  {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
                </h3>
                {items.length > 0 && (
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

              {/* Inline voice entry for adding more items */}
              {showVoiceEntry && items.length > 0 && (
                <Card className="shadow-card border-border/60 border-primary/30 mb-3">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                      <Mic className="w-4 h-4 text-primary" /> Add More Items via Voice
                    </h3>
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
                            const itemName = (item.productName || item.name || '').toLowerCase()
                            const product = products.find(p =>
                              p.name?.toLowerCase() === itemName
                            ) || products.find(p =>
                              p.name?.toLowerCase().includes(itemName) || itemName.includes(p.name?.toLowerCase())
                            )
                            return {
                              productId: product?.id || '',
                              productName: item.productName || item.name,
                              quantity: Number(item.quantity) || 1,
                              unitPrice: product ? (isSale ? product.salePrice : product.purchasePrice) : (Number(item.unitPrice) || 0),
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

              {items.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                  <ShoppingCart className="w-10 h-10 mx-auto mb-2 text-muted-foreground/40" />
                  <p>No items added yet</p>
                  <p className="text-[11px] mt-1">Click products above to add them here</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {items.map((item, i) => {
                    const itemTotal = item.quantity * item.unitPrice * (1 + item.gstRate / 100)
                    return (
                      <div key={i} className="rounded-lg bg-muted/20 border border-border/40 p-2 transition hover:bg-muted/30">
                        {/* Row 1: Number + Product name + Total + Delete */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-muted-foreground w-4 text-center flex-shrink-0">{i + 1}</span>
                          <p className="flex-1 min-w-0 text-sm font-medium truncate">{item.productName}</p>
                          <span className="text-xs font-bold tabular-nums flex-shrink-0">{formatINR(itemTotal)}</span>
                          <button
                            className="p-1 rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition flex-shrink-0"
                            onClick={() => handleRemoveItem(i)}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {/* Row 2: Qty + Unit + Price + GST — fills FULL width */}
                        <div className="flex items-center gap-1 pl-5 mt-1">
                          <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => handleUpdateItem(i, 'quantity', parseFloat(e.target.value) || 0)}
                            className="flex-1 min-w-0 h-8 text-center text-sm tabular-nums"
                            min="0"
                            step="0.01"
                          />
                          <span className="text-[10px] text-muted-foreground flex-shrink-0">{item.unit}</span>
                          <span className="text-[10px] text-muted-foreground flex-shrink-0">×</span>
                          <span className="text-[10px] text-muted-foreground flex-shrink-0">₹</span>
                          <Input
                            type="number"
                            value={item.unitPrice}
                            onChange={(e) => handleUpdateItem(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                            className="flex-1 min-w-0 h-8 text-center text-sm tabular-nums"
                            min="0"
                            step="0.01"
                          />
                          <Select
                            value={String(item.gstRate)}
                            onValueChange={(v) => handleUpdateItem(i, 'gstRate', parseFloat(v))}
                          >
                            <SelectTrigger className="w-14 h-8 text-xs px-1 flex-shrink-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {[0, 5, 12, 18, 28].map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Card>

          {/* Notes */}
          <Card className="shadow-card border-border/60">
            <div className="p-4">
              <Label>Notes (optional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes about this transaction..."
                className="mt-1"
              />
            </div>
          </Card>
        </div>

        {/* RIGHT: Party, date, payment, summary */}
        <div className="space-y-4">
          {/* Party selection */}
          <Card className="shadow-card border-border/60">
            <div className="p-4">
              <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                <User className="w-4 h-4" /> {isSale ? 'Customer' : 'Supplier'}
              </h3>

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
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {selectedParty.phone && <span className="flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{selectedParty.phone}</span>}
                      {selectedParty.balance !== 0 && (
                        <Badge variant="outline" className={cn('text-[9px] py-0', selectedParty.balance > 0 ? 'text-emerald-600 border-emerald-300' : 'text-rose-600 border-rose-300')}>
                          {selectedParty.balance > 0 ? `Owes ₹${selectedParty.balance}` : `You owe ₹${Math.abs(selectedParty.balance)}`}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setPartyId('')}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="relative" ref={partyDropdownRef}>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                  <Input
                    placeholder={`Search ${isSale ? 'customer' : 'supplier'} by name or phone...`}
                    value={partySearch}
                    onChange={(e) => { setPartySearch(e.target.value); setPartyDropdownOpen(true) }}
                    onFocus={() => setPartyDropdownOpen(true)}
                    className="pl-9"
                  />

                  {partyDropdownOpen && (
                    <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-popover border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                      {filteredParties.length === 0 ? (
                        <div className="p-4 text-center">
                          <p className="text-sm text-muted-foreground mb-2">
                            {partySearch ? `No match for "${partySearch}"` : `No ${isSale ? 'customers' : 'suppliers'} yet`}
                          </p>
                          <Button size="sm" className="bg-gradient-saffron gap-1" onClick={() => { setPartyDropdownOpen(false); setAddPartyOpen(true) }}>
                            <Plus className="w-3.5 h-3.5" /> Add New {isSale ? 'Customer' : 'Supplier'}
                          </Button>
                        </div>
                      ) : (
                        <>
                          {partySearch && (
                            <div className="px-3 py-1.5 text-[10px] text-muted-foreground uppercase font-medium border-b border-border">
                              {filteredParties.length} match{filteredParties.length !== 1 ? 'es' : ''}
                            </div>
                          )}
                          {filteredParties.slice(0, 20).map(p => (
                            <button
                              key={p.id}
                              onClick={() => { setPartyId(p.id); setPartyDropdownOpen(false); setPartySearch('') }}
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
                                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                  {p.phone && <span className="flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{p.phone}</span>}
                                  {p.state && <span>{p.state}</span>}
                                </div>
                              </div>
                              {p.balance !== 0 && (
                                <Badge variant="outline" className={cn('text-[9px] py-0', p.balance > 0 ? 'text-emerald-600' : 'text-rose-600')}>
                                  {p.balance > 0 ? `+₹${p.balance}` : `-₹${Math.abs(p.balance)}`}
                                </Badge>
                              )}
                            </button>
                          ))}
                          <div className="p-2 border-t border-border">
                            <Button variant="outline" size="sm" className="w-full gap-1" onClick={() => { setPartyDropdownOpen(false); setAddPartyOpen(true) }}>
                              <Plus className="w-3.5 h-3.5" /> Add New {isSale ? 'Customer' : 'Supplier'}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Transaction details */}
          <Card className="shadow-card border-border/60">
            <div className="p-4 space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Details
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>Invoice No.</Label>
                  <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Optional" className="mt-1" />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                <div>
                  <Label className="cursor-pointer text-sm">Inter-state (IGST)</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">ON if other state</p>
                </div>
                <Switch checked={isInterState} onCheckedChange={setIsInterState} />
              </div>

              <div>
                <Label>Discount (₹)</Label>
                <Input type="number" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} placeholder="0" className="mt-1" />
              </div>

              <div>
                <Label>Payment Mode</Label>
                <Select value={paymentMode} onValueChange={setPaymentMode}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Paid Amount (₹)</Label>
                <Input
                  type="number"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  placeholder={`Full: ${totalAmount.toFixed(0)}`}
                  className="mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Leave empty for full payment</p>
              </div>
            </div>
          </Card>

          {/* Live summary */}
          <Card className="shadow-card border-border/60 sticky top-20">
            <div className="p-4">
              <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                <IndianRupee className="w-4 h-4" /> Summary
              </h3>
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
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">GST Total</span>
                  <span className="font-medium">{formatINR(totalGst)}</span>
                </div>
                {!isInterState ? (
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
                <div className="border-t border-border pt-2 flex items-center justify-between">
                  <span className="font-semibold">Total</span>
                  <span className="text-xl font-bold">{formatINR(totalAmount)}</span>
                </div>
                {due > 0 && (
                  <div className="flex items-center justify-between text-sm bg-rose-50 -mx-4 px-4 py-2 rounded-lg">
                    <span className="text-rose-600 font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> Outstanding
                    </span>
                    <span className="font-bold text-rose-600">{formatINR(due)}</span>
                  </div>
                )}
                {isSale && totalProfit > 0 && (
                  <div className="flex items-center justify-between text-sm bg-emerald-50 -mx-4 px-4 py-2 rounded-lg">
                    <span className="text-emerald-700 font-medium flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5" /> Gross Profit
                    </span>
                    <span className="font-bold text-emerald-700">
                      {formatINR(totalProfit)}
                      <span className="text-[10px] ml-1">({totalAmount > 0 ? ((totalProfit / totalAmount) * 100).toFixed(1) : 0}%)</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Mobile sticky save bar — shows total + save */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-md border-t border-border p-2.5 flex items-center gap-2 z-30" style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}>
        <div className="flex-1">
          <p className="text-[10px] text-muted-foreground uppercase">Total</p>
          <p className="text-lg font-bold tabular-nums">{formatINR(totalAmount)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleCancel} className="h-10 px-4">
          Cancel
        </Button>
        <Button className="bg-gradient-saffron gap-2 shadow-md h-10 px-6" onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {/* Add Party Dialog */}
      <AddPartyInline
        open={addPartyOpen}
        onOpenChange={setAddPartyOpen}
        defaultType={isSale ? 'customer' : 'supplier'}
        onAdded={(newParty) => {
          refetchParties()
          setPartyId(newParty.id)
        }}
      />
    </div>
  )
}

function AddPartyInline({ open, onOpenChange, defaultType, onAdded }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultType: 'customer' | 'supplier'
  onAdded: (party: any) => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState({
    name: '', type: defaultType, phone: '', gstin: '', state: '', address: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({ name: '', type: defaultType, phone: '', gstin: '', state: '', address: '' })
    }
  }, [open, defaultType])

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' })
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
      if (!r.ok) throw new Error('Failed')
      if (isQueuedResponse(r)) {
        sonnerToast.success('Saved offline — will sync when online')
        onOpenChange(false)
        return
      }
      const data = await r.json()
      sonnerToast.success(`${defaultType === 'customer' ? 'Customer' : 'Supplier'} added`)
      onAdded(data.party)
      onOpenChange(false)
    } catch {
      toast({ title: 'Failed to add', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className={`fixed inset-0 z-50 m-auto w-full max-w-md h-fit shadow-2xl ${open ? 'flex' : 'hidden'} flex-col`}>
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" /> Add New {defaultType === 'customer' ? 'Customer' : 'Supplier'}
        </h3>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onOpenChange(false)}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <Label>Name *</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus className="mt-1" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1" />
          </div>
          <div>
            <Label>State</Label>
            <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="mt-1" />
          </div>
        </div>
        <div>
          <Label>GSTIN</Label>
          <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} className="mt-1 font-mono" />
        </div>
        <div>
          <Label>Address</Label>
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1" />
        </div>
      </div>
      <div className="p-4 border-t border-border flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button className="flex-1 bg-gradient-saffron" onClick={handleSave} disabled={saving}>
          {saving ? 'Adding...' : 'Add'}
        </Button>
      </div>
    </Card>
  )
}
