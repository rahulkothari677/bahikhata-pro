import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { roundMoney } from '@/lib/money'
import { activeTransactionWhere } from '@/lib/query-helpers'

// ⏱️ Vercel serverless timeout — reports can aggregate thousands of
// transactions and generate large responses. Set explicit maxDuration.
// (Audit fix Phase 1.3)
export const maxDuration = 60

// GET /api/reports?type=pl|gst|stock|party&from=&to=
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') || 'pl'
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')

    const now = new Date()
    const from = fromStr ? new Date(fromStr) : new Date(now.getFullYear(), now.getMonth(), 1)
    const to = toStr ? new Date(toStr) : now

    const transactions = await db.transaction.findMany({
      where: activeTransactionWhere(userId, { date: { gte: from, lte: to } }),
      include: { items: true, party: true },
      orderBy: { date: 'asc' },
      // 🔒 AUDIT FIX V4 P3: Defensive cap to prevent OOM on Vercel serverless.
      // The list-endpoint 200-cap doesn't apply here — reports use `findMany`
      // with no `take`, so a busy shop after a year could load 10K+ rows into
      // a single serverless function → timeout / OOM. 5,000 transactions in
      // a single period is a sane upper bound (a kirana shop doing 100 sales/
      // day for 50 days = 5,000). Above this we'd return a 413 with a clear
      // message asking the user to narrow the date range.
      // Roadmap: replace with SQL aggregate queries (db.transaction.groupBy /
      // $queryRaw) so we never load rows into JS at all — same pattern as
      // /api/dashboard/route.ts. Until then, the cap prevents the worst case.
      take: 5000,
    })

    // If we hit the cap exactly, warn the client (but still return data —
    // the report is approximate, not missing). User can narrow the range.
    const hitCap = transactions.length === 5000

    const products = await db.product.findMany({ where: { userId } })

    if (type === 'pl') {
      // Profit & Loss report
      const sales = transactions.filter(t => t.type === 'sale')
      const purchases = transactions.filter(t => t.type === 'purchase')
      const incomes = transactions.filter(t => t.type === 'income')
      const expenses = transactions.filter(t => t.type === 'expense')

      // 💰 MONEY (Audit fix Phase 8): roundMoney on all P&L totals
      const grossProfit = roundMoney(sales.reduce((s, t) => s + t.grossProfit, 0))
      const totalRevenue = roundMoney(sales.reduce((s, t) => s + t.subtotal - t.discountAmount, 0))
      const totalExpenses = roundMoney(expenses.reduce((s, t) => s + t.totalAmount, 0))
      const otherIncome = roundMoney(incomes.reduce((s, t) => s + t.totalAmount, 0))
      const netProfit = roundMoney(grossProfit + otherIncome - totalExpenses)

      const expensesByCategory = new Map<string, number>()
      expenses.forEach(e => {
        const cat = e.category || 'Other'
        expensesByCategory.set(cat, (expensesByCategory.get(cat) || 0) + e.totalAmount)
      })

      const incomeByCategory = new Map<string, number>()
      incomes.forEach(i => {
        const cat = i.category || 'Other'
        incomeByCategory.set(cat, (incomeByCategory.get(cat) || 0) + i.totalAmount)
      })

      return NextResponse.json({
        type: 'pl',
        period: { from, to },
        truncated: hitCap,  // true if we hit the 5K cap — report is approximate
        summary: {
          totalRevenue,
          grossProfit,
          totalExpenses,
          otherIncome,
          netProfit,
          profitMargin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0,
        },
        expensesByCategory: Array.from(expensesByCategory.entries()).map(([name, value]) => ({ name, value })),
        incomeByCategory: Array.from(incomeByCategory.entries()).map(([name, value]) => ({ name, value })),
        salesCount: sales.length,
        purchaseTotal: purchases.reduce((s, t) => s + t.totalAmount, 0),
      })
    }

    if (type === 'gst') {
      // GST report
      const sales = transactions.filter(t => t.type === 'sale')
      const purchases = transactions.filter(t => t.type === 'purchase')

      // By GST rate slab
      // 💰 MONEY (Audit fix Phase 8): roundMoney on all GST slab calculations
      const slabMap = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number; quantity: number }>()
      sales.forEach(t => {
        t.items.forEach(item => {
          const rate = item.gstRate
          const existing = slabMap.get(rate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0, quantity: 0 }
          const taxable = roundMoney(item.quantity * item.unitPrice)
          const gst = roundMoney(taxable * rate / 100)
          existing.taxable = roundMoney(existing.taxable + taxable)
          existing.cgst = roundMoney(existing.cgst + (t.isInterState ? 0 : gst / 2))
          existing.sgst = roundMoney(existing.sgst + (t.isInterState ? 0 : gst / 2))
          existing.igst = roundMoney(existing.igst + (t.isInterState ? gst : 0))
          existing.quantity += item.quantity
          slabMap.set(rate, existing)
        })
      })

      const inputSlabMap = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>()
      purchases.forEach(t => {
        t.items.forEach(item => {
          const rate = item.gstRate
          const existing = inputSlabMap.get(rate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
          const taxable = roundMoney(item.quantity * item.unitPrice)
          const gst = roundMoney(taxable * rate / 100)
          existing.taxable = roundMoney(existing.taxable + taxable)
          existing.cgst = roundMoney(existing.cgst + (t.isInterState ? 0 : gst / 2))
          existing.sgst = roundMoney(existing.sgst + (t.isInterState ? 0 : gst / 2))
          existing.igst = roundMoney(existing.igst + (t.isInterState ? gst : 0))
          inputSlabMap.set(rate, existing)
        })
      })

      const outputTax = roundMoney(sales.reduce((s, t) => s + t.cgst + t.sgst + t.igst, 0))
      const inputTax = roundMoney(purchases.reduce((s, t) => s + t.cgst + t.sgst + t.igst, 0))

      return NextResponse.json({
        type: 'gst',
        period: { from, to },
        truncated: hitCap,  // true if we hit the 5K cap — report is approximate
        outputSales: {
          taxableValue: sales.reduce((s, t) => s + t.subtotal - t.discountAmount, 0),
          outputTax,
          bySlab: Array.from(slabMap.entries()).map(([rate, v]) => ({ rate, ...v })),
        },
        inputPurchases: {
          taxableValue: purchases.reduce((s, t) => s + t.subtotal, 0),
          inputTax,
          bySlab: Array.from(inputSlabMap.entries()).map(([rate, v]) => ({ rate, ...v })),
        },
        netGSTPayable: outputTax - inputTax,
        totalInvoices: sales.length,
        totalPurchaseBills: purchases.length,
      })
    }

    if (type === 'stock') {
      // 🔒 AUDIT FIX V4 P3 + N2 (v3): Read `currentStock` directly from the
      // Product column instead of re-deriving from ALL transactions.
      // Was: an unbounded `findMany` of every transaction with items, then a
      // JS reduce to recompute stock. That's (a) O(all items) for no reason
      // — the column is maintained atomically on every transaction write —
      // and (b) an OOM risk on Vercel serverless for shops with many txns.
      // Now: O(1) per product, no second query.
      // (Note: `products` was already fetched above with all fields, so
      // currentStock is available without an extra DB call.)
      const stockReport = products.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        hsn: p.hsn,
        unit: p.unit,
        currentStock: p.currentStock,
        purchasePrice: p.purchasePrice,
        salePrice: p.salePrice,
        mrp: p.mrp,
        gstRate: p.gstRate,
        // 💰 MONEY (Audit fix Phase 8): roundMoney on stock values
        stockValue: roundMoney(p.currentStock * p.purchasePrice),
        potentialSaleValue: roundMoney(p.currentStock * p.salePrice),
        isLowStock: p.currentStock <= p.lowStockThreshold,
      }))

      const totalStockValue = roundMoney(stockReport.reduce((s, p) => s + p.stockValue, 0))
      const totalPotentialValue = roundMoney(stockReport.reduce((s, p) => s + p.potentialSaleValue, 0))

      return NextResponse.json({
        type: 'stock',
        period: { from, to },
        truncated: hitCap,  // true if we hit the 5K cap — report is approximate
        products: stockReport.sort((a, b) => b.stockValue - a.stockValue),
        totalStockValue,
        totalPotentialValue,
        potentialProfit: totalPotentialValue - totalStockValue,
        lowStockCount: stockReport.filter(p => p.isLowStock).length,
      })
    }

    if (type === 'party') {
      // Party statement
      const partyTransactions = transactions.filter(t => t.partyId)
      const partyMap = new Map<string, { party: any; transactions: any[]; balance: number; totalSales: number; totalPurchases: number; totalPaid: number; totalReceived: number }>()

      const parties = await db.party.findMany({ where: { userId } })
      parties.forEach(p => {
        partyMap.set(p.id, {
          party: p,
          transactions: [],
          balance: p.openingBalance,
          totalSales: 0,
          totalPurchases: 0,
          totalPaid: 0,
          totalReceived: 0,
        })
      })

      partyTransactions.forEach(t => {
        const entry = partyMap.get(t.partyId!)
        if (!entry) return
        entry.transactions.push(t)
        if (t.type === 'sale') {
          entry.totalSales += t.totalAmount
          entry.balance += t.totalAmount - t.paidAmount
          entry.totalReceived += t.paidAmount
        } else if (t.type === 'purchase') {
          entry.totalPurchases += t.totalAmount
          entry.balance -= t.totalAmount - t.paidAmount
          entry.totalPaid += t.paidAmount
        }
      })

      return NextResponse.json({
        type: 'party',
        period: { from, to },
        truncated: hitCap,  // true if we hit the 5K cap — report is approximate
        parties: Array.from(partyMap.values())
          .filter(p => p.transactions.length > 0 || p.party.openingBalance !== 0)
          .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
      })
    }

    return NextResponse.json({ error: 'Invalid report type' }, { status: 400 })
  } catch (error) {
    console.error('Reports error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}
