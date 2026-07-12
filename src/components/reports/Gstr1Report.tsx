'use client'

/**
 * 🔒 V17 Audit Phase 3 — GSTR-1 Filing Export Report.
 *
 * Generates the GST portal-ready GSTR-1 JSON for a given month.
 * The user can:
 *   - View all 8 sections (B2B, B2CL, B2CS, CDNR, CDNUR, HSN, NIL, DOC)
 *   - Download the portal-ready JSON (upload directly to gst.gov.in)
 *   - Download a CSV summary
 *   - Save as Draft / Mark as Filed
 *   - See a filed-vs-live divergence warning (like GSTR-3B)
 *
 * Self-contained: own month state, own useQuery, all hooks before early return.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatINR, cn } from '@/lib/utils'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { toast as sonnerToast } from 'sonner'
import { haptic } from '@/lib/haptic'
import {
  ChevronLeft, ChevronRight, Download, FileCheck, Save,
  FileText, Loader2, AlertCircle, FileJson, Table,
} from 'lucide-react'

export function Gstr1Report() {
  const queryClient = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [activeSection, setActiveSection] = useState<string>('b2b')
  const [saving, setSaving] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['gstr-1', month],
    queryFn: async () => {
      const r = await offlineFetch(`/api/gstr-1?month=${month}`)
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}))
        throw new Error(errBody.error || errBody.message || `Failed to fetch GSTR-1 (HTTP ${r.status})`)
      }
      return r.json()
    },
  })

  const handlePrevMonth = () => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const handleNextMonth = () => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const handleDownloadJSON = () => {
    if (!data?.gstr1) {
      sonnerToast.error('No GSTR-1 data to download. Check if the API returned an error.')
      return
    }
    const json = JSON.stringify({ gstr1: data.gstr1 }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `GSTR1_${month}.json`
    a.click()
    URL.revokeObjectURL(url)
    sonnerToast.success('GSTR-1 JSON downloaded — upload to GST portal')
  }

  const handleDownloadCSV = () => {
    if (!data?.gstr1) {
      sonnerToast.error('No GSTR-1 data to download. Check if the API returned an error.')
      return
    }
    const g = data.gstr1
    const rows: string[] = []
    rows.push('GSTR-1 Summary,' + (data?.period?.monthLabel || month))
    rows.push('')
    rows.push('Section,Count,Taxable Value,CGST,SGST,IGST,Total Tax')
    rows.push(`B2B (Registered),${g.b2b.length},${g.b2b.reduce((s: number, e: any) => s + e.inv.reduce((ss: number, i: any) => ss + i.val, 0), 0)},-,-,-,-`)
    rows.push(`B2CL (Large B2C),${g.b2cl.length},${g.b2cl.reduce((s: number, e: any) => s + e.inv.reduce((ss: number, i: any) => ss + i.val, 0), 0)},-,-,-,-`)
    rows.push(`B2CS (Small B2C),${g.b2cs.length},${g.b2cs.reduce((s: number, e: any) => s + e.txval, 0)},${g.b2cs.reduce((s: number, e: any) => s + e.camt, 0)},${g.b2cs.reduce((s: number, e: any) => s + e.samt, 0)},${g.b2cs.reduce((s: number, e: any) => s + e.iamt, 0)},-`)
    rows.push(`CDNR (Registered Notes),${g.cdnr.length},-,-,-,-,-`)
    rows.push(`CDNUR (Unregistered Notes),${g.cdnur.length},-,-,-,-,-`)
    rows.push(`HSN Summary,${g.hsn.data.length},-,-,-,-,-`)
    rows.push(`NIL Supplies,3,${g.nil.inv.reduce((s: number, e: any) => s + e.txval, 0)},0,0,0,0`)
    rows.push(`Documents,${g.doc_issue.doc_det.length},-,-,-,-,-`)
    rows.push('')
    rows.push(`Summary,Taxable Value,Output Tax,Invoices,Credit Notes`)
    rows.push(`,${data?.summary?.totalTaxableValue || 0},${data?.summary?.totalOutputTax || 0},${data?.summary?.totalInvoiceCount || 0},${data?.summary?.totalCreditNotes || 0}`)
    const csv = rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `GSTR1_${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
    sonnerToast.success('GSTR-1 CSV downloaded')
  }

  const handleSave = async (action: 'save' | 'file') => {
    setSaving(true)
    try {
      const r = await offlineFetch('/api/gstr-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, action }),
      })
      const result = await r.json()
      if (!r.ok) throw new Error(result.message || result.error || 'Failed')
      if (isQueuedResponse(r)) {
        sonnerToast.success('Saved offline — will sync when online')
      } else {
        sonnerToast.success(result.message || 'GSTR-1 saved')
      }
      haptic.success()
      queryClient.invalidateQueries({ queryKey: ['gstr-1', month] })
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e.message || 'Failed to save GSTR-1')
    } finally {
      setSaving(false)
    }
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

  // 🔒 V17 Audit Phase 3: Show error state instead of silently rendering zeros.
  // This happens when the API fails (e.g., migration not applied, Neon cold start).
  if (error || !data) {
    return (
      <Card className="shadow-card border-rose-200 dark:border-rose-900/50">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">
                Failed to load GSTR-1
              </p>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                This usually means the database migration hasn't run yet. Wait for the Vercel
                deploy to finish (the build runs migrations automatically), then refresh this page.
                If the error persists, check that your shop has transactions in {month}.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-2"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['gstr-1', month] })}
              >
                <Loader2 className="w-4 h-4" /> Retry
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const g = data?.gstr1
  const isFiled = data?.snapshot?.filingStatus === 'filed'
  const monthLabel = data?.period?.monthLabel || month

  // Filed-vs-live divergence
  const filedTaxable = data?.snapshot?.filedTotalTaxableValue
  const liveTaxable = data?.summary?.totalTaxableValue
  const hasDivergence = isFiled && typeof filedTaxable === 'number' && typeof liveTaxable === 'number'
    && Math.abs(filedTaxable - liveTaxable) > 0.01

  const sections = [
    { key: 'b2b', label: 'B2B', count: g?.b2b?.length || 0, icon: FileText },
    { key: 'b2cl', label: 'B2CL', count: g?.b2cl?.length || 0, icon: FileText },
    { key: 'b2cs', label: 'B2CS', count: g?.b2cs?.length || 0, icon: FileText },
    { key: 'cdnr', label: 'CDNR', count: g?.cdnr?.length || 0, icon: FileText },
    { key: 'cdnur', label: 'CDNUR', count: g?.cdnur?.length || 0, icon: FileText },
    { key: 'hsn', label: 'HSN', count: g?.hsn?.data?.length || 0, icon: Table },
    { key: 'nil', label: 'NIL', count: g?.nil?.inv?.length || 0, icon: FileText },
    { key: 'doc', label: 'DOC', count: g?.doc_issue?.doc_det?.length || 0, icon: FileCheck },
  ]

  return (
    <div className="space-y-4">
      {/* Month picker + filing status */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrevMonth}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[120px] text-center">{monthLabel}</span>
          <Button variant="outline" size="sm" onClick={handleNextMonth}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {isFiled ? (
            <Badge className="bg-emerald-600 text-white gap-1">
              <FileCheck className="w-3 h-3" /> Filed
            </Badge>
          ) : data?.snapshot ? (
            <Badge variant="secondary">Draft</Badge>
          ) : (
            <Badge variant="outline">Not saved</Badge>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={handleDownloadJSON}>
            <FileJson className="w-4 h-4" /> JSON
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleDownloadCSV}>
            <Download className="w-4 h-4" /> CSV
          </Button>
        </div>
      </div>

      {/* Filed-vs-live divergence warning */}
      {hasDivergence && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              Books have changed since this GSTR-1 was filed
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Filed Taxable: {formatINR(filedTaxable!)} → Live Taxable: {formatINR(liveTaxable!)}
              {' '}
              (difference: {formatINR(Math.abs(filedTaxable! - liveTaxable!))})
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Transactions were edited or deleted after filing. Please file a <strong>revised return</strong> on the GST portal.
            </p>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="shadow-card border-border/60">
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Taxable Value</p>
            <p className="text-xl font-bold tabular-nums">{formatINR(data?.summary?.totalTaxableValue || 0)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Output Tax</p>
            <p className="text-xl font-bold tabular-nums text-rose-600">{formatINR(data?.summary?.totalOutputTax || 0)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Invoices</p>
            <p className="text-xl font-bold tabular-nums">{data?.summary?.totalInvoiceCount || 0}</p>
          </CardContent>
        </Card>
        <Card className="shadow-card border-border/60">
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Credit Notes</p>
            <p className="text-xl font-bold tabular-nums text-violet-600">{data?.summary?.totalCreditNotes || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 flex-wrap">
        {sections.map(s => {
          const Icon = s.icon
          return (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition',
                activeSection === s.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {s.label}
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full',
                activeSection === s.key ? 'bg-white/20' : 'bg-background'
              )}>
                {s.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Section content */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {sections.find(s => s.key === activeSection)?.label} Section
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Gstr1SectionContent section={activeSection} g={g} />
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {!isFiled && (
          <>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => handleSave('save')}
              disabled={saving}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Draft
            </Button>
            <Button
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => handleSave('file')}
              disabled={saving}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4" />}
              Mark as Filed
            </Button>
          </>
        )}
        {isFiled && (
          <div className="text-xs text-muted-foreground italic w-full text-center py-2">
            Filed on {data?.snapshot?.filedAt ? new Date(data.snapshot.filedAt).toLocaleString('en-IN') : 'unknown date'}.
            To correct, file a revised return on the GST portal.
          </div>
        )}
      </div>

      {/* Shop info */}
      {(!data?.shop?.gstin || !data?.shop?.stateCode) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-700 dark:text-amber-300">
          <p className="font-semibold">⚠️ Missing shop details</p>
          <p className="mt-1">
            {!data?.shop?.gstin && 'Shop GSTIN is not set. '}
            {!data?.shop?.stateCode && 'Place of Supply (POS) cannot be derived. '}
            Go to Settings → Shop Profile to set your GSTIN and state.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Section content renderer ─────────────────────────────────────────────

function Gstr1SectionContent({ section, g }: { section: string; g: any }) {
  if (!g) return <p className="text-xs text-muted-foreground">No data</p>

  switch (section) {
    case 'b2b':
      if (!g.b2b?.length) return <EmptySection label="B2B invoices (registered parties)" />
      return (
        <div className="space-y-3 text-xs">
          {g.b2b.map((entry: any, i: number) => (
            <div key={i} className="border border-border/40 rounded-lg p-3">
              <p className="font-semibold">GSTIN: {entry.ctin}</p>
              <p className="text-muted-foreground">{entry.inv.length} invoice(s)</p>
              <div className="mt-2 space-y-1">
                {entry.inv.map((inv: any, j: number) => (
                  <div key={j} className="flex justify-between border-t border-border/20 pt-1">
                    <span>{inv.inum} ({inv.idt})</span>
                    <span className="font-medium tabular-nums">{formatINR(inv.val)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )

    case 'b2cl':
      if (!g.b2cl?.length) return <EmptySection label="B2CL invoices (large inter-state B2C)" />
      return (
        <div className="space-y-3 text-xs">
          {g.b2cl.map((entry: any, i: number) => (
            <div key={i} className="border border-border/40 rounded-lg p-3">
              <p className="font-semibold">POS: {entry.pos}</p>
              <p className="text-muted-foreground">{entry.inv.length} invoice(s)</p>
            </div>
          ))}
        </div>
      )

    case 'b2cs':
      if (!g.b2cs?.length) return <EmptySection label="B2CS (small B2C supplies)" />
      return (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="text-left py-1.5">Rate</th>
              <th className="text-right py-1.5">Taxable</th>
              <th className="text-right py-1.5">IGST</th>
              <th className="text-right py-1.5">CGST</th>
              <th className="text-right py-1.5">SGST</th>
            </tr>
          </thead>
          <tbody>
            {g.b2cs.map((e: any, i: number) => (
              <tr key={i} className="border-b border-border/20">
                <td className="py-1.5">{e.rt}%</td>
                <td className="text-right py-1.5 tabular-nums">{formatINR(e.txval)}</td>
                <td className="text-right py-1.5 tabular-nums">{e.iamt ? formatINR(e.iamt) : '-'}</td>
                <td className="text-right py-1.5 tabular-nums">{e.camt ? formatINR(e.camt) : '-'}</td>
                <td className="text-right py-1.5 tabular-nums">{e.samt ? formatINR(e.samt) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )

    case 'hsn':
      if (!g.hsn?.data?.length) return <EmptySection label="HSN-wise summary" />
      return (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="text-left py-1.5">#</th>
              <th className="text-left py-1.5">HSN</th>
              <th className="text-left py-1.5">Description</th>
              <th className="text-right py-1.5">Qty</th>
              <th className="text-right py-1.5">Taxable</th>
              <th className="text-right py-1.5">Rate</th>
            </tr>
          </thead>
          <tbody>
            {g.hsn.data.map((e: any, i: number) => (
              <tr key={i} className="border-b border-border/20">
                <td className="py-1.5">{e.num}</td>
                <td className="py-1.5 font-mono">{e.hsn_sc}</td>
                <td className="py-1.5">{e.desc}</td>
                <td className="text-right py-1.5 tabular-nums">{e.qty} {e.uqc}</td>
                <td className="text-right py-1.5 tabular-nums">{formatINR(e.txval)}</td>
                <td className="text-right py-1.5">{e.rt}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )

    case 'nil':
      return (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="text-left py-1.5">Type</th>
              <th className="text-left py-1.5">Description</th>
              <th className="text-right py-1.5">Taxable Value</th>
            </tr>
          </thead>
          <tbody>
            {g.nil?.inv?.map((e: any, i: number) => (
              <tr key={i} className="border-b border-border/20">
                <td className="py-1.5 font-medium">{e.sply_ty}</td>
                <td className="py-1.5">{e.description}</td>
                <td className="text-right py-1.5 tabular-nums">{formatINR(e.txval)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )

    case 'doc':
      if (!g.doc_issue?.doc_det?.length) return <EmptySection label="Document issuance summary" />
      return (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="text-left py-1.5">Document Type</th>
              <th className="text-right py-1.5">Total</th>
              <th className="text-right py-1.5">Cancelled</th>
              <th className="text-right py-1.5">Net Issued</th>
            </tr>
          </thead>
          <tbody>
            {g.doc_issue.doc_det.map((e: any, i: number) => (
              <tr key={i} className="border-b border-border/20">
                <td className="py-1.5">{e.doc_typ}</td>
                <td className="text-right py-1.5 tabular-nums">{e.docs[0]?.totnum || 0}</td>
                <td className="text-right py-1.5 tabular-nums">{e.docs[0]?.cancel || 0}</td>
                <td className="text-right py-1.5 tabular-nums">{e.docs[0]?.net_issue || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )

    case 'cdnr':
    case 'cdnur':
      const cdnr = g.cdnr || []
      const cdnur = g.cdnur || []
      if (!cdnr.length && !cdnur.length) return <EmptySection label="Credit/Debit Notes" />
      return (
        <div className="space-y-3 text-xs">
          {cdnr.map((e: any, i: number) => (
            <div key={`cdnr-${i}`} className="border border-border/40 rounded-lg p-3">
              <p className="font-semibold">CDNR — GSTIN: {e.ctin}</p>
              <p className="text-muted-foreground">{e.nt.length} note(s)</p>
            </div>
          ))}
          {cdnur.map((e: any, i: number) => (
            <div key={`cdnur-${i}`} className="border border-border/40 rounded-lg p-3">
              <p className="font-semibold">CDNUR — {e.nt_num} ({e.ntty === 'C' ? 'Credit' : 'Debit'})</p>
              <p className="text-muted-foreground">{formatINR(e.val)}</p>
            </div>
          ))}
        </div>
      )

    default:
      return <p className="text-xs text-muted-foreground">Unknown section</p>
  }
}

function EmptySection({ label }: { label: string }) {
  return (
    <div className="text-center py-8 text-xs text-muted-foreground">
      <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
      <p>No {label} for this month</p>
    </div>
  )
}
