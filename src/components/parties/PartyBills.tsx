'use client'

/**
 * 🔒 AUDIT C5 — the party's bills, on their own page.
 *
 * This started as a card inside PartyProfile. It was moved out because a
 * customer with fifty bills turned the profile into a scroll marathon and
 * pushed the account statement, chart and top-products below the fold — a new
 * section making the existing screen worse is not an improvement.
 *
 * On its own page it can also do the things a long list actually needs:
 * search, filtering and a running total of what is selected, none of which
 * would fit inside a card without crowding the profile further.
 *
 * Every due here comes from the shared computeInvoiceDue(). A bill showing a
 * different figure on this screen than on the ledger or the printed invoice is
 * the class of bug this whole change exists to remove.
 */

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import { formatINR, formatDate, cn } from '@/lib/utils'
import { roundMoney } from '@/lib/money'
import { computeInvoiceDue } from '@/lib/invoice-due'
import { EmptyState } from '@/components/common/EmptyState'
import { ArrowLeft, Receipt, Search, IndianRupee } from 'lucide-react'

type BillFilter = 'open' | 'all'

export function PartyBills() {
  const { selectedPartyId, setView, setSelectedTransactionId, setPreviousView, setPendingSettle } = useAppStore()
  const [filter, setFilter] = useState<BillFilter>('open')
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['party', selectedPartyId, 'bills'],
    queryFn: async () => {
      const r = await fetch(`/api/parties/${selectedPartyId}`)
      if (!r.ok) throw new Error('Failed to load bills')
      return r.json()
    },
    enabled: !!selectedPartyId,
  })

  const party = data?.party
  const balance = Number(data?.stats?.balance ?? 0)

  const bills = useMemo(() => {
    const rows = (data?.transactions || [])
      // Only sale/purchase documents. A credit note is a RETURN, not something
      // a payment settles — listing one with a "Settle" button would invite
      // exactly the wrong action.
      .filter((t: any) => t.type === 'sale' || t.type === 'purchase')
      .map((t: any) => ({
        ...t,
        due: computeInvoiceDue(t),
        settledSoFar: roundMoney((t.paidAmount || 0) + (t.allocatedAmount || 0)),
      }))

    const q = search.trim().toLowerCase()
    const searched = q
      ? rows.filter((b: any) =>
          (b.invoiceNo || '').toLowerCase().includes(q) ||
          formatDate(b.date).toLowerCase().includes(q) ||
          String(b.totalAmount).includes(q))
      : rows

    return searched.sort((a: any, b: any) => {
      // Open bills first, then oldest first within each group — the order a
      // khata is settled in, and the order the server allocates a payment in,
      // so what is on screen matches what actually happens.
      if ((a.due > 0) !== (b.due > 0)) return a.due > 0 ? -1 : 1
      return new Date(a.date).getTime() - new Date(b.date).getTime()
    })
  }, [data, search])

  const openBills = bills.filter((b: any) => b.due > 0)
  const visible = filter === 'open' ? openBills : bills
  const totalDue = roundMoney(openBills.reduce((s: number, b: any) => s + b.due, 0))

  const goBack = () => setView('party-profile')

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={goBack} className="gap-1">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold truncate flex items-center gap-2">
            <Receipt className="w-4 h-4 shrink-0" /> Bills
          </h1>
          <p className="text-xs text-muted-foreground truncate">{party?.name}</p>
        </div>
      </div>

      {/*
        The two numbers a shopkeeper needs before taking money: what is still
        open across the bills, and what the customer owes overall. They can
        legitimately differ — an advance, or a payment not yet tied to a bill —
        so both are shown rather than one being presented as the truth.
      */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="shadow-card border-border/60">
          <CardContent className="p-3">
            <p className="text-2xs text-muted-foreground uppercase tracking-wide">Open bills</p>
            <p className="text-lg font-bold text-rose-600">{formatINR(totalDue)}</p>
            <p className="text-2xs text-muted-foreground">{openBills.length} of {bills.length} bills</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-3">
            <p className="text-2xs text-muted-foreground uppercase tracking-wide">Party balance</p>
            <p className={cn('text-lg font-bold', balance > 0 ? 'text-emerald-600' : balance < 0 ? 'text-rose-600' : '')}>
              {formatINR(Math.abs(balance))}
            </p>
            <p className="text-2xs text-muted-foreground">
              {balance > 0 ? 'They owe you' : balance < 0 ? 'You owe them' : 'Settled'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search invoice no, date or amount"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Button
          variant={filter === 'open' ? 'default' : 'outline'}
          size="sm"
          className="h-9 text-xs shrink-0"
          onClick={() => setFilter(f => (f === 'open' ? 'all' : 'open'))}
        >
          {filter === 'open' ? 'Open only' : `All (${bills.length})`}
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={filter === 'open' ? 'No open bills' : 'No bills yet'}
          description={
            filter === 'open'
              ? 'Every bill for this party is settled. Tap “All” to see them.'
              : 'Bills for this party will appear here.'
          }
        />
      ) : (
        <div className="space-y-2">
          {visible.map((b: any) => (
            <Card key={b.id} className="shadow-card border-border/60">
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() => {
                    setSelectedTransactionId(b.id)
                    setPreviousView('party-bills')
                    setView('transaction-detail')
                  }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold truncate">
                      {b.invoiceNo || b.id.slice(-6)}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-3xs px-1.5 py-0',
                        b.due === 0
                          ? 'text-emerald-600 border-emerald-300'
                          : b.settledSoFar > 0
                            ? 'text-amber-600 border-amber-300'
                            : 'text-rose-600 border-rose-300',
                      )}
                    >
                      {b.due === 0 ? 'Paid' : b.settledSoFar > 0 ? 'Partly paid' : 'Unpaid'}
                    </Badge>
                  </div>
                  <p className="text-2xs text-muted-foreground mt-0.5">
                    {formatDate(b.date)} · {formatINR(b.totalAmount)}
                    {b.settledSoFar > 0 && <> · {formatINR(b.settledSoFar)} received</>}
                  </p>
                </button>
                <div className="text-right shrink-0">
                  <p className={cn('text-sm font-bold', b.due > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                    {b.due > 0 ? formatINR(b.due) : 'Settled'}
                  </p>
                  {b.due > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-2xs text-primary gap-1"
                      onClick={() => {
                        // 🔒 AUDIT C5: carry WHICH bill, not just the amount.
                        //
                        // This button previously only navigated — it opened the
                        // profile and did nothing else, so "Settle" on a
                        // specific bill silently did not settle that bill. The
                        // intent now travels with it and the dialog opens
                        // locked to this invoice.
                        //
                        // The amount is a SUGGESTION and stays editable. A
                        // customer paying ₹200 against a ₹553 bill is the
                        // normal case; forcing full settlement would make
                        // repeated part-payments impossible to record honestly.
                        setPendingSettle({
                          transactionId: b.id,
                          invoiceNo: b.invoiceNo || null,
                          amount: b.due,
                        })
                        setPreviousView('party-bills')
                        setView('party-profile')
                      }}
                    >
                      <IndianRupee className="w-3 h-3" /> Settle
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
