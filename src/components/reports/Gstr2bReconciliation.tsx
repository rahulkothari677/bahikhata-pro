'use client'

/**
 * V17-Ext Tier 3 Step 4: GSTR-2B Reconciliation UI
 *
 * Self-contained component (manages its own month state + data fetching).
 * Lets the user upload the GSTR-2B JSON from the GST portal, then shows
 * the 3-way reconciliation result:
 *
 * ✅ Matched — 2B invoice has a corresponding purchase (eligible ITC)
 * ⚠️ Books-only — purchase in books but NOT in 2B (ITC deferred)
 * ❌ 2B-only — 2B invoice but NO purchase in books (missing purchase)
 *
 * Features:
 * - Month picker (prev/next, defaults to current IST month)
 * - Upload 2B JSON button (file input)
 * - Summary cards: Matched ITC, Deferred ITC, Missing ITC
 * - 3 section tables (toggle between them)
 * - CSV download of the reconciliation report
 *
 * Defensive: all hooks before early return, optional chaining everywhere.
 */

import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatINR, cn } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'
import { toast as sonnerToast } from 'sonner'
import { haptic } from '@/lib/haptic'
import {
  ChevronLeft, ChevronRight, Upload, Download, Loader2,
  CheckCircle2, AlertTriangle, XCircle, FileCheck, FileX,
} from 'lucide-react'

type ReconcileSection = 'matched' | 'booksOnly' | 'twoBOnly'

