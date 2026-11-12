'use client'

/**
 * Supplier bills (GSTR-2B / IMS) — 9a-3, 3 Nov 2026, from plan 9a (approved 3 Nov).
 *
 * Kept from the screen it replaces: the month switch, upload / re-upload of the
 * 2B file, the CSV export, the "no 2B yet" state, the IMS timing, and every
 * bill's numbers.
 *
 * Changed: one screen in groups instead of three tabs. The credit that is fine
 * comes first and biggest ("Nothing to do on the portal" — a bill nobody acts on
 * is deemed accepted, s.38); then only the bills that need the shop, each with
 * one reason and its action — open my bill, ask the supplier, "same bill?",
 * add as purchase (filled in), "not mine" (the portal steps; EkBook has no GSP
 * link to press Reject itself) — then 2B's no-credit bills, suppliers' notes,
 * bills waiting for suppliers (remind on WhatsApp), and the folded matched list.
 * The sorting is the server's (lib/gstr2b-match.ts), the same GSTR-3B claims by.
 *
 * Defensive: all hooks before early return, optional chaining everywhere.
 */

import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatINR, cn } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'
import { toast as sonnerToast } from 'sonner'
import { haptic } from '@/lib/haptic'
import { ChevronLeft, ChevronRight, Upload, Download, Loader2, CheckCircle2, FileCheck, FileX, Clock } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { InfoHint } from '@/components/common/InfoHint'
import { Notice } from '@/components/ui/notice'
import { useSetting } from '@/hooks/use-setting'
import { gstStatus } from '@/lib/shop-tax'
import { filingFrequency } from '@/lib/gst-due-dates'
import { useAppStore } from '@/store/app-store'
import { whatsAppUrl } from '@/lib/whatsapp-link'
import { purchasePresetFrom, returnPresetFrom, askSupplierText, remindSupplierText } from '@/lib/supplier-bills'

