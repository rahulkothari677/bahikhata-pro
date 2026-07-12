'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
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
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { formatINR, formatDateTime, formatDate, cn } from '@/lib/utils'
import { roundMoney } from '@/lib/money'
import {
  Edit2, Trash2, Printer, Download, User, Calendar, Receipt,
  ShoppingCart, Truck, ArrowDownRight, ArrowUpRight, ArrowRight, X, Plus,
  IndianRupee, FileText, Phone, Building2, MapPin, TrendingUp,
  MessageCircle, AlertCircle, ArrowLeft, History, Loader2,
} from 'lucide-react'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { amountToWords } from '@/lib/amount-to-words'
import { generateInvoicePDF } from '@/lib/invoice-pdf'
import { haptic } from '@/lib/haptic'
import { useSetting } from '@/hooks/use-setting'

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI / QR' },
  { value: 'card', label: 'Card' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'credit', label: 'Credit (Udhaar)' },
]

export function TransactionDetail() {
  const { selectedTransactionId, setSelectedTransactionId, setView, triggerRefresh, previousView, setPreviousView, selectedTransactionType, setSelectedTransactionType } = useAppStore()
  const { hideProfit } = useSetting()
  const [editOpen, setEditOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const queryClient = useQueryClient()
  const { confirmDialog, dialog: confirmDialogEl } = useConfirmDialog()
  const { data: session } = useSession()

  const { data, isLoading, error } = useQuery({
    queryKey: ['transaction', selectedTransactionId],
    queryFn: async () => {
      const r = await offlineFetch(`/api/transactions/${selectedTransactionId}`)
      const json = await r.json()
      if (!r.ok || json.error) {
        throw new Error(json.error || json.message || `Request failed (${r.status})`)
      }
      return json
    },
    enabled: !!selectedTransactionId,
    retry: 1,
  })

  // V17-Ext 5.1: Fetch the field-level audit trail (edit history) for this transaction.
  // Shows who changed what field from what to what, and when. Only fetched for
  // owners (staff don't have 'reports' permission). Enabled only when not loading.
  const isOwner = session?.user?.role !== 'staff'
  const { data: auditTrailData } = useQuery({
    queryKey: ['transaction-audit-trail', selectedTransactionId],
    queryFn: async () => {
      const r = await offlineFetch(`/api/transactions/${selectedTransactionId}/audit-trail`)
      if (!r.ok) return { changes: [] }
      return r.json()
    },
    enabled: !!selectedTransactionId && isOwner && !isLoading,
  })

  // Fetch shop settings for invoice letterhead (GSTIN, shop name, address, owner)
  const { data: settingData } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await offlineFetch('/api/settings')
      return r.json()
    },
  })
  const setting = settingData?.setting || {}

  const txn = data?.transaction

  const goBack = () => {
    // Clear the selected transaction so it doesn't reopen
    setSelectedTransactionId(null)
    setSelectedTransactionType(null)
    // Go back to the previous view, or infer from transaction type
    const targetView = previousView || (selectedTransactionType === 'sale' || data?.type === 'sale' ? 'sales' : selectedTransactionType === 'purchase' || data?.type === 'purchase' ? 'purchases' : 'income-expense')
    setView(targetView)
    setPreviousView(null)
    triggerRefresh()
  }

  const handleDelete = async () => {
    if (!txn) return
    if (!await confirmDialog('Delete this transaction? You can undo this for 5 seconds.', { title: 'Delete Transaction', confirmLabel: 'Delete', destructive: true })) return
    const r = await offlineFetch(`/api/transactions/${txn.id}`, { method: 'DELETE', offline: { invalidate: ['/api/transactions', '/api/dashboard', '/api/products', '/api/parties'] } })
    if (r.ok) {
      haptic.warning()
      const deletedTxnId = txn.id
      const wasQueued = isQueuedResponse(r)

      // 🔒 AUDIT FIX V6 UX: 5-second Undo toast.
      // Since deletes are soft (deletedAt set), restoring is trivial — just
      // POST to /api/transactions/[id]/restore. The auditor called this
      // "a huge perceived-safety win" — prevents accidental-delete panic.
      // Only offer Undo for online deletes (queued offline deletes can't be
      // undone until they sync, which is a different flow).
      if (wasQueued) {
        sonnerToast.success('Will delete when online')
      } else {
        sonnerToast.success('Transaction deleted', {
          duration: 5000,
          action: {
            label: 'Undo',
            onClick: async () => {
              try {
                const restoreR = await offlineFetch(`/api/transactions/${deletedTxnId}/restore`, {
                  method: 'POST',
                  offline: { invalidate: ['/api/transactions', '/api/dashboard', '/api/products', '/api/parties'] },
                })
                if (restoreR.ok) {
                  sonnerToast.success('Transaction restored')
                  queryClient.invalidateQueries({ queryKey: ['transactions'] })
                  queryClient.invalidateQueries({ queryKey: ['dashboard'] })
                } else {
                  sonnerToast.error('Could not restore — transaction may have been permanently removed.')
                }
              } catch {
                sonnerToast.error('Could not restore — check your connection.')
              }
            },
          },
        })
      }
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      // Go back to ledger
      goBack()
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
    if (!txn) return
    const toastId = sonnerToast.loading('Generating PDF...')
    generateInvoicePDF(txn, {
      shopName: setting?.shopName || 'My Shop',
      ownerName: setting?.ownerName,
      phone: setting?.phone,
      email: setting?.email,
      gstin: setting?.gstin,
      address: setting?.address,
      state: setting?.state,
    }).then(async (pdfBlob) => {
      // On mobile (Capacitor), use Share plugin to save/share the PDF
      const { Capacitor } = await import('@capacitor/core')
      if (Capacitor.isNativePlatform()) {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
        const { Share } = await import('@capacitor/share')

        const reader = new FileReader()
        const base64Data = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string
            resolve(result.split(',')[1])
          }
          reader.onerror = reject
          reader.readAsDataURL(pdfBlob)
        })

        const fileName = `invoice-${txn.invoiceNo || txn.id.slice(-6)}.pdf`
        const fileResult = await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: Directory.Cache,
          recursive: true,
        })

        await Share.share({
          title: fileName,
          url: fileResult.uri,
          dialogTitle: 'Save or Share PDF',
        })
        sonnerToast.success('PDF ready — save or share from the popup', { id: toastId })
      } else {
        // Desktop: direct download
        const url = URL.createObjectURL(pdfBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = `invoice-${txn.invoiceNo || txn.id.slice(-6)}.pdf`
        a.click()
        URL.revokeObjectURL(url)
        sonnerToast.success('Invoice PDF downloaded', { id: toastId })
      }
    }).catch((err) => {
      sonnerToast.error('Failed to generate PDF', {
        description: String(err?.message || err).slice(0, 200),
        id: toastId,
        duration: 8000,
      })
    })
  }

  const handleWhatsAppShare = async () => {
    if (!txn) return
    haptic.click()
    const toastId = sonnerToast.loading('Generating PDF...')

    try {
      const pdfBlob = await generateInvoicePDF(txn, {
        shopName: setting?.shopName || 'My Shop',
        ownerName: setting?.ownerName,
        phone: setting?.phone,
        email: setting?.email,
        gstin: setting?.gstin,
        address: setting?.address,
        state: setting?.state,
      })

      const fileName = `invoice-${txn.invoiceNo || txn.id.slice(-6)}.pdf`
      const shareText = `Invoice from ${setting?.shopName || 'My Shop'} — Total: Rs. ${txn.totalAmount.toFixed(2)}`

      // Check if running on Capacitor (native app)
      const { Capacitor } = await import('@capacitor/core')
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share')
        const { Filesystem, Directory } = await import('@capacitor/filesystem')

        const reader = new FileReader()
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string
            const base64 = result.split(',')[1]
            resolve(base64)
          }
          reader.onerror = reject
          reader.readAsDataURL(pdfBlob)
        })
        const base64Data = await base64Promise

        const fileResult = await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: Directory.Cache,
        })

        await Share.share({
          title: `Invoice ${txn.invoiceNo || ''}`,
          text: shareText,
          url: fileResult.uri,
          dialogTitle: 'Send Invoice via',
        })
        sonnerToast.success('Invoice shared!', { id: toastId })
      } else if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([pdfBlob], fileName, { type: 'application/pdf' })] })) {
        const file = new File([pdfBlob], fileName, { type: 'application/pdf' })
        await navigator.share({
          files: [file],
          title: `Invoice ${txn.invoiceNo || ''}`,
          text: shareText,
        })
        sonnerToast.success('Invoice shared!', { id: toastId })
      } else {
        const url = URL.createObjectURL(pdfBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        URL.revokeObjectURL(url)
        sonnerToast.success('Invoice PDF downloaded', { id: toastId })

        const r = await offlineFetch('/api/whatsapp-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactionId: txn.id }),
        })
        const data = await r.json()
        if (data.whatsappUrl) {
          window.open(data.whatsappUrl, '_blank')
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        sonnerToast.dismiss(toastId)
        return
      }
      sonnerToast.error('Failed to share invoice', {
        description: String(err?.message || err).slice(0, 200),
        id: toastId,
        duration: 8000,
      })
    }
  }

  // 🔒 FIX H7: Show error state instead of infinite skeleton on API failure.
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mb-3">
          <AlertCircle className="w-6 h-6 text-rose-600" />
        </div>
        <h3 className="font-semibold text-slate-800 mb-1">Couldn't load transaction</h3>
        <p className="text-sm text-slate-500 max-w-sm mb-4">
          {(error as Error).message || 'This transaction might have been deleted or the database is warming up.'}
        </p>
        <Button variant="outline" onClick={goBack} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Go back
        </Button>
      </div>
    )
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
  const isCreditNote = txn.type === 'credit-note'
  const isDebitNote = txn.type === 'debit-note'
  const isInflow = isSale || isIncome
  const due = roundMoney(txn.totalAmount - txn.paidAmount)

  // V17-Ext Tier 3: Credit/debit note display helpers
  const isNote = isCreditNote || isDebitNote
  const noteLabel = isCreditNote ? 'Credit Note' : isDebitNote ? 'Debit Note' : isSale ? 'Sales Invoice' : 'Purchase Bill'

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 no-print">
        <Button variant="outline" size="touch" onClick={() => setEditOpen(true)} className="gap-2">
          <Edit2 className="w-4 h-4" /> Edit
        </Button>
        <Button variant="outline" size="touch" onClick={handlePrint} className="gap-2">
          <Printer className="w-4 h-4" /> Print
        </Button>
        <Button variant="outline" size="touch" onClick={handleDownload} className="gap-2">
          <Download className="w-4 h-4" /> PDF
        </Button>
        <Button variant="outline" size="touch" onClick={handleWhatsAppShare} className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
          <MessageCircle className="w-4 h-4" /> Send PDF
        </Button>
        {/* V17-Ext Tier 3: Create Credit Note button (sales only) */}
        {isSale && (
          <Button
            variant="outline"
            size="touch"
            className="gap-2 border-violet-300 text-violet-700 hover:bg-violet-50"
            onClick={() => {
              useAppStore.getState().setSelectedTransactionId(null)
              ;(window as any).__ledgerPreset = {
                type: 'credit-note',
                data: {
                  partyId: txn.partyId,
                  partyName: txn.party?.name,
                  date: new Date().toISOString().slice(0, 10),
                  originalTransactionId: txn.id,
                  noteType: 'C',
                  // 🔒 V17 Audit §1: Items are NOT pre-filled. The credit note form
                  // starts BLANK because the most common case is a partial return
                  // (customer returns 1-2 items from a multi-item sale). Pre-filling
                  // all items would force the user to delete the non-returned items.
                  // Instead, the TransactionEntry shows a "Load items from original
                  // sale" button that the user can click for full returns.
                  // The originalTransactionId is passed so the entry form can fetch
                  // the original items on demand when the user clicks that button.
                },
              }
              useAppStore.getState().setPreviousView('transaction-detail')
              useAppStore.getState().setView('new-sale')
            }}
          >
            <FileText className="w-4 h-4" /> Credit Note
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="outline" size="touch" onClick={handleDelete} className="gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50">
          <Trash2 className="w-4 h-4" /> Delete
        </Button>
      </div>

      {/* Income/Expense simple view */}
      {(isIncome || isExpense) ? (
        <div className="rounded-2xl shadow-card border border-border/60 overflow-hidden">
          <div className={cn('p-5 text-white relative overflow-hidden', isIncome ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-rose-500 to-red-600')}>
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 pointer-events-none" />
            <div className="relative flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                {isIncome
                  ? <ArrowDownRight className="w-7 h-7" />
                  : <ArrowUpRight className="w-7 h-7" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/70 uppercase tracking-wide">{isIncome ? 'Income' : 'Expense'}</p>
                <h2 className="text-2xl font-bold font-heading tracking-tight truncate">{txn.category || 'Other'}</h2>
                <p className="text-sm text-white/70">{formatDateTime(txn.date)}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-2xl font-bold tabular-nums">
                  {isIncome ? '+' : '-'}{formatINR(txn.totalAmount)}
                </p>
                <span className="inline-block mt-1 text-[10px] font-medium bg-white/20 backdrop-blur-sm rounded-full px-2 py-0.5 uppercase">{txn.paymentMode}</span>
              </div>
            </div>
          </div>
          {txn.notes && (
            <div className="p-4">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground uppercase mb-1">Notes</p>
                <p className="text-sm">{txn.notes}</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Invoice-style header card — full-width gradient */}
          <div className={cn('rounded-2xl shadow-card overflow-hidden text-white',
            isNote ? 'bg-gradient-to-br from-violet-500 to-purple-600'
            : isSale ? 'bg-gradient-emerald' : 'bg-gradient-saffron')}>
            <div className="p-5 relative">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 pointer-events-none" />
              <div className="relative flex items-start justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    {isCreditNote ? <FileText className="w-6 h-6" />
                    : isDebitNote ? <FileText className="w-6 h-6" />
                    : isSale ? <ShoppingCart className="w-6 h-6" />
                    : <Truck className="w-6 h-6" />}
                  </div>
                  <div>
                    <p className="text-white/70 text-xs uppercase tracking-wide">{noteLabel}</p>
                    <h2 className="text-xl font-bold font-heading tracking-tight">{txn.invoiceNo || `TXN-${txn.id.slice(-6)}`}</h2>
                    {/* V17-Ext Tier 3: Show note reason if present */}
                    {isNote && txn.noteReason && (
                      <p className="text-white/60 text-[10px] mt-0.5 capitalize">{txn.noteReason.replace(/-/g, ' ')}</p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold tabular-nums">{formatINR(txn.totalAmount)}</p>
                  {due > 0 && (
                    <span className="inline-block mt-1 text-xs bg-white/20 backdrop-blur-sm rounded-full px-2 py-0.5">Due: {formatINR(due)}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

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
                {txn.roundOff !== 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Round Off</span>
                    <span className="font-medium tabular-nums">{txn.roundOff > 0 ? '+' : ''}{formatINR(txn.roundOff)}</span>
                  </div>
                )}
                {txn.createdBy && (
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-muted-foreground flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Entered by</span>
                    <span className="font-medium text-xs">{txn.createdBy.name || txn.createdBy.email}{txn.createdBy.role === 'staff' ? ' (Staff)' : ''}</span>
                  </div>
                )}
                {isSale && !hideProfit && (
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

      {/* 🔒 V17 Audit §1: Linked Credit/Debit Notes — show reversals issued against this transaction */}
      {txn.reversalTransactions && txn.reversalTransactions.length > 0 && (
        <Card className="shadow-card border-violet-200 dark:border-violet-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-violet-600" />
              {txn.type === 'sale' ? 'Credit Notes Issued' : 'Debit Notes Issued'}
              <Badge variant="secondary" className="bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                {txn.reversalTransactions.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {txn.reversalTransactions.map((rev: any) => (
                <div
                  key={rev.id}
                  className="flex items-center justify-between rounded-lg bg-violet-50/50 dark:bg-violet-950/20 p-3 border border-violet-100 dark:border-violet-900/40 cursor-pointer hover:bg-violet-50 dark:hover:bg-violet-950/30 transition"
                  onClick={() => {
                    useAppStore.getState().setSelectedTransactionId(rev.id)
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{rev.invoiceNo || '—'}</span>
                      <Badge className="text-[9px] py-0 bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                        {rev.type === 'credit-note' ? 'Credit Note' : 'Debit Note'}
                      </Badge>
                      {rev.affectsStock && (
                        <Badge className="text-[9px] py-0 bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                          Stock Adjusted
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatDateTime(rev.date)}
                      {rev.noteReason && ` • ${rev.noteReason.replace(/-/g, ' ')}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className="font-bold text-sm tabular-nums text-violet-700 dark:text-violet-300">
                      -{formatINR(rev.totalAmount)}
                    </p>
                    {/* 🔒 V17 Audit Phase 4: credit-note grossProfit is NEGATIVE, so use < 0 */}
                    {rev.grossProfit < 0 && (
                      <p className="text-[10px] text-rose-500 tabular-nums">-{formatINR(Math.abs(rev.grossProfit))} profit</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Tap a note to view its details. Total adjusted: <span className="font-semibold text-violet-700 dark:text-violet-300">-{formatINR(txn.reversalTransactions.reduce((s: number, r: any) => s + r.totalAmount, 0))}</span>
            </p>
          </CardContent>
        </Card>
      )}

      {/* 🔒 V17 Audit §1: If this IS a credit/debit note, show the original transaction link */}
      {txn.originalTransaction && (
        <Card className="shadow-card border-blue-200 dark:border-blue-900/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowLeft className="w-4 h-4 text-blue-600" />
              Original {txn.originalTransaction.type === 'sale' ? 'Sale' : 'Purchase'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="flex items-center justify-between rounded-lg bg-blue-50/50 dark:bg-blue-950/20 p-3 border border-blue-100 dark:border-blue-900/40 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/30 transition"
              onClick={() => {
                useAppStore.getState().setSelectedTransactionId(txn.originalTransaction.id)
              }}
            >
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-sm">{txn.originalTransaction.invoiceNo || '—'}</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">{formatDateTime(txn.originalTransaction.date)}</p>
              </div>
              <div className="text-right flex-shrink-0 ml-2">
                <p className="font-bold text-sm tabular-nums">{formatINR(txn.originalTransaction.totalAmount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 🔒 V17 Audit Phase 5: e-Invoicing (IRN/QR) card.
          Shows IRN status + allows generating the IRN request JSON for B2B invoices. */}
      {(isSale || isCreditNote) && (
        <EInvoiceCard txn={txn} />
      )}

      {/* V17-Ext 5.1: Field-level Audit Trail — shows who changed what, when */}
      {isOwner && auditTrailData?.changes?.length > 0 && (
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              Edit History
              <Badge variant="secondary">{auditTrailData.changes.length} change{auditTrailData.changes.length !== 1 ? 's' : ''}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {auditTrailData.changes.map((change: any, i: number) => (
                <div key={change.id || i} className="flex items-start gap-3 rounded-lg bg-muted/30 p-2 text-xs">
                  <div className="flex-shrink-0 w-2 h-2 rounded-full bg-primary/40 mt-1.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{change.fieldName}</span>
                      <span className="text-muted-foreground">
                        changed {new Date(change.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 tabular-nums">
                      <span className="text-rose-600 line-through opacity-70">
                        {formatAuditValue(change.oldValue, change.fieldName)}
                      </span>
                      <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <span className="text-emerald-600 font-medium">
                        {formatAuditValue(change.newValue, change.fieldName)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
      {printing && <PrintInvoice txn={txn} setting={setting} />}
      {confirmDialogEl}
    </div>
  )
}

function EditTransactionDialog({ open, onOpenChange, transaction, onSuccess }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: any
  onSuccess?: () => void
}) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  // 🔒 Defensive: if transaction is somehow undefined (e.g. during a React
  // Query refetch that temporarily clears data), don't crash. Hooks must be
  // called unconditionally (Rules of Hooks), so we call them first, THEN
  // check if transaction exists. If not, render nothing.
  // The parent's guard (if isLoading || !txn) should prevent this, but this
  // is a safety net against race conditions.
  const isIncomeOrExpense = transaction?.type === 'income' || transaction?.type === 'expense'
  const isSale = transaction?.type === 'sale'

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
      const r = await offlineFetch('/api/products')
      return r.json()
    },
  })
  const products: any[] = productsData?.products || []

  const { data: partiesData } = useQuery({
    queryKey: ['parties', 'for-edit'],
    queryFn: async () => {
      const r = await offlineFetch('/api/parties')
      return r.json()
    },
  })
  const parties: any[] = (partiesData?.parties || []).filter((p: any) =>
    isSale ? p.type === 'customer' || p.type === 'both' : transaction?.type === 'purchase' ? p.type === 'supplier' || p.type === 'both' : true
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

  // 🔒 Defensive: after all hooks, bail if transaction is undefined.
  // The parent's guard should prevent this, but this is a safety net.
  if (!transaction) return null

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
      const r = await offlineFetch(`/api/transactions/${transaction.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        offline: { invalidate: ['/api/transactions', '/api/dashboard', '/api/products', '/api/parties'] },
      })
      if (!r.ok) throw new Error('Failed')
      sonnerToast.success(isQueuedResponse(r) ? 'Saved offline — will sync when online' : 'Transaction updated')
      haptic.success()
      onSuccess?.()
      onOpenChange(false)
    } catch (e) {
      haptic.error()
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
                <Input type="number" inputMode="decimal" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} />
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
                {/* 🔒 V19-021: isInterState is server-derived from party state, not user-settable.
                    Display as read-only to avoid confusion. */}
                <Switch checked={form.isInterState} disabled />
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
                        <Input type="number" inputMode="decimal" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)} className="h-9" />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <Input type="number" inputMode="decimal" value={item.unitPrice} onChange={(e) => updateItem(i, 'unitPrice', parseFloat(e.target.value) || 0)} className="h-9" />
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
                  <Input type="number" inputMode="decimal" value={form.discountAmount} onChange={(e) => setForm({ ...form, discountAmount: e.target.value })} />
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
                  <Input type="number" inputMode="decimal" value={form.paidAmount} onChange={(e) => setForm({ ...form, paidAmount: e.target.value })} />
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

function PrintInvoice({ txn, setting }: { txn: any; setting: any }) {
  return (
    <div className="hidden print:block fixed inset-0 bg-white p-6 lg:p-10 z-50 overflow-y-auto">
      <PrintInvoiceContent txn={txn} setting={setting} />
    </div>
  )
}

function PrintInvoiceContent({ txn, setting }: { txn: any; setting: any }) {
  const isSale = txn.type === 'sale'
  const due = roundMoney(txn.totalAmount - txn.paidAmount)
  const shopName = setting?.shopName || 'My Shop'
  const shopAddress = setting?.address
  const shopPhone = setting?.phone
  const shopGstin = setting?.gstin
  const shopState = setting?.state
  const ownerName = setting?.ownerName || shopName
  return (
    <div className="max-w-3xl mx-auto text-black">
      {/* Letterhead */}
      <div className="flex items-start justify-between gap-6 pb-5 mb-5 border-b-2 border-orange-600">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-orange-500 to-rose-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-xl">{shopName?.[0]?.toUpperCase() || 'B'}</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-tight">{shopName}</h1>
            {shopAddress && <p className="text-xs text-gray-700 mt-0.5 max-w-xs">{shopAddress}</p>}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-700 mt-1">
              {shopPhone && <span>Phone: {shopPhone}</span>}
              {shopGstin && <span className="font-mono">GSTIN: {shopGstin}</span>}
              {shopState && <span>State: {shopState}</span>}
            </div>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <h2 className="text-lg font-bold tracking-wide uppercase">{isSale ? 'Tax Invoice' : 'Purchase Bill'}</h2>
          <div className="text-xs text-gray-700 mt-1 space-y-0.5">
            <p><span className="text-gray-500">Invoice No:</span> <span className="font-mono font-medium">{txn.invoiceNo || txn.id.slice(-8)}</span></p>
            <p><span className="text-gray-500">Date:</span> <span className="font-medium">{formatDate(txn.date)}</span></p>
            <p><span className="text-gray-500">Payment:</span> <span className="font-medium uppercase">{txn.paymentMode}</span></p>
          </div>
        </div>
      </div>

      {/* Bill To / Supply Details */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-semibold">Bill To</p>
          <p className="font-bold text-sm">{txn.party?.name || 'Walk-in Customer'}</p>
          {txn.party?.phone && <p className="text-xs text-gray-700 mt-0.5">{txn.party.phone}</p>}
          {txn.party?.gstin && <p className="text-xs text-gray-700 font-mono mt-0.5">GSTIN: {txn.party.gstin}</p>}
          {txn.party?.address && <p className="text-xs text-gray-700 mt-0.5">{txn.party.address}</p>}
          {txn.party?.state && <p className="text-xs text-gray-700 mt-0.5">State: {txn.party.state}</p>}
        </div>
        <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-semibold">Supply Details</p>
          <div className="text-xs space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">GST Type:</span><span className="font-medium">{txn.isInterState ? 'IGST (Inter-state)' : 'CGST + SGST'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Items:</span><span className="font-medium">{txn.items.length}</span></div>
            {isSale && txn.grossProfit !== undefined && (
              <div className="flex justify-between"><span className="text-gray-500">Profit:</span><span className="font-medium text-emerald-700">₹{txn.grossProfit.toFixed(2)}</span></div>
            )}
          </div>
        </div>
      </div>

      {/* Items table */}
      <table className="w-full text-xs border border-gray-300 mb-4">
        <thead>
          <tr className="bg-orange-50 border-b border-gray-300">
            <th className="text-left py-2 px-2 font-semibold w-8">#</th>
            <th className="text-left py-2 px-2 font-semibold">Item / Description</th>
            <th className="text-right py-2 px-2 font-semibold w-16">HSN</th>
            <th className="text-right py-2 px-2 font-semibold w-16">Qty</th>
            <th className="text-right py-2 px-2 font-semibold w-24">Unit Price</th>
            <th className="text-right py-2 px-2 font-semibold w-16">GST%</th>
            <th className="text-right py-2 px-2 font-semibold w-28">Amount</th>
          </tr>
        </thead>
        <tbody>
          {txn.items.map((item: any, i: number) => (
            <tr key={i} className="border-b border-gray-200">
              <td className="py-2 px-2 text-gray-600">{i + 1}</td>
              <td className="py-2 px-2 font-medium">{item.productName}</td>
              <td className="py-2 px-2 text-right text-gray-600">{item.hsnCode || '\u2014'}</td>
              <td className="py-2 px-2 text-right">{item.quantity}</td>
              <td className="py-2 px-2 text-right">₹{item.unitPrice.toFixed(2)}</td>
              <td className="py-2 px-2 text-right">{item.gstRate}%</td>
              <td className="py-2 px-2 text-right font-semibold">₹{item.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Amount in words + totals */}
      <div className="flex justify-between items-start gap-6 mb-5">
        <div className="flex-1">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-semibold">Amount in Words</p>
          <p className="text-xs italic font-medium text-gray-800 max-w-xs">{amountToWords(txn.totalAmount)}</p>
        </div>
        <div className="w-72 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span className="font-medium">₹{txn.subtotal.toFixed(2)}</span></div>
          {txn.discountAmount > 0 && <div className="flex justify-between"><span className="text-gray-600">Discount</span><span className="font-medium text-rose-700">-₹{txn.discountAmount.toFixed(2)}</span></div>}
          {txn.cgst > 0 && <div className="flex justify-between"><span className="text-gray-600">CGST</span><span className="font-medium">₹{txn.cgst.toFixed(2)}</span></div>}
          {txn.sgst > 0 && <div className="flex justify-between"><span className="text-gray-600">SGST</span><span className="font-medium">₹{txn.sgst.toFixed(2)}</span></div>}
          {txn.igst > 0 && <div className="flex justify-between"><span className="text-gray-600">IGST</span><span className="font-medium">₹{txn.igst.toFixed(2)}</span></div>}
          {txn.roundOff !== 0 && <div className="flex justify-between"><span className="text-gray-600">Round Off</span><span className="font-medium">{txn.roundOff > 0 ? '+' : '-'}₹{Math.abs(txn.roundOff).toFixed(2)}</span></div>}
          <div className="flex justify-between text-base font-bold border-t-2 border-black pt-2 mt-1">
            <span>Total</span><span>₹{txn.totalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-emerald-700"><span>Paid</span><span className="font-medium">₹{txn.paidAmount.toFixed(2)}</span></div>
          {due > 0 && (
            <div className="flex justify-between text-rose-700 font-semibold"><span>Balance Due</span><span>₹{due.toFixed(2)}</span></div>
          )}
        </div>
      </div>

      {/* Terms + signature + footer */}
      <div className="grid grid-cols-2 gap-6 mt-10 pt-4 border-t border-gray-300">
        <div className="text-[10px] text-gray-600 leading-relaxed">
          <p className="font-semibold text-gray-700 mb-1">Terms &amp; Conditions</p>
          <p>&bull; Goods once sold will not be taken back or exchanged.</p>
          <p>&bull; All disputes are subject to local jurisdiction only.</p>
          {due > 0 && <p>&bull; Payment due within 30 days from invoice date.</p>}
          {txn.roundOff !== 0 && <p>&bull; Total rounded to nearest rupee as per GST norms.</p>}
        </div>
        <div className="text-right">
          <div className="border-t border-gray-400 mt-8 pt-1 inline-block w-40">
            <p className="text-[10px] text-gray-600 font-medium">Authorised Signatory</p>
          </div>
          <p className="text-xs font-semibold mt-2">{ownerName}</p>
        </div>
      </div>

      <div className="mt-6 pt-3 border-t border-gray-200 text-center text-[10px] text-gray-500">
        <p>This is a computer-generated invoice and does not require a physical signature.</p>
        <p>Generated by EkBook on {formatDate(new Date())}</p>
      </div>
    </div>
  )
}

// V17-Ext 5.1: Format a value from the audit trail for display.
// 🔒 V19-033 FIX: gstRate is a percentage (not money), quantity is a count.
// Money fields show with Rs. prefix, percentages with %, others as plain numbers.
function formatAuditValue(value: any, fieldName?: string): string {
  if (value === null || value === undefined) return '\u2014'
  if (value instanceof Date) return formatDate(value)
  if (typeof value === 'number') {
    // 🔒 V19-033: gstRate is a percentage, not money
    if (fieldName === 'gstRate') return `${value}%`
    // quantity is a count, not money
    if (fieldName === 'quantity' || fieldName === 'currentStock' || fieldName === 'openingStock' || fieldName === 'lowStockThreshold') return String(value)
    // All other numbers are money
    return `Rs. ${value.toFixed(2)}`
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      try { return formatDate(new Date(value)) } catch { return value }
    }
    return value
  }
  return String(value)
}

// ─── E-Invoice Card (Phase 5) ─────────────────────────────────────────────

/**
 * Shows e-Invoice (IRN/QR) status for a B2B transaction.
 * Lets the user:
 *   - Check eligibility
 *   - Download the IRN request JSON (for NIC portal submission)
 *   - Store the IRN + signed QR (after NIC portal returns them)
 *   - View the stored IRN/QR
 */
function EInvoiceCard({ txn }: { txn: any }) {
  const [loading, setLoading] = useState(false)
  const [irnInput, setIrnInput] = useState('')
  const [qrInput, setQrInput] = useState('')
  const [showStoreForm, setShowStoreForm] = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    try {
      const r = await offlineFetch(`/api/e-invoice/irn?transactionId=${txn.id}`)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || data.message || 'Failed')

      if (!data.eligible) {
        sonnerToast.error('Not eligible for e-Invoicing', {
          description: data.reason || 'This transaction does not meet e-Invoicing requirements.',
          duration: 8000,
        })
        return
      }

      // Download the IRN request JSON
      const json = JSON.stringify(data.irnRequest, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `IRN_Request_${txn.invoiceNo || txn.id}.json`
      a.click()
      URL.revokeObjectURL(url)
      sonnerToast.success('IRN request JSON downloaded', {
        description: 'Submit this to the NIC e-Invoice portal or your API provider. Then paste the returned IRN + QR here.',
        duration: 10000,
      })
      setShowStoreForm(true)
    } catch (e: any) {
      sonnerToast.error('Failed to generate IRN request', {
        description: e.message,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleStoreIrn = async () => {
    if (!irnInput.trim()) {
      sonnerToast.error('IRN is required')
      return
    }
    setLoading(true)
    try {
      const r = await offlineFetch('/api/e-invoice/irn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: txn.id,
          irn: irnInput.trim(),
          signedQR: qrInput.trim() || undefined,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || data.message || 'Failed')
      sonnerToast.success('IRN stored successfully')
      setShowStoreForm(false)
      setIrnInput('')
      setQrInput('')
      window.location.reload()
    } catch (e: any) {
      sonnerToast.error('Failed to store IRN', { description: e.message })
    } finally {
      setLoading(false)
    }
  }

  const irnStatus = txn.irnStatus
  const hasIrn = !!txn.irn

  return (
    <Card className="shadow-card border-indigo-200 dark:border-indigo-900/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-4 h-4 text-indigo-600" />
          e-Invoice (IRN)
          {hasIrn && (
            <Badge className={cn(
              'text-[9px]',
              irnStatus === 'generated' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
              irnStatus === 'cancelled' && 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
              irnStatus === 'pending' && 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
            )}>
              {irnStatus === 'generated' && '✓ IRN Generated'}
              {irnStatus === 'cancelled' && '✗ Cancelled'}
              {irnStatus === 'pending' && '⏳ Pending'}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasIrn ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-muted/30 p-3 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">IRN:</span>
                <span className="font-mono text-[10px] break-all text-right max-w-[200px]">{txn.irn}</span>
              </div>
              {txn.irnGeneratedAt && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Generated:</span>
                  <span>{formatDateTime(txn.irnGeneratedAt)}</span>
                </div>
              )}
              {txn.signedQR && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Signed QR:</span>
                  <span className="text-emerald-600">✓ Available</span>
                </div>
              )}
            </div>
            {txn.ewayBillNo && (
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 p-3 space-y-1.5 border border-blue-100 dark:border-blue-900/40">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">e-Way Bill:</span>
                  <span className="font-mono">{txn.ewayBillNo}</span>
                </div>
                {txn.ewayBillExpiry && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Expires:</span>
                    <span>{formatDateTime(txn.ewayBillExpiry)}</span>
                  </div>
                )}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              This invoice is e-Invoice compliant. The IRN and signed QR are stored permanently for audit.
            </p>
          </div>
        ) : showStoreForm ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Paste the IRN and signed QR from the NIC portal response:
            </p>
            <div>
              <Label className="text-xs">IRN (64 characters) *</Label>
              <textarea
                value={irnInput}
                onChange={(e) => setIrnInput(e.target.value)}
                placeholder="Paste the 64-char IRN here..."
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
                rows={2}
              />
            </div>
            <div>
              <Label className="text-xs">Signed QR (optional)</Label>
              <textarea
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
                placeholder="Paste the signed QR string here..."
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
                rows={2}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowStoreForm(false)}>Cancel</Button>
              <Button size="sm" onClick={handleStoreIrn} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700">
                {loading ? 'Storing...' : 'Store IRN'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Generate the IRN request JSON, submit it to the NIC e-Invoice portal
              (or your API provider), then store the returned IRN + QR here.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Generate IRN Request JSON
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
