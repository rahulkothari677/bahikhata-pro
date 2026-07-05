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
          SUM(ROUND(ti.quantity * ti."unitPrice", 2)) AS "taxableValue",
          SUM(CASE WHEN t."isInterState" THEN 0 ELSE ROUND(ti.quantity * ti."unitPrice" * ti."gstRate" / 200, 2) END) AS cgst,
          SUM(CASE WHEN t."isInterState" THEN 0 ELSE ROUND(ti.quantity * ti."unitPrice" * ti."gstRate" / 200, 2) END) AS sgst,
          SUM(CASE WHEN t."isInterState" THEN ROUND(ti.quantity * ti."unitPrice" * ti."gstRate" / 100, 2) ELSE 0 END) AS igst,
          SUM(ti.quantity) AS quantity
        FROM "TransactionItem" ti
        JOIN "Transaction" t ON ti."transactionId" = t.id
        WHERE t."userId" = ${userId}
          AND t."deletedAt" IS NULL
          AND t.type = 'sale'
          AND t.date >= ${from}
          AND t.date <= ${to}
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
      b2cl: b2cInvoices.filter(i => i.total >= 100000), // B2C Large
      b2cs: b2cInvoices.filter(i => i.total < 100000), // B2C Small
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
