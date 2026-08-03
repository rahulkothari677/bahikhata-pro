import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { roundMoney } from '@/lib/money'
import { istDayStart, istDateString } from '@/lib/timezone'
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
      // 🔒 DRAWER DOUBLE-COUNT FIX (2026-08-03, reported by Rahul).
      //
      // `totalAmount` is the INVOICE value. `paidAmount` is what actually
      // changed hands at billing. Summing totalAmount into the cash drawer
      // treated every invoice as if it had been paid in full on the spot, so
      // anything collected later was counted TWICE — once inside the invoice
      // total and again as the Settle payment.
      //
      // Real case: a ₹600 cash sale with ₹200 paid at billing and ₹400
      // settled later showed ₹600 + ₹400 = ₹1,000 expected in the drawer,
      // when only ₹600 had physically arrived.
      //
      // Both are summed: totalAmount still drives the REVENUE lines (a sale
      // is revenue when made, not when collected), paidAmount drives the CASH
      // lines. They answer different questions and must not be conflated.
      _sum: { totalAmount: true, paidAmount: true },
      _count: { _all: true },
    })

    // Today's payments (udhaar collections + payments to suppliers).
    //
    // 🔒 Grouped by mode as well as type. The drawer previously added EVERY
    // received payment to expected cash regardless of how it arrived — the
    // old comment called finer granularity a "future enhancement", but a
    // customer settling ₹400 by UPI never touches the cash drawer, so it made
    // the count come up short by exactly that amount every time.
    const paymentsByTypeMode = await db.payment.groupBy({
      by: ['type', 'mode'],
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
    // 🔒 V17 Audit Phase 1 P0.4: Track credit-note/debit-note refunds separately
    // so the DayEndSummary UI can show them as distinct line items (not folded
    // into the net sales/purchases totals).
    let creditNoteRefunds = 0  // total credit-note amounts (refunds issued to customers)
    let debitNoteRefunds = 0   // total debit-note amounts (refunds received from suppliers)

    // 🔒 V17 Audit Phase 4: Credit notes reduce sales (customer return = refund).
    // Debit notes reduce purchases (we return to supplier = refund). Without these
    // branches, the cash drawer was inflated — a cash credit note (refund to customer)
    // wasn't subtracted from expected cash, and a cash debit note (refund from supplier)
    // wasn't added. Credit/debit note totalAmount is stored POSITIVE, so we subtract
    // for credit notes (sales reversal) and subtract for debit notes (purchase reversal).
    // 🔒 CASH accumulators, kept strictly apart from the REVENUE ones above.
    //   revenue  = invoice value        (totalAmount, every payment mode)
    //   cash     = money in the drawer  (paidAmount,  cash mode only)
    // A sale is revenue the moment it is made; it is cash only when collected.
    let cashInFromSales = 0     // received at billing, cash mode
    let cashOutForPurchases = 0 // paid at billing, cash mode
    let cashIncome = 0
    let cashExpenses = 0
    let cashRefundsOut = 0      // credit notes actually refunded in cash
    let cashRefundsIn = 0       // debit notes actually refunded to us in cash
    // Received at billing across ALL modes. Only used to derive how much
    // credit was extended today (totalSales − this), so it must be a
    // paidAmount figure like the term it is subtracted from.
    let salesReceivedAtBilling = 0

    for (const row of txByTypeMode) {
      const amount = roundMoney(row._sum.totalAmount || 0)
      // What actually changed hands at billing. For income/expense
      // resolveFinalPaid() defaults this to the total (they settle
      // immediately); for credit/debit notes it defaults to 0, so an unrefunded
      // note correctly moves no cash.
      const received = roundMoney(row._sum.paidAmount || 0)
      const isCash = row.paymentMode === 'cash'
      const count = row._count._all
      transactionCount += count

      if (row.type === 'sale') {
        salesReceivedAtBilling = roundMoney(salesReceivedAtBilling + received)
      }

      if (isCash) {
        if (row.type === 'sale') cashInFromSales = roundMoney(cashInFromSales + received)
        else if (row.type === 'purchase') cashOutForPurchases = roundMoney(cashOutForPurchases + received)
        else if (row.type === 'income') cashIncome = roundMoney(cashIncome + received)
        else if (row.type === 'expense') cashExpenses = roundMoney(cashExpenses + received)
        else if (row.type === 'credit-note') cashRefundsOut = roundMoney(cashRefundsOut + received)
        else if (row.type === 'debit-note') cashRefundsIn = roundMoney(cashRefundsIn + received)
      }

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
      } else if (row.type === 'credit-note') {
        // 🔒 V17 Audit Phase 4: Credit note = sales return. Reduces totalSales.
        // The refund (cash/UPI/etc.) goes OUT, so it reduces that payment mode.
        // 🔒 V17 Audit Phase 1 P0.4: Also track total refund amount for the UI.
        creditNoteRefunds = roundMoney(creditNoteRefunds + amount)
        totalSales = roundMoney(totalSales - amount)
        switch (row.paymentMode) {
          case 'cash': cashSales = roundMoney(cashSales - amount); break
          case 'upi': upiSales = roundMoney(upiSales - amount); break
          case 'card': cardSales = roundMoney(cardSales - amount); break
          case 'bank': bankSales = roundMoney(bankSales - amount); break
          case 'credit': creditSales = roundMoney(creditSales - amount); break
        }
      } else if (row.type === 'debit-note') {
        // 🔒 V17 Audit Phase 4: Debit note = purchase return. Reduces totalPurchases.
        // The refund (cash/UPI/etc.) comes IN, so it reduces that purchase payment mode.
        // 🔒 V17 Audit Phase 1 P0.4: Also track total refund amount for the UI.
        debitNoteRefunds = roundMoney(debitNoteRefunds + amount)
        totalPurchases = roundMoney(totalPurchases - amount)
        switch (row.paymentMode) {
          case 'cash': cashPurchases = roundMoney(cashPurchases - amount); break
          case 'upi': upiPurchases = roundMoney(upiPurchases - amount); break
          case 'card': cardPurchases = roundMoney(cardPurchases - amount); break
          case 'bank': bankPurchases = roundMoney(bankPurchases - amount); break
          case 'credit': creditPurchases = roundMoney(creditPurchases - amount); break
        }
      }
    }

    // Payments (udhaar settlements).
    // Totals across all modes drive the DISPLAY; the cash-mode subtotals drive
    // the drawer. A ₹400 settlement by UPI is real money collected, but it is
    // not in the drawer.
    let udhaarCollected = 0, udhaarPaid = 0
    let udhaarCollectedCash = 0, udhaarPaidCash = 0
    for (const row of paymentsByTypeMode) {
      const amount = roundMoney(row._sum.amount || 0)
      const isCash = row.mode === 'cash'
      if (row.type === 'received') {
        udhaarCollected = roundMoney(udhaarCollected + amount)
        if (isCash) udhaarCollectedCash = roundMoney(udhaarCollectedCash + amount)
      } else if (row.type === 'paid') {
        udhaarPaid = roundMoney(udhaarPaid + amount)
        if (isCash) udhaarPaidCash = roundMoney(udhaarPaidCash + amount)
      }
    }

    /*
     * Expected cash in the drawer — PHYSICAL cash only.
     *
     * Every term is (a) money that actually changed hands, not invoice value,
     * and (b) cash mode, not UPI/card/bank.
     *
     *   + cash received at billing        (sales, paidAmount)
     *   + cash income
     *   + udhaar collected in cash        (Settle payments, mode = cash)
     *   + refunds received from suppliers in cash   (debit notes)
     *   − cash paid at billing            (purchases, paidAmount)
     *   − cash expenses
     *   − udhaar paid in cash
     *   − refunds given to customers in cash        (credit notes)
     *
     * Worked example — the case that exposed the bug:
     *   ₹600 cash sale, ₹200 paid at billing, ₹400 settled later in cash
     *     cashInFromSales     = 200   (was 600: the whole invoice)
     *     udhaarCollectedCash = 400
     *     expected            = 600   (was 1,000)
     */
    const expectedCash = roundMoney(
      cashInFromSales + cashIncome + udhaarCollectedCash + cashRefundsIn
      - cashOutForPurchases - cashExpenses - udhaarPaidCash - cashRefundsOut
    )

    return NextResponse.json({
      // 🔒 TZ FIX (2026-07-21): the comment claimed "(IST)" but toISOString()
      // returns the UTC date. `startOfToday` is istDayStart(now) — the UTC
      // INSTANT of IST midnight (18:30 the previous day in UTC) — so this
      // stamped the Day-End Summary with YESTERDAY's date, every single day.
      // The shopkeeper closes the drawer at night and the summary is dated a
      // day earlier. istDateString() converts the instant to IST parts.
      date: istDateString(startOfToday), // YYYY-MM-DD in IST
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
      creditNoteRefunds,  // 🔒 V17 Audit Phase 1 P0.4: for separate UI line item
      debitNoteRefunds,   // 🔒 V17 Audit Phase 1 P0.4: for separate UI line item
      udhaarCollected,
      udhaarPaid,
      expectedCash,
      transactionCount,

      // 🔒 The drawer's working, term by term, so the shopkeeper can check the
      // figure instead of trusting it. Without this the old ₹1,000 looked
      // exactly as authoritative as the correct ₹600.
      cashInFromSales,        // received at billing today, cash mode
      cashOutForPurchases,
      cashIncome,
      cashExpenses,
      udhaarCollectedCash,    // subset of udhaarCollected that was cash
      udhaarPaidCash,
      cashRefundsOut,
      cashRefundsIn,
      salesReceivedAtBilling,
      // Credit extended today = invoiced but not yet received. Shown so the
      // gap between "Total Sales" and what arrived is explained on screen
      // rather than looking like an error. Both terms are paidAmount-based.
      salesOnCredit: roundMoney(totalSales - salesReceivedAtBilling),
    })
  } catch (err) {
    return apiError(err, 'Failed to load day summary', 500)
  }
}
