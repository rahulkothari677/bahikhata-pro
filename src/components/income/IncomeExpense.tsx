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
import { useTranslation } from '@/hooks/use-translation'
import { useToast } from '@/hooks/use-toast'
import { toast as sonnerToast } from 'sonner'
import { formatINR, formatDate, cn } from '@/lib/utils'
import { Plus, Wallet, Trash2, ArrowDownRight, ArrowUpRight, Receipt, Target, Edit2, X } from 'lucide-react'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { useExpenseBudgets } from '@/hooks/use-expense-budgets'

const EXPENSE_CATEGORIES = ['Rent', 'Salary', 'Electricity', 'Water', 'Telephone', 'Internet', 'Transport', 'Packaging', 'Marketing', 'Maintenance', 'Bank Charges', 'Insurance', 'Taxes', 'Miscellaneous']
const INCOME_CATEGORIES = ['Commission', 'Interest', 'Rent Received', 'Scrap Sale', 'Discount Received', 'Refund', 'Miscellaneous']
const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank']

export function IncomeExpense() {
  const { refreshKey, triggerRefresh, triggerNewEntry, triggerNewEntryView, setSelectedTransactionId, setView, setPreviousView } = useAppStore()
  const { t } = useTranslation()
  const { features } = useAppStore()
  const { getProgress, setBudget, removeBudget } = useExpenseBudgets()
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false)
  const [budgetCategory, setBudgetCategory] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
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
      const r = await offlineFetch('/api/transactions?type=all&limit=200')
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
    const r = await offlineFetch(`/api/transactions?id=${id}`, { method: 'DELETE', offline: { invalidate: ['/api/transactions', '/api/dashboard'] } })
    if (r.ok) {
      sonnerToast.success(isQueuedResponse(r) ? 'Will delete when online' : 'Entry deleted')
      triggerRefresh()
    }
  }

  return (
    <>
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowDownRight className="w-4 h-4 text-emerald-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{t('stat.total_income')}</p>
            </div>
            <p className="text-2xl font-bold text-emerald-600">{formatINR(totalIncome)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight className="w-4 h-4 text-rose-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{t('stat.total_expenses')}</p>
            </div>
            <p className="text-2xl font-bold text-rose-600">{formatINR(totalExpense)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-4 h-4 text-violet-600" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{t('stat.net_cashflow')}</p>
            </div>
            <p className={cn('text-2xl font-bold', netCashflow >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{formatINR(netCashflow)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Budget tracking — shows progress bars for expense categories with budgets */}
      {features?.reorderAlerts && topExpenses.length > 0 && (
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                <p className="text-sm font-semibold">Monthly Budgets</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setBudgetCategory(topExpenses[0]?.[0] || 'Rent'); setBudgetAmount(''); setBudgetDialogOpen(true) }}
                className="gap-1.5 text-xs h-7"
              >
                <Plus className="w-3 h-3" /> Set Budget
              </Button>
            </div>
            <div className="space-y-3">
              {topExpenses.map(([cat, spent]) => {
                const progress = getProgress(cat, spent)
                if (!progress) return null
                const pctColor = progress.exceeded
                  ? 'bg-rose-500'
                  : progress.pct > 80
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{cat}</span>
                        {progress.exceeded && (
                          <Badge variant="destructive" className="text-[9px] py-0">Over budget</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {formatINR(progress.spent)} / {formatINR(progress.budget)}
                        </span>
                        <button
                          onClick={() => { setBudgetCategory(cat); setBudgetAmount(String(progress.budget)); setBudgetDialogOpen(true) }}
                          className="p-0.5 rounded hover:bg-muted text-muted-foreground"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => { removeBudget(cat); sonnerToast.success(`Budget removed for ${cat}`) }}
                          className="p-0.5 rounded hover:bg-muted text-muted-foreground"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', pctColor)}
                        style={{ width: `${Math.min(100, progress.pct)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {progress.exceeded
                        ? `${formatINR(progress.spent - progress.budget)} over budget`
                        : `${formatINR(progress.remaining)} remaining (${progress.pct.toFixed(0)}% used)`}
                    </p>
                  </div>
                )
              })}
              {/* Show categories with budgets but no spending this month */}
              {Object.entries(getProgress('', 0) || {}).length === 0 && topExpenses.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No budgets set. Click "Set Budget" to track monthly spending limits.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Toolbar - removed duplicate Add Income/Expense buttons (header has "Add Entry") */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('ie.all_entries')}</SelectItem>
                <SelectItem value="income">{t('ie.income_only')}</SelectItem>
                <SelectItem value="expense">{t('ie.expenses_only')}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1" />
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
                <p className="text-sm font-medium">{t('ie.no_entries')}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('ie.track_hint')}</p>
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
                            {t.payeeName && <span>• {isIncome ? 'From' : 'To'}: {t.payeeName}</span>}
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
              <h3 className="font-semibold text-sm">{t('ie.top_expense_cat')}</h3>
            </div>
            {topExpenses.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">{t('ie.no_expenses')}</p>
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

      {/* Budget setting dialog */}
      <Dialog open={budgetDialogOpen} onOpenChange={setBudgetDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" /> Set Monthly Budget
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Category</Label>
              <Select value={budgetCategory} onValueChange={setBudgetCategory}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select expense category" />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Monthly Budget Amount (₹)</Label>
              <Input
                type="number"
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
                placeholder="e.g. 15000"
                className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                You'll see a progress bar on this page showing how much you've spent vs budget.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBudgetDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const amt = parseFloat(budgetAmount)
                if (!budgetCategory || isNaN(amt) || amt <= 0) {
                  sonnerToast.error('Enter a valid amount')
                  return
                }
                setBudget(budgetCategory, amt)
                sonnerToast.success(`Budget set: ${budgetCategory} = ${formatINR(amt)}/month`)
                setBudgetDialogOpen(false)
              }}
              className="bg-gradient-saffron gap-2"
            >
              <Target className="w-4 h-4" /> Save Budget
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </>
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
  const [customCategory, setCustomCategory] = useState('')
  const [isCustomCategory, setIsCustomCategory] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [paymentMode, setPaymentMode] = useState('cash')
  const [notes, setNotes] = useState('')
  const [payeeName, setPayeeName] = useState('')
  const [payeePhone, setPayeePhone] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setAmount('')
      setCategory('')
      setCustomCategory('')
      setIsCustomCategory(false)
      setDate(new Date().toISOString().slice(0, 10))
      setPaymentMode('cash')
      setNotes('')
      setPayeeName('')
      setPayeePhone('')
    }
  }, [open, type])

  const categories = isExpense ? EXPENSE_CATEGORIES : INCOME_CATEGORIES

  const handleSave = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) {
      toast({ title: 'Enter valid amount', variant: 'destructive' })
      return
    }
    const finalCategory = isCustomCategory ? customCategory.trim() : category
    if (!finalCategory) {
      toast({ title: 'Select or enter a category', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const r = await offlineFetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          category: finalCategory,
          totalAmount: amt,
          date,
          paymentMode,
          notes,
          payeeName: payeeName.trim() || null,
          payeePhone: payeePhone.trim() || null,
        }),
        offline: { invalidate: ['/api/transactions', '/api/dashboard'] },
      })
      if (!r.ok) throw new Error('Failed')
      if (isQueuedResponse(r)) {
        sonnerToast.success('Saved offline — will sync when online')
      } else {
        sonnerToast.success(`${isExpense ? 'Expense' : 'Income'} recorded`)
      }
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
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
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
              min="0"
              step="0.01"
            />
          </div>

          {/* Category with custom option */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Category *</Label>
              <button
                type="button"
                onClick={() => setIsCustomCategory(!isCustomCategory)}
                className="text-[11px] text-primary hover:underline"
              >
                {isCustomCategory ? '← Choose from list' : '+ Custom category'}
              </button>
            </div>
            {isCustomCategory ? (
              <Input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="Enter custom category name"
                autoFocus
              />
            ) : (
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Payee info - who you paid / received from */}
          <div className="rounded-lg bg-muted/30 p-3 space-y-2">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              {isExpense ? 'Paid To' : 'Received From'} (optional)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={payeeName}
                onChange={(e) => setPayeeName(e.target.value)}
                placeholder="Name"
                className="h-9"
              />
              <Input
                value={payeePhone}
                onChange={(e) => setPayeePhone(e.target.value)}
                placeholder="Mobile number"
                className="h-9"
                inputMode="numeric"
              />
            </div>
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
