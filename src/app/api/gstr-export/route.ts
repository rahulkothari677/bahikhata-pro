import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { roundMoney, calculateGst, splitGst } from '@/lib/money'
import { activeTransactionWhere } from '@/lib/query-helpers'

// ⏱️ Vercel serverless timeout — GSTR export aggregates all transactions
// in a period and generates CSV/JSON. Can take several seconds at scale.
// (Audit fix Phase 1.3)
export const maxDuration = 60

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

    const [transactions, setting] = await Promise.all([
      db.transaction.findMany({
        where: activeTransactionWhere(userId, {
          type: 'sale',
          date: { gte: from, lte: to },
        }),
        include: { items: true, party: true },
        orderBy: { date: 'asc' },
      }),
      db.setting.findUnique({ where: { userId } }),
    ])

    // Build GSTR-1 B2B section (invoices with GSTIN)
    const b2bInvoices: any[] = []
    const b2cInvoices: any[] = []

    transactions.forEach(t => {
      if (!t.party?.gstin) {
        // B2C
        const itemsByRate: any = {}
        t.items.forEach(item => {
          const rate = item.gstRate
          if (!itemsByRate[rate]) {
            itemsByRate[rate] = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, quantity: 0 }
          }
          // 💰 MONEY (Audit fix Phase 8): roundMoney to prevent drift in GST filings
          const taxable = roundMoney(item.quantity * item.unitPrice)
          itemsByRate[rate].taxableValue = roundMoney(itemsByRate[rate].taxableValue + taxable)
          const gst = calculateGst(taxable, rate)
          if (t.isInterState) {
            itemsByRate[rate].igst = roundMoney(itemsByRate[rate].igst + gst)
          } else {
            const { cgst, sgst } = splitGst(gst)
            itemsByRate[rate].cgst = roundMoney(itemsByRate[rate].cgst + cgst)
            itemsByRate[rate].sgst = roundMoney(itemsByRate[rate].sgst + sgst)
          }
          itemsByRate[rate].quantity += item.quantity
        })

        b2cInvoices.push({
          inum: t.invoiceNo || t.id.slice(-8),
          idt: t.date.toISOString().slice(0, 10),
          taxablevalue: Object.values(itemsByRate).reduce((s: number, v: any) => s + v.taxableValue, 0),
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
        const itemsByRate: any = {}
        t.items.forEach(item => {
          const rate = item.gstRate
          if (!itemsByRate[rate]) {
            itemsByRate[rate] = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, quantity: 0 }
          }
          // 💰 MONEY (Audit fix Phase 8): roundMoney to prevent drift in GST filings
          const taxable = roundMoney(item.quantity * item.unitPrice)
          itemsByRate[rate].taxableValue = roundMoney(itemsByRate[rate].taxableValue + taxable)
          const gst = calculateGst(taxable, rate)
          if (t.isInterState) {
            itemsByRate[rate].igst = roundMoney(itemsByRate[rate].igst + gst)
          } else {
            const { cgst, sgst } = splitGst(gst)
            itemsByRate[rate].cgst = roundMoney(itemsByRate[rate].cgst + cgst)
            itemsByRate[rate].sgst = roundMoney(itemsByRate[rate].sgst + sgst)
          }
          itemsByRate[rate].quantity += item.quantity
        })

        b2bInvoices.push({
          inum: t.invoiceNo || t.id.slice(-8),
          itype: 'R', // Regular
          ctin: t.party.gstin,
          in_date: t.date.toISOString().slice(0, 10),
          taxablevalue: Object.values(itemsByRate).reduce((s: number, v: any) => s + v.taxableValue, 0),
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
    })

    const output = {
      gstin: setting?.gstin || '',
      fp: `${String(from.getMonth() + 1).padStart(2, '0')}${from.getFullYear()}`,
      gt: 0,
      cur_gt: 0,
      b2b: b2bInvoices,
      b2cl: b2cInvoices.filter(i => i.total >= 100000), // B2C Large
      b2cs: b2cInvoices.filter(i => i.total < 100000), // B2C Small
      summary: {
        total_invoices: transactions.length,
        // 💰 MONEY (Audit fix Phase 8): roundMoney on all summary totals
        total_taxable: roundMoney(transactions.reduce((s, t) => s + t.subtotal - t.discountAmount, 0)),
        total_cgst: roundMoney(transactions.reduce((s, t) => s + t.cgst, 0)),
        total_sgst: roundMoney(transactions.reduce((s, t) => s + t.sgst, 0)),
        total_igst: roundMoney(transactions.reduce((s, t) => s + t.igst, 0)),
        total_tax: roundMoney(transactions.reduce((s, t) => s + t.cgst + t.sgst + t.igst, 0)),
        total_amount: roundMoney(transactions.reduce((s, t) => s + t.totalAmount, 0)),
      },
      period: { from, to },
    }

    if (format === 'csv') {
      // Generate CSV
      const csvLines: string[] = []
      csvLines.push('Invoice No,Date,Party Name,GSTIN,Taxable Value,CGST,SGST,IGST,Total,Type')
      transactions.forEach(t => {
        csvLines.push([
          t.invoiceNo || t.id.slice(-8),
          t.date.toISOString().slice(0, 10),
          t.party?.name || 'Walk-in',
          t.party?.gstin || '',
          (t.subtotal - t.discountAmount).toFixed(2),
          t.cgst.toFixed(2),
          t.sgst.toFixed(2),
          t.igst.toFixed(2),
          t.totalAmount.toFixed(2),
          t.party?.gstin ? 'B2B' : 'B2C',
        ].join(','))
      })
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
