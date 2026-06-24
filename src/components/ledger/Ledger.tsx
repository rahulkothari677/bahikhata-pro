'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/store/app-store'
import { useToast } from '@/hooks/use-toast'
import { toast as sonnerToast } from 'sonner'
import { formatINR, formatDateTime, cn } from '@/lib/utils'
import { Plus, Search, ShoppingCart, Truck, Trash2, Receipt, X, ScanLine, IndianRupee, TrendingUp, Calendar, User } from 'lucide-react'

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI / QR' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'credit', label: 'Credit (Udhaar)' },
]

type LedgerType = 'sale' | 'purchase'

export function Ledger({ type }: { type: LedgerType }) {
  const { refreshKey, triggerRefresh, setView, setScannerBillType } = useAppStore()
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [presetData, setPresetData] = useState<any>(null)

  const isSale = type === 'sale'
  const accentColor = isSale ? 'text-emerald-600' : 'text-amber-600'
  const accentBg = isSale ? 'bg-emerald-100' : 'bg-amber-100'

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', type, refreshKey],
    queryFn: async () => {
      const r = await fetch(`/api/transactions?type=${type}&limit=100`)
      return r.json()
    },
  })

  const transactions: any[] = data?.transactions || []

  const filtered = transactions.filter(t => {
    if (!search) return true
    const q = search.toLowerCase()
    return t.invoiceNo?.toLowerCase().includes(q) ||
      t.party?.name?.toLowerCase().includes(q) ||
      t.notes?.toLowerCase().includes(q)
  })

  const totalAmount = filtered.reduce((s, t) => s + t.totalAmount, 0)
  const totalProfit = filtered.reduce((s, t) => s + (t.grossProfit || 0), 0)
  const totalPaid = filtered.reduce((s, t) => s + t.paidAmount, 0)
  const totalDue = totalAmount - totalPaid

  // Listen for preset data (when called from scanner)
  useEffect(() => {
    const checkPreset = () => {
      const stored = (window as any).__ledgerPreset
      if (stored && stored.type === type) {
        setPresetData(stored.data)
        setDialogOpen(true)
        ;(window as any).__ledgerPreset = null
      }
    }
    checkPreset()
    const interval = setInterval(checkPreset, 300)
    return () => clearInterval(interval)
  }, [type])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this transaction?')) return
    const r = await fetch(`/api/transactions?id=${id}`, { method: 'DELETE' })
    if (r.ok) {
      sonnerToast.success('Transaction deleted')
      triggerRefresh()
    }
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className={cn('w-4 h-4', accentColor)} />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{isSale ? 'Total Sales' : 'Total Purchases'}</p>
            </div>
            <p className="text-xl font-bold">{formatINR(totalAmount)}</p>
            <p className="text-[11px] text-muted-foreground">{filtered.length} transactions</p>
          </CardContent>
        </Card>
        {isSale && (
          <Card className="shadow-card border-border/60">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Gross Profit</p>
              </div>
              <p className="text-xl font-bold text-emerald-600">{formatINR(totalProfit)}</p>
              <p className="text-[11px] text-muted-foreground">{totalAmount > 0 ? ((totalProfit / totalAmount) * 100).toFixed(1) : 0}% margin</p>
            </CardContent>
          </Card>
        )}
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <IndianRupee className="w-4 h-4 text-violet-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Paid</p>
            </div>
            <p className="text-xl font-bold">{formatINR(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <IndianRupee className="w-4 h-4 text-rose-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{isSale ? 'Outstanding' : 'Pending Payment'}</p>
            </div>
            <p className="text-xl font-bold text-rose-600">{formatINR(totalDue)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={`Search ${isSale ? 'sales' : 'purchases'} by invoice, party, notes...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => { setScannerBillType(type); setView('scanner') }}
              className="gap-2 border-primary/30 text-primary hover:bg-primary/10"
            >
              <ScanLine className="w-4 h-4" /> Scan Bill
            </Button>
            <Button
              onClick={() => { setPresetData(null); setDialogOpen(true) }}
              className={cn('gap-2 shadow-md', isSale ? 'bg-gradient-emerald' : 'bg-gradient-saffron')}
            >
              <Plus className="w-4 h-4" /> New {isSale ? 'Sale' : 'Purchase'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Transactions list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="shadow-card border-border/60">
          <CardContent className="py-16 text-center">
            {isSale ? <ShoppingCart className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" /> : <Truck className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />}
            <p className="text-sm font-medium">No {isSale ? 'sales' : 'purchases'} yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isSale ? 'Record your first sale or scan a bill to begin' : 'Record your first stock purchase'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => {
            const due = t.totalAmount - t.paidAmount
            return (
              <Card key={t.id} className="shadow-card border-border/60 hover:shadow-md transition group">
                <CardContent className="p-3 lg:p-4">
                  <div className="flex items-start gap-3">
                    <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', accentBg)}>
                      {isSale
                        ? <ShoppingCart className={cn('w-5 h-5', accentColor)} />
                        : <Truck className={cn('w-5 h-5', accentColor)} />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm">
                              {t.party?.name || 'Walk-in Customer'}
                            </p>
                            {t.invoiceNo && (
                              <Badge variant="outline" className="text-[10px] py-0">{t.invoiceNo}</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDateTime(t.date)}</span>
                            <span className="flex items-center gap-1"><User className="w-3 h-3" />{t.items?.length || 0} items</span>
                            <Badge variant="secondary" className="text-[10px] py-0 uppercase">{t.paymentMode}</Badge>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={cn('font-bold text-sm', accentColor)}>{formatINR(t.totalAmount)}</p>
                          {due > 0 && (
                            <p className="text-[11px] text-rose-600 mt-0.5">Due: {formatINR(due)}</p>
                          )}
                          {isSale && (
                            <p className="text-[11px] text-emerald-600 mt-0.5">Profit: {formatINR(t.grossProfit)}</p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => handleDelete(t.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>

                      {/* Items preview */}
                      {t.items?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {t.items.slice(0, 4).map((item: any, i: number) => (
                            <span key={i} className="text-[11px] bg-muted px-2 py-0.5 rounded-md">
                              {item.productName} × {item.quantity}
                            </span>
                          ))}
                          {t.items.length > 4 && (
                            <span className="text-[11px] text-muted-foreground px-2 py-0.5">+{t.items.length - 4} more</span>
                          )}
                        </div>
                      )}

                      {/* Tax breakdown */}
                      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span>Subtotal: {formatINR(t.subtotal)}</span>
                        {(t.cgst + t.sgst) > 0 && <span>CGST+SGST: {formatINR(t.cgst + t.sgst)}</span>}
                        {t.igst > 0 && <span>IGST: {formatINR(t.igst)}</span>}
                        {t.discountAmount > 0 && <span className="text-rose-600">Disc: -{formatINR(t.discountAmount)}</span>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <TransactionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        type={type}
        presetData={presetData}
        onSuccess={() => { triggerRefresh(); setPresetData(null) }}
      />
    </div>
  )
}

function TransactionDialog({ open, onOpenChange, type, presetData, onSuccess }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: LedgerType
  presetData?: any
  onSuccess?: () => void
}) {
  const isSale = type === 'sale'
  const { toast } = useToast()

  const [partyId, setPartyId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [invoiceNo, setInvoiceNo] = useState('')
  const [isInterState, setIsInterState] = useState(false)
  const [paymentMode, setPaymentMode] = useState('cash')
  const [paidAmount, setPaidAmount] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<any[]>([
    { productId: '', productName: '', quantity: 1, unitPrice: 0, gstRate: 0, discountAmount: 0 }
  ])
  const [saving, setSaving] = useState(false)

  const { data: productsData } = useQuery({
    queryKey: ['products', 'for-ledger'],
    queryFn: async () => {
      const r = await fetch('/api/products')
      return r.json()
    },
  })
  const products: any[] = productsData?.products || []

  const { data: partiesData } = useQuery({
    queryKey: ['parties', 'for-ledger'],
    queryFn: async () => {
      const r = await fetch('/api/parties')
      return r.json()
    },
  })
  const parties: any[] = (partiesData?.parties || []).filter((p: any) =>
    isSale ? p.type === 'customer' || p.type === 'both' : p.type === 'supplier' || p.type === 'both'
  )

  // Apply preset data (from scanner)
  useEffect(() => {
    if (open && presetData) {
      if (presetData.invoiceNo) setInvoiceNo(presetData.invoiceNo)
      if (presetData.date) {
        try {
          const d = new Date(presetData.date)
          if (!isNaN(d.getTime())) setDate(d.toISOString().slice(0, 10))
        } catch {}
      }
      if (presetData.paymentMode) setPaymentMode(presetData.paymentMode)
      if (presetData.discountAmount) setDiscountAmount(String(presetData.discountAmount))
      if (presetData.sellerName && !isSale) {
        // Try to match party name
        const matched = parties.find(p =>
          p.name.toLowerCase().includes(presetData.sellerName.toLowerCase()) ||
          presetData.sellerName.toLowerCase().includes(p.name.toLowerCase())
        )
        if (matched) setPartyId(matched.id)
      }
      if (presetData.items?.length > 0) {
        const mapped = presetData.items.map((item: any) => {
          // Try to match existing product by name
          const matched = products.find(p =>
            p.name.toLowerCase().includes(item.name.toLowerCase()) ||
            item.name.toLowerCase().includes(p.name.toLowerCase())
          )
          return {
            productId: matched?.id || '',
            productName: item.name,
            quantity: Number(item.quantity) || 1,
            unitPrice: Number(item.unitPrice) || (matched ? (isSale ? matched.salePrice : matched.purchasePrice) : 0),
            gstRate: Number(item.gstRate) || (matched?.gstRate ?? 0),
            discountAmount: 0,
          }
        })
        setItems(mapped)
      }
      if (presetData.totalAmount) {
        setPaidAmount(String(presetData.totalAmount))
      }
    }
  }, [open, presetData])

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setPartyId('')
        setDate(new Date().toISOString().slice(0, 10))
        setInvoiceNo('')
        setIsInterState(false)
        setPaymentMode('cash')
        setPaidAmount('')
        setDiscountAmount('')
        setNotes('')
        setItems([{ productId: '', productName: '', quantity: 1, unitPrice: 0, gstRate: 0, discountAmount: 0 }])
      }, 200)
    }
  }, [open])

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    // When product selected, auto-fill price and gst
    if (field === 'productId' && value) {
      const p = products.find(p => p.id === value)
      if (p) {
        newItems[index].productName = p.name
        newItems[index].unitPrice = isSale ? p.salePrice : p.purchasePrice
        newItems[index].gstRate = p.gstRate
      }
    }
    setItems(newItems)
  }

  const addItem = () => {
    setItems([...items, { productId: '', productName: '', quantity: 1, unitPrice: 0, gstRate: 0, discountAmount: 0 }])
  }

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  // Compute totals
  let subtotal = 0
  let totalGst = 0
  let totalDiscount = parseFloat(discountAmount) || 0
  let totalProfit = 0

  items.forEach(item => {
    const amount = (item.quantity || 0) * (item.unitPrice || 0)
    const itemGst = amount * (item.gstRate || 0) / 100
    subtotal += amount
    totalGst += itemGst
    if (isSale && item.productId) {
      const p = products.find(p => p.id === item.productId)
      if (p) totalProfit += (item.unitPrice - p.purchasePrice) * item.quantity
    }
  })

  const totalAmount = subtotal - totalDiscount + totalGst
  const cgst = isInterState ? 0 : totalGst / 2
  const sgst = isInterState ? 0 : totalGst / 2
  const igst = isInterState ? totalGst : 0
  const paid = parseFloat(paidAmount) || 0
  const finalPaid = paidAmount === '' ? totalAmount : paid

  const handleSave = async () => {
    const validItems = items.filter(i => i.productName && i.quantity > 0)
    if (validItems.length === 0) {
      toast({ title: 'Add at least one item', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/transactions', {
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
          items: validItems.map(i => ({
            productId: i.productId || null,
            productName: i.productName,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice),
            gstRate: Number(i.gstRate) || 0,
            discountAmount: Number(i.discountAmount) || 0,
          })),
        }),
      })
      if (!r.ok) throw new Error('Failed')
      sonnerToast.success(`${isSale ? 'Sale' : 'Purchase'} recorded successfully!`)
      onSuccess?.()
      onOpenChange(false)
    } catch (e) {
      toast({ title: 'Failed to save transaction', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isSale ? <ShoppingCart className="w-5 h-5 text-emerald-600" /> : <Truck className="w-5 h-5 text-amber-600" />}
            New {isSale ? 'Sale' : 'Purchase'} Entry
            {presetData && (
              <Badge className="bg-gradient-saffron text-white text-[10px] ml-2 gap-1">
                <ScanLine className="w-3 h-3" /> AI-filled
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Top row: party, date, invoice */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>{isSale ? 'Customer' : 'Supplier'} (optional)</Label>
              <Select value={partyId} onValueChange={setPartyId}>
                <SelectTrigger><SelectValue placeholder={`Select ${isSale ? 'customer' : 'supplier'}`} /></SelectTrigger>
                <SelectContent>
                  {parties.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}{p.phone ? ` • ${p.phone}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Invoice/Bill No.</Label>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          {/* Inter-state GST toggle */}
          <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <div>
              <Label className="cursor-pointer">Inter-state transaction (IGST)</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">Toggle ON if buyer/seller is from another state</p>
            </div>
            <Switch checked={isInterState} onCheckedChange={setIsInterState} />
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Items *</Label>
              <Button variant="outline" size="sm" onClick={addItem} className="h-7 gap-1">
                <Plus className="w-3.5 h-3.5" /> Add Item
              </Button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {items.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 rounded-lg bg-muted/30">
                  <div className="col-span-12 sm:col-span-4">
                    {i === 0 && <Label className="text-[10px]">Product</Label>}
                    <Select value={item.productId} onValueChange={(v) => updateItem(i, 'productId', v)}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select product" /></SelectTrigger>
                      <SelectContent>
                        {products.map(p => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} ({formatINR(isSale ? p.salePrice : p.purchasePrice)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-5 sm:col-span-3">
                    {i === 0 && <Label className="text-[10px]">Name (if not in list)</Label>}
                    <Input
                      value={item.productName}
                      onChange={(e) => updateItem(i, 'productName', e.target.value)}
                      placeholder="Product name"
                      className="h-9"
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-1">
                    {i === 0 && <Label className="text-[10px]">Qty</Label>}
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)}
                      className="h-9"
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    {i === 0 && <Label className="text-[10px]">Price ₹</Label>}
                    <Input
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => updateItem(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                      className="h-9"
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-1">
                    {i === 0 && <Label className="text-[10px]">GST%</Label>}
                    <Select value={String(item.gstRate)} onValueChange={(v) => updateItem(i, 'gstRate', parseFloat(v))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[0, 5, 12, 18, 28].map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0 text-rose-600 hover:bg-rose-50"
                      onClick={() => removeItem(i)}
                      disabled={items.length === 1}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Discount & payment */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Discount (₹)</Label>
              <Input type="number" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label>Payment Mode</Label>
              <Select value={paymentMode} onValueChange={setPaymentMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
              />
              <p className="text-[10px] text-muted-foreground mt-1">Leave empty for full payment</p>
            </div>
          </div>

          {/* Live summary */}
          <div className="rounded-xl bg-muted/50 p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
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
              <span className="font-semibold">Total Payable</span>
              <span className="text-lg font-bold">{formatINR(totalAmount)}</span>
            </div>
            {finalPaid < totalAmount && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-rose-600">Outstanding</span>
                <span className="font-medium text-rose-600">{formatINR(totalAmount - finalPaid)}</span>
              </div>
            )}
            {isSale && totalProfit > 0 && (
              <div className="flex items-center justify-between text-sm bg-emerald-50 -mx-4 -mb-4 px-4 py-2 rounded-b-xl mt-2">
                <span className="text-emerald-700 font-medium flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" /> Gross Profit
                </span>
                <span className="font-bold text-emerald-700">{formatINR(totalProfit)} ({totalAmount > 0 ? ((totalProfit / totalAmount) * 100).toFixed(1) : 0}%)</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className={isSale ? 'bg-gradient-emerald' : 'bg-gradient-saffron'}>
            {saving ? 'Saving...' : `Save ${isSale ? 'Sale' : 'Purchase'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
