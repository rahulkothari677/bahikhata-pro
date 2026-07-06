import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { roundMoney } from '@/lib/money'
import { activeTransactionWhere } from '@/lib/query-helpers'

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
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')
    const format = searchParams.get('format') || 'json' // json or csv

    const now = new Date()
    const from = fromStr ? new Date(fromStr) : new Date(now.getFullYear(), now.getMonth(), 1)
    const to = toStr ? new Date(toStr) : now

    // 🔒 V7 M5: GSTR-1 is a MONTHLY return. The `fp` (filing period) field
    // is derived from `from` only, so a multi-month range produces a
    // mislabeled return. Was: silently exported with `fp` = first month.
    // Now: reject multi-month ranges with a clear 400 error so the user
    // selects a single month (GSTR-1's required granularity).
    const monthDiff =
      (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
    // Allow same month (monthDiff === 0) and the natural "first of month to
    // end of month" case. monthDiff === 0 means same month. We also allow
    // monthDiff === 1 if `to` is the 1st of the next month (common pattern:
    // from = July 1, to = Aug 1, which is effectively all of July).
    const isSingleMonth = monthDiff === 0 || (monthDiff === 1 && to.getDate() === 1)
    if (!isSingleMonth) {
      return NextResponse.json({
        error: 'GSTR-1 export requires a single-month period',
        message: `GSTR-1 is a monthly return. The selected range spans ${monthDiff + 1} months (${from.toLocaleDateString('en-IN')} to ${to.toLocaleDateString('en-IN')}). Please select a single month and try again.`,
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
          idt: t.date.toISOString().slice(0, 10),
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
          in_date: t.date.toISOString().slice(0, 10),
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

    // Summary totals via SQL aggregate (O(1) memory, no row iteration)
    const summaryAgg = await db.transaction.aggregate({
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
    })

    const output = {
      gstin: setting?.gstin || '',
      fp: `${String(from.getMonth() + 1).padStart(2, '0')}${from.getFullYear()}`,
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
      reconciliation: (() => {
        const perInvoiceTaxable = roundMoney(
          [...b2bInvoices, ...b2cInvoices].reduce((s, inv) => s + (inv.taxablevalue || 0), 0)
        )
        const summaryTaxable = roundMoney((summaryAgg._sum.subtotal || 0) - (summaryAgg._sum.discountAmount || 0))
        const perInvoiceTax = roundMoney(
          [...b2bInvoices, ...b2cInvoices].reduce((s, inv) => {
            // inv.items is for B2B, itemsByRate spread is for B2C
            if (inv.items) {
              return s + inv.items.reduce((s2: number, it: any) => s2 + (it.camt || 0) + (it.samt || 0) + (it.iamt || 0), 0)
            }
            // B2C: rate_X.camt/samt/iamt
            return s + Object.entries(inv)
              .filter(([k]) => k.startsWith('rate_'))
              .reduce((s2: number, [, v]: [string, any]) => s2 + (v.cgst || 0) + (v.sgst || 0) + (v.igst || 0), 0)
          }, 0)
        )
        const summaryTax = roundMoney((summaryAgg._sum.cgst || 0) + (summaryAgg._sum.sgst || 0) + (summaryAgg._sum.igst || 0))
        const matches = Math.abs(perInvoiceTaxable - summaryTaxable) < 1 && Math.abs(perInvoiceTax - summaryTax) < 1
        if (!matches) {
          console.warn('[gstr-export] Reconciliation mismatch:', {
            perInvoiceTaxable, summaryTaxable,
            perInvoiceTax, summaryTax,
          })
        }
        return { perInvoiceTaxable, summaryTaxable, perInvoiceTax, summaryTax, matches }
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
          t.date.toISOString().slice(0, 10),
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
      const csv = csvLines.join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="GSTR1_${from.toISOString().slice(0,7)}.csv"`,
        },
      })
    }

    return NextResponse.json(output)
  } catch (error) {
    console.error('GSTR export error:', error)
    return NextResponse.json({ error: 'Failed to generate GSTR report' }, { status: 500 })
  }
}
