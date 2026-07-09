import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney } from '@/lib/money'
import { istDayStart } from '@/lib/timezone'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/day-summary
 *
 * 🔒 V17-Ext §5.4: Daily "Close the Drawer" summary.
 *
 * Returns today's cash flow breakdown so the shopkeeper can reconcile their
 * cash drawer at end of day. All times are IST-based (the shopkeeper's
 * "today" starts at 12 AM IST, not UTC).
 *
 * Returns:
 *   - Sales by payment mode (cash, upi, card, bank, credit)
 *   - Purchases by payment mode
 *   - Expenses + other income
 *   - Udhaar collected (payments received) + udhaar paid (payments paid)
 *   - Expected cash = cashSales + income + udhaarCollected - cashPurchases - expenses - udhaarPaid
 *   - Transaction count
 *
 * The UI shows this as a summary card. The shopkeeper can optionally enter
 * their actual cash count, and the app shows the variance (expected - actual).
 */
export async function GET() {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    if (!canAccessModule(authCtx.role, authCtx.permissions, 'dashboard')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // IST-based "today" boundary
    const now = new Date()
    const startOfToday = istDayStart(now)

    // Query all of today's transactions grouped by type + payment mode.
    // Uses a single groupBy query (1 DB round-trip) instead of N separate
    // aggregate queries. O(1) memory — returns at most ~10 rows (one per
    // type × paymentMode combination).
    const txByTypeMode = await db.transaction.groupBy({
      by: ['type', 'paymentMode'],
      where: {
        userId,
        deletedAt: null,
        date: { gte: startOfToday, lte: now },
      },
      _sum: { totalAmount: true },
      _count: { _all: true },
    })

    // Also get today's payments (udhaar collections + payments to suppliers)
    const paymentsByType = await db.payment.groupBy({
      by: ['type'],
      where: {
        userId,
        deletedAt: null,
        date: { gte: startOfToday, lte: now },
      },
      _sum: { amount: true },
      _count: { _all: true },
    })

    // Build the summary from the grouped results
    let cashSales = 0, upiSales = 0, cardSales = 0, bankSales = 0, creditSales = 0
    let cashPurchases = 0, upiPurchases = 0, cardPurchases = 0, bankPurchases = 0, creditPurchases = 0
    let expenses = 0, income = 0
    let totalSales = 0, totalPurchases = 0
    let transactionCount = 0

    for (const row of txByTypeMode) {
      const amount = roundMoney(row._sum.totalAmount || 0)
      const count = row._count._all
      transactionCount += count

      if (row.type === 'sale') {
        totalSales = roundMoney(totalSales + amount)
        switch (row.paymentMode) {
          case 'cash': cashSales = roundMoney(cashSales + amount); break
          case 'upi': upiSales = roundMoney(upiSales + amount); break
          case 'card': cardSales = roundMoney(cardSales + amount); break
          case 'bank': bankSales = roundMoney(bankSales + amount); break
          case 'credit': creditSales = roundMoney(creditSales + amount); break
        }
      } else if (row.type === 'purchase') {
        totalPurchases = roundMoney(totalPurchases + amount)
        switch (row.paymentMode) {
          case 'cash': cashPurchases = roundMoney(cashPurchases + amount); break
          case 'upi': upiPurchases = roundMoney(upiPurchases + amount); break
          case 'card': cardPurchases = roundMoney(cardPurchases + amount); break
          case 'bank': bankPurchases = roundMoney(bankPurchases + amount); break
          case 'credit': creditPurchases = roundMoney(creditPurchases + amount); break
        }
      } else if (row.type === 'expense') {
        expenses = roundMoney(expenses + amount)
      } else if (row.type === 'income') {
        income = roundMoney(income + amount)
      }
    }

    // Payments (udhaar settlements)
    let udhaarCollected = 0, udhaarPaid = 0
    for (const row of paymentsByType) {
      const amount = roundMoney(row._sum.amount || 0)
      if (row.type === 'received') udhaarCollected = amount
      else if (row.type === 'paid') udhaarPaid = amount
    }

    // Expected cash in drawer:
    //   + cash sales (money in)
    //   + other income (money in)
    //   + udhaar collected (money in — customer paid us in cash/UPI/etc.)
    //   - cash purchases (money out)
    //   - expenses (money out)
    //   - udhaar paid (money out — we paid supplier)
    //
    // Note: UPI/card/bank sales are NOT in the cash drawer — they went to
    // the bank. Only cash mode sales are physical money in the drawer.
    // Similarly, only cash-mode purchases and expenses are physical money out.
    // Udhaar payments have a `mode` field (cash/upi/card/bank) but for the
    // "expected cash" calculation we treat all received payments as cash in
    // unless the user wants finer granularity (future enhancement).
    // For simplicity: expected cash = cashSales + income + udhaarCollected
    //                                - cashPurchases - expenses - udhaarPaid
    const expectedCash = roundMoney(
      cashSales + income + udhaarCollected - cashPurchases - expenses - udhaarPaid
    )

    return NextResponse.json({
      date: startOfToday.toISOString().slice(0, 10), // YYYY-MM-DD (IST)
      cashSales,
      upiSales,
      cardSales,
      bankSales,
      creditSales,
      totalSales,
      cashPurchases,
      upiPurchases,
      cardPurchases,
      bankPurchases,
      creditPurchases,
      totalPurchases,
      expenses,
      income,
      udhaarCollected,
      udhaarPaid,
      expectedCash,
      transactionCount,
    })
  } catch (err) {
    return apiError(err, 'Failed to load day summary', 500)
  }
}
