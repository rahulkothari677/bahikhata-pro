'use client'

/**
 * V17-Ext Tier 3 Step 4: GSTR-3B Report UI
 *
 * Self-contained component (manages its own month state + data fetching).
 * Shows the complete GSTR-3B monthly liability summary with all sections:
 *
 * 3.1(a) Outward taxable supplies
 * 3.1(b) Zero-rated (Rs.0)
 * 3.1(c) Nil-rated + exempt + non-GST
 * 3.1(d) Inward supplies liable to reverse charge (RCM inward)
 * 3.2   Interstate B2C
 * 4(a)  ITC from purchases
 * 4(b)  ITC from RCM purchases
 * 4(c-d) Imports/SEZ (Rs.0)
 * 5     Exempt inward
 * 6.1   Net tax payable
 *
 * Features:
 * - Month picker (prev/next, defaults to current IST month)
 * - Summary cards (output, ITC, net payable, invoices)
 * - Section-by-section tables
 * - CSV download
 * - Save Draft / Mark as Filed buttons
 * - Filing status badge
 *
 * Defensive: all hooks before early return, optional chaining everywhere.
 */

import { useState } from 'react'
import { FilingReadiness } from '@/components/reports/FilingReadiness'
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
  Receipt, TrendingDown, TrendingUp, Wallet, Loader2,
  ArrowRight, ArrowDownRight, ArrowUpRight, FileText, AlertCircle, AlertTriangle } from 'lucide-react'

