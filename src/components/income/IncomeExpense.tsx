'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import { useToast } from '@/hooks/use-toast'
import { toast as sonnerToast } from 'sonner'
import { formatINR, formatDate, cn } from '@/lib/utils'
import { Plus, Wallet, Trash2, ArrowDownRight, ArrowUpRight, Receipt } from 'lucide-react'

const EXPENSE_CATEGORIES = ['Rent', 'Salary', 'Electricity', 'Water', 'Telephone', 'Internet', 'Transport', 'Packaging', 'Marketing', 'Maintenance', 'Bank Charges', 'Insurance', 'Taxes', 'Miscellaneous']
const INCOME_CATEGORIES = ['Commission', 'Interest', 'Rent Received', 'Scrap Sale', 'Discount Received', 'Refund', 'Miscellaneous']
const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank']

export function IncomeExpense() {
  const { refreshKey, triggerRefresh, triggerNewEntry, triggerNewEntryView, setSelectedTransactionId, setView, setPreviousView } = useAppStore()
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogType, setDialogType] = useState<'income' | 'expense'>('expense')
  const [choiceOpen, setChoiceOpen] = useState(false)

  // Listen for global "New Entry" trigger from Header (only if fired on this view)
  const lastTriggerRef = useRef(0)
  useEffect(() => {
    if (triggerNewEntry > lastTriggerRef.current && triggerNewEntryView === 'income-expense') {
      lastTriggerRef.current = triggerNewEntry
      Promise.resolve().then(() => setChoiceOpen(true))
    } else if (triggerNewEntry > lastTriggerRef.current) {
      lastTriggerRef.current = triggerNewEntry
    }
  }, [triggerNewEntry, triggerNewEntryView])

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', 'income-expense', refreshKey],
    queryFn: async () => {
      const r = await fetch('/api/transactions?type=all&limit=200')
      return r.json()
    },
  })

  const allTxns: any[] = data?.transactions || []
  const txns = allTxns.filter(t => t.type === 'income' || t.type === 'expense')
  const filtered = filter === 'all' ? txns : txns.filter(t => t.type === filter)

  const totalIncome = txns.filter(t => t.type === 'income').reduce((s, t) => s + t.totalAmount, 0)
  const totalExpense = txns.filter(t => t.type === 'expense').reduce((s, t) => s + t.totalAmount, 0)
  const netCashflow = totalIncome - totalExpense

  const expensesByCategory = new Map<string, number>()
  txns.filter(t => t.type === 'expense').forEach(t => {
    const cat = t.category || 'Other'
    expensesByCategory.set(cat, (expensesByCategory.get(cat) || 0) + t.totalAmount)
  })
  const topExpenses = Array.from(expensesByCategory.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4)

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this entry?')) return
    const r = await fetch(`/api/transactions?id=${id}`, { method: 'DELETE' })
    if (r.ok) {
      sonnerToast.success('Entry deleted')
      triggerRefresh()
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowDownRight className="w-4 h-4 text-emerald-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Total Income</p>
            </div>
            <p className="text-2xl font-bold text-emerald-600">{formatINR(totalIncome)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight className="w-4 h-4 text-rose-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Total Expenses</p>
            </div>
            <p className="text-2xl font-bold text-rose-600">{formatINR(totalExpense)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-4 h-4 text-violet-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Net Cashflow</p>
            </div>
            <p className={cn('text-2xl font-bold', netCashflow >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{formatINR(netCashflow)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entries</SelectItem>
                <SelectItem value="income">Income Only</SelectItem>
                <SelectItem value="expense">Expenses Only</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Button
              variant="outline"
              onClick={() => { setDialogType('income'); setDialogOpen(true) }}
              className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              <Plus className="w-4 h-4" /> Add Income
            </Button>
            <Button
              onClick={() => { setDialogType('expense'); setDialogOpen(true) }}
              className="gap-2 bg-gradient-saffron shadow-md"
            >
              <Plus className="w-4 h-4" /> Add Expense
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <Card className="shadow-card border-border/60">
              <CardContent className="py-16 text-center">
                <Wallet className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm font-medium">No income/expense entries yet</p>
                <p className="text-xs text-muted-foreground mt-1">Track your rent, salary, electricity, and other income/expenses</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((t) => {
                const isIncome = t.type === 'income'
                return (
                  <Card
                    key={t.id}
                    className="shadow-card border-border/60 hover:shadow-md hover:border-primary/30 transition group cursor-pointer"
                    onClick={() => {
                      setSelectedTransactionId(t.id)
                      setPreviousView('income-expense')
                      setView('transaction-detail')
                    }}
                  >
                    <CardContent className="p-3 lg:p-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                          isIncome ? 'bg-emerald-100' : 'bg-rose-100'
                        )}>
                          {isIncome
                            ? <ArrowDownRight className="w-5 h-5 text-emerald-600" />
                            : <ArrowUpRight className="w-5 h-5 text-rose-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm group-hover:text-primary transition">{t.category || 'Other'}</p>
                            <Badge variant="secondary" className="text-[10px] py-0 uppercase">{t.paymentMode}</Badge>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                            <span>{formatDate(t.date)}</span>
                            {t.notes && <span>• {t.notes}</span>}
                          </div>
                        </div>
                        <p className={cn('font-bold text-sm', isIncome ? 'text-emerald-600' : 'text-rose-600')}>
                          {isIncome ? '+' : '-'}{formatINR(t.totalAmount)}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          onClick={(e) => { e.stopPropagation(); handleDelete(t.id) }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        <Card className="shadow-card border-border/60 h-fit lg:sticky lg:top-20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Receipt className="w-4 h-4 text-rose-600" />
              <h3 className="font-semibold text-sm">Top Expense Categories</h3>
            </div>
            {topExpenses.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No expenses yet</p>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const total = topExpenses.reduce((s, [, v]) => s + v, 0)
                  return topExpenses.map(([name, value]) => {
                    const pct = (value / total) * 100
                    return (
                      <div key={name}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium">{name}</span>
                          <span className="text-xs text-muted-foreground">{formatINR(value)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-rose-400 to-rose-600 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <IncomeExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        type={dialogType}
        onSuccess={() => triggerRefresh()}
      />

      {/* Choice dialog when triggered from Header */}
      <Dialog open={choiceOpen} onOpenChange={setChoiceOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-violet-600" />
              Add New Entry
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <button
              onClick={() => { setDialogType('income'); setDialogOpen(true); setChoiceOpen(false) }}
              className="rounded-xl p-4 border-2 border-emerald-300 hover:border-emerald-500 hover:bg-emerald-50 transition text-left"
            >
              <ArrowDownRight className="w-6 h-6 mb-2 text-emerald-600" />
              <p className="font-semibold text-sm">Add Income</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Commission, interest, etc.</p>
            </button>
            <button
              onClick={() => { setDialogType('expense'); setDialogOpen(true); setChoiceOpen(false) }}
              className="rounded-xl p-4 border-2 border-rose-300 hover:border-rose-500 hover:bg-rose-50 transition text-left"
            >
              <ArrowUpRight className="w-6 h-6 mb-2 text-rose-600" />
              <p className="font-semibold text-sm">Add Expense</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Rent, salary, bills</p>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function IncomeExpenseDialog({ open, onOpenChange, type, onSuccess }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: 'income' | 'expense'
  onSuccess?: () => void
}) {
  const isExpense = type === 'expense'
  const { toast } = useToast()
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [paymentMode, setPaymentMode] = useState('cash')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setAmount('')
      setCategory('')
      setDate(new Date().toISOString().slice(0, 10))
      setPaymentMode('cash')
      setNotes('')
    }
  }, [open, type])

  const categories = isExpense ? EXPENSE_CATEGORIES : INCOME_CATEGORIES

  const handleSave = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) {
      toast({ title: 'Enter valid amount', variant: 'destructive' })
      return
    }
    if (!category) {
      toast({ title: 'Select a category', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          category,
          totalAmount: amt,
          date,
          paymentMode,
          notes,
        }),
      })
      if (!r.ok) throw new Error('Failed')
      sonnerToast.success(`${isExpense ? 'Expense' : 'Income'} recorded`)
      onSuccess?.()
      onOpenChange(false)
    } catch {
      toast({ title: 'Failed to save', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isExpense
              ? <ArrowUpRight className="w-5 h-5 text-rose-600" />
              : <ArrowDownRight className="w-5 h-5 text-emerald-600" />}
            Add {isExpense ? 'Expense' : 'Income'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Amount (₹) *</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="text-lg font-semibold"
              autoFocus
            />
          </div>
          <div>
            <Label>Category *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Payment Mode</Label>
              <Select value={paymentMode} onValueChange={setPaymentMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map(m => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Monthly shop rent" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className={isExpense ? 'bg-gradient-saffron' : 'bg-gradient-emerald'}
          >
            {saving ? 'Saving...' : `Save ${isExpense ? 'Expense' : 'Income'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