export function Gstr2bReconciliation() {
  const queryClient = useQueryClient()
  const now = new Date()
  const [picked, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  )
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 9a-5: IMS and GSTR-2B credit are for a regular registration; a composition shop
  // claims no input credit (s.10(4)) and is not an IMS user (IMS FAQ Q9).
  const { setting } = useSetting()
  const composition = gstStatus(setting) === 'composition'
  /*
   * 9b-2: a quarterly (QRMP) filer has one 2B per quarter (IMS FAQ Q28), filed under the
   * quarter's last month — so the screen always sits on that month (worked out here,
   * before the first request) and the switch moves a quarter at a time.
   */
  const quarterly = filingFrequency(setting) === 'quarterly'
  const month = quarterly ? `${picked.slice(0, 5)}${String(Math.ceil(Number(picked.slice(5)) / 3) * 3).padStart(2, '0')}` : picked

  // 🔒 Hooks first — always called unconditionally
  const { data, isLoading, error } = useQuery({
    queryKey: ['gstr-2b-reconcile', month],
    enabled: !composition,
    // 9a-4: "Add as purchase" and "Record it" send the shop to a form and back. Fetch fresh each
    // time the screen opens (showing the cached answer meanwhile), or the bill just entered read
    // "not in your books" for the app-wide 2-minute cache.
    refetchOnMount: 'always',
    queryFn: async () => {
      const r = await offlineFetch(`/api/gstr-2b/reconcile?month=${month}`)
      if (!r.ok) {
        const json = await r.json().catch(() => ({}))
        throw new Error(json.message || json.error || `Request failed (${r.status})`)
      }
      return r.json()
    },
  })

  const goToMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta * (quarterly ? 3 : 1), 1)
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
        sonnerToast.error(result.message || result.error || 'Upload failed')
        return
      }

      const result = await r.json()
      sonnerToast.success(result.message)
      haptic.success()
      queryClient.invalidateQueries({ queryKey: ['gstr-2b-reconcile', month] })
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e?.message || 'Could not upload GSTR-2B. Please try again.')
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

  if (composition) {
    return (
      <Notice level="note" title="Supplier bills are for regular GST shops" data-testid="supplier-bills-composition"
        info="A composition shop does not claim input credit (Section 10(4)) and does not use IMS on the portal. Your returns are CMP-08 every quarter and GSTR-4 once a year — both under Reports."
      />
    )
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
  const groups = data?.groups as Groups | undefined
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['gstr-2b-reconcile', month] }) }
  const summary = data?.summary
  const monthLabel = quarterly
    ? (() => {
        const end = Number(month.slice(5))
        const short = (m: number) => new Date(2000, m - 1, 1).toLocaleDateString('en-IN', { month: 'short' })
        return `${short(end - 2)}–${short(end)} ${month.slice(0, 4)}`
      })()
    : new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-4">
      {/* Month picker + upload */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button aria-label="Previous month" variant="outline" size="icon" onClick={() => goToMonth(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="font-semibold text-lg min-w-[140px] text-center">{monthLabel}</span>
          <Button aria-label="Next month" variant="outline" size="icon" onClick={() => goToMonth(1)}>
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

      {/* Reconciliation results — 9a-3: the supplier-bills screen (plan 9a, approved 3 Nov). */}
      {hasImport && summary && groups && (
        <SupplierBills data={data} groups={groups} month={month} onChanged={refresh} />
      )}
    </div>
  )
}

// ─── 9a-3: the supplier-bills screen ─────────────────────────────

/*
 * What the server sends per group (app/api/gstr-2b/reconcile → groups). Typed
 * here, at the one place that reads it.
 */
interface Line {
  id: string; docType: string; supplierGstin: string; supplierName: string | null; supplierPartyId: string | null
  invoiceNumber: string; originalNumber: string | null; invoiceDate: string | null
  taxableValue: number; igst: number; cgst: number; sgst: number; totalAmount: number
  itcAvailable: boolean; itcReason: string | null
}
interface Buy {
  purchaseId: string; invoiceNumber: string | null; purchaseDate: string; partyName: string; partyGstin: string
  partyPhone: string | null; igst: number; cgst: number; sgst: number; totalAmount: number
}
interface PairRow {
  supplierGstin: string; invoiceNumber: string; invoiceDate: string | null; twoBTotal: number
  twoBIgst: number; twoBCgst: number; twoBSgst: number; purchaseId: string; purchaseTotal: number
  purchaseInvoiceNo: string | null; partyName: string; partyPhone: string | null; amountDifference: number; itcReason: string | null; via: string
}
interface Groups {
  matched: PairRow[]; amountDiffers: PairRow[]; noCredit: PairRow[]
  sameBill: Array<{ line: Line; candidates: Buy[] }>
  notInBooks: Line[]; notMine: Line[]; notes: Line[]; waiting: Buy[]
  notesRecorded?: Array<{ line: Line; entry: Buy }>; notesOffered?: Array<{ line: Line; candidates: Buy[] }>; notesToRecord?: Line[]
}

const tax = (x: { cgst: number; sgst: number; igst: number }) => Math.round((x.cgst + x.sgst + x.igst) * 100) / 100
const pairTax = (p: PairRow) => tax({ cgst: p.twoBCgst, sgst: p.twoBSgst, igst: p.twoBIgst })
const shortGstin = (g: string) => `${g.slice(0, 7)}…`
const nameOf = (l: Line) => l.supplierName || shortGstin(l.supplierGstin)
const dayOf = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

async function decide(body: Record<string, string>, method: 'POST' | 'DELETE' = 'POST') {
  const r = await offlineFetch('/api/gstr-2b/decisions', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new Error(j.message || j.error || 'Could not save that')
  }
}

function SupplierBills({ data, groups, month, onChanged }: { data: any; groups: Groups; month: string; onChanged: () => void }) {
  const { setView, setPreviousView, setSelectedTransactionId } = useAppStore.getState()
  const [notMine, setNotMine] = useState<Line | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const ims = data?.ims

  // 9b-2: how long a supplier's credit note can stay Pending (lib/gst-due-dates.ts, from the shop's filing frequency).
  const pendingUntil = data?.notesPendingUntil
    ? new Date(data.notesPendingUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  const readyTax = groups.matched.reduce((s, p) => s + pairTax(p), 0)
  const waitingTax = groups.waiting.reduce((s, b) => s + tax(b), 0)
  const decisions = groups.amountDiffers.length + groups.notInBooks.length + groups.sameBill.length
  const openBill = (id: string) => { setSelectedTransactionId(id); setPreviousView('reports'); setView('transaction-detail') }
  const addAsPurchase = (l: Line) => {
    ;(window as any).__ledgerPreset = purchasePresetFrom(l, l.supplierPartyId)
    setPreviousView('reports')
    setView('new-purchase')
  }
  // 9a-4: "Record it" — the return-to-supplier form, filled in from the note; nothing is saved from here.
  const recordNote = (l: Line) => {
    ;(window as any).__ledgerPreset = returnPresetFrom(l, l.supplierPartyId)
    setPreviousView('reports')
    setView('new-purchase')
  }
  const run = async (key: string, body: Record<string, string>, method: 'POST' | 'DELETE' = 'POST', done?: string) => {
    setBusy(key)
    try {
      await decide(body, method)
      haptic.success()
      if (done) sonnerToast.success(done)
      onChanged()
    } catch (e) {
      haptic.error()
      sonnerToast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4" data-testid="supplier-bills">
      {/* When to act: on the portal, before GSTR-3B is filed (IMS FAQ: actions freeze on filing). */}
      {/* Calm when fine: no countdown when nothing needs a decision. */}
      {ims && decisions > 0 && (
        <div className="flex items-center gap-1">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
            ims.state === 'period-closed' ? 'bg-muted text-muted-foreground' : 'bg-check-soft text-check')}
          >
            <Clock className="w-3.5 h-3.5" aria-hidden />
            {ims.state === 'period-closed' ? 'GSTR-3B filed — this month is closed'
              : ims.state === 'deemed-accepted' ? 'Change it on the portal before you file GSTR-3B'
                : `${ims.daysLeft} days to act on the portal`}
          </span>
          <InfoHint text={ims.message} label="when to act on the portal" />
        </div>
      )}

      {/* The money that is fine comes first, and biggest. */}
      <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-card" data-testid="credit-ready">
        <p className="text-3xl font-extrabold tabular-nums text-good">{formatINR(readyTax)}</p>
        <p className="text-sm text-muted-foreground">
          input credit ready · {groups.matched.length} {groups.matched.length === 1 ? 'bill matches' : 'bills match'} your books
        </p>
        {groups.matched.length > 0 && (
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-good-soft px-3 py-1 text-xs font-semibold text-good">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Nothing to do on the portal for these
          </span>
        )}
      </section>

      {decisions > 0 && (
        <Section title="Needs your decision" count={`${decisions} ${decisions === 1 ? 'bill' : 'bills'}`}>
          {groups.amountDiffers.map((p) => (
            <Row key={`amt-${p.supplierGstin}-${p.invoiceNumber}`} title={`${p.partyName} · ${p.invoiceNumber}`} amount={p.twoBTotal}
              why={<><Chip tone="check">Amount differs by {formatINR(p.amountDifference)}</Chip><span className="text-xs text-muted-foreground">your bill {formatINR(p.purchaseTotal)}</span></>}
            >
              <Act onClick={() => openBill(p.purchaseId)}>Open my bill</Act>
              <Act href={whatsAppUrl(p.partyPhone, askSupplierText(p.invoiceNumber, p.twoBTotal, p.purchaseTotal))}>Ask supplier</Act>
            </Row>
          ))}
          {groups.sameBill.flatMap((s) => s.candidates.map((c) => (
            <Row key={`same-${s.line.id}-${c.purchaseId}`} title={nameOf(s.line)} amount={s.line.totalAmount}
              why={<><Chip tone="check">Same bill? Number written differently</Chip>
                <span className="text-xs text-muted-foreground">2B: {s.line.invoiceNumber} · yours: {c.invoiceNumber} {formatINR(c.totalAmount)}</span></>}
            >
              <Act primary disabled={busy !== null} onClick={() => run(`same-${s.line.id}`, { supplierGstin: s.line.supplierGstin, docType: s.line.docType, documentNumber: s.line.invoiceNumber, decision: 'same-bill', purchaseId: c.purchaseId }, 'POST', 'Matched')}>Same bill</Act>
              <Act disabled={busy !== null} onClick={() => run(`diff-${s.line.id}`, { supplierGstin: s.line.supplierGstin, docType: s.line.docType, documentNumber: s.line.invoiceNumber, decision: 'different-bills', purchaseId: c.purchaseId })}>Different bills</Act>
            </Row>
          )))}
          {groups.notInBooks.map((l) => (
            <Row key={`nib-${l.id}`} title={`${nameOf(l)} · ${l.invoiceNumber}`} amount={l.totalAmount}
              why={<Chip tone="bad">Not in your books</Chip>}
            >
              <Act primary onClick={() => addAsPurchase(l)}>Add as purchase</Act>
              <Act onClick={() => setNotMine(l)}>Not mine</Act>
            </Row>
          ))}
        </Section>
      )}

      {groups.noCredit.length > 0 && (
        <Section title="2B says no credit" count={`${groups.noCredit.length} ${groups.noCredit.length === 1 ? 'bill' : 'bills'}`}>
          {groups.noCredit.map((p) => (
            <Row key={`nc-${p.supplierGstin}-${p.invoiceNumber}`} title={`${p.partyName} · ${p.invoiceNumber}`} amount={p.twoBTotal}
              why={<><Chip tone="bad">No credit on this bill</Chip>
                <InfoHint label={`why ${p.invoiceNumber} has no credit`} text={`Your GSTR-2B marks this bill "ITC not available"${p.itcReason ? ` (portal reason code ${p.itcReason})` : ''}, so its credit is not claimed. If that looks wrong, ask the supplier to check the GSTIN and place of supply on their bill.`} /></>}
            />
          ))}
        </Section>
      )}

      {/*
        * 9a-4: a supplier's credit note. Once accepted on the portal it cuts credit by its
        * GST (GSTN IMS FAQ Q15: accepted records auto-populate GSTR-3B), so the books
        * record it as a return to the supplier. Recorded, offered ("Recorded as DN-…?"),
        * or still to record — never assumed from an amount alone.
        */}
      {groups.notes.length > 0 && (
        <Section title="Notes from suppliers" count={`${groups.notes.length}`}>
          {(groups.notesToRecord ?? []).map((l) => (
            <Row key={`note-${l.id}`} title={`${nameOf(l)} · ${l.invoiceNumber}`} amount={l.totalAmount}
              why={<><Chip tone="check">Credit note · not in your books</Chip>
                <span className="text-xs text-muted-foreground">Portal: accept, reduce credit {formatINR(tax(l))}</span>
                {pendingUntil && <Chip tone="check">Decide by {pendingUntil}</Chip>}
                <InfoHint label={`about credit note ${l.invoiceNumber}`} text={`On the portal, accept it and say "Yes" to reducing credit, by ${formatINR(tax(l))} — or "No" if you never took credit on that bill. A credit note can stay Pending only until ${pendingUntil ?? 'your next GSTR-3B'}; after that it counts as accepted.`} /></>}
            >
              <Act primary onClick={() => recordNote(l)}>Record it</Act>
            </Row>
          ))}
          {(groups.notesOffered ?? []).flatMap((x) => x.candidates.map((c) => (
            <Row key={`noff-${x.line.id}-${c.purchaseId}`} title={`${nameOf(x.line)} · ${x.line.invoiceNumber}`} amount={x.line.totalAmount}
              why={<><Chip tone="check">Recorded as {c.invoiceNumber}?</Chip><span className="text-xs text-muted-foreground">your return {formatINR(c.totalAmount)}</span></>}
            >
              <Act primary disabled={busy !== null} onClick={() => run(`nsame-${x.line.id}`, { supplierGstin: x.line.supplierGstin, docType: x.line.docType, documentNumber: x.line.invoiceNumber, decision: 'same-bill', purchaseId: c.purchaseId }, 'POST', 'Matched')}>Yes, that one</Act>
              <Act disabled={busy !== null} onClick={() => run(`ndiff-${x.line.id}`, { supplierGstin: x.line.supplierGstin, docType: x.line.docType, documentNumber: x.line.invoiceNumber, decision: 'different-bills', purchaseId: c.purchaseId })}>No</Act>
            </Row>
          )))}
          {(groups.notesRecorded ?? []).map((n) => (
            <Row key={`nrec-${n.line.id}`} title={`${nameOf(n.line)} · ${n.line.invoiceNumber}`} amount={n.line.totalAmount}
              why={<span className="inline-flex items-center gap-1 text-xs text-good"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Recorded as {n.entry.invoiceNumber}</span>}
            />
          ))}
        </Section>
      )}

      {groups.waiting.length > 0 && (
        <Section title="Waiting for suppliers" count={`${groups.waiting.length} · ${formatINR(waitingTax)} credit`}>
          {groups.waiting.map((b) => (
            <Row key={`w-${b.purchaseId}`} title={`${b.partyName} · ${b.invoiceNumber ?? ''}`} amount={b.totalAmount}
              why={<span className="text-xs text-muted-foreground">Not in 2B yet · {dayOf(b.purchaseDate)} · GST {formatINR(tax(b))}</span>}
            >
              <Act href={whatsAppUrl(b.partyPhone, remindSupplierText(b.invoiceNumber, dayOf(b.purchaseDate), b.totalAmount))}>Remind</Act>
            </Row>
          ))}
        </Section>
      )}

      <Folded title="Matched" count={groups.matched.length}>
        {groups.matched.map((p) => (
          <Row key={`m-${p.supplierGstin}-${p.invoiceNumber}`} title={`${p.partyName} · ${p.invoiceNumber}`} amount={p.twoBTotal}
            why={<span className="text-xs text-muted-foreground">GST {formatINR(pairTax(p))}{p.via === 'corrected' ? ` · corrected bill, yours ${p.purchaseInvoiceNo}` : p.via === 'confirmed' ? ` · same as your ${p.purchaseInvoiceNo}` : ''}</span>}
          />
        ))}
      </Folded>

      <Folded title="Not mine" count={groups.notMine.length}>
        {groups.notMine.map((l) => (
          <Row key={`nm-${l.id}`} title={`${nameOf(l)} · ${l.invoiceNumber}`} amount={l.totalAmount}
            why={<span className="text-xs text-muted-foreground">Rejected on the portal</span>}
          >
            <Act disabled={busy !== null} onClick={() => run(`undo-${l.id}`, { supplierGstin: l.supplierGstin, docType: l.docType, documentNumber: l.invoiceNumber, decision: 'not-mine' }, 'DELETE')}>Undo</Act>
          </Row>
        ))}
      </Folded>

      {/* Import info — quiet, at the end. */}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileCheck className="w-3.5 h-3.5 text-good" aria-hidden />
        2B for {new Date(month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} · imported {new Date(data?.importInfo?.importedAt).toLocaleDateString('en-IN')} · {data?.importInfo?.invoiceCount || 0} bills
      </p>

      {notMine && (
        <NotMineSheet line={notMine} busy={busy !== null} onClose={() => setNotMine(null)}
          onDone={() => run(`nm-${notMine.id}`, { supplierGstin: notMine.supplierGstin, docType: notMine.docType, documentNumber: notMine.invoiceNumber, decision: 'not-mine' }, 'POST', 'Marked as not yours').then(() => setNotMine(null))}
        />
      )}
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-baseline justify-between px-1 text-sm font-bold">
        {title} <span className="text-xs font-semibold text-muted-foreground">{count}</span>
      </h3>
      {children}
    </section>
  )
}

function Folded({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  if (count === 0) return null
  return (
    <section className="space-y-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full min-h-12 items-center justify-between rounded-xl px-1 text-sm font-bold hover:bg-muted/40"
      >
        {title}
        <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          {count} {count === 1 ? 'bill' : 'bills'} <ChevronRight className={cn('w-4 h-4 transition-transform', open && 'rotate-90')} aria-hidden />
        </span>
      </button>
      {open && children}
    </section>
  )
}

function Row({ title, amount, why, children }: { title: string; amount: number; why: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2 text-sm font-semibold">
        <span className="min-w-0 truncate">{title}</span>
        <span className="shrink-0 tabular-nums">{formatINR(amount)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">{why}</div>
      {children && <div className="mt-2 flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}

function Chip({ tone, children }: { tone: 'check' | 'bad' | 'quiet'; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
      tone === 'check' ? 'bg-check-soft text-check' : tone === 'bad' ? 'bg-bad-soft text-bad' : 'bg-muted text-foreground')}
    >{children}</span>
  )
}

/** One action on a row: a 48 px button, or a link that opens WhatsApp with the message typed. */
function Act({ children, onClick, href, primary, disabled }: { children: React.ReactNode; onClick?: () => void; href?: string; primary?: boolean; disabled?: boolean }) {
  const cls = cn('inline-flex min-h-12 items-center rounded-xl px-3 text-sm font-semibold border',
    primary ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-muted/50',
    disabled && 'opacity-60')
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{children}</a>
  return <button type="button" onClick={onClick} disabled={disabled} className={cls}>{children}</button>
}

/** "Not mine": EkBook cannot press Reject on the portal (no GSP link), so it shows the steps and remembers. */
function NotMineSheet({ line, busy, onClose, onDone }: { line: Line; busy: boolean; onClose: () => void; onDone: () => void }) {
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[88vh] overflow-y-auto gap-0 pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-lg" data-testid="not-mine-sheet">
        <SheetHeader className="pb-1">
          <SheetTitle className="text-lg">Not yours? {line.invoiceNumber}</SheetTitle>
          <SheetDescription className="text-xs">
            {nameOf(line)} · {formatINR(line.totalAmount)} · GST {formatINR(tax(line))} if you leave it
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 space-y-4">
          <div className="rounded-xl border border-border/60 p-3">
            <p className="text-sm font-semibold">Reject it on the GST portal</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm">
              <li>gst.gov.in → Services → Returns → <b>IMS</b></li>
              <li>Inward supplies → B2B → find <b>{line.invoiceNumber}</b></li>
              <li>Tap <b>Reject</b>, then <b>Recompute GSTR-2B</b></li>
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">Do it before you file GSTR-3B for this month.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Button className="min-h-12" disabled={busy} onClick={onDone}>Done on the portal</Button>
            <Button variant="outline" className="min-h-12" onClick={onClose}>It is mine after all</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