export function Gstr3bReport() {
  const queryClient = useQueryClient()

  // Month state — format "YYYY-MM" (e.g. "2026-07")
  const now = new Date()
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  )
  const [saving, setSaving] = useState(false)

  /*
   * The selected month as a date range, for the readiness check.
   *
   * Derived from `month` ("YYYY-MM") rather than from the response, so the card
   * asks about the month the shopkeeper is LOOKING at even while the 3B figures
   * are still loading — otherwise it would flash the previous month's answer.
   */
  const [readinessYear, readinessMonth] = month.split('-').map(Number)
  const readinessFrom = new Date(readinessYear, readinessMonth - 1, 1)
  const readinessTo = new Date(readinessYear, readinessMonth, 0, 23, 59, 59)

  // 🔒 Hooks first — always called unconditionally
  const { data, isLoading, error } = useQuery({
    queryKey: ['gstr-3b', month],
    queryFn: async () => {
      const r = await offlineFetch(`/api/gstr-3b?month=${month}`)
      if (!r.ok) {
        const json = await r.json().catch(() => ({}))
        throw new Error(json.error || json.message || `Request failed (${r.status})`)
      }
      return r.json()
    },
  })

  // Navigate months
  const goToMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // Save / File actions
  const handleSave = async (action: 'save' | 'file') => {
    setSaving(true)
    try {
      const r = await offlineFetch('/api/gstr-3b', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, action }),
      })
      if (!r.ok) {
        const json = await r.json().catch(() => ({}))
        sonnerToast.error(json.error || json.message || "Couldn\'t save")
        return
      }
      const result = await r.json()
      sonnerToast.success(result.message)
      haptic.success()
      queryClient.invalidateQueries({ queryKey: ['gstr-3b', month] })
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e?.message || 'Could not save GSTR-3B')
    } finally {
      setSaving(false)
    }
  }

  // CSV download
  const handleDownloadCSV = () => {
    if (!data) return
    const rows: string[] = []
    rows.push('GSTR-3B Summary,' + (data?.period?.monthLabel || month))
    rows.push('')
    rows.push('Section,Description,Taxable Value,CGST,SGST,IGST,Total Tax')
    rows.push(`3.1(a),Outward taxable supplies (gross),${data?.outwardTaxableValue || 0},${data?.outwardCgst || 0},${data?.outwardSgst || 0},${data?.outwardIgst || 0},${(data?.outwardCgst || 0) + (data?.outwardSgst || 0) + (data?.outwardIgst || 0)}`)
    // 🔒 AUDIT G3: portal-ready 3.1(a), net of credit notes. GSTR-3B Table 3.1
    // has no credit-note row, so outward supplies there must already be net.
    // The CSV had the same hazard as the screen: a row labelled "3.1(a)" that
    // was actually the gross figure. See the note in the table below.
    rows.push(`3.1(a),Outward taxable supplies (NET of credit notes - file this),${(data?.outwardTaxableValue || 0) - (data?.creditNoteTaxableValue || 0)},${(data?.outwardCgst || 0) - (data?.creditNoteCgst || 0)},${(data?.outwardSgst || 0) - (data?.creditNoteSgst || 0)},${(data?.outwardIgst || 0) - (data?.creditNoteIgst || 0)},${((data?.outwardCgst || 0) - (data?.creditNoteCgst || 0)) + ((data?.outwardSgst || 0) - (data?.creditNoteSgst || 0)) + ((data?.outwardIgst || 0) - (data?.creditNoteIgst || 0))}`)
    rows.push(`3.1(b),Zero-rated supplies,${data?.zeroRatedTaxableValue || 0},0,0,${data?.zeroRatedIgst || 0},${data?.zeroRatedIgst || 0}`)
    rows.push(`3.1(c),Nil-rated (0% GST),${data?.nilRatedValue || 0},0,0,0,0`)
    rows.push(`3.1(c),Exempt supplies,${data?.exemptValue || 0},0,0,0,0`)
    rows.push(`3.1(c),Non-GST supplies,${data?.nonGstValue || 0},0,0,0,0`)
    rows.push(`3.1(d),Inward supplies liable to RCM,${data?.rcmTaxableValue || 0},${data?.rcmCgst || 0},${data?.rcmSgst || 0},${data?.rcmIgst || 0},${(data?.rcmCgst || 0) + (data?.rcmSgst || 0) + (data?.rcmIgst || 0)}`)
    rows.push(`3.2,Interstate B2C (unregistered),${data?.interstateB2cTaxableValue || 0},0,0,${data?.interstateB2cIgst || 0},${data?.interstateB2cIgst || 0}`)
    rows.push(`4(a),ITC regular purchases,${data?.itcTaxableValue || 0},${data?.itcCgst || 0},${data?.itcSgst || 0},${data?.itcIgst || 0},${(data?.itcCgst || 0) + (data?.itcSgst || 0) + (data?.itcIgst || 0)}`)
    rows.push(`4(b),ITC from RCM purchases,${data?.rcmItcTaxableValue || 0},${data?.rcmItcCgst || 0},${data?.rcmItcSgst || 0},${data?.rcmItcIgst || 0},${(data?.rcmItcCgst || 0) + (data?.rcmItcSgst || 0) + (data?.rcmItcIgst || 0)}`)
    rows.push(`4(c),ITC from imports,0,0,0,0,0`)
    rows.push(`4(d),ITC from SEZ,0,0,0,0,0`)
    rows.push(`5,Exempt inward supplies,${data?.exemptInwardValue || 0},0,0,0,0`)
    rows.push('')
    // 🔒 V17 Audit Phase 1 P0.1: CDN breakdown — was persisted to DB but never exported
    rows.push('Credit/Debit Note Adjustments')
    rows.push(`Credit Notes (reduce output tax),${data?.creditNoteTaxableValue || 0},${data?.creditNoteCgst || 0},${data?.creditNoteSgst || 0},${data?.creditNoteIgst || 0},${(data?.creditNoteCgst || 0) + (data?.creditNoteSgst || 0) + (data?.creditNoteIgst || 0)}`)
    rows.push(`Debit Notes (reduce ITC),${data?.debitNoteTaxableValue || 0},${data?.debitNoteCgst || 0},${data?.debitNoteSgst || 0},${data?.debitNoteIgst || 0},${(data?.debitNoteCgst || 0) + (data?.debitNoteSgst || 0) + (data?.debitNoteIgst || 0)}`)
    rows.push('')
    rows.push(`6.1,Net Tax Payable,,,${data?.netTaxPayable || 0}`)
    rows.push(`,Total Sale Invoices: ${data?.totalSaleInvoices || 0}`)
    rows.push(`,Total Purchase Bills: ${data?.totalPurchaseBills || 0}`)
    rows.push(`,RCM Purchases: ${data?.totalRcmPurchases || 0}`)
    const csv = rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `GSTR3B_${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
    sonnerToast.success('GSTR-3B CSV downloaded')
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {/* Stands in for the month picker, so the readiness card below it does
            not jump when the figures arrive. */}
        <Skeleton className="h-16 w-full rounded-xl" />

        {/* Readiness has its own query and answers for the SELECTED month, so it
            can be useful while the 3B figures are still loading. It sits in the
            same slot here as in the loaded state — see the note there. */}
        <FilingReadiness from={readinessFrom} to={readinessTo} />

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

  if (!data) return null

  const isFiled = data?.snapshot?.filingStatus === 'filed'
  const monthLabel = data?.period?.monthLabel || month
  // 🔒 V17 Audit Phase 1 P0.2: Detect filed-vs-live divergence.
  // If the snapshot's filedNetTaxPayable differs from the live netTaxPayable,
  // it means transactions were edited/deleted after filing → the filed return
  // no longer matches the books. Warn the user so they can file a revised return.
  const filedNet = data?.snapshot?.filedNetTaxPayable
  const liveNet = data?.netTaxPayable
  const hasDivergence = isFiled && typeof filedNet === 'number' && typeof liveNet === 'number'
    && Math.abs(filedNet - liveNet) > 0.01

  return (
    <div className="space-y-4">
      {/* Month picker + filing status */}
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
          {isFiled ? (
            <Badge className="bg-emerald-600 text-white gap-1">
              <FileCheck className="w-3 h-3" /> Filed
            </Badge>
          ) : data?.snapshot ? (
            <Badge variant="secondary">Draft</Badge>
          ) : (
            <Badge variant="outline">Not saved</Badge>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={handleDownloadCSV}>
            <Download className="w-4 h-4" /> CSV
          </Button>
        </div>
      </div>

      {/*
        * One answer to "can I file?", above the figures.
        *
        * This replaces four separate warning boxes that had accumulated on this
        * screen — each correct, each added beside the last. Stacked they read as
        * an app in trouble rather than a shop with two things to check, and
        * nothing told a shopkeeper which of them actually stopped them filing.
        *
        * It must be rendered HERE, in the loaded branch. It was first added only
        * to the isLoading branch above, so it flashed during load and then
        * vanished — leaving the screen with no warnings at all, which is worse
        * than the stack it replaced. Both branches now render it, in the same
        * slot, and `gstr-3b-shows-filing-readiness.test.tsx` fails if either
        * one stops.
        */}
      <FilingReadiness from={readinessFrom} to={readinessTo} />

      {/* 🔒 V17 Audit Phase 1 P0.2: Filed-vs-live divergence warning.
          Shows when a filed snapshot's netTaxPayable differs from the live value —
          meaning transactions were edited/deleted after filing. The user must file
          a revised return on the GST portal to stay compliant. */}
      {hasDivergence && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              Books have changed since this return was filed
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Filed Net Tax: <span className="font-semibold tabular-nums">{formatINR(filedNet!)}</span>
              {' → '}
              Live Net Tax: <span className="font-semibold tabular-nums">{formatINR(liveNet!)}</span>
              {' '}
              (difference: {formatINR(Math.abs(filedNet! - liveNet!))})
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              Transactions were edited or deleted after this return was filed. The filed GSTR-3B
              no longer matches your books. Please file a <strong>revised return</strong> on the
              GST portal to stay compliant.
            </p>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Output Tax"
          value={data?.totalOutputTax || 0}
          color="text-blue-600"
          bg="bg-blue-100 dark:bg-blue-900/40"
        />
        <SummaryCard
          icon={<TrendingDown className="w-4 h-4" />}
          label="Input Tax (ITC)"
          value={data?.totalItc || 0}
          color="text-amber-600 dark:text-amber-400"
          bg="bg-amber-100 dark:bg-amber-900/40"
        />
        <SummaryCard
          icon={<Wallet className="w-4 h-4" />}
          label="Net Tax Payable"
          value={data?.netTaxPayable || 0}
          color={data?.netTaxPayable > 0 ? 'text-rose-600' : 'text-emerald-600 dark:text-emerald-400'}
          bg={data?.netTaxPayable > 0 ? 'bg-rose-100 dark:bg-rose-900/40' : 'bg-emerald-100 dark:bg-emerald-900/40'}
          highlight
        />
        <SummaryCard
          icon={<Receipt className="w-4 h-4" />}
          label="Invoices"
          value={data?.totalSaleInvoices || 0}
          color="text-violet-600"
          bg="bg-violet-100 dark:bg-violet-900/40"
          isCount
        />
      </div>

      {/* Section 3.1: Outward Supplies */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-blue-600" />
            3.1 Outward Supplies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left py-1.5 font-medium">Section</th>
                <th className="text-right py-1.5 font-medium">Taxable</th>
                <th className="text-right py-1.5 font-medium">CGST</th>
                <th className="text-right py-1.5 font-medium">SGST</th>
                <th className="text-right py-1.5 font-medium">IGST</th>
              </tr>
            </thead>
            <tbody>
              <Gstr3bRow label="(a) Taxable supplies (gross)" taxable={data?.outwardTaxableValue} cgst={data?.outwardCgst} sgst={data?.outwardSgst} igst={data?.outwardIgst} />
              {/*
                🔒 AUDIT G3: the portal-ready 3.1(a) figure, net of credit notes.

                GSTR-3B Table 3.1 has NO credit-note row — unlike GSTR-1, which
                has CDNR/CDNUR. Outward supplies in 3.1(a) are expected NET of
                credit notes issued in the period.

                Previously this screen showed only the GROSS figure here, with
                credit notes in a separate card further down. Anyone copying the
                3.1(a) row straight into the portal — the obvious thing to do
                when the row is labelled "3.1(a)" — OVERSTATED outward supplies
                and output tax, and paid GST on sales that had been returned.

                The gross row is kept (it is the working, and removing it would
                make the credit-note card unreadable). This row is the one to
                file, and says so.

                Deliberately computed HERE rather than by changing
                computeGstr3bValues: netTaxPayable ALREADY subtracts credit-note
                tax, so netting at the source risks a second subtraction
                somewhere downstream — which would UNDERSTATE liability, the
                dangerous direction to be wrong in. This is additive and cannot
                double-count.

                Only credit notes are subtracted. In this app a debit-note is
                issued to a SUPPLIER (a purchase return), so it reduces ITC — it
                is not an outward supply and must not move 3.1(a).

                CAVEAT the filer must know: in a month where returns exceed
                sales this figure can go NEGATIVE. The GST portal does not
                accept a negative value in 3.1(a) — the excess is carried
                forward and adjusted against a later month. The negative is
                shown rather than clamped to zero, because clamping would hide
                the carry-forward the filer has to act on.
              */}
              <Gstr3bRow
                label="(a) Taxable supplies — NET of credit notes ← file this"
                taxable={(data?.outwardTaxableValue || 0) - (data?.creditNoteTaxableValue || 0)}
                cgst={(data?.outwardCgst || 0) - (data?.creditNoteCgst || 0)}
                sgst={(data?.outwardSgst || 0) - (data?.creditNoteSgst || 0)}
                igst={(data?.outwardIgst || 0) - (data?.creditNoteIgst || 0)}
              />
              <Gstr3bRow label="(b) Zero-rated" taxable={data?.zeroRatedTaxableValue} cgst={0} sgst={0} igst={data?.zeroRatedIgst} />
              <Gstr3bRow label="(c) Nil-rated (0% GST)" taxable={data?.nilRatedValue} cgst={0} sgst={0} igst={0} />
              <Gstr3bRow label="(c) Exempt" taxable={data?.exemptValue} cgst={0} sgst={0} igst={0} />
              <Gstr3bRow label="(c) Non-GST" taxable={data?.nonGstValue} cgst={0} sgst={0} igst={0} />
              <Gstr3bRow label="(d) Inward supplies liable to RCM" taxable={data?.rcmTaxableValue} cgst={data?.rcmCgst} sgst={data?.rcmSgst} igst={data?.rcmIgst} />
              <tr className="border-t font-semibold">
                <td className="py-1.5">Total Outward</td>
                <td className="text-right py-1.5 tabular-nums">{formatINR((data?.outwardTaxableValue || 0) + (data?.zeroRatedTaxableValue || 0) + (data?.nilRatedValue || 0) + (data?.exemptValue || 0) + (data?.nonGstValue || 0) + (data?.rcmTaxableValue || 0))}</td>
                <td className="text-right py-1.5 tabular-nums">{formatINR((data?.outwardCgst || 0) + (data?.rcmCgst || 0))}</td>
                <td className="text-right py-1.5 tabular-nums">{formatINR((data?.outwardSgst || 0) + (data?.rcmSgst || 0))}</td>
                <td className="text-right py-1.5 tabular-nums">{formatINR((data?.outwardIgst || 0) + (data?.zeroRatedIgst || 0) + (data?.rcmIgst || 0))}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Section 3.2: Interstate B2C */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ArrowRight className="w-4 h-4 text-violet-600" />
            3.2 Inter-state B2C (Unregistered)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Taxable Value</span>
            <span className="font-semibold tabular-nums">{formatINR(data?.interstateB2cTaxableValue || 0)}</span>
          </div>
          <div className="flex items-center justify-between text-sm mt-1">
            <span className="text-muted-foreground">IGST</span>
            <span className="font-semibold tabular-nums">{formatINR(data?.interstateB2cIgst || 0)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Section 4: ITC */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ArrowDownRight className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            4. Input Tax Credit (ITC)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left py-1.5 font-medium">Section</th>
                <th className="text-right py-1.5 font-medium">Taxable</th>
                <th className="text-right py-1.5 font-medium">CGST</th>
                <th className="text-right py-1.5 font-medium">SGST</th>
                <th className="text-right py-1.5 font-medium">IGST</th>
              </tr>
            </thead>
            <tbody>
              <Gstr3bRow label="(a) Regular purchases" taxable={data?.itcTaxableValue} cgst={data?.itcCgst} sgst={data?.itcSgst} igst={data?.itcIgst} />
              <Gstr3bRow label="(b) RCM purchases" taxable={data?.rcmItcTaxableValue} cgst={data?.rcmItcCgst} sgst={data?.rcmItcSgst} igst={data?.rcmItcIgst} />
              <Gstr3bRow label="(c) Imports" taxable={0} cgst={0} sgst={0} igst={0} />
              <Gstr3bRow label="(d) SEZ" taxable={0} cgst={0} sgst={0} igst={0} />
              <tr className="border-t font-semibold">
                <td className="py-1.5">Total ITC</td>
                <td className="text-right py-1.5 tabular-nums">{formatINR((data?.itcTaxableValue || 0) + (data?.rcmItcTaxableValue || 0))}</td>
                <td className="text-right py-1.5 tabular-nums">{formatINR((data?.itcCgst || 0) + (data?.rcmItcCgst || 0))}</td>
                <td className="text-right py-1.5 tabular-nums">{formatINR((data?.itcSgst || 0) + (data?.rcmItcSgst || 0))}</td>
                <td className="text-right py-1.5 tabular-nums">{formatINR((data?.itcIgst || 0) + (data?.rcmItcIgst || 0))}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 🔒 V17 Audit Phase 1 P0.1: Credit/Debit Note Adjustments
          — was persisted to DB (8 columns) but never shown in the UI. */}
      <Card className="shadow-card border-violet-200 dark:border-violet-900/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-violet-600" />
            Credit/Debit Note Adjustments
          </CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left py-1.5 font-medium">Type</th>
                <th className="text-right py-1.5 font-medium">Taxable</th>
                <th className="text-right py-1.5 font-medium">CGST</th>
                <th className="text-right py-1.5 font-medium">SGST</th>
                <th className="text-right py-1.5 font-medium">IGST</th>
              </tr>
            </thead>
            <tbody>
              <Gstr3bRow
                label="Credit Notes (reduce output tax)"
                taxable={data?.creditNoteTaxableValue}
                cgst={data?.creditNoteCgst}
                sgst={data?.creditNoteSgst}
                igst={data?.creditNoteIgst}
              />
              <Gstr3bRow
                label="Debit Notes (reduce ITC)"
                taxable={data?.debitNoteTaxableValue}
                cgst={data?.debitNoteCgst}
                sgst={data?.debitNoteSgst}
                igst={data?.debitNoteIgst}
              />
              <tr className="border-t font-semibold">
                <td className="py-1.5">Net CDN Adjustment</td>
                <td className="text-right py-1.5 tabular-nums">
                  {formatINR((data?.creditNoteTaxableValue || 0) - (data?.debitNoteTaxableValue || 0))}
                </td>
                <td className="text-right py-1.5 tabular-nums">
                  {formatINR((data?.creditNoteCgst || 0) - (data?.debitNoteCgst || 0))}
                </td>
                <td className="text-right py-1.5 tabular-nums">
                  {formatINR((data?.creditNoteSgst || 0) - (data?.debitNoteSgst || 0))}
                </td>
                <td className="text-right py-1.5 tabular-nums">
                  {formatINR((data?.creditNoteIgst || 0) - (data?.debitNoteIgst || 0))}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="text-3xs text-muted-foreground mt-2">
            Credit notes reduce your output tax liability (sales returns).
            Debit notes reduce your input tax credit (purchase returns).
            Both are already included in the Net Tax Payable calculation above.
          </p>
        </CardContent>
      </Card>

      {/* Section 5: Exempt Inward */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Receipt className="w-4 h-4 text-muted-foreground" />
            5. Exempt Inward Supplies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">0% GST Purchases</span>
            <span className="font-semibold tabular-nums">{formatINR(data?.exemptInwardValue || 0)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Section 6.1: Net Tax Payable (highlighted) */}
      <div className={cn(
        'rounded-2xl p-5 text-white shadow-lg',
        (data?.netTaxPayable || 0) > 0
          ? 'bg-gradient-to-r from-rose-500 to-red-600'
          : 'bg-gradient-to-r from-emerald-500 to-teal-600'
      )}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white/80 text-xs font-medium uppercase tracking-wide">6.1 Net Tax Payable</p>
            <p className="text-3xl font-bold tabular-nums mt-1">
              {formatINR(data?.netTaxPayable || 0)}
            </p>
          </div>
          <div className="text-right text-xs text-white/70 space-y-0.5">
            <p>Output: {formatINR(data?.totalOutputTax || 0)}</p>
            <p>RCM Inward: {formatINR(data?.totalRcmInward || 0)}</p>
            <p>ITC: -{formatINR(data?.totalItc || 0)}</p>
            <p>RCM ITC: -{formatINR(data?.totalRcmItc || 0)}</p>
          </div>
        </div>
      </div>

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
              Save as Draft
            </Button>
            <Button
              className="gap-2 bg-gradient-saffron"
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
    </div>
  )
}

// ─── Helper components ───────────────────────────────────────────

function SummaryCard({ icon, label, value, color, bg, highlight, isCount }: {
  icon: React.ReactNode
  label: string
  value: number
  color: string
  bg: string
  highlight?: boolean
  isCount?: boolean
}) {
  return (
    <div className={cn(
      'rounded-xl border p-3 flex items-center gap-3',
      highlight ? 'border-primary/30 bg-primary/5' : 'border-border/60',
    )}>
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', bg)}>
        <span className={color}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-3xs text-muted-foreground uppercase tracking-wide truncate">{label}</p>
        <p className={cn('text-base font-bold tabular-nums', color)}>
          {isCount ? value : formatINR(value)}
        </p>
      </div>
    </div>
  )
}

function Gstr3bRow({ label, taxable, cgst, sgst, igst }: {
  label: string
  taxable: number
  cgst: number
  sgst: number
  igst: number
}) {
  return (
    <tr className="border-b border-border/30">
      <td className="py-1.5">{label}</td>
      <td className="text-right py-1.5 tabular-nums">{formatINR(taxable || 0)}</td>
      <td className="text-right py-1.5 tabular-nums">{cgst ? formatINR(cgst) : '-'}</td>
      <td className="text-right py-1.5 tabular-nums">{sgst ? formatINR(sgst) : '-'}</td>
      <td className="text-right py-1.5 tabular-nums">{igst ? formatINR(igst) : '-'}</td>
    </tr>
  )
}