export function Gstr2bReconciliation() {
  const queryClient = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  )
  const [activeSection, setActiveSection] = useState<ReconcileSection>('matched')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 🔒 Hooks first — always called unconditionally
  const { data, isLoading, error } = useQuery({
    queryKey: ['gstr-2b-reconcile', month],
    queryFn: async () => {
      const r = await offlineFetch(`/api/gstr-2b/reconcile?month=${month}`)
      if (!r.ok) {
        const json = await r.json().catch(() => ({}))
        throw new Error(json.error || json.message || `Request failed (${r.status})`)
      }
      return r.json()
    },
  })

  const goToMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // Upload handler
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const text = await file.text()
      const jsonData = JSON.parse(text)

      // Convert month to monthYear (MMYYYY)
      const [y, m] = month.split('-').map(Number)
      const monthYear = `${String(m).padStart(2, '0')}${y}`

      const r = await offlineFetch('/api/gstr-2b/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthYear, data: jsonData }),
      })

      if (!r.ok) {
        const result = await r.json().catch(() => ({}))
        sonnerToast.error(result.error || result.message || 'Upload failed')
        return
      }

      const result = await r.json()
      sonnerToast.success(result.message)
      haptic.success()
      queryClient.invalidateQueries({ queryKey: ['gstr-2b-reconcile', month] })
    } catch {
      haptic.error()
      sonnerToast.error('Could not parse the JSON file. Please download the GSTR-2B JSON from the GST portal.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = '' // reset for re-upload
    }
  }

  // CSV download
  const handleDownloadCSV = () => {
    if (!data) return
    const rows: string[] = []
    rows.push('GSTR-2B Reconciliation Report,' + month)
    rows.push('')
    rows.push(`Summary: Matched=${data?.summary?.matched || 0}, Books-only=${data?.summary?.booksOnly || 0}, 2B-only=${data?.summary?.twoBOnly || 0}`)
    rows.push(`ITC: Matched=Rs.${data?.summary?.matchedItc || 0}, Deferred=Rs.${data?.summary?.deferredItc || 0}, Missing=Rs.${data?.summary?.missingItc || 0}`)
    rows.push('')
    rows.push('Section,Supplier GSTIN,Invoice Number,Invoice Date,Taxable,IGST,CGST,SGST,Total,Status')

    if (data?.matched) {
      for (const m of data.matched) {
        rows.push(`Matched,${m.supplierGstin},${m.invoiceNumber},${m.invoiceDate || ''},${m.twoBTaxable},${m.twoBIgst},${m.twoBCgst},${m.twoBSgst},${m.twoBTotal},${m.status}`)
      }
    }
    if (data?.booksOnly) {
      for (const b of data.booksOnly) {
        rows.push(`Books Only,${b.partyGstin},${b.invoiceNumber},${b.purchaseDate || ''},${b.taxableValue},${b.igst},${b.cgst},${b.sgst},${b.totalAmount},${b.status}`)
      }
    }
    if (data?.twoBOnly) {
      for (const t of data.twoBOnly) {
        rows.push(`2B Only,${t.supplierGstin},${t.invoiceNumber},${t.invoiceDate || ''},${t.taxableValue},${t.igst},${t.cgst},${t.sgst},${t.totalAmount},${t.status}`)
      }
    }

    const csv = rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `GSTR2B_Reconciliation_${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
    sonnerToast.success('Reconciliation report downloaded')
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-rose-600 mb-2">{(error as Error).message}</p>
        <Button variant="outline" onClick={() => goToMonth(0)}>Retry</Button>
      </div>
    )
  }

  const hasImport = data?.hasImport
  const summary = data?.summary
  const monthLabel = new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-4">
      {/* Month picker + upload */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => goToMonth(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="font-semibold text-lg min-w-[140px] text-center">{monthLabel}</span>
          <Button variant="outline" size="icon" onClick={() => goToMonth(1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleUpload}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading...' : hasImport ? 'Re-upload 2B' : 'Upload 2B JSON'}
          </Button>
          {hasImport && (
            <Button variant="outline" size="sm" className="gap-2" onClick={handleDownloadCSV}>
              <Download className="w-4 h-4" /> CSV
            </Button>
          )}
        </div>
      </div>

      {/* No import state — show upload prompt */}
      {!hasImport && (
        <Card className="shadow-card border-dashed border-2 border-border">
          <CardContent className="py-12 text-center">
            <FileX className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold text-muted-foreground">No GSTR-2B imported for {monthLabel}</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Download the GSTR-2B JSON from the GST portal (Returns → GSTR-2B → Download),
              then click "Upload 2B JSON" to reconcile your purchases against supplier filings.
            </p>
            <Button
              className="mt-4 gap-2 bg-gradient-saffron"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload GSTR-2B JSON
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Reconciliation results */}
      {hasImport && summary && (
        <>
          {/* Import info */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>
              Imported on {new Date(data?.importInfo?.importedAt).toLocaleDateString('en-IN')} ·
              {' '}{data?.importInfo?.invoiceCount || 0} invoices ·
              {' '}Taxable: {formatINR(data?.importInfo?.taxableTotal || 0)}
            </span>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SummaryCard
              icon={<CheckCircle2 className="w-4 h-4" />}
              label="Matched (Eligible ITC)"
              count={summary.matched}
              itc={summary.matchedItc}
              color="text-emerald-600"
              bg="bg-emerald-100 dark:bg-emerald-900/40"
              active={activeSection === 'matched'}
              onClick={() => setActiveSection('matched')}
            />
            <SummaryCard
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Books-only (Deferred ITC)"
              count={summary.booksOnly}
              itc={summary.deferredItc}
              color="text-amber-600"
              bg="bg-amber-100 dark:bg-amber-900/40"
              active={activeSection === 'booksOnly'}
              onClick={() => setActiveSection('booksOnly')}
            />
            <SummaryCard
              icon={<XCircle className="w-4 h-4" />}
              label="2B-only (Missing Purchase)"
              count={summary.twoBOnly}
              itc={summary.missingItc}
              color="text-rose-600"
              bg="bg-rose-100 dark:bg-rose-900/40"
              active={activeSection === 'twoBOnly'}
              onClick={() => setActiveSection('twoBOnly')}
            />
          </div>

          {/* Active section table */}
          <Card className="shadow-card border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                {activeSection === 'matched' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                {activeSection === 'booksOnly' && <AlertTriangle className="w-4 h-4 text-amber-600" />}
                {activeSection === 'twoBOnly' && <XCircle className="w-4 h-4 text-rose-600" />}
                {activeSection === 'matched' ? 'Matched Invoices' : activeSection === 'booksOnly' ? 'In Books, Not in 2B' : 'In 2B, Not in Books'}
                <Badge variant="secondary">
                  {(activeSection === 'matched' ? data?.matched : activeSection === 'booksOnly' ? data?.booksOnly : data?.twoBOnly)?.length || 0}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeSection === 'matched' && (
                <MatchedTable items={data?.matched || []} />
              )}
              {activeSection === 'booksOnly' && (
                <BooksOnlyTable items={data?.booksOnly || []} />
              )}
              {activeSection === 'twoBOnly' && (
                <TwoBOnlyTable items={data?.twoBOnly || []} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// ─── Helper components ───────────────────────────────────────────

function SummaryCard({ icon, label, count, itc, color, bg, active, onClick }: {
  icon: React.ReactNode
  label: string
  count: number
  itc: number
  color: string
  bg: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-xl border p-3 flex items-center gap-3 text-left transition',
        active ? 'border-primary/40 bg-primary/5 shadow-sm' : 'border-border/60 hover:border-border',
      )}
    >
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', bg)}>
        <span className={color}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">{label}</p>
        <p className={cn('text-base font-bold tabular-nums', color)}>{count} invoice(s)</p>
        <p className="text-xs text-muted-foreground tabular-nums">ITC: {formatINR(itc)}</p>
      </div>
    </button>
  )
}

function MatchedTable({ items }: { items: any[] }) {
  if (items.length === 0) return <p className="text-center py-8 text-sm text-muted-foreground">No matched invoices</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b">
            <th className="text-left py-1.5 font-medium">Supplier GSTIN</th>
            <th className="text-left py-1.5 font-medium">Invoice No</th>
            <th className="text-right py-1.5 font-medium">Taxable</th>
            <th className="text-right py-1.5 font-medium">IGST</th>
            <th className="text-right py-1.5 font-medium">CGST</th>
            <th className="text-right py-1.5 font-medium">SGST</th>
            <th className="text-right py-1.5 font-medium">Total</th>
            <th className="text-center py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m, i) => (
            <tr key={i} className="border-b border-border/30">
              <td className="py-1.5 font-mono text-[10px]">{m.supplierGstin}</td>
              <td className="py-1.5">{m.invoiceNumber}</td>
              <td className="text-right py-1.5 tabular-nums">{formatINR(m.twoBTaxable)}</td>
              <td className="text-right py-1.5 tabular-nums">{m.twoBIgst ? formatINR(m.twoBIgst) : '-'}</td>
              <td className="text-right py-1.5 tabular-nums">{m.twoBCgst ? formatINR(m.twoBCgst) : '-'}</td>
              <td className="text-right py-1.5 tabular-nums">{m.twoBSgst ? formatINR(m.twoBSgst) : '-'}</td>
              <td className="text-right py-1.5 tabular-nums font-medium">{formatINR(m.twoBTotal)}</td>
              <td className="text-center py-1.5">
                {m.status === 'matched' ? (
                  <Badge className="bg-emerald-600 text-white text-[10px]">✓ Match</Badge>
                ) : (
                  <Badge className="bg-amber-600 text-white text-[10px]">Amt Δ₹{m.amountDifference?.toFixed(2)}</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BooksOnlyTable({ items }: { items: any[] }) {
  if (items.length === 0) return <p className="text-center py-8 text-sm text-muted-foreground">All purchases are in 2B — no deferred ITC</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b">
            <th className="text-left py-1.5 font-medium">Supplier</th>
            <th className="text-left py-1.5 font-medium">GSTIN</th>
            <th className="text-left py-1.5 font-medium">Invoice No</th>
            <th className="text-right py-1.5 font-medium">Taxable</th>
            <th className="text-right py-1.5 font-medium">Total Tax</th>
            <th className="text-right py-1.5 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((b, i) => (
            <tr key={i} className="border-b border-border/30">
              <td className="py-1.5">{b.partyName}</td>
              <td className="py-1.5 font-mono text-[10px]">{b.partyGstin}</td>
              <td className="py-1.5">{b.invoiceNumber}</td>
              <td className="text-right py-1.5 tabular-nums">{formatINR(b.taxableValue)}</td>
              <td className="text-right py-1.5 tabular-nums text-amber-600">{formatINR(b.igst + b.cgst + b.sgst)}</td>
              <td className="text-right py-1.5 tabular-nums font-medium">{formatINR(b.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TwoBOnlyTable({ items }: { items: any[] }) {
  if (items.length === 0) return <p className="text-center py-8 text-sm text-muted-foreground">All 2B invoices are in your books — no missing purchases</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b">
            <th className="text-left py-1.5 font-medium">Supplier GSTIN</th>
            <th className="text-left py-1.5 font-medium">Invoice No</th>
            <th className="text-left py-1.5 font-medium">Date</th>
            <th className="text-right py-1.5 font-medium">Taxable</th>
            <th className="text-right py-1.5 font-medium">IGST</th>
            <th className="text-right py-1.5 font-medium">CGST</th>
            <th className="text-right py-1.5 font-medium">SGST</th>
            <th className="text-right py-1.5 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t, i) => (
            <tr key={i} className="border-b border-border/30">
              <td className="py-1.5 font-mono text-[10px]">{t.supplierGstin}</td>
              <td className="py-1.5">{t.invoiceNumber}</td>
              <td className="py-1.5">{t.invoiceDate || '-'}</td>
              <td className="text-right py-1.5 tabular-nums">{formatINR(t.taxableValue)}</td>
              <td className="text-right py-1.5 tabular-nums">{t.igst ? formatINR(t.igst) : '-'}</td>
              <td className="text-right py-1.5 tabular-nums">{t.cgst ? formatINR(t.cgst) : '-'}</td>
              <td className="text-right py-1.5 tabular-nums">{t.sgst ? formatINR(t.sgst) : '-'}</td>
              <td className="text-right py-1.5 tabular-nums font-medium text-rose-600">{formatINR(t.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
