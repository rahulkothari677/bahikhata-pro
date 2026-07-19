'use client'

/**
 * 🔒 V17 Audit Phase 6 — Bank Reconciliation UI.
 *
 * Lets the user:
 *   - Upload a bank statement CSV
 *   - View matched/unmatched transactions
 *   - See reconciliation summary (total credits, debits, matched %)
 *
 * Self-contained: own data fetching, all hooks before early return.
 */

import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatINR, cn } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'
import { toast as sonnerToast } from 'sonner'
import { haptic } from '@/lib/haptic'
import {
  Upload, CheckCircle2, XCircle, Loader2, Banknote, TrendingUp, TrendingDown,
  FileText, ChevronDown, ChevronUp,
} from 'lucide-react'
import { format } from 'date-fns'
import { readError } from '@/lib/read-error'

export function BankReconciliation() {
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [bankName, setBankName] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['bank-recon'],
    queryFn: async () => {
      const r = await offlineFetch('/api/bank-recon/reconcile')
      if (!r.ok) throw new Error(await readError(r))
      return r.json()
    },
  })

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const text = await file.text()
      const r = await offlineFetch('/api/bank-recon/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text, bankName: bankName || file.name.replace('.csv', '') }),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.error || result.message || 'Import failed')

      haptic.success()
      sonnerToast.success(`Imported ${result.summary.txnCount} transactions`, {
        description: `${result.summary.matchedCount} matched, ${result.summary.unmatchedCount} unmatched. ${result.summary.bankName}`,
        duration: 8000,
      })
      queryClient.invalidateQueries({ queryKey: ['bank-recon'] })
      setBankName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (e: any) {
      haptic.error()
      sonnerToast.error("Couldn\'t import the bank statement", {
        description: e.message,
        duration: 10000,
      })
    } finally {
      setUploading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  const statements = data?.bankStatements || []
  const summary = data?.summary || { totalStatements: 0, totalBankTxns: 0, matchedCount: 0, unmatchedCount: 0 }

  return (
    <div className="space-y-4">
      {/* Upload card */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Banknote className="w-4 h-4 text-blue-600" />
            Import Bank Statement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Download a CSV statement from your bank or UPI app (HDFC, SBI, ICICI, PhonePe, Google Pay, etc.).
            We'll auto-match transactions against your recorded UPI/card/bank payments.
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs" htmlFor="field-bank-name-optional">Bank Name (optional)</Label>
              <Input id="field-bank-name-optional"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. HDFC, SBI"
                className="mt-1"
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleUpload}
              className="hidden"
              id="bank-csv-upload"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="gap-2 bg-blue-600 hover:bg-blue-700"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Importing...' : 'Upload CSV'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      {statements.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="shadow-card border-border/60">
            <CardContent className="p-3">
              <p className="text-3xs text-muted-foreground uppercase tracking-wide">Bank Txns</p>
              <p className="text-xl font-bold tabular-nums">{summary.totalBankTxns}</p>
            </CardContent>
          </Card>
          <Card className="shadow-card border-emerald-200 dark:border-emerald-900/50">
            <CardContent className="p-3">
              <p className="text-3xs text-muted-foreground uppercase tracking-wide">Matched</p>
              <p className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{summary.matchedCount}</p>
            </CardContent>
          </Card>
          <Card className="shadow-card border-amber-200 dark:border-amber-900/50">
            <CardContent className="p-3">
              <p className="text-3xs text-muted-foreground uppercase tracking-wide">Unmatched</p>
              <p className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{summary.unmatchedCount}</p>
            </CardContent>
          </Card>
          <Card className="shadow-card border-border/60">
            <CardContent className="p-3">
              <p className="text-3xs text-muted-foreground uppercase tracking-wide">Match Rate</p>
              <p className="text-xl font-bold tabular-nums">
                {summary.totalBankTxns > 0 ? Math.round((summary.matchedCount / summary.totalBankTxns) * 100) : 0}%
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Bank statements list */}
      {statements.length === 0 ? (
        <Card className="shadow-card border-border/60">
          <CardContent className="py-8 text-center">
            <Banknote className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm font-medium">No bank statements imported yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Upload a CSV from your bank to start reconciling. We'll match each bank transaction
              against your recorded UPI/card/bank payments automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {statements.map((bs: any) => (
            <Card key={bs.id} className="shadow-card border-border/60">
              <CardHeader className="pb-2">
                <button
                  onClick={() => setExpandedId(expandedId === bs.id ? null : bs.id)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <div className="flex items-center gap-2">
                    <Banknote className="w-4 h-4 text-blue-600" />
                    <div>
                      <p className="text-sm font-semibold">{bs.bankName}</p>
                      <p className="text-2xs text-muted-foreground">
                        {bs.txnCount} txns • {bs.matchedCount} matched • {format(new Date(bs.importedAt), 'dd MMM yyyy')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-2xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 justify-end">
                        <TrendingUp className="w-3 h-3" /> {formatINR(bs.totalCredits)}
                      </p>
                      <p className="text-2xs text-rose-600 flex items-center gap-1 justify-end">
                        <TrendingDown className="w-3 h-3" /> {formatINR(bs.totalDebits)}
                      </p>
                    </div>
                    {expandedId === bs.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>
              </CardHeader>
              {expandedId === bs.id && (
                <CardContent>
                  <div className="space-y-1.5 max-h-96 overflow-y-auto">
                    {bs.transactions.map((t: any) => (
                      <div
                        key={t.id}
                        className={cn(
                          'flex items-center gap-3 rounded-lg p-2.5 border text-xs',
                          t.matchStatus === 'matched'
                            ? 'border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900/40'
                            : 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900/40'
                        )}
                      >
                        <div className="flex-shrink-0">
                          {t.matchStatus === 'matched' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <XCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{t.description}</p>
                          <p className="text-3xs text-muted-foreground">
                            {format(new Date(t.date), 'dd MMM yyyy')}
                            {t.matchedPayment && ` • Matched: ${t.matchedPayment.mode.toUpperCase()} - ${t.matchedPayment.partyName || 'Unknown'}`}
                            {t.matchedTransaction && ` • Matched: ${t.matchedTransaction.invoiceNo || t.matchedTransaction.type} - ${t.matchedTransaction.partyName || 'Unknown'}`}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={cn('font-bold tabular-nums', t.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600')}>
                            {t.amount > 0 ? '+' : ''}{formatINR(t.amount)}
                          </p>
                          {t.matchConfidence && t.matchConfidence < 1.0 && (
                            <p className="text-3xs text-muted-foreground">{Math.round(t.matchConfidence * 100)}% match</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
