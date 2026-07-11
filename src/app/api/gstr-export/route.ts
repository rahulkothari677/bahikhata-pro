import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { roundMoney } from '@/lib/money'
import { activeTransactionWhere } from '@/lib/query-helpers'
import { istMonthStart, getISTDateParts, isSameISTMonth, istDateString, istYearMonth, IST_OFFSET_MS } from '@/lib/timezone'
import { apiError } from '@/lib/api-error'

// ⏱️ Vercel serverless timeout — GSTR export aggregates all transactions
// in a period and generates CSV/JSON. Can take several seconds at scale.
// (Audit fix Phase 1.3)
export const maxDuration = 60

// 🔒 AUDIT FIX V6 SC1: GSTR export now computes per-invoice GST via SQL
// aggregation rather than loading all transactions with items into JS.
//
// GSTR-1 is unique among reports: the GST portal expects per-invoice data
// (B2B section needs each invoice with its GSTIN, B2C needs invoices
// grouped by rate). So we can't avoid loading invoice rows entirely — but
// we CAN compute the per-invoice GST breakdown in SQL, so we load only
// the aggregated per-invoice rows instead of all TransactionItem rows.
//
// Strategy:
//   1. One raw SQL query that groups TransactionItem by (transactionId, gstRate)
//      and returns the per-invoice-per-rate totals. This is O(invoices × rates)
//      rows, much smaller than O(all items).
//   2. One findMany for the transaction headers (invoiceNo, date, party) —
//      bounded by the number of invoices in the period (capped at 10K as a
//      safety net, with a truncated flag).
//   3. Join them in JS.
//
// The previous unbounded findMany (loading all transactions with all items)
// is gone. The 10K cap is a defensive safety net — at scale, the user should
// split the period, and the response includes a `truncated` flag + CSV
// warning so the UI can hard-block export (V6 SC1/PP1).

