'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { formatINR, formatDate, formatDateTime, cn, getInitials } from '@/lib/utils'
import {
  Phone, Building2, MapPin, User, Plus, ShoppingCart, Truck,
  ArrowDownRight, ArrowUpRight, IndianRupee, Calendar, TrendingUp,
  Receipt, Edit2, Trash2, MessageCircle, Loader2, FileDown, Printer,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'

export function PartyProfile() {
  const { selectedPartyId, setView, setPreviousView, triggerRefresh, previousView, features } = useAppStore()
  const queryClient = useQueryClient()
  const [sendingReminder, setSendingReminder] = useState(false)

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

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  const { party, stats, topProducts, monthlyData, transactions } = data

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

  const handleDelete = async () => {
    if (!confirm(`Delete ${party.name}? All their transactions will remain but lose the party link.`)) return
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
    <p>This is a computer-generated statement from BahiKhata Pro.</p>
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

  const isCustomer = party.type === 'customer' || party.type === 'both'
  const isSupplier = party.type === 'supplier' || party.type === 'both'

  return (
    <div className="space-y-4">
      {/* Profile header */}
      <Card className="shadow-card border-border/60 overflow-hidden">
        <div className={cn(
          'p-5 text-white',
          party.type === 'customer' ? 'bg-gradient-to-br from-emerald-500 to-teal-600' :
          party.type === 'supplier' ? 'bg-gradient-to-br from-amber-500 to-orange-600' :
          'bg-gradient-to-br from-violet-500 to-purple-600'
        )}>
          <div className="flex items-start gap-4 flex-wrap">
            <Avatar className="w-16 h-16 border-4 border-white/30">
              <AvatarFallback className="bg-white/20 text-white text-xl font-bold">
                {getInitials(party.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-bold truncate">{party.name}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge className="bg-white/20 text-white border-0 capitalize">{party.type}</Badge>
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
              <p className="text-white/70 text-xs uppercase">Outstanding Balance</p>
              <p className={cn('text-2xl font-bold', stats.balance >= 0 ? 'text-white' : 'text-red-200')}>
                {stats.balance >= 0 ? '+' : ''}{formatINR(stats.balance)}
              </p>
              <p className="text-white/70 text-xs mt-0.5">
                {stats.balance > 0 ? 'They owe you' : stats.balance < 0 ? 'You owe them' : 'Settled'}
              </p>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="p-3 flex flex-wrap gap-2">
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
          {/* Download Statement — generates a printable HTML statement */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadStatement}
            className="gap-2"
            title="Download account statement as HTML"
          >
            <FileDown className="w-4 h-4" />
            Statement
          </Button>
          <Button size="sm" variant="outline" onClick={() => setView('parties')} className="gap-2">
            <User className="w-4 h-4" /> All Parties
          </Button>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={handleDelete} className="gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50">
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
        </div>
      </Card>

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
        <Card className="shadow-card border-border/60">
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
      <Card className="shadow-card border-border/60">
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
        <Card className="shadow-card border-border/60">
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

      {/* Transaction history */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="w-4 h-4" /> Transaction History
            </CardTitle>
            <Badge variant="secondary">{transactions.length} total</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">No transactions yet with this party</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {transactions.map((txn: any) => {
                const isSale = txn.type === 'sale'
                const isPurchase = txn.type === 'purchase'
                const isInflow = isSale
                const due = txn.totalAmount - txn.paidAmount
                return (
                  <button
                    key={txn.id}
                    onClick={() => handleViewTransaction(txn.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition text-left border border-transparent hover:border-border"
                  >
                    <div className={cn(
                      'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                      isInflow ? 'bg-emerald-100' : 'bg-rose-100'
                    )}>
                      {isInflow
                        ? <ArrowDownRight className="w-4 h-4 text-emerald-600" />
                        : <ArrowUpRight className="w-4 h-4 text-rose-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm capitalize">{txn.type}</p>
                        {txn.invoiceNo && <Badge variant="outline" className="text-[10px] py-0">{txn.invoiceNo}</Badge>}
                        <span className="text-[11px] text-muted-foreground">{txn.items?.length || 0} items</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {formatDateTime(txn.date)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={cn('font-semibold text-sm', isInflow ? 'text-emerald-600' : 'text-rose-600')}>
                        {isInflow ? '+' : '-'}{formatINR(txn.totalAmount)}
                      </p>
                      {due > 0 && <p className="text-[10px] text-rose-600">Due: {formatINR(due)}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
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
  return (
    <Card className="shadow-card border-border/60">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', bg)}>
            <Icon className={cn('w-3.5 h-3.5', color)} />
          </div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
        </div>
        <p className="text-lg font-bold">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}
