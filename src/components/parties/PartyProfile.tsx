'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatINR, formatDate, formatDateTime, cn, getInitials } from '@/lib/utils'
import {
  Phone, Building2, MapPin, User, Plus, ShoppingCart, Truck,
  ArrowDownRight, ArrowUpRight, IndianRupee, Calendar, TrendingUp,
  Receipt, Edit2, Trash2, MessageCircle, Loader2, FileDown, Printer,
  HandCoins,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { toast as sonnerToast } from 'sonner'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { haptic } from '@/lib/haptic'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'

export function PartyProfile() {
  const { selectedPartyId, setView, setPreviousView, triggerRefresh, previousView, features } = useAppStore()
  const queryClient = useQueryClient()
  const [sendingReminder, setSendingReminder] = useState(false)
  const { confirmDialog, dialog: confirmDialogEl } = useConfirmDialog()
  // 🔒 FIX H3: Payment dialog state
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentType, setPaymentType] = useState<'received' | 'paid'>('received')
  const [paymentMode, setPaymentMode] = useState('cash')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['party-profile', selectedPartyId],
    queryFn: async () => {
      const r = await offlineFetch(`/api/parties/${selectedPartyId}`)
      return r.json()
    },
    enabled: !!selectedPartyId,
  })

  // Fetch shop settings for statement header
  const { data: settingData } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await offlineFetch('/api/settings')
      return r.json()
    },
  })
  const setting = settingData?.setting || {}

  // 🔒 FIX React #310: These hooks MUST be before the early return (Rules of Hooks).
  // Was: useQuery for payments + useMemo for statement were after `if (isLoading || !data) return`.
  // Moved here so all hooks are called unconditionally.

  // Fetch payments for this party (for the unified account statement)
  const { data: paymentsData } = useQuery({
    queryKey: ['party-payments', selectedPartyId],
    queryFn: async () => {
      const r = await offlineFetch(`/api/payments?partyId=${selectedPartyId}`)
      if (!r.ok) throw new Error('Failed')
      return r.json()
    },
    enabled: !!selectedPartyId,
  })

  // Extract data safely (before early return)
  const party = data?.party
  const stats = data?.stats
  const topProducts = data?.topProducts || []
  const monthlyData = data?.monthlyData || []
  const transactions = data?.transactions || []
  const payments = paymentsData?.payments || []

  // Merge transactions + payments into a unified chronological statement
  const statement = useMemo(() => {
    const txEntries = transactions.map((t: any) => ({
      id: t.id,
      date: t.date,
      type: t.type,
      amount: t.totalAmount,
      due: t.totalAmount - t.paidAmount,
      invoiceNo: t.invoiceNo,
      itemCount: t.items?.length || 0,
      isPayment: false,
    }))
    const payEntries = payments.map((p: any) => ({
      id: p.id,
      date: p.date,
      type: p.type === 'received' ? 'payment-received' : 'payment-paid',
      amount: p.amount,
      due: 0,
      invoiceNo: null,
      itemCount: 0,
      paymentMode: p.mode,
      notes: p.notes,
      isPayment: true,
    }))
    return [...txEntries, ...payEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [transactions, payments])

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  // 🔒 FIX React #310: party, stats, etc. are now extracted before the early return (line 79-84)
  // to satisfy React's Rules of Hooks. No re-declaration here.

  const handleNewTransaction = (type: 'sale' | 'purchase') => {
    // Set preset data with party pre-selected
    ;(window as any).__ledgerPreset = {
      type,
      data: {
        partyId: party.id,
        partyName: party.name,
        date: new Date().toISOString().slice(0, 10),
      },
    }
    useAppStore.getState().setScannerBillType(type)
    setPreviousView('party-profile')
    setView(type === 'sale' ? 'sales' : 'purchases')
  }

  const handleViewTransaction = (txnId: string) => {
    useAppStore.getState().setSelectedTransactionId(txnId)
    setPreviousView('party-profile')
    setView('transaction-detail')
  }

  // 🔒 FIX H3: Record a payment (receive from customer / pay to supplier)
  const handleSavePayment = async () => {
    const amt = parseFloat(paymentAmount) || 0
    if (amt <= 0) {
      sonnerToast.error('Enter a valid amount')
      return
    }
    setSavingPayment(true)
    try {
      const r = await offlineFetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partyId: selectedPartyId,
          amount: amt,
          type: paymentType,
          mode: paymentMode,
          notes: paymentNotes || undefined,
        }),
        offline: { invalidate: ['/api/parties', '/api/dashboard'] },
      })
      if (!r.ok) throw new Error('Failed')
      sonnerToast.success(paymentType === 'received' ? 'Payment received!' : 'Payment recorded!')
      setPaymentDialogOpen(false)
      setPaymentAmount('')
      setPaymentNotes('')
      haptic.success()
      // Refresh party profile data to show updated balance
      queryClient.invalidateQueries({ queryKey: ['party-profile', selectedPartyId] })
      queryClient.invalidateQueries({ queryKey: ['party-payments', selectedPartyId] })
      triggerRefresh()
    } catch {
      haptic.error()
      sonnerToast.error('Failed to record payment')
    } finally {
      setSavingPayment(false)
    }
  }

  // 🔒 FIX React #310: Old duplicate payments query removed.
  // The payments useQuery + statement useMemo are now declared BEFORE the
  // early return (lines 68-111) to satisfy React's Rules of Hooks.

  const handleDelete = async () => {
    if (!await confirmDialog(`Delete ${party.name}? All their transactions will remain but lose the party link.`, { title: 'Delete Party', confirmLabel: 'Delete', destructive: true })) return
    const r = await offlineFetch(`/api/parties/${party.id}`, { method: 'DELETE', offline: { invalidate: ['/api/parties', '/api/dashboard'] } })
    if (r.ok) {
      sonnerToast.success(isQueuedResponse(r) ? 'Will delete when online' : 'Party deleted')
      queryClient.invalidateQueries({ queryKey: ['parties'] })
      setView(previousView || 'parties')
      triggerRefresh()
    }
  }

  const handleSendReminder = async () => {
    if (!party) return
    setSendingReminder(true)
    try {
      const r = await offlineFetch('/api/whatsapp-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partyId: party.id }),
      })
      const data = await r.json()
      if (data.success) {
        window.open(data.whatsappUrl, '_blank')
        sonnerToast.success('Opening WhatsApp with reminder message...')
      } else {
        sonnerToast.error(data.error || 'Failed to generate reminder')
      }
    } catch {
      sonnerToast.error('Failed to send reminder')
    } finally {
      setSendingReminder(false)
    }
  }

  // Generate a printable statement HTML for this party
  const handleDownloadStatement = () => {
    if (!party || !transactions) return

    const shopName = setting?.shopName || 'My Shop'
    const shopAddress = setting?.address || ''
    const shopPhone = setting?.phone || ''
    const shopGstin = setting?.gstin || ''

    const rows = transactions.map((t: any, i: number) => {
      const isInflow = t.type === 'sale' || t.type === 'income'
      const amount = isInflow ? t.totalAmount : -t.totalAmount
      const paid = t.paidAmount || 0
      const due = t.totalAmount - paid
      return `
        <tr>
          <td style="text-align:center">${i + 1}</td>
          <td>${formatDate(t.date)}</td>
          <td>${t.invoiceNo || '—'}</td>
          <td style="text-transform:capitalize">${t.type}</td>
          <td style="text-align:right">${t.totalAmount.toFixed(2)}</td>
          <td style="text-align:right">${paid.toFixed(2)}</td>
          <td style="text-align:right; color:${due > 0 ? '#dc2626' : '#059669'}">${due.toFixed(2)}</td>
        </tr>
      `
    }).join('')

    const totalAmount = transactions.reduce((s: number, t: any) => s + t.totalAmount, 0)
    const totalPaid = transactions.reduce((s: number, t: any) => s + (t.paidAmount || 0), 0)
    const totalDue = totalAmount - totalPaid

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Statement - ${party.name}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1a1a1a; }
    .header { display: flex; justify-content: space-between; align-items: start; border-bottom: 3px solid #d97706; padding-bottom: 20px; margin-bottom: 30px; }
    .shop-info h1 { margin: 0; font-size: 22px; color: #1a1a1a; }
    .shop-info p { margin: 3px 0; font-size: 12px; color: #555; }
    .statement-title { text-align: right; }
    .statement-title h2 { margin: 0; font-size: 18px; text-transform: uppercase; letter-spacing: 1px; }
    .statement-title p { margin: 3px 0; font-size: 12px; color: #555; }
    .party-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; margin-bottom: 25px; display: flex; justify-content: space-between; }
    .party-box .label { font-size: 10px; text-transform: uppercase; color: #888; font-weight: 600; }
    .party-box .value { font-size: 14px; font-weight: 600; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #fef3e6; padding: 10px; font-size: 12px; font-weight: 600; color: #444; text-align: left; border-bottom: 2px solid #d97706; }
    td { padding: 8px 10px; font-size: 13px; border-bottom: 1px solid #e5e7eb; }
    .totals { margin-left: auto; width: 300px; }
    .totals .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
    .totals .grand { font-size: 16px; font-weight: bold; border-top: 2px solid #1a1a1a; padding-top: 10px; margin-top: 5px; }
    .footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #888; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="shop-info">
      <h1>${shopName}</h1>
      ${shopAddress ? `<p>${shopAddress}</p>` : ''}
      <p>${shopPhone ? 'Phone: ' + shopPhone : ''} ${shopGstin ? ' | GSTIN: ' + shopGstin : ''}</p>
    </div>
    <div class="statement-title">
      <h2>Account Statement</h2>
      <p>Generated on ${formatDate(new Date())}</p>
    </div>
  </div>

  <div class="party-box">
    <div>
      <p class="label">Party Name</p>
      <p class="value">${party.name}</p>
      ${party.phone ? `<p style="font-size:12px;color:#555;margin-top:4px;">${party.phone}</p>` : ''}
      ${party.gstin ? `<p style="font-size:12px;color:#555;font-family:monospace;">GSTIN: ${party.gstin}</p>` : ''}
    </div>
    <div style="text-align:right">
      <p class="label">Party Type</p>
      <p class="value" style="text-transform:capitalize">${party.type}</p>
      <p style="font-size:12px;color:#555;margin-top:4px;">${transactions.length} transactions</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:40px">#</th>
        <th>Date</th>
        <th>Invoice</th>
        <th>Type</th>
        <th style="text-align:right">Amount</th>
        <th style="text-align:right">Paid</th>
        <th style="text-align:right">Due</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Total Amount:</span><span>₹${totalAmount.toFixed(2)}</span></div>
    <div class="row"><span>Total Paid:</span><span style="color:#059669">₹${totalPaid.toFixed(2)}</span></div>
    <div class="row grand"><span>Balance Due:</span><span style="color:${totalDue > 0 ? '#dc2626' : '#059669'}">₹${totalDue.toFixed(2)}</span></div>
  </div>

  <div class="footer">
    <p>This is a computer-generated statement from EkBook.</p>
    <p>For any discrepancies, please contact ${shopPhone || 'the shop'} within 7 days.</p>
  </div>
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Statement_${party.name.replace(/\s+/g, '_')}_${formatDate(new Date()).replace(/\//g, '-')}.html`
    a.click()
    URL.revokeObjectURL(url)
    sonnerToast.success('Statement downloaded')
  }

  // Print statement directly
  const handlePrintStatement = () => {
    if (!party || !transactions) return
    handleDownloadStatement()
    setTimeout(() => window.print(), 500)
  }

  // Share statement as PDF via WhatsApp (uses Capacitor Share on native)
  const handleShareStatementPDF = async () => {
    if (!party || !transactions) return
    haptic.click()
    try {
      // Generate PDF using jsPDF (same logic as handleDownloadStatement but output as blob)
      const jsPDFMod: any = await import("jspdf")
      const doc = new jsPDFMod.jsPDF()({ unit: 'mm', format: 'a4' })
      const pageWidth = 210, pageHeight = 297, margin = 15
      let y = 20

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(18)
      doc.text(setting?.shopName || 'My Shop', margin, y)
      y += 6
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      if (setting?.address) { doc.text(setting.address, margin, y); y += 4 }
      let contactLine = ''
      if (setting?.phone) contactLine += `Phone: ${setting.phone}  `
      if (setting?.gstin) contactLine += `GSTIN: ${setting.gstin}`
      if (contactLine) { doc.text(contactLine, margin, y); y += 4 }
      y += 2; doc.setDrawColor(200); doc.line(margin, y, pageWidth - margin, y); y += 8

      doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
      doc.text('ACCOUNT STATEMENT', margin, y)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
      doc.text(`Generated: ${formatDate(new Date())}`, pageWidth - margin, y, { align: 'right' })
      y += 8

      doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
      doc.text('Party:', margin, y)
      doc.setFont('helvetica', 'normal')
      doc.text(`${party.name}  (${party.type})`, margin + 15, y)
      y += 5
      let partyLine = ''
      if (party.phone) partyLine += `Phone: ${party.phone}  `
      if (party.gstin) partyLine += `GSTIN: ${party.gstin}`
      if (partyLine) { doc.text(partyLine, margin, y); y += 5 }
      doc.text(`Total Transactions: ${transactions.length}`, margin, y); y += 6

      doc.setFillColor(240, 240, 240)
      doc.rect(margin, y - 4, pageWidth - 2 * margin, 8, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
      doc.text('#', margin + 2, y); doc.text('Date', margin + 10, y)
      doc.text('Invoice', margin + 40, y); doc.text('Type', margin + 75, y)
      doc.text('Amount', margin + 110, y, { align: 'right' })
      doc.text('Paid', margin + 140, y, { align: 'right' })
      doc.text('Due', pageWidth - margin - 2, y, { align: 'right' })
      y += 6

      doc.setFont('helvetica', 'normal')
      let totalAmount = 0, totalPaid = 0
      transactions.forEach((t: any, i: number) => {
        if (y > pageHeight - 40) { doc.addPage(); y = 20 }
        const due = t.totalAmount - (t.paidAmount || 0)
        totalAmount += t.totalAmount; totalPaid += (t.paidAmount || 0)
        doc.text(String(i + 1), margin + 2, y)
        doc.text(formatDate(t.date), margin + 10, y)
        doc.text(t.invoiceNo || '—', margin + 40, y)
        doc.text(t.type, margin + 75, y)
        doc.text(`Rs. ${t.totalAmount.toFixed(2)}`, margin + 110, y, { align: 'right' })
        doc.text(`Rs. ${(t.paidAmount || 0).toFixed(2)}`, margin + 140, y, { align: 'right' })
        if (due > 0) doc.setTextColor(200, 0, 0)
        doc.text(`Rs. ${due.toFixed(2)}`, pageWidth - margin - 2, y, { align: 'right' })
        doc.setTextColor(0); y += 5
      })

      y += 4; doc.setDrawColor(200); doc.line(margin, y, pageWidth - margin, y); y += 6
      const totalDue = totalAmount - totalPaid
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
      doc.text('Total Amount:', pageWidth - margin - 50, y)
      doc.text(`Rs. ${totalAmount.toFixed(2)}`, pageWidth - margin - 2, y, { align: 'right' }); y += 5
      doc.text('Total Paid:', pageWidth - margin - 50, y)
      doc.setTextColor(0, 128, 0)
      doc.text(`Rs. ${totalPaid.toFixed(2)}`, pageWidth - margin - 2, y, { align: 'right' }); y += 5
      doc.setTextColor(0)
      doc.text('Balance Due:', pageWidth - margin - 50, y)
      if (totalDue > 0) doc.setTextColor(200, 0, 0); else doc.setTextColor(0, 128, 0)
      doc.text(`Rs. ${totalDue.toFixed(2)}`, pageWidth - margin - 2, y, { align: 'right' })
      doc.setTextColor(0)

      y = pageHeight - 25; doc.setDrawColor(200); doc.line(margin, y, pageWidth - margin, y); y += 6
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(120)
      doc.text("Generated by EkBook", pageWidth / 2, y, { align: 'center' })

      const pdfBlob = doc.output('blob')
      const fileName = `Statement_${party.name.replace(/\s+/g, '_')}.pdf`

      const { Capacitor } = await import('@capacitor/core')
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share')
        const { Filesystem, Directory } = await import('@capacitor/filesystem')
        const reader = new FileReader()
        const base64Data = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1])
          reader.onerror = reject
          reader.readAsDataURL(pdfBlob)
        })
        const fileResult = await Filesystem.writeFile({ path: fileName, data: base64Data, directory: Directory.Cache })
        await Share.share({
          title: `Statement - ${party.name}`,
          text: `Account statement for ${party.name}`,
          url: fileResult.uri,
          dialogTitle: 'Send Statement via',
        })
        sonnerToast.success('Statement shared!')
      } else {
        const url = URL.createObjectURL(pdfBlob)
        const a = document.createElement('a')
        a.href = url; a.download = fileName; a.click()
        URL.revokeObjectURL(url)
        sonnerToast.success('Statement PDF downloaded')
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      sonnerToast.error('Failed to share statement')
    }
  }

  // Send WhatsApp payment link with UPI deep link
  const handleSendPaymentLink = () => {
    if (!party || stats.balance <= 0) return
    const shopName = setting?.shopName || 'My Shop'
    const shopPhone = setting?.phone || ''
    const upiId = setting?.upiId || '' // Future: add UPI ID to settings
    const message = `Dear ${party.name},\n\nYou have an outstanding balance of Rs. ${stats.balance.toFixed(2)} with ${shopName}.\nPlease clear the payment at your earliest convenience.\n${upiId ? `\nPay via UPI: upi://pay?pa=${upiId}&pn=${encodeURIComponent(shopName)}&am=${stats.balance.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Payment to ' + shopName)}\n` : ''}Thank you for your business!`
    const text = encodeURIComponent(message)
    const phone = party.phone ? `91${party.phone.replace(/\D/g, '')}` : ''
    window.open(`https://wa.me/${phone}?text=${text}`, '_blank')
    sonnerToast.success('Opening WhatsApp with payment reminder...')
  }

  const isCustomer = party.type === 'customer' || party.type === 'both'
  const isSupplier = party.type === 'supplier' || party.type === 'both'

  return (
    <div className="space-y-4">
      {/* Profile header — premium gradient banner */}
      <div className={cn(
        'rounded-2xl shadow-card overflow-hidden text-white relative',
        party.type === 'customer' ? 'bg-gradient-to-br from-emerald-500 to-teal-600' :
        party.type === 'supplier' ? 'bg-gradient-to-br from-amber-500 to-orange-600' :
        'bg-gradient-to-br from-violet-500 to-purple-600'
      )}>
        {/* Decorative circles */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 pointer-events-none" />
        <div className="absolute bottom-0 right-20 w-24 h-24 bg-white/5 rounded-full -mb-12 pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-start gap-4 flex-wrap">
            <Avatar className="w-16 h-16 border-4 border-white/30 flex-shrink-0">
              <AvatarFallback className="bg-white/20 backdrop-blur-sm text-white text-xl font-bold">
                {getInitials(party.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-bold font-heading tracking-tight truncate">{party.name}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-[10px] font-medium bg-white/20 backdrop-blur-sm rounded-full px-2 py-0.5 capitalize">{party.type}</span>
                {party.phone && (
                  <span className="text-white/80 text-sm flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {party.phone}
                  </span>
                )}
                {party.state && (
                  <span className="text-white/80 text-sm flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {party.state}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-white/70 text-xs uppercase">Outstanding</p>
              <p className={cn('text-2xl font-bold tabular-nums', stats.balance >= 0 ? 'text-white' : 'text-red-200')}>
                {stats.balance >= 0 ? '+' : ''}{formatINR(stats.balance)}
              </p>
              <p className="text-white/70 text-xs mt-0.5">
                {stats.balance > 0 ? 'They owe you' : stats.balance < 0 ? 'You owe them' : 'Settled'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
          {isCustomer && (
            <Button size="sm" onClick={() => handleNewTransaction('sale')} className="bg-gradient-emerald gap-2">
              <Plus className="w-4 h-4" /> New Sale
            </Button>
          )}
          {isSupplier && (
            <Button size="sm" onClick={() => handleNewTransaction('purchase')} className="bg-gradient-saffron gap-2">
              <Plus className="w-4 h-4" /> New Purchase
            </Button>
          )}
          {/* 🔒 FIX H3: Receive Payment / Make Payment button */}
          <Button size="sm" variant="outline" onClick={() => setPaymentDialogOpen(true)} className="gap-2">
            <HandCoins className="w-4 h-4" /> Settle
          </Button>
          {isCustomer && stats.balance > 0 && features?.paymentReminders && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleSendReminder}
              disabled={sendingReminder}
              className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              {sendingReminder ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
              Send Reminder
            </Button>
          )}
          {/* WhatsApp Payment Link — sends UPI payment link for outstanding dues */}
          {isCustomer && stats.balance > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleSendPaymentLink}
              className="gap-2 border-violet-300 text-violet-700 hover:bg-violet-50"
              title="Send WhatsApp message with payment details"
            >
              <IndianRupee className="w-4 h-4" />
              Payment Link
            </Button>
          )}
          {/* Download Statement PDF */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadStatement}
            className="gap-2"
            title="Download account statement as PDF"
          >
            <FileDown className="w-4 h-4" />
            PDF
          </Button>
          {/* Share Statement PDF via WhatsApp */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleShareStatementPDF}
            className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            title="Share account statement as PDF via WhatsApp"
          >
            <MessageCircle className="w-4 h-4" />
            Send PDF
          </Button>
          <Button size="sm" variant="outline" onClick={() => setView('parties')} className="gap-2">
            <User className="w-4 h-4" /> All Parties
          </Button>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={handleDelete} className="gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50">
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total Sales"
          value={formatINR(stats.totalSales)}
          icon={ShoppingCart}
          color="text-emerald-600"
          bg="bg-emerald-100"
          sub={`${stats.salesCount} sales`}
        />
        <StatCard
          label="Total Purchases"
          value={formatINR(stats.totalPurchases)}
          icon={Truck}
          color="text-amber-600"
          bg="bg-amber-100"
          sub={`${stats.purchasesCount} purchases`}
        />
        <StatCard
          label="Received"
          value={formatINR(stats.totalReceived)}
          icon={ArrowDownRight}
          color="text-violet-600"
          bg="bg-violet-100"
        />
        <StatCard
          label="Paid"
          value={formatINR(stats.totalPaid)}
          icon={ArrowUpRight}
          color="text-rose-600"
          bg="bg-rose-100"
        />
      </div>

      {/* Contact details */}
      {(party.gstin || party.email || party.address) && (
        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Contact & GST Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {party.gstin && (
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">GSTIN</p>
                    <p className="font-mono text-sm font-medium">{party.gstin}</p>
                  </div>
                </div>
              )}
              {party.email && (
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Email</p>
                    <p className="text-sm font-medium">{party.email}</p>
                  </div>
                </div>
              )}
              {party.address && (
                <div className="flex items-start gap-2 sm:col-span-2">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Address</p>
                    <p className="text-sm">{party.address}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly activity chart */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> 6-Month Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.91 0.01 60)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
              <Tooltip formatter={(v: number) => formatINR(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="sales" name="Sales" fill="oklch(0.62 0.15 155)" radius={[6, 6, 0, 0]} barSize={24} />
              <Bar dataKey="purchases" name="Purchases" fill="oklch(0.62 0.18 42)" radius={[6, 6, 0, 0]} barSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top products */}
      {topProducts.length > 0 && (
        <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Products</CardTitle>
            <p className="text-xs text-muted-foreground">Most frequently transacted</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topProducts.map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </div>
                    <span className="text-sm font-medium">{p.name}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{formatINR(p.amount)}</p>
                    <p className="text-[11px] text-muted-foreground">{p.quantity} units</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 🔒 UI/UX 2: Account Statement — merged transactions + payments timeline
          Sales (inflow) = right-aligned green bubbles
          Purchases (outflow) = left-aligned amber bubbles
          Payments received = right-aligned blue bubbles
          Payments paid = left-aligned blue bubbles
          Date separators between days, running balance sticky at top */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="w-4 h-4" /> Account Statement
            </CardTitle>
            <Badge variant="secondary">{statement.length} entries</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {statement.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">No transactions or payments yet with this party</p>
          ) : (
            <div className="max-h-[500px] overflow-y-auto rounded-xl bg-muted/20 p-3 space-y-1">
              {/* Running balance banner at top */}
              <div className="sticky top-0 z-10 -mx-3 px-3 py-2 mb-2 bg-primary/10 backdrop-blur-sm border-y border-primary/20 text-center">
                <span className="text-xs text-muted-foreground">Current Balance: </span>
                <span className={cn('text-xs font-bold', stats.balance > 0 ? 'text-emerald-600' : stats.balance < 0 ? 'text-rose-600' : 'text-muted-foreground')}>
                  {stats.balance >= 0 ? '+' : ''}{formatINR(stats.balance)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {' '}· {stats.balance > 0 ? 'They owe you' : stats.balance < 0 ? 'You owe them' : 'Settled'}
                </span>
              </div>

              {statement.map((entry: any, index: number) => {
                const isSale = entry.type === 'sale'
                const isPurchase = entry.type === 'purchase'
                const isPayReceived = entry.type === 'payment-received'
                const isPayPaid = entry.type === 'payment-paid'
                const isInflow = isSale || isPayReceived
                const entryDate = new Date(entry.date)
                const prevEntry = statement[index - 1]
                const showDateSeparator = !prevEntry || new Date(prevEntry.date).toDateString() !== entryDate.toDateString()

                return (
                  <div key={`${entry.isPayment ? 'pay' : 'txn'}-${entry.id}`}>
                    {/* Date separator */}
                    {showDateSeparator && (
                      <div className="flex justify-center my-3">
                        <span className="text-[10px] font-medium text-muted-foreground bg-background px-3 py-1 rounded-full border border-border">
                          {formatDate(entry.date)}
                        </span>
                      </div>
                    )}

                    {/* Chat bubble */}
                    {entry.isPayment ? (
                      // Payment entry — blue/teal bubble, not clickable
                      <div className={cn('flex w-full', isInflow ? 'justify-end' : 'justify-start')}>
                        <div
                          className={cn(
                            'max-w-[80%] rounded-2xl px-3 py-2 shadow-sm',
                            isInflow
                              ? 'bg-blue-500 text-white rounded-br-md'
                              : 'bg-teal-600 text-white rounded-bl-md'
                          )}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <HandCoins className="w-3 h-3" />
                            <span className="text-[10px] font-semibold uppercase tracking-wide opacity-90">
                              {isPayReceived ? 'Received' : 'Paid'}
                            </span>
                            <span className="text-[10px] opacity-75 bg-white/20 px-1.5 py-0.5 rounded">
                              {entry.paymentMode}
                            </span>
                          </div>
                          <p className="text-base font-bold tabular-nums">
                            {isInflow ? '+' : '-'}{formatINR(entry.amount)}
                          </p>
                          {entry.notes && (
                            <p className="text-[10px] opacity-75 mt-0.5">{entry.notes}</p>
                          )}
                          <span className="text-[10px] opacity-75">
                            {entryDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    ) : (
                      // Transaction entry — clickable, green/amber bubble
                      <button
                        onClick={() => handleViewTransaction(entry.id)}
                        className={cn(
                          'flex w-full group',
                          isInflow ? 'justify-end' : 'justify-start',
                        )}
                      >
                        <div
                          className={cn(
                            'max-w-[80%] rounded-2xl px-3 py-2 shadow-sm transition group-hover:shadow-md group-active:scale-95',
                            isInflow
                              ? 'bg-emerald-500 text-white rounded-br-md'
                              : 'bg-amber-500 text-white rounded-bl-md'
                          )}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wide opacity-90">
                              {entry.type}
                            </span>
                            {entry.invoiceNo && (
                              <span className="text-[10px] opacity-75 bg-white/20 px-1.5 py-0.5 rounded">
                                {entry.invoiceNo}
                              </span>
                            )}
                            <span className="text-[10px] opacity-75">
                              {entry.itemCount} items
                            </span>
                          </div>
                          <p className="text-base font-bold tabular-nums">
                            {isInflow ? '+' : '-'}{formatINR(entry.amount)}
                          </p>
                          <div className="flex items-center justify-between gap-2 mt-1">
                            {entry.due > 0 ? (
                              <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded">
                                Due: {formatINR(entry.due)}
                              </span>
                            ) : (
                              <span className="text-[10px] opacity-75">✓ Paid</span>
                            )}
                            <span className="text-[10px] opacity-75">
                              {entryDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
      {/* 🔒 FIX H3: Payment dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="w-5 h-5 text-primary" />
              Settle Payment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Payment Type</Label>
              <Select value={paymentType} onValueChange={(v) => setPaymentType(v as 'received' | 'paid')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="received">Received from customer</SelectItem>
                  <SelectItem value="paid">Paid to supplier</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (₹)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label>Payment Mode</Label>
              <Select value={paymentMode} onValueChange={setPaymentMode}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI / QR</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                placeholder="e.g. Part payment for July"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSavePayment} disabled={savingPayment} className="bg-gradient-saffron gap-2">
              {savingPayment ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {savingPayment ? 'Saving...' : 'Record Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 🔒 UI/UX 2: Payment History card removed — payments now appear in the
          unified Account Statement above (merged with transactions in a
          chronological timeline with blue/teal bubbles). */}

      {confirmDialogEl}
    </div>
  )
}

function StatCard({ label, value, icon: Icon, color, bg, sub }: {
  label: string
  value: string
  icon: any
  color: string
  bg: string
  sub?: string
}) {
  // Map bg to gradient for top accent
  const gradient = bg.includes('emerald') ? 'from-emerald-500 to-teal-600'
    : bg.includes('amber') ? 'from-amber-500 to-orange-600'
    : bg.includes('violet') ? 'from-violet-500 to-purple-600'
    : bg.includes('rose') ? 'from-rose-500 to-red-600'
    : 'from-blue-500 to-indigo-600'

  return (
    <div className="rounded-2xl bg-card border border-border/60 shadow-card overflow-hidden">
      <div className={`h-1 bg-gradient-to-r ${gradient}`} />
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', bg)}>
            <Icon className={cn('w-3.5 h-3.5', color)} />
          </div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
        </div>
        <p className="text-lg font-bold tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