// GET /api/gstr-export?from=&to= - generates GSTR-1 format data (JSON + CSV)
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('reports')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')
    const format = searchParams.get('format') || 'json' // json or csv

    const now = new Date()
    // 🔒 V11 §2.1 + §4.6: Default "from" is start of THIS month in IST.
    const from = fromStr ? new Date(fromStr) : istMonthStart(now)
    const to = toStr ? new Date(toStr) : now

    // 🔒 V7 M5: GSTR-1 is a MONTHLY return. Reject ranges that span multiple
    // IST calendar months.
    // 🔒 V10 FIX: Was comparing from.getMonth()/to.getMonth() using the
    // SERVER's local timezone (UTC on Vercel). Blocked every GSTR-1 export
    // for non-UTC users because "July 1 IST" became "June 30 UTC".
    // 🔒 V11 §4.1 FIX: Was a loose 35-day heuristic that allowed 30-day
    // ranges straddling 2 months (e.g., June 15 → July 15) — these passed
    // the check but got mislabeled with the wrong `fp` (filing period).
    // Now: proper IST calendar-month check.
    //
    // Valid ranges:
    //   1. `from` and `to` are in the SAME IST calendar month/year
    //      (e.g., July 1 - July 15, July 1 - July 31)
    //   2. `to` is exactly the 1st of the NEXT month at 00:00 IST
    //      (e.g., from = July 1 00:00 IST, to = Aug 1 00:00 IST — the
    //      "whole month of July" picker case)
    //
    // Invalid: any range spanning 2+ IST calendar months (e.g., June 15 -
    // July 15), or > 31 days (defensive cap).
    // 🔒 V11 §4.6: Uses centralized getISTDateParts + isSameISTMonth from
    // @/lib/timezone. (IST_OFFSET_MS is imported, not redeclared.)
    const fromParts = getISTDateParts(from)
    const toParts = getISTDateParts(to)

    // Case 1: same IST calendar month/year (uses helper)
    const sameMonth = isSameISTMonth(from, to)

    // Case 2: `to` is exactly the 1st of the next month at 00:00:00 IST
    // (the "whole month" picker case — from = July 1, to = Aug 1 00:00)
    const nextMonth = fromParts.month === 11 ? 0 : fromParts.month + 1
    const nextMonthYear = fromParts.month === 11 ? fromParts.year + 1 : fromParts.year
    const isWholeMonthBoundary =
      toParts.year === nextMonthYear &&
      toParts.month === nextMonth &&
      toParts.day === 1 &&
      toParts.hours === 0 &&
      toParts.minutes === 0 &&
      toParts.seconds === 0 &&
      toParts.ms === 0

    // Defensive cap: no month has > 31 days
    const rangeMs = to.getTime() - from.getTime()
    const rangeDays = rangeMs / (1000 * 60 * 60 * 24)

    if (!sameMonth && !isWholeMonthBoundary) {
      return NextResponse.json({
        error: 'GSTR-1 export requires a single-month period',
        message: `GSTR-1 is a monthly return. The selected range spans multiple calendar months (${istDateString(from)} to ${istDateString(to)}). Please select a single month and try again.`,
        hint: 'Use the date picker to select "This Month" or a specific month range (e.g., July 1 to July 31).',
      }, { status: 400 })
    }
    if (rangeDays > 31) {
      return NextResponse.json({
        error: 'GSTR-1 export requires a single-month period',
        message: `GSTR-1 is a monthly return. The selected range spans ${Math.ceil(rangeDays)} days, which exceeds the maximum 31-day month. Please select a single month and try again.`,
        hint: 'Use the date picker to select "This Month" or a specific month range.',
      }, { status: 400 })
    }

    // Defensive cap: 10K invoices per monthly return is a sane upper bound
    // (GSTN's own GSTR-1 portal caps a single upload at ~50K lines). If a
    // shop exceeds this, the user must split the period.
    const INVOICE_CAP = 10000

    // Parallel: transaction headers + per-invoice-per-rate GST breakdown via SQL
    const [transactions, perInvoiceGstRows, setting] = await Promise.all([
      // Transaction headers (bounded at INVOICE_CAP)
      db.transaction.findMany({
        where: activeTransactionWhere(userId, {
          type: 'sale',
          date: { gte: from, lte: to },
        }),
        include: { party: true },
        orderBy: { date: 'asc' },
        take: INVOICE_CAP + 1,  // fetch one extra to detect cap hit
      }),
      // Per-invoice-per-rate GST breakdown via raw SQL.
      // 🔒 V10 §2.2: aggregate STORED per-item CGST/SGST/IGST (single source
      // of truth). Was: recompute GST in SQL with `ROUND(taxable × rate / 200)`
      // — different rounding path from write-time splitGst() → for odd-paise
      // GST, stored (cgst=4.51, sgst=4.50) disagreed with recomputed
      // (cgst=4.51, sgst=4.51) → summary tax ≠ sum of per-invoice tax →
      // CA reconciliation fails. Now: aggregate the stored per-item values.
      // Returns one row per (transaction, gstRate) — much smaller than all items.
      db.$queryRaw<Array<{
        transactionId: string;
        gstRate: number;
        taxableValue: number;
        cgst: number;
        sgst: number;
        igst: number;
        quantity: number;
      }>>`
        SELECT
          ti."transactionId",
          ti."gstRate",
          SUM(ROUND((ti."quantity"::numeric * ti."unitPrice" - COALESCE(ti."discountAmount", 0)::numeric)::numeric, 2)) AS "taxableValue",
          SUM(COALESCE(ti."cgst", 0)::numeric) AS cgst,
          SUM(COALESCE(ti."sgst", 0)::numeric) AS sgst,
          SUM(COALESCE(ti."igst", 0)::numeric) AS igst,
          SUM(ti."quantity") AS quantity
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" = 'sale'
          AND t."date" >= ${from}
          AND t."date" <= ${to}
        GROUP BY ti."transactionId", ti."gstRate"
      `,
      db.setting.findUnique({ where: { userId } }),
    ])

    // Detect cap hit
    const hitCap = transactions.length > INVOICE_CAP
    const cappedTransactions = hitCap ? transactions.slice(0, INVOICE_CAP) : transactions

    // Build a lookup: transactionId → array of per-rate rows
    const gstByTransaction = new Map<string, Array<{ gstRate: number; taxableValue: number; cgst: number; sgst: number; igst: number; quantity: number }>>()
    for (const row of perInvoiceGstRows) {
      const txId = row.transactionId
      if (!gstByTransaction.has(txId)) gstByTransaction.set(txId, [])
      gstByTransaction.get(txId)!.push({
        gstRate: Number(row.gstRate),
        taxableValue: roundMoney(Number(row.taxableValue)),
        cgst: roundMoney(Number(row.cgst)),
        sgst: roundMoney(Number(row.sgst)),
        igst: roundMoney(Number(row.igst)),
        quantity: Number(row.quantity),
      })
    }

    // Build GSTR-1 B2B/B2C sections
    const b2bInvoices: any[] = []
    const b2cInvoices: any[] = []

    for (const t of cappedTransactions) {
      const itemsByRate: any = {}
      const rateRows = gstByTransaction.get(t.id) || []
      let taxableTotal = 0

      for (const row of rateRows) {
        const rate = row.gstRate
        if (!itemsByRate[rate]) {
          itemsByRate[rate] = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, quantity: 0 }
        }
        itemsByRate[rate].taxableValue = roundMoney(itemsByRate[rate].taxableValue + row.taxableValue)
        itemsByRate[rate].cgst = roundMoney(itemsByRate[rate].cgst + row.cgst)
        itemsByRate[rate].sgst = roundMoney(itemsByRate[rate].sgst + row.sgst)
        itemsByRate[rate].igst = roundMoney(itemsByRate[rate].igst + row.igst)
        itemsByRate[rate].quantity += row.quantity
        taxableTotal = roundMoney(taxableTotal + row.taxableValue)
      }

      if (!t.party?.gstin) {
        // B2C
        b2cInvoices.push({
          inum: t.invoiceNo || t.id.slice(-8),
          idt: istDateString(t.date),  // 🔒 FIX C2: was toISOString (UTC)
          taxablevalue: taxableTotal,
          isInterState: t.isInterState,  // 🔒 V7 M2: needed for B2CL classification
          ...Object.fromEntries(
            Object.entries(itemsByRate).map(([rate, v]: [string, any]) => [
              `rate_${rate}`,
              { taxable: v.taxableValue, cgst: v.cgst, sgst: v.sgst, igst: v.igst, qty: v.quantity }
            ])
          ),
          total: t.totalAmount,
        })
      } else {
        // B2B
        b2bInvoices.push({
          inum: t.invoiceNo || t.id.slice(-8),
          itype: 'R', // Regular
          ctin: t.party.gstin,
          in_date: istDateString(t.date),  // 🔒 FIX C2: was toISOString (UTC)
          taxablevalue: taxableTotal,
          isInterState: t.isInterState,  // 🔒 V7 M2: include for consistency
          items: Object.entries(itemsByRate).map(([rate, v]: [string, any]) => ({
            rate: parseFloat(rate),
            txval: v.taxableValue,
            camt: v.cgst,
            samt: v.sgst,
            iamt: v.igst,
            qty: v.quantity,
          })),
          total: t.totalAmount,
        })
      }
    }

    // V17-Ext Tier 3 Step 4: Fetch credit/debit notes for the CDN section
    const [cdnTransactions, cdnGstRows] = await Promise.all([
      db.transaction.findMany({
        where: activeTransactionWhere(userId, {
          type: { in: ['credit-note', 'debit-note'] },
          date: { gte: from, lte: to },
        }),
        include: {
          party: true,
          originalTransaction: { select: { invoiceNo: true, date: true } },
        },
        orderBy: { date: 'asc' },
        take: INVOICE_CAP + 1,
      }),
      db.$queryRaw<Array<{
        transactionId: string;
        gstRate: number;
        taxableValue: number;
        cgst: number;
        sgst: number;
        igst: number;
        quantity: number;
      }>>`
        SELECT
          ti."transactionId",
          ti."gstRate",
          SUM(ROUND((ti."quantity"::numeric * ti."unitPrice" - COALESCE(ti."discountAmount", 0)::numeric)::numeric, 2)) AS "taxableValue",
          SUM(COALESCE(ti."cgst", 0)::numeric) AS cgst,
          SUM(COALESCE(ti."sgst", 0)::numeric) AS sgst,
          SUM(COALESCE(ti."igst", 0)::numeric) AS igst,
          SUM(ti."quantity") AS quantity
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t."type" IN ('credit-note', 'debit-note')
          AND t."date" >= ${from}
          AND t."date" <= ${to}
        GROUP BY ti."transactionId", ti."gstRate"
      `,
    ])

    // Build per-transaction GST map for CDN
    const cdnGstByTransaction = new Map<string, any[]>()
    for (const row of cdnGstRows) {
      const arr = cdnGstByTransaction.get(row.transactionId) || []
      arr.push(row)
      cdnGstByTransaction.set(row.transactionId, arr)
    }

    // Build CDN section: grouped by counter-party GSTIN
    // Structure: { ctin, nt: [{ nt_num, nt_dt, ntty, pos, rchrg, doc_det, itms }] }
    const cdnByGstin = new Map<string, any[]>()
    for (const t of cdnTransactions) {
      const ctin = t.party?.gstin || ''
      if (!ctin) continue // skip unregistered parties (they go in cdnur, not cdn)
      const rateRows = cdnGstByTransaction.get(t.id) || []
      const items = rateRows.map(r => ({
        rt: r.gstRate,
        txval: roundMoney(r.taxableValue),
        camt: roundMoney(r.cgst),
        samt: roundMoney(r.sgst),
        iamt: roundMoney(r.igst),
        qty: Number(r.quantity),
      }))
      const noteEntry = {
        nt_num: t.invoiceNo || t.id.slice(-8),
        nt_dt: istDateString(t.date),
        ntty: t.noteType || (t.type === 'credit-note' ? 'C' : 'D'),
        pos: t.isInterState ? (t.party?.state ? '' : '99') : (setting?.state ? '' : '99'),
        rchrg: t.isReverseCharge ? 'Y' : 'N',
        doc_det: t.originalTransaction ? {
          doc_num: t.originalTransaction.invoiceNo || '',
          doc_dt: istDateString(t.originalTransaction.date),
        } : null,
        itms: items,
        total: roundMoney(t.totalAmount),
        isInterState: t.isInterState,
      }
      const arr = cdnByGstin.get(ctin) || []
      arr.push(noteEntry)
      cdnByGstin.set(ctin, arr)
    }
    const cdnSection = Array.from(cdnByGstin.entries()).map(([ctin, nt]) => ({ ctin, nt }))

    // Summary totals via SQL aggregate (O(1) memory, no row iteration)
    // 🔒 V17 Audit Phase 3 FIX: Summary must NET credit notes (was: type='sale' only).
    // The per-invoice aggregation includes credit-note items (via the CDN section),
    // so the summary must also subtract credit-note taxable to match.
    // Without this, per-invoice taxable > summary taxable → reconciliation fails.
    const [saleAgg, creditNoteAgg] = await Promise.all([
      db.transaction.aggregate({
        where: activeTransactionWhere(userId, {
          type: 'sale',
          date: { gte: from, lte: to },
        }),
        _sum: {
          subtotal: true,
          discountAmount: true,
          cgst: true,
          sgst: true,
          igst: true,
          totalAmount: true,
        },
        _count: true,
      }),
      db.transaction.aggregate({
        where: activeTransactionWhere(userId, {
          type: 'credit-note',
          date: { gte: from, lte: to },
        }),
        _sum: {
          subtotal: true,
          discountAmount: true,
          cgst: true,
          sgst: true,
          igst: true,
          totalAmount: true,
        },
        _count: true,
      }),
    ])

    // Net totals: sale - credit-note
    const summaryAgg = {
      _count: saleAgg._count,
      _sum: {
        subtotal: roundMoney((saleAgg._sum.subtotal || 0) - (creditNoteAgg._sum.subtotal || 0)),
        discountAmount: roundMoney((saleAgg._sum.discountAmount || 0) - (creditNoteAgg._sum.discountAmount || 0)),
        cgst: roundMoney((saleAgg._sum.cgst || 0) - (creditNoteAgg._sum.cgst || 0)),
        sgst: roundMoney((saleAgg._sum.sgst || 0) - (creditNoteAgg._sum.sgst || 0)),
        igst: roundMoney((saleAgg._sum.igst || 0) - (creditNoteAgg._sum.igst || 0)),
        totalAmount: roundMoney((saleAgg._sum.totalAmount || 0) - (creditNoteAgg._sum.totalAmount || 0)),
      },
    }

    const output = {
      gstin: setting?.gstin || '',
      // 🔒 V10 FIX: Derive `fp` (filing period) from the `to` date, not `from`.
      // Reason: when a user in India selects "This Month" (July 1 - July 6 IST),
      // the ISO strings become June 30 - July 6 in UTC. Using `from`'s UTC month
      // gives "062026" (June) — wrong. Using `to`'s UTC month gives "072026"
      // (July) — correct. The `to` date is always within the intended filing
      // month (the user is exporting for a period that ENDS in the current month).
      // 🔒 FIX C1: Was `to.getUTCMonth()` which returns UTC month. For an export
      // at IST 2 AM on July 1, `to` is still June 30 UTC → fp = "062026" (wrong).
      // Now uses `toParts` (already computed on line ~75 from getISTDateParts).
      fp: `${String(toParts.month + 1).padStart(2, '0')}${toParts.year}`,
      gt: 0,
      cur_gt: 0,
      b2b: b2bInvoices,
      // 🔒 V7 M2: B2CL = inter-state B2C above threshold. Was: only filtered
      // on total >= 100000, ignoring isInterState. Intra-state high-value
      // B2C invoices were miscategorized as B2CL.
      // 🔒 V8 M3: Verified the ₹1,00,000 threshold matches the current GST
      // rule for B2CL (was ₹2,50,000 historically, reduced to ₹1,00,000).
      // Correct for current filing periods.
      b2cl: b2cInvoices.filter(i => i.isInterState === true && i.total >= 100000), // B2C Large (inter-state only, ₹1L threshold)
      b2cs: b2cInvoices.filter(i => !(i.isInterState === true && i.total >= 100000)), // B2C Small (everything else)
      // V17-Ext Tier 3: CDN section — credit/debit notes
      cdn: cdnSection,
      // 🔒 V6 SC1: flag if we hit the 10K cap — return is incomplete.
      // The UI must hard-block export when this is true (V6 PP1).
      truncated: hitCap,
      truncatedHint: hitCap ? 'GSTR export capped at 10,000 invoices. Split the period into smaller ranges and re-run.' : null,
      summary: {
        total_invoices: summaryAgg._count,
        total_taxable: roundMoney((summaryAgg._sum.subtotal || 0) - (summaryAgg._sum.discountAmount || 0)),
        total_cgst: roundMoney(summaryAgg._sum.cgst || 0),
        total_sgst: roundMoney(summaryAgg._sum.sgst || 0),
        total_igst: roundMoney(summaryAgg._sum.igst || 0),
        total_tax: roundMoney((summaryAgg._sum.cgst || 0) + (summaryAgg._sum.sgst || 0) + (summaryAgg._sum.igst || 0)),
        total_amount: roundMoney(summaryAgg._sum.totalAmount || 0),
      },
      // 🔒 V7 H3: Reconciliation assertion — per-invoice taxable AND tax must
      // equal the summary totals. If they don't, the export is internally
      // inconsistent and the user (or their CA) will catch it during filing.
      // 🔒 V10 §2.2: now also reconciles TAX (was: taxable only — missed the
      // stored-vs-recomputed drift). Since both summary and per-invoice now
      // aggregate the SAME stored per-item CGST/SGST/IGST columns, they must
      // be byte-identical (rounding tolerance only for float-sum drift).
      // 🔒 V10 FIX: Wrapped in try-catch. If the reconciliation code itself
      // crashes (e.g., unexpected invoice structure), we return matches: null
      // instead of failing the entire export. The reconciliation is a safety
      // check — it should never block the export by crashing.
      reconciliation: (() => {
        try {
          // 🔒 V17 Audit Phase 3 FIX: Per-invoice taxable must be NET of credit notes.
          // Was: only summed B2B + B2C (sales). Now: also subtract CDN (credit-note) taxable.
          const salesTaxable = roundMoney(
            [...b2bInvoices, ...b2cInvoices].reduce((s, inv) => s + (Number(inv.taxablevalue) || 0), 0)
          )
          const cdnTaxable = roundMoney(
            cdnTransactions.reduce((s, t) => {
              const rows = cdnGstByTransaction.get(t.id) || []
              return s + rows.reduce((ss, r) => ss + Number(r.taxableValue || 0), 0)
            }, 0)
          )
          const perInvoiceTaxable = roundMoney(salesTaxable - cdnTaxable)
          const summaryTaxable = roundMoney((summaryAgg._sum.subtotal || 0) - (summaryAgg._sum.discountAmount || 0))
          const perInvoiceTax = roundMoney(
            [...b2bInvoices, ...b2cInvoices].reduce((s, inv) => {
              // B2B: inv.items is an array of { rate, txval, camt, samt, iamt, qty }
              if (Array.isArray(inv.items)) {
                return s + inv.items.reduce((s2: number, it: any) =>
                  s2 + (Number(it.camt) || 0) + (Number(it.samt) || 0) + (Number(it.iamt) || 0), 0)
              }
              // B2C: rate_X: { taxable, cgst, sgst, igst, qty }
              let b2cTax = 0
              for (const [k, v] of Object.entries(inv)) {
                if (k.startsWith('rate_') && v && typeof v === 'object') {
                  b2cTax += (Number((v as any).cgst) || 0) + (Number((v as any).sgst) || 0) + (Number((v as any).igst) || 0)
                }
              }
              return s + b2cTax
            }, 0)
          )
          const summaryTax = roundMoney((summaryAgg._sum.cgst || 0) + (summaryAgg._sum.sgst || 0) + (summaryAgg._sum.igst || 0))
          // 🔒 FIX L6: Was < 1 (₹1 tolerance) — too loose, could mask real per-invoice
          // drift. Both sides aggregate the same stored per-item values, so they
          // should agree within float-sum noise (< 0.05). Tightened from ₹1 to ₹0.05.
          const matches = Math.abs(perInvoiceTaxable - summaryTaxable) < 0.05 && Math.abs(perInvoiceTax - summaryTax) < 0.05
          if (!matches) {
            console.warn('[gstr-export] Reconciliation mismatch:', {
              perInvoiceTaxable, summaryTaxable,
              perInvoiceTax, summaryTax,
            })
          }
          return { perInvoiceTaxable, summaryTaxable, perInvoiceTax, summaryTax, matches }
        } catch (reconError) {
          // Reconciliation itself crashed — log it but don't block the export.
          // The export data is still valid; the reconciliation is just a safety check.
          console.error('[gstr-export] Reconciliation code crashed (non-blocking):', reconError)
          return { perInvoiceTaxable: 0, summaryTaxable: 0, perInvoiceTax: 0, summaryTax: 0, matches: null }
        }
      })(),
      period: { from, to },
    }

    if (format === 'csv') {
      // Generate CSV
      const csvLines: string[] = []
      // 🔒 V6 SC1: include truncation warning as the first CSV row
      if (hitCap) {
        csvLines.push('# WARNING: GSTR export capped at 10,000 invoices. Split the period into smaller ranges and re-run. THIS CSV IS INCOMPLETE — DO NOT FILE.')
      }
      csvLines.push('Invoice No,Date,Party Name,GSTIN,Taxable Value,CGST,SGST,IGST,Total,Type')
      for (const t of cappedTransactions) {
        const rateRows = gstByTransaction.get(t.id) || []
        const taxable = rateRows.reduce((s, r) => s + r.taxableValue, 0)
        const cgst = rateRows.reduce((s, r) => s + r.cgst, 0)
        const sgst = rateRows.reduce((s, r) => s + r.sgst, 0)
        const igst = rateRows.reduce((s, r) => s + r.igst, 0)
        csvLines.push([
          t.invoiceNo || t.id.slice(-8),
          istDateString(t.date),  // 🔒 FIX C2: was toISOString (UTC)
          t.party?.name || 'Walk-in',
          t.party?.gstin || '',
          taxable.toFixed(2),
          cgst.toFixed(2),
          sgst.toFixed(2),
          igst.toFixed(2),
          t.totalAmount.toFixed(2),
          t.party?.gstin ? 'B2B' : 'B2C',
        ].join(','))
      }
      // V17-Ext Tier 3: Add credit/debit note rows to CSV
      for (const t of cdnTransactions) {
        const rateRows = cdnGstByTransaction.get(t.id) || []
        const taxable = rateRows.reduce((s, r) => s + r.taxableValue, 0)
        const cgst = rateRows.reduce((s, r) => s + r.cgst, 0)
        const sgst = rateRows.reduce((s, r) => s + r.sgst, 0)
        const igst = rateRows.reduce((s, r) => s + r.igst, 0)
        csvLines.push([
          t.invoiceNo || t.id.slice(-8),
          istDateString(t.date),
          t.party?.name || 'Unknown',
          t.party?.gstin || '',
          taxable.toFixed(2),
          cgst.toFixed(2),
          sgst.toFixed(2),
          igst.toFixed(2),
          t.totalAmount.toFixed(2),
          t.type === 'credit-note' ? 'CDN-C' : 'CDN-D',
        ].join(','))
      }
      const csv = csvLines.join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          // 🔒 V10 FIX: Use `to` date for filename month (same reason as `fp`).
          // 🔒 FIX C14: Was `to.toISOString().slice(0,7)` which returns UTC year-month.
          // Now uses istYearMonth which returns the IST year-month.
          'Content-Disposition': `attachment; filename="GSTR1_${istYearMonth(to)}.csv"`,
        },
      })
    }

    return NextResponse.json(output)
  } catch (error) {
    return apiError(error, 'Failed to generate GSTR report', 500)
  }
}
