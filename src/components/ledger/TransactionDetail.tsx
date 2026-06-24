'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { toast as sonnerToast } from 'sonner'
import { formatINR, formatDateTime, formatDate, cn } from '@/lib/utils'
import {
  Edit2, Trash2, Printer, Download, User, Calendar, Receipt,
  ShoppingCart, Truck, ArrowDownRight, ArrowUpRight, X, Plus,
  IndianRupee, FileText, Phone, Building2, MapPin, TrendingUp,
} from 'lucide-react'

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI / QR' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'credit', label: 'Credit (Udhaar)' },
]

export function TransactionDetail() {
  const { selectedTransactionId, setView, triggerRefresh, previousView, setPreviousView } = useAppStore()
  const [editOpen, setEditOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['transaction', selectedTransactionId],
    queryFn: async () => {
      const r = await fetch(`/api/transactions/${selectedTransactionId}`)
      return r.json()
    },
    enabled: !!selectedTransactionId,
  })

  const txn = data?.transaction

  const handleDelete = async () => {
    if (!txn) return
    if (!confirm('Delete this transaction? This cannot be undone.')) return
    const r = await fetch(`/api/transactions/${txn.id}`, { method: 'DELETE' })
    if (r.ok) {
      sonnerToast.success('Transaction deleted')
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      // Go back to ledger
      setView(previousView || (txn.type === 'sale' ? 'sales' : txn.type === 'purchase' ? 'purchases' : 'income-expense'))
      setPreviousView(null)
      triggerRefresh()
    }
  }

  const handlePrint = () => {
    setPrinting(true)
    setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 100)
  }

  const handleDownload = () => {
    // Generate a printable HTML and download
    if (!txn) return
    const html = generateInvoiceHTML(txn)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invoice-${txn.invoiceNo || txn.id}.html`
    a.click()
    URL.revokeObjectURL(url)
    sonnerToast.success('Invoice downloaded')
  }

  if (isLoading || !txn) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  const isSale = txn.type === 'sale'
  const isPurchase = txn.type === 'purchase'
  const isIncome = txn.type === 'income'
  const isExpense = txn.type === 'expense'
  const isInflow = isSale || isIncome
  const due = txn.totalAmount - txn.paidAmount

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 no-print">
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-2">
          <Edit2 className="w-4 h-4" /> Edit
        </Button>
        <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
          <Printer className="w-4 h-4" /> Print
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownload} className="gap-2">
          <Download className="w-4 h-4" /> Download
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleDelete} className="gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50">
          <Trash2 className="w-4 h-4" /> Delete
        </Button>
      </div>

      {/* Income/Expense simple view */}
      {(isIncome || isExpense) ? (
        <Card className="shadow-card border-border/60">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className={cn(
                'w-14 h-14 rounded-xl flex items-center justify-center',
                isIncome ? 'bg-emerald-100' : 'bg-rose-100'
              )}>
                {isIncome
                  ? <ArrowDownRight className="w-7 h-7 text-emerald-600" />
                  : <ArrowUpRight className="w-7 h-7 text-rose-600" />}
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{isIncome ? 'Income' : 'Expense'}</p>
                <h2 className="text-2xl font-bold">{txn.category || 'Other'}</h2>
                <p className="text-sm text-muted-foreground">{formatDateTime(txn.date)}</p>
              </div>
              <div className="ml-auto text-right">
                <p className={cn('text-2xl font-bold', isIncome ? 'text-emerald-600' : 'text-rose-600')}>
                  {isIncome ? '+' : '-'}{formatINR(txn.totalAmount)}
                </p>
                <Badge variant="secondary" className="mt-1 uppercase">{txn.paymentMode}</Badge>
              </div>
            </div>
            {txn.notes && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground uppercase mb-1">Notes</p>
                <p className="text-sm">{txn.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Invoice-style header card */}
          <Card className="shadow-card border-border/60 overflow-hidden">
            <div className={cn('p-5 text-white', isSale ? 'bg-gradient-emerald' : 'bg-gradient-saffron')}>
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                    {isSale ? <ShoppingCart className="w-6 h-6" /> : <Truck className="w-6 h-6" />}
                  </div>
                  <div>
                    <p className="text-white/80 text-xs uppercase tracking-wide">{isSale ? 'Sales Invoice' : 'Purchase Bill'}</p>
                    <h2 className="text-xl font-bold">{txn.invoiceNo || `TXN-${txn.id.slice(-6)}`}</h2>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold">{formatINR(txn.totalAmount)}</p>
                  {due > 0 && (
                    <p className="text-white/80 text-sm mt-1">Due: {formatINR(due)}</p>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Party + meta info */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="shadow-card border-border/60 lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="w-4 h-4" /> {isSale ? 'Customer' : 'Supplier'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {txn.party ? (
                  <div className="space-y-2">
                    <button
                      onClick={() => {
                        setPreviousView('transaction-detail')
                        useAppStore.getState().setSelectedPartyId(txn.party.id)
                        setView('party-profile')
                      }}
                      className="text-lg font-semibold hover:text-primary transition"
                    >
                      {txn.party.name}
                    </button>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {txn.party.phone && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="w-3.5 h-3.5" />
                          <span>{txn.party.phone}</span>
                        </div>
                      )}
                      {txn.party.gstin && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Building2 className="w-3.5 h-3.5" />
                          <span className="font-mono text-xs">{txn.party.gstin}</span>
                        </div>
                      )}
                      {txn.party.state && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5" />
                          <span>{txn.party.state}</span>
                        </div>
                      )}
                    </div>
                    {txn.party.address && (
                      <p className="text-xs text-muted-foreground pt-2 border-t border-border">{txn.party.address}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Walk-in customer (no party linked)</p>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-card border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Date</span>
                  <span className="font-medium">{formatDate(txn.date)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Payment</span>
                  <Badge variant="secondary" className="uppercase text-[10px]">{txn.paymentMode}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">GST Type</span>
                  <span className="font-medium">{txn.isInterState ? 'IGST (Inter-state)' : 'CGST+SGST'}</span>
                </div>
                {isSale && (
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-muted-foreground flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Profit</span>
                    <span className="font-bold text-emerald-600">{formatINR(txn.grossProfit)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Items table */}
          <Card className="shadow-card border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="w-4 h-4" /> Items ({txn.items.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-2 font-medium">#</th>
                      <th className="py-2 px-2 font-medium">Product</th>
                      <th className="py-2 px-2 font-medium text-right">Qty</th>
                      <th className="py-2 px-2 font-medium text-right">Unit Price</th>
                      <th className="py-2 px-2 font-medium text-right">GST</th>
                      <th className="py-2 px-2 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txn.items.map((item: any, i: number) => (
                      <tr key={item.id} className="border-b border-border/50">
                        <td className="py-2.5 pr-2 text-muted-foreground">{i + 1}</td>
                        <td className="py-2.5 px-2 font-medium">{item.productName}</td>
                        <td className="py-2.5 px-2 text-right">{item.quantity}</td>
                        <td className="py-2.5 px-2 text-right">{formatINR(item.unitPrice)}</td>
                        <td className="py-2.5 px-2 text-right">{item.gstRate}%</td>
                        <td className="py-2.5 px-2 text-right font-semibold">{formatINR(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="mt-4 pt-4 border-t border-border">
                <div className="ml-auto max-w-xs space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium">{formatINR(txn.subtotal)}</span>
                  </div>
                  {txn.discountAmount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Discount</span>
                      <span className="font-medium text-rose-600">-{formatINR(txn.discountAmount)}</span>
                    </div>
                  )}
                  {txn.cgst > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">CGST</span>
                      <span className="font-medium">{formatINR(txn.cgst)}</span>
                    </div>
                  )}
                  {txn.sgst > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">SGST</span>
                      <span className="font-medium">{formatINR(txn.sgst)}</span>
                    </div>
                  )}
                  {txn.igst > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">IGST</span>
                      <span className="font-medium">{formatINR(txn.igst)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-border text-base">
                    <span className="font-bold">Total</span>
                    <span className="font-bold">{formatINR(txn.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-600">Paid</span>
                    <span className="font-medium text-emerald-600">{formatINR(txn.paidAmount)}</span>
                  </div>
                  {due > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-rose-600">Outstanding</span>
                      <span className="font-medium text-rose-600">{formatINR(due)}</span>
                    </div>
                  )}
                </div>
              </div>

              {txn.notes && (
                <div className="mt-4 rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground uppercase mb-1">Notes</p>
                  <p className="text-sm">{txn.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Edit Dialog */}
      <EditTransactionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        transaction={txn}
        onSuccess={() => {
          triggerRefresh()
          queryClient.invalidateQueries({ queryKey: ['transaction', selectedTransactionId] })
          queryClient.invalidateQueries({ queryKey: ['transactions'] })
        }}
      />

      {/* Print-only invoice */}
      {printing && <PrintInvoice txn={txn} />}
    </div>
  )
}

function EditTransactionDialog({ open, onOpenChange, transaction, onSuccess }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: any
  onSuccess?: () => void
}) {
  const isIncomeOrExpense = transaction.type === 'income' || transaction.type === 'expense'
  const isSale = transaction.type === 'sale'
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    partyId: '',
    date: '',
    invoiceNo: '',
    isInterState: false,
    paymentMode: 'cash',
    paidAmount: '',
    discountAmount: '',
    notes: '',
    category: '',
    totalAmount: '',
  })
  const [items, setItems] = useState<any[]>([])

  const { data: productsData } = useQuery({
    queryKey: ['products', 'for-edit'],
    queryFn: async () => {
      const r = await fetch('/api/products')
      return r.json()
    },
  })
  const products: any[] = productsData?.products || []

  const { data: partiesData } = useQuery({
    queryKey: ['parties', 'for-edit'],
    queryFn: async () => {
      const r = await fetch('/api/parties')
      return r.json()
    },
  })
  const parties: any[] = (partiesData?.parties || []).filter((p: any) =>
    isSale ? p.type === 'customer' || p.type === 'both' : transaction.type === 'purchase' ? p.type === 'supplier' || p.type === 'both' : true
  )

  useEffect(() => {
    if (open && transaction) {
      setForm({
        partyId: transaction.partyId || '',
        date: new Date(transaction.date).toISOString().slice(0, 10),
        invoiceNo: transaction.invoiceNo || '',
        isInterState: transaction.isInterState || false,
        paymentMode: transaction.paymentMode || 'cash',
        paidAmount: String(transaction.paidAmount || ''),
        discountAmount: String(transaction.discountAmount || ''),
        notes: transaction.notes || '',
        category: transaction.category || '',
        totalAmount: String(transaction.totalAmount || ''),
      })
      setItems(transaction.items?.map((i: any) => ({
        productId: i.productId || '',
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        gstRate: i.gstRate,
        discountAmount: i.discountAmount || 0,
      })) || [])
    }
  }, [open, transaction])

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
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

  const handleSave = async () => {
    setSaving(true)
    try {
      const body: any = {
        type: transaction.type,
        partyId: form.partyId || null,
        date: form.date,
        invoiceNo: form.invoiceNo || null,
        isInterState: form.isInterState,
        paymentMode: form.paymentMode,
        paidAmount: form.paidAmount,
        discountAmount: form.discountAmount,
        notes: form.notes,
        category: form.category,
        totalAmount: form.totalAmount,
        items: isIncomeOrExpense ? [] : items.filter(i => i.productName && i.quantity > 0).map(i => ({
          productId: i.productId || null,
          productName: i.productName,
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          gstRate: Number(i.gstRate) || 0,
          discountAmount: Number(i.discountAmount) || 0,
        })),
      }
      const r = await fetch(`/api/transactions/${transaction.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('Failed')
      sonnerToast.success('Transaction updated')
      onSuccess?.()
      onOpenChange(false)
    } catch (e) {
      toast({ title: 'Failed to update', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="w-5 h-5" />
            Edit {transaction.type === 'sale' ? 'Sale' : transaction.type === 'purchase' ? 'Purchase' : transaction.type}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isIncomeOrExpense ? (
            <div className="space-y-3">
              <div>
                <Label>Amount (₹)</Label>
                <Input type="number" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} />
              </div>
              <div>
                <Label>Category</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>
                <div>
                  <Label>Payment Mode</Label>
                  <Select value={form.paymentMode} onValueChange={(v) => setForm({ ...form, paymentMode: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label>{isSale ? 'Customer' : 'Supplier'}</Label>
                  <Select value={form.partyId} onValueChange={(v) => setForm({ ...form, partyId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select party" /></SelectTrigger>
                    <SelectContent>
                      {parties.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>
                <div>
                  <Label>Invoice No.</Label>
                  <Input value={form.invoiceNo} onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })} />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                <Label className="cursor-pointer">Inter-state (IGST)</Label>
                <Switch checked={form.isInterState} onCheckedChange={(v) => setForm({ ...form, isInterState: v })} />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Items</Label>
                  <Button variant="outline" size="sm" onClick={addItem} className="h-7 gap-1">
                    <Plus className="w-3.5 h-3.5" /> Add Item
                  </Button>
                </div>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {items.map((item, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 rounded-lg bg-muted/30">
                      <div className="col-span-12 sm:col-span-4">
                        <Select value={item.productId} onValueChange={(v) => updateItem(i, 'productId', v)}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Product" /></SelectTrigger>
                          <SelectContent>
                            {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-5 sm:col-span-3">
                        <Input value={item.productName} onChange={(e) => updateItem(i, 'productName', e.target.value)} className="h-9" placeholder="Name" />
                      </div>
                      <div className="col-span-3 sm:col-span-1">
                        <Input type="number" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)} className="h-9" />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <Input type="number" value={item.unitPrice} onChange={(e) => updateItem(i, 'unitPrice', parseFloat(e.target.value) || 0)} className="h-9" />
                      </div>
                      <div className="col-span-3 sm:col-span-1">
                        <Select value={String(item.gstRate)} onValueChange={(v) => updateItem(i, 'gstRate', parseFloat(v))}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[0, 5, 12, 18, 28].map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-rose-600 hover:bg-rose-50" onClick={() => removeItem(i)} disabled={items.length === 1}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label>Discount (₹)</Label>
                  <Input type="number" value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: e.target.value })} />
                </div>
                <div>
                  <Label>Payment Mode</Label>
                  <Select value={form.paymentMode} onValueChange={(v) => setForm({ ...form, paymentMode: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Paid Amount (₹)</Label>
                  <Input type="number" value={form.paidAmount} onChange={(e) => setForm({ ...form, paidAmount: e.target.value })} />
                </div>
              </div>

              <div>
                <Label>Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-saffron">
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PrintInvoice({ txn }: { txn: any }) {
  return (
    <div className="hidden print:block fixed inset-0 bg-white p-8 z-50">
      <PrintInvoiceContent txn={txn} />
    </div>
  )
}

function PrintInvoiceContent({ txn }: { txn: any }) {
  const isSale = txn.type === 'sale'
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex justify-between items-start mb-6 pb-4 border-b-2 border-black">
        <div>
          <h1 className="text-2xl font-bold">Tax Invoice</h1>
          <p className="text-sm text-gray-600">{isSale ? 'Sales Invoice' : 'Purchase Bill'}</p>
        </div>
        <div className="text-right">
          <p className="font-bold text-lg">BahiKhata Pro</p>
          <p className="text-xs text-gray-600">Invoice #: {txn.invoiceNo || txn.id.slice(-8)}</p>
          <p className="text-xs text-gray-600">Date: {formatDate(txn.date)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <p className="text-xs text-gray-500 uppercase mb-1">Bill To</p>
          <p className="font-bold">{txn.party?.name || 'Walk-in Customer'}</p>
          {txn.party?.phone && <p className="text-sm">{txn.party.phone}</p>}
          {txn.party?.gstin && <p className="text-sm font-mono">GSTIN: {txn.party.gstin}</p>}
          {txn.party?.address && <p className="text-sm">{txn.party.address}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase mb-1">Payment</p>
          <p className="font-medium uppercase">{txn.paymentMode}</p>
          <p className="text-xs text-gray-500 uppercase mt-2">GST Type</p>
          <p className="font-medium">{txn.isInterState ? 'IGST' : 'CGST + SGST'}</p>
        </div>
      </div>

      <table className="w-full text-sm mb-6">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="text-left py-2">#</th>
            <th className="text-left py-2">Item</th>
            <th className="text-right py-2">Qty</th>
            <th className="text-right py-2">Price</th>
            <th className="text-right py-2">GST%</th>
            <th className="text-right py-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {txn.items.map((item: any, i: number) => (
            <tr key={i} className="border-b border-gray-300">
              <td className="py-2">{i + 1}</td>
              <td className="py-2">{item.productName}</td>
              <td className="py-2 text-right">{item.quantity}</td>
              <td className="py-2 text-right">₹{item.unitPrice.toFixed(2)}</td>
              <td className="py-2 text-right">{item.gstRate}%</td>
              <td className="py-2 text-right">₹{item.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ml-auto max-w-xs space-y-1">
        <div className="flex justify-between"><span>Subtotal:</span><span>₹{txn.subtotal.toFixed(2)}</span></div>
        {txn.discountAmount > 0 && <div className="flex justify-between"><span>Discount:</span><span>-₹{txn.discountAmount.toFixed(2)}</span></div>}
        {txn.cgst > 0 && <div className="flex justify-between"><span>CGST:</span><span>₹{txn.cgst.toFixed(2)}</span></div>}
        {txn.sgst > 0 && <div className="flex justify-between"><span>SGST:</span><span>₹{txn.sgst.toFixed(2)}</span></div>}
        {txn.igst > 0 && <div className="flex justify-between"><span>IGST:</span><span>₹{txn.igst.toFixed(2)}</span></div>}
        <div className="flex justify-between font-bold text-lg border-t pt-2"><span>Total:</span><span>₹{txn.totalAmount.toFixed(2)}</span></div>
        <div className="flex justify-between text-emerald-700"><span>Paid:</span><span>₹{txn.paidAmount.toFixed(2)}</span></div>
        {txn.totalAmount - txn.paidAmount > 0 && (
          <div className="flex justify-between text-red-700"><span>Balance Due:</span><span>₹{(txn.totalAmount - txn.paidAmount).toFixed(2)}</span></div>
        )}
      </div>

      <div className="mt-8 pt-4 border-t text-center text-xs text-gray-500">
        <p>Thank you for your business!</p>
        <p>Generated by BahiKhata Pro on {formatDate(new Date())}</p>
      </div>
    </div>
  )
}

function generateInvoiceHTML(txn: any): string {
  const isSale = txn.type === 'sale'
  const itemsHTML = txn.items.map((item: any, i: number) => `
    <tr>
      <td>${i + 1}</td>
      <td>${item.productName}</td>
      <td style="text-align:right">${item.quantity}</td>
      <td style="text-align:right">₹${item.unitPrice.toFixed(2)}</td>
      <td style="text-align:right">${item.gstRate}%</td>
      <td style="text-align:right">₹${item.total.toFixed(2)}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${txn.invoiceNo || txn.id}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1a1a1a; }
    h1 { margin: 0; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
    .header { display: flex; justify-content: space-between; align-items: start; border-bottom: 3px solid #d97706; padding-bottom: 20px; margin-bottom: 30px; }
    .totals { margin-left: auto; width: 300px; }
    .totals div { display: flex; justify-content: space-between; padding: 5px 0; }
    .grand-total { font-size: 20px; font-weight: bold; border-top: 2px solid #1a1a1a; padding-top: 10px; margin-top: 10px; }
    .footer { margin-top: 60px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #ddd; padding-top: 20px; }
    .party { background: #f9f9f9; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Tax Invoice</h1>
      <p style="color:#666; margin:5px 0;">${isSale ? 'Sales Invoice' : 'Purchase Bill'}</p>
    </div>
    <div style="text-align:right">
      <p style="font-weight:bold; font-size:18px; margin:0;">BahiKhata Pro</p>
      <p style="margin:5px 0; font-size:14px;">Invoice #: ${txn.invoiceNo || txn.id.slice(-8)}</p>
      <p style="margin:5px 0; font-size:14px;">Date: ${formatDate(txn.date)}</p>
    </div>
  </div>

  <div class="party">
    <p style="color:#666; font-size:12px; text-transform:uppercase; margin:0 0 5px;">Bill To</p>
    <p style="font-weight:bold; font-size:16px; margin:0;">${txn.party?.name || 'Walk-in Customer'}</p>
    ${txn.party?.phone ? `<p style="margin:3px 0;">${txn.party.phone}</p>` : ''}
    ${txn.party?.gstin ? `<p style="margin:3px 0; font-family:monospace;">GSTIN: ${txn.party.gstin}</p>` : ''}
    ${txn.party?.address ? `<p style="margin:3px 0; color:#666;">${txn.party.address}</p>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Item</th>
        <th style="text-align:right">Qty</th>
        <th style="text-align:right">Price</th>
        <th style="text-align:right">GST</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>${itemsHTML}</tbody>
  </table>

  <div class="totals">
    <div><span>Subtotal:</span><span>₹${txn.subtotal.toFixed(2)}</span></div>
    ${txn.discountAmount > 0 ? `<div><span>Discount:</span><span>-₹${txn.discountAmount.toFixed(2)}</span></div>` : ''}
    ${txn.cgst > 0 ? `<div><span>CGST:</span><span>₹${txn.cgst.toFixed(2)}</span></div>` : ''}
    ${txn.sgst > 0 ? `<div><span>SGST:</span><span>₹${txn.sgst.toFixed(2)}</span></div>` : ''}
    ${txn.igst > 0 ? `<div><span>IGST:</span><span>₹${txn.igst.toFixed(2)}</span></div>` : ''}
    <div class="grand-total"><span>Total:</span><span>₹${txn.totalAmount.toFixed(2)}</span></div>
    <div style="color:#059669;"><span>Paid:</span><span>₹${txn.paidAmount.toFixed(2)}</span></div>
    ${txn.totalAmount - txn.paidAmount > 0 ? `<div style="color:#dc2626;"><span>Balance Due:</span><span>₹${(txn.totalAmount - txn.paidAmount).toFixed(2)}</span></div>` : ''}
  </div>

  <div class="footer">
    <p>Thank you for your business!</p>
    <p>Generated by BahiKhata Pro on ${formatDate(new Date())}</p>
  </div>
</body>
</html>`
}
