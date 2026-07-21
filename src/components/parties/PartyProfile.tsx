'use client'

import { useState, useMemo, useEffect } from 'react'
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
import { useCountUp } from '@/hooks/use-count-up'
import { roundMoney } from '@/lib/money'
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
import { computeStatementRunningBalance } from '@/lib/statement-balance'
import { readError } from '@/lib/read-error'

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

  // 🔒 V26 N1b: Skeleton-dead-end guard (mirrors TransactionDetail.tsx).
  // The browser-back hook clears selectedPartyId on popstate
  // (use-browser-back-button.ts:232-234). Popping INTO party-profile with a
  // nulled id disables the query → isLoading stays false, data stays
  // undefined → skeleton forever. Redirect to the parties list instead.
  // Targeted patch for the most user-facing N1 symptom; full systemic fix
  // (store navStack as single model, restore params on pop) is queued.
  useEffect(() => {
    if (!selectedPartyId) {
      setView(previousView || 'parties')
    }
  }, [selectedPartyId, previousView, setView])

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
  //
  // 🔒 V15 M-2: The separate /api/payments fetch is GONE. Payments are now
  // bundled into the /api/parties/[id] response as `statementPayments`
  // (newest-first, capped at 500, soft-delete-filtered) so the statement
  // has a complete, consistent data set — no more "paginated transactions
  // merged with all payments" mismatch that dropped older invoices while
  // their payments remained.
  // 🔒 V17 §2.2: Order changed from oldest-first to newest-first (date DESC).

  // Extract data safely (before early return)
  const party = data?.party
  const stats = data?.stats
  const topProducts = data?.topProducts || []
  const monthlyData = data?.monthlyData || []
  const transactions = data?.transactions || []
  // 🔒 V26 Phase 6 §6.6: Animate the balance value with useCountUp — makes
  // state changes *visible* after a payment (GPay-style). The animation runs
  // from 0→balance on mount + when balance changes (e.g. after recording a
  // payment, the balance ticks down animatedly).
  const animatedBalance = useCountUp(stats?.balance ?? 0, 800)
  // 🔒 V15 M-2: Statement-grade data — complete (capped at 500), newest-first.
  // Used ONLY for the account statement. The paginated `transactions` array
  // above is still used for the recent-transactions list.
  // 🔒 V17 §2.2: Order changed from oldest-first to newest-first (date DESC).
  const statementTransactions = data?.statementTransactions || []
  const statementPayments = data?.statementPayments || []
  const statementTotals = data?.statementTotals

  // 🔒 V15 M-2 + V17 §2.1/§2.2/§2.3: Build the unified statement with a running
  // balance.
  //
  // V17 §2.1: The logic is extracted into `computeStatementRunningBalance()`
  // (src/lib/statement-balance.ts) so it can be tested behaviorally without
  // mounting the React component. The behavioral test in
  // src/__tests__/lib/balance-reconciliation-behavioral.test.ts calls this
  // exact function with a fixture and asserts the result agrees with
  // computePartyBalance() and getReceivablePayable().
  //
  // Algorithm (V17 backward walk):
  //   1. Merge + sort NEWEST → OLDEST.
  //   2. First entry (newest) gets runningBalance = stats.balance (the true
  //      current balance from the server). Top row ALWAYS ties to the headline,
  //      even when truncated (>500 entries).
  //   3. Each older entry: runningBalance = roundMoney(prev.balance - prev.delta).
  //   4. If NOT truncated, oldest entry's balance - delta = openingBalance.
  //
  // V17 §2.2: Was forward walk from OPENING — broke at >500 entries (showed
  // oldest 500, closing balance didn't match headline). Now backward from
  // stats.balance — shows newest 500, top row always matches headline.
  //
  // V17 §2.3: Uses roundMoney (not inline Math.round) — eliminates per-row
  // vs aggregate paisa drift.
  const statement = useMemo(
    () => computeStatementRunningBalance(
      statementTransactions,
      statementPayments,
      Number(stats?.balance ?? 0),
    ),
    [statementTransactions, statementPayments, stats],
  )

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
    // 🔒 V26 Phase 8 NAV-1: Navigate DIRECTLY to the form, not via the ledger
    // relay. Was: setView('sales'/'purchases') → Ledger relayed to new-sale →
    // but Ledger nulled __ledgerPreset before TransactionEntry could read it
    // (100ms delay) → form opened empty. Now: direct navigation, preset survives.
    setView(type === 'sale' ? 'new-sale' : 'new-purchase')
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
      if (!r.ok) throw new Error(await readError(r))
      const data = await r.json()
      sonnerToast.success(paymentType === 'received' ? 'Payment received!' : 'Payment recorded!')
      // 🔒 FIX M-NEW-1: Show double-counting warning if the server detected it
      if (data.warning) {
        sonnerToast.warning('Double-counting risk', {
          description: data.warning,
          duration: 12000,
        })
      }
      setPaymentDialogOpen(false)
      setPaymentAmount('')
      setPaymentNotes('')
      haptic.success()
      // Refresh party profile data to show updated balance + new payment in
      // the unified statement (statementPayments is now part of this response).
      queryClient.invalidateQueries({ queryKey: ['party-profile', selectedPartyId] })
      // 🔒 V26 Phase 8 PB-4: Also invalidate the parties LIST + dashboard so
      // the balance updates everywhere. Was: only party-profile was invalidated
      // → the Parties list still showed the old balance after settling.
      queryClient.invalidateQueries({ queryKey: ['parties'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      triggerRefresh()
    } catch (e: any) {
      // 🔒 V26 Phase 8 PB-5: Surface the server's error message (was: discarded).
      // Period-lock, future-date, and validation messages now reach the user.
      haptic.error()
      sonnerToast.error(e?.message || "Couldn't record the payment")
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
        sonnerToast.error(data.error || "Couldn't generate reminder")
      }
    } catch (e: any) {
      sonnerToast.error(e?.message || "Couldn't send the reminder")
    } finally {
      setSendingReminder(false)
    }
  }

  // Generate a printable statement HTML for this party
  const handleDownloadStatement = () => {
    if (!party) return
    // 🔒 V26 Phase 8 R9-1/R9-2 (CRITICAL FIX): Drive the statement from the
    // `statement` array (which correctly merges transactions + payments +
    // running balance, ties to the headline balance) — NOT from raw
    // `statementTransactions` (which omits standalone payments and re-derives
    // totals incorrectly). Was: allTxns.reduce() for totals → missed all
    // settle payments → closing balance didn't match the headline. Now: the
    // statement array IS the source of truth, and the closing figure is
    // stats.balance verbatim.
    const shopName = setting?.shopName || 'My Shop'
    const shopAddress = setting?.address || ''
    const shopPhone = setting?.phone || ''
    const shopGstin = setting?.gstin || ''

    // 🔒 R9-1: rows come from the SHARED builder used by all three exporters.
    // The previous inline version also had a rendering bug: it printed
    // Math.abs(delta) in BOTH the Debit and Credit columns, so every row
    // showed its amount twice. Now a row fills exactly one column.
    const rows = buildStatementRows().map(r => `
        <tr>
          <td style="text-align:center">${r.index}</td>
          <td>${r.date}</td>
          <td>${r.particulars}</td>
          <td style="text-align:right">${r.debit ? r.debit.toFixed(2) : ''}</td>
          <td style="text-align:right; color:#059669">${r.credit ? r.credit.toFixed(2) : ''}</td>
          <td style="text-align:right; font-weight:600">${r.balance.toFixed(2)}</td>
        </tr>
      `).join('')

    // Closing balance is stats.balance — the single source of truth.
    const closingBalance = stats?.balance ?? 0
    const balanceLabel = closingBalance > 0
      ? (party?.type === 'supplier' ? 'Advance paid (they owe you)' : 'They owe you')
      : closingBalance < 0
        ? 'You owe them'
        : 'Settled'

    // Show count from statementTotals (true count, not capped).
    const totalCount = statementTotals?.transactionTotal || statement.length

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
    .balance-hero { text-align: right; }
    .balance-hero .amount { font-size: 24px; font-weight: bold; color: ${closingBalance >= 0 ? '#059669' : '#dc2626'}; }
    .balance-hero .label { font-size: 12px; color: #555; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #fef3e6; padding: 10px; font-size: 12px; font-weight: 600; color: #444; text-align: left; border-bottom: 2px solid #d97706; }
    td { padding: 8px 10px; font-size: 13px; border-bottom: 1px solid #e5e7eb; }
    .closing-box { background: #d97706; color: white; padding: 15px 20px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-top: 20px; }
    .closing-box .amount { font-size: 20px; font-weight: bold; }
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
    <div class="balance-hero">
      <p class="label">Outstanding Balance</p>
      <p class="amount">${closingBalance >= 0 ? '+' : ''}${closingBalance.toFixed(2)}</p>
      <p class="label">${balanceLabel}</p>
    </div>
  </div>

  ${totalCount > 500 ? `<p style="font-size:12px;color:#888;margin-bottom:15px;">Showing the 500 most recent entries of ${totalCount}. The closing balance reflects all entries.</p>` : ''}

  <table>
    <thead>
      <tr>
        <th style="width:40px">#</th>
        <th>Date</th>
        <th>Particulars</th>
        <th style="text-align:right">Debit (+)</th>
        <th style="text-align:right">Credit (-)</th>
        <th style="text-align:right">Balance</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="closing-box">
    <span>Closing Balance</span>
    <span class="amount">${closingBalance >= 0 ? '+' : ''}${closingBalance.toFixed(2)} — ${balanceLabel}</span>
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
  // 🔒 R9-1 STRUCTURAL FIX (2026-07-21): ONE source of statement rows.
  //
  // There are THREE statement exporters (Download HTML, Print, Send PDF).
  // Each had grown its own row-building logic, and the R9-1 money fix was
  // applied to only ONE of them — twice (V19-017 fixed Print only; the later
  // fix corrected Download only). Meanwhile "Send PDF" — the one that
  // WhatsApps a statement to the CUSTOMER — still iterated the paginated
  // 50-row `transactions` array, omitted every Settle payment, and ADDED
  // credit notes to the amount owed.
  //
  // This helper is now the single definition. All three exporters call it, so
  // the class cannot fork a fourth time. Rows come from `statement`
  // (transactions + payments merged, running balance anchored to
  // stats.balance), so an exported statement can never disagree with the
  // statement on screen.
  const buildStatementRows = () => statement.map((entry: any, i: number) => {
    const isPayment = entry.isPayment
    const particulars = isPayment
      ? (entry.type === 'payment-received' ? 'Payment received' : 'Payment made')
      : (entry.invoiceNo || entry.type)
    const delta = entry.delta
    return {
      index: i + 1,
      date: formatDate(entry.date),
      particulars,
      // Khata convention: debit increases what they owe, credit reduces it.
      debit: delta > 0 ? Math.abs(delta) : 0,
      credit: delta < 0 ? Math.abs(delta) : 0,
      balance: entry.runningBalance,
    }
  })

  /** Closing figure + wording, always the canonical balance (never re-derived). */
  const statementClosing = () => {
    const closing = stats?.balance ?? 0
    return {
      closing,
      label: closing > 0
        ? (party?.type === 'supplier' ? 'Advance paid (they owe you)' : 'They owe you')
        : closing < 0 ? 'You owe them' : 'Settled',
      trueCount: statementTotals?.transactionTotal ?? statement.length,
      truncated: (statementTotals?.transactionTotal ?? 0) > statement.length,
    }
  }

  // 🔒 V19-016 FIX: Was calling handleDownloadStatement() then window.print()
  // which printed the CURRENT PAGE (the PartyProfile UI), not the statement.
  // Now: open the generated HTML in a new window and print that.
  const handlePrintStatement = () => {
    if (!party) return
    const shopName = setting?.shopName || 'My Shop'
    const closing = statementClosing()
    const rows = buildStatementRows().map(r => `<tr><td style="text-align:center">${r.index}</td><td>${r.date}</td><td>${r.particulars}</td><td style="text-align:right">${r.debit ? r.debit.toFixed(2) : ''}</td><td style="text-align:right;color:#059669">${r.credit ? r.credit.toFixed(2) : ''}</td><td style="text-align:right;font-weight:600">${r.balance.toFixed(2)}</td></tr>`).join('')
    const truncNote = closing.truncated
      ? `<p style="font-size:11px;color:#888">Showing the most recent ${statement.length} of ${closing.trueCount} entries. The closing balance reflects all entries.</p>`
      : ''
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Statement - ${party.name}</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px}h1{font-size:22px}table{width:100%;border-collapse:collapse}th{background:#fef3e6;padding:10px;font-size:12px;text-align:left}td{padding:8px;font-size:13px;border-bottom:1px solid #e5e7eb}</style></head><body><h1>${shopName}</h1><h2>Statement: ${party.name}</h2><table><thead><tr><th>#</th><th>Date</th><th>Particulars</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead><tbody>${rows}</tbody></table><h3 style="text-align:right">Closing Balance: ${formatINR(closing.closing)} — ${closing.label}</h3>${truncNote}</body></html>`
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 250)
  }

  // Share statement as PDF via WhatsApp (uses Capacitor Share on native)
  const handleShareStatementPDF = async () => {
    if (!party || !transactions) return
    haptic.click()
    try {
      // Generate PDF using jsPDF
      const jsPDFMod: any = await import("jspdf")
      const { registerUnicodeFont, THEME, formatPDFMoney } = await import('@/lib/pdf/theme')
      const { drawBrandBand, drawFooter, drawUPIQRBlock } = await import('@/lib/pdf/primitives')
      const doc = new jsPDFMod.jsPDF({ unit: 'mm', format: 'a4' })
      await registerUnicodeFont(doc)

      const pageWidth = 210, pageHeight = 297, margin = 15
      const shopName = setting?.shopName || 'My Shop'

      // Brand band
      let y = drawBrandBand(doc, {
        shopName,
        address: setting?.address,
        phone: setting?.phone,
        gstin: setting?.gstin,
        title: 'ACCOUNT STATEMENT',
        subtitle: `Generated: ${formatDate(new Date())}`,
      })

      // Party info + balance hero
      doc.setFont(THEME.font, 'bold')
      doc.setFontSize(7)
      doc.setTextColor(THEME.textMuted.r, THEME.textMuted.g, THEME.textMuted.b)
      doc.text('PARTY', margin, y)
      doc.setFont(THEME.font, 'bold')
      doc.setFontSize(11)
      doc.setTextColor(THEME.text.r, THEME.text.g, THEME.text.b)
      doc.text(party.name, margin, y + 6)
      doc.setFont(THEME.font, 'normal')
      doc.setFontSize(8)
      doc.setTextColor(THEME.textMuted.r, THEME.textMuted.g, THEME.textMuted.b)
      let partyY = y + 11
      if (party.phone) { doc.text(party.phone, margin, partyY); partyY += 4 }
      if (party.gstin) { doc.text('GSTIN: ' + party.gstin, margin, partyY); partyY += 4 }

      // Balance hero (right side)
      const closing = statementClosing()
      doc.setFont(THEME.font, 'bold')
      doc.setFontSize(7)
      doc.setTextColor(THEME.textMuted.r, THEME.textMuted.g, THEME.textMuted.b)
      doc.text('OUTSTANDING BALANCE', pageWidth - margin, y, { align: 'right' })
      doc.setFont(THEME.font, 'bold')
      doc.setFontSize(20)
      const balColor = closing.closing >= 0 ? THEME.paid : THEME.due
      doc.setTextColor(balColor.r, balColor.g, balColor.b)
      doc.text(formatPDFMoney(Math.abs(closing.closing)), pageWidth - margin, y + 8, { align: 'right' })
      doc.setFont(THEME.font, 'normal')
      doc.setFontSize(8)
      doc.setTextColor(THEME.textMuted.r, THEME.textMuted.g, THEME.textMuted.b)
      doc.text(closing.label, pageWidth - margin, y + 13, { align: 'right' })

      y = Math.max(partyY, y + 16) + 6

      // Truncation note
      if (closing.truncated) {
        doc.setFontSize(7)
        doc.setTextColor(THEME.textMuted.r, THEME.textMuted.g, THEME.textMuted.b)
        doc.text(`Showing the most recent entries. The closing balance reflects all entries.`, margin, y)
        y += 5
      }

      // Table header
      const drawHeaderRow = () => {
        doc.setFillColor(THEME.brand.r, THEME.brand.g, THEME.brand.b)
        doc.rect(margin, y - 4, pageWidth - 2 * margin, 8, 'F')
        doc.setFont(THEME.font, 'bold')
        doc.setFontSize(8)
        doc.setTextColor(THEME.white.r, THEME.white.g, THEME.white.b)
        doc.text('#', margin + 2, y + 1)
        doc.text('Date', margin + 10, y + 1)
        doc.text('Particulars', margin + 40, y + 1)
        doc.text('Debit', margin + 118, y + 1, { align: 'right' })
        doc.text('Credit', margin + 148, y + 1, { align: 'right' })
        doc.text('Balance', pageWidth - margin - 2, y + 1, { align: 'right' })
        doc.setTextColor(THEME.text.r, THEME.text.g, THEME.text.b)
        y += 8
        doc.setFont(THEME.font, 'normal')
        doc.setFontSize(9)
      }

      y += 2
      drawHeaderRow()

      const rows = buildStatementRows()
      rows.forEach((r) => {
        if (y > pageHeight - 40) { doc.addPage(); y = 20; drawHeaderRow() }
        if (r.index % 2 === 0) {
          doc.setFillColor(THEME.zebra.r, THEME.zebra.g, THEME.zebra.b)
          doc.rect(margin, y - 4, pageWidth - 2 * margin, 6, 'F')
        }
        doc.text(String(r.index), margin + 2, y)
        doc.text(r.date, margin + 10, y)
        doc.text(String(r.particulars).slice(0, 38), margin + 40, y)
        if (r.debit) doc.text(formatPDFMoney(r.debit), margin + 118, y, { align: 'right' })
        if (r.credit) {
          doc.setTextColor(THEME.paid.r, THEME.paid.g, THEME.paid.b)
          doc.text(formatPDFMoney(r.credit), margin + 148, y, { align: 'right' })
          doc.setTextColor(THEME.text.r, THEME.text.g, THEME.text.b)
        }
        doc.setFont(THEME.font, 'bold')
        doc.text(formatPDFMoney(r.balance), pageWidth - margin - 2, y, { align: 'right' })
        doc.setFont(THEME.font, 'normal')
        y += 6
      })

      // Closing balance box
      y += 4
      doc.setFillColor(THEME.brand.r, THEME.brand.g, THEME.brand.b)
      doc.rect(pageWidth - margin - 65, y - 4, 65, 11, 'F')
      doc.setFont(THEME.font, 'bold')
      doc.setFontSize(11)
      doc.setTextColor(THEME.white.r, THEME.white.g, THEME.white.b)
      doc.text('CLOSING BALANCE', pageWidth - margin - 63, y + 3)
      doc.text(formatPDFMoney(Math.abs(closing.closing)), pageWidth - margin - 2, y + 3, { align: 'right' })
      y += 15
      doc.setFont(THEME.font, 'normal')
      doc.setFontSize(8)
      doc.setTextColor(THEME.textMuted.r, THEME.textMuted.g, THEME.textMuted.b)
      doc.text(closing.label, pageWidth - margin - 2, y, { align: 'right' })

      // UPI QR (if balance > 0 and upiId set)
      if (setting?.upiId && Math.abs(closing.closing) > 0) {
        y += 5
        await drawUPIQRBlock(doc, margin, y, {
          upiId: setting.upiId,
          shopName,
          amount: Math.abs(closing.closing),
          note: 'Statement Settlement',
        })
      }

      // Footer
      drawFooter(doc, 1, 1)

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
      sonnerToast.error(err?.message || "Couldn\'t share the statement")
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
                <span className="text-3xs font-medium bg-white/20 backdrop-blur-sm rounded-full px-2 py-0.5 capitalize">{party.type}</span>
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
                {stats.balance >= 0 ? '+' : ''}{formatINR(animatedBalance)}
              </p>
              <p className="text-white/70 text-xs mt-0.5">
                {/* 🔒 V26 Phase 8 PB-6: Better label for supplier balances.
                    Was: "They owe you" even for suppliers → confusing when you
                    paid them and it shows as a receivable. Now: context-aware. */}
                {stats.balance > 0
                  ? party?.type === 'supplier'
                    ? 'Advance paid (they owe you)'
                    : 'They owe you'
                  : stats.balance < 0
                    ? party?.type === 'supplier'
                      ? 'You owe them'
                      : 'You owe them'
                    : 'Settled'}
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
          <Button size="sm" variant="outline" onClick={() => {
            // 🔒 V26 Phase 8 PB-3: Default payment direction based on party type.
            // Was: always 'received' — opening Settle on a supplier pre-selected
            // "received" → one careless tap recorded the payment in the wrong direction.
            const defaultType = party?.type === 'supplier' ? 'paid' : (stats?.balance ?? 0) < 0 ? 'paid' : 'received'
            setPaymentType(defaultType)
            setPaymentDialogOpen(true)
          }} className="gap-2">
            <HandCoins className="w-4 h-4" /> Settle
          </Button>
          {isCustomer && stats.balance > 0 && features?.paymentReminders && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleSendReminder}
              disabled={sendingReminder}
              className="gap-2 border-emerald-300 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50"
            >
              {sendingReminder ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
              Send Reminder
            </Button>
          )}
          {/* 🔒 V19-031 FIX: Show "Notify Supplier" button when we owe them (balance < 0) */}
          {isSupplier && stats.balance < 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const phone = party?.phone?.replace(/\D/g, '')
                if (phone) {
                  const msg = `Hi ${party?.name}, we have a pending payment of ₹${Math.abs(stats.balance).toFixed(2)} to you. Will settle soon.`
                  window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`, '_blank')
                }
              }}
              className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
            >
              <MessageCircle className="w-4 h-4" />
              Notify Supplier
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
            className="gap-2 border-emerald-300 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50"
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

      {/* Stats grid — 🔒 V26 Phase 8 PB-7: Hide irrelevant cards by party type.
          Was: all 4 cards always rendered → a customer showing "Total Purchases ₹0 / Paid ₹0"
          reads as broken. Now: show sales-side cards for customers, purchase-side for
          suppliers, all for 'both'. Also show if there's actual data regardless of type. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Sales-side cards: show for customers, 'both', or if sales data exists */}
        {(party.type !== 'supplier' || stats.salesCount > 0) && (
        <StatCard
          label="Total Sales"
          value={formatINR(stats.totalSales)}
          icon={ShoppingCart}
          color="text-emerald-600 dark:text-emerald-400"
          bg="bg-emerald-100"
          sub={`${stats.salesCount} sales`}
        />
        )}
        {/* Purchase-side cards: show for suppliers, 'both', or if purchase data exists */}
        {(party.type !== 'customer' || stats.purchasesCount > 0) && (
        <StatCard
          label="Total Purchases"
          value={formatINR(stats.totalPurchases)}
          icon={Truck}
          color="text-amber-600 dark:text-amber-400"
          bg="bg-amber-100"
          sub={`${stats.purchasesCount} purchases`}
        />
        )}
        {/* Received card: show when there are sales or received payments */}
        {(party.type !== 'supplier' || stats.salesCount > 0 || stats.paymentsReceived > 0) && (
        <StatCard
          label="Received"
          // 🔒 V26 Phase 8 PB-2: Include standalone settle payments (was: only invoice paidAmount).
          // The "Received" card was understating real money by omitting all settle payments.
          value={formatINR(stats.totalReceived + stats.paymentsReceived)}
          icon={ArrowDownRight}
          color="text-violet-600"
          bg="bg-violet-100"
          sub={stats.paymentsReceived > 0 ? `${formatINR(stats.paymentsReceived)} via Settle` : undefined}
        />
        )}
        {/* Paid card: show when there are purchases or paid payments */}
        {(party.type !== 'customer' || stats.purchasesCount > 0 || stats.paymentsPaid > 0) && (
        <StatCard
          label="Paid"
          // 🔒 V26 Phase 8 PB-2: Same fix — include standalone settle payments.
          value={formatINR(stats.totalPaid + stats.paymentsPaid)}
          icon={ArrowUpRight}
          color="text-rose-600"
          bg="bg-rose-100"
          sub={stats.paymentsPaid > 0 ? `${formatINR(stats.paymentsPaid)} via Settle` : undefined}
        />
        )}
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
                    <p className="text-3xs text-muted-foreground uppercase">GSTIN</p>
                    <p className="font-mono text-sm font-medium">{party.gstin}</p>
                  </div>
                </div>
              )}
              {party.email && (
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-3xs text-muted-foreground uppercase">Email</p>
                    <p className="text-sm font-medium">{party.email}</p>
                  </div>
                </div>
              )}
              {party.address && (
                <div className="flex items-start gap-2 sm:col-span-2">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-3xs text-muted-foreground uppercase">Address</p>
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
                    <p className="text-2xs text-muted-foreground">{p.quantity} units</p>
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
          {/* 🔒 V15 M-2: Truncation warning. The statement caps at 500
              transactions + 500 payments to bound memory. If a party exceeds
              that, older entries are cut off — the shopkeeper needs to use
              the printable / exportable statement for the full history. */}
          {statementTotals && (statementTotals.transactionTotal > statementTotals.cap || statementTotals.paymentTotal > statementTotals.cap) && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>Showing the latest {statementTotals.cap} entries.</strong> This party has{' '}
              {statementTotals.transactionTotal} transactions and {statementTotals.paymentTotal} payments total.
              Use the <em>Print / Share Statement</em> button below for the complete history.
            </div>
          )}
        </CardHeader>
        <CardContent>
          {statement.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">No transactions or payments yet with this party</p>
          ) : (
            <div className="max-h-[500px] overflow-y-auto rounded-xl bg-muted/20 p-3 space-y-1">
              {/* Running balance banner at top.
                  🔒 V16 M3: When the statement is truncated (>500 entries),
                  per-entry "Bal: ₹X" badges reflect only the latest 500
                  entries — NOT the true historical balance at that point.
                  We surface this honestly so the user doesn't think the
                  last visible badge should equal the current balance. */}
              <div className="sticky top-0 z-10 -mx-3 px-3 py-2 mb-2 bg-primary/10 backdrop-blur-sm border-y border-primary/20 text-center">
                <span className="text-xs text-muted-foreground">Current Balance: </span>
                <span className={cn('text-xs font-bold', stats.balance > 0 ? 'text-emerald-600 dark:text-emerald-400' : stats.balance < 0 ? 'text-rose-600' : 'text-muted-foreground')}>
                  {stats.balance >= 0 ? '+' : ''}{formatINR(stats.balance)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {' '}· {stats.balance > 0 ? 'They owe you' : stats.balance < 0 ? 'You owe them' : 'Settled'}
                </span>
                {statementTotals && (statementTotals.transactionTotal > statementTotals.cap || statementTotals.paymentTotal > statementTotals.cap) && (
                  <span className="block text-3xs text-amber-700 dark:text-amber-300 mt-1">
                    Per-entry balances below reflect only the latest {statementTotals.cap} entries — use Print Statement for the complete audited history.
                  </span>
                )}
              </div>

              {statement.map((entry: any, index: number) => {
                const isSale = entry.type === 'sale'
                const isPurchase = entry.type === 'purchase'
                const isPayReceived = entry.type === 'payment-received'
                const isPayPaid = entry.type === 'payment-paid'
                // 🔒 V19-015 FIX: Credit notes are OUTFLOW (money returned to customer).
                // Debit notes are INFLOW (money received from supplier).
                const isCreditNote = entry.type === 'credit-note'
                const isDebitNote = entry.type === 'debit-note'
                const isInflow = isSale || isPayReceived || isDebitNote
                const entryDate = new Date(entry.date)
                const prevEntry = statement[index - 1]
                const showDateSeparator = !prevEntry || new Date(prevEntry.date).toDateString() !== entryDate.toDateString()

                return (
                  <div key={`${entry.isPayment ? 'pay' : 'txn'}-${entry.id}`}>
                    {/* Date separator */}
                    {showDateSeparator && (
                      <div className="flex justify-center my-3">
                        <span className="text-3xs font-medium text-muted-foreground bg-background px-3 py-1 rounded-full border border-border">
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
                            <span className="text-3xs font-semibold uppercase tracking-wide opacity-90">
                              {isPayReceived ? 'Received' : 'Paid'}
                            </span>
                            <span className="text-3xs opacity-75 bg-white/20 px-1.5 py-0.5 rounded">
                              {entry.paymentMode}
                            </span>
                          </div>
                          <p className="text-base font-bold tabular-nums">
                            {isInflow ? '+' : '-'}{formatINR(entry.amount)}
                          </p>
                          {entry.notes && (
                            <p className="text-3xs opacity-75 mt-0.5">{entry.notes}</p>
                          )}
                          {/* 🔒 V15 M-2: Running balance after this entry —
                              the historical balance AT THIS POINT, not the
                              current balance. This is what a real ledger
                              statement shows so the reader can follow the
                              money from oldest to newest. */}
                          <div className="flex items-center justify-between gap-2 mt-0.5">
                            <span className="text-3xs bg-white/20 px-1.5 py-0.5 rounded tabular-nums">
                              Bal: {entry.runningBalance >= 0 ? '+' : ''}{formatINR(entry.runningBalance)}
                            </span>
                            <span className="text-3xs opacity-75">
                              {entryDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
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
                            <span className="text-3xs font-semibold uppercase tracking-wide opacity-90">
                              {entry.type}
                            </span>
                            {entry.invoiceNo && (
                              <span className="text-3xs opacity-75 bg-white/20 px-1.5 py-0.5 rounded">
                                {entry.invoiceNo}
                              </span>
                            )}
                            <span className="text-3xs opacity-75">
                              {entry.itemCount} items
                            </span>
                          </div>
                          <p className="text-base font-bold tabular-nums">
                            {isInflow ? '+' : '-'}{formatINR(entry.amount)}
                          </p>
                          <div className="flex items-center justify-between gap-2 mt-1">
                            {entry.due > 0 ? (
                              <span className="text-3xs bg-white/20 px-1.5 py-0.5 rounded">
                                Due: {formatINR(entry.due)}
                              </span>
                            ) : (
                              <span className="text-3xs opacity-75">✓ Paid</span>
                            )}
                            {/* 🔒 V15 M-2: Running balance after this entry. */}
                            <span className="text-3xs bg-white/20 px-1.5 py-0.5 rounded tabular-nums">
                              Bal: {entry.runningBalance >= 0 ? '+' : ''}{formatINR(entry.runningBalance)}
                            </span>
                            <span className="text-3xs opacity-75">
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
              <Label htmlFor="field-payment-type">Payment Type</Label>
              <Select value={paymentType} onValueChange={(v) => setPaymentType(v as 'received' | 'paid')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="received">Received from customer</SelectItem>
                  <SelectItem value="paid">Paid to supplier</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="field-amount">Amount (₹)</Label>
              <Input id="field-amount"
                inputMode="decimal" type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="field-payment-mode">Payment Mode</Label>
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
              <Label htmlFor="field-notes-optional">Notes (optional)</Label>
              <Input id="field-notes-optional"
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
          <p className="text-3xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
        </div>
        <p className="text-lg font-bold tabular-nums">{value}</p>
        {sub && <p className="text-2xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
