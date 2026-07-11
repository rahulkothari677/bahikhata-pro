/**
 * 🔒 V17 Audit Phase 8 — Balance As Of Any Date.
 *
 * Computes a party's balance as of a historical date. CAs live in this —
 * they need to answer "what did Rahul owe us on June 30?" for audit,
 * reconciliation, and dispute resolution.
 *
 * The computation is the SAME formula as computePartyBalance(), but with
 * a date filter: only transactions and payments dated ON OR BEFORE the
 * target date are included.
 *
 * Formula:
 *   balance = openingBalance
 *     + Σ(sale.totalAmount - sale.paidAmount) where date <= asOfDate
 *     - Σ(purchase.totalAmount - purchase.paidAmount) where date <= asOfDate
 *     - Σ(credit-note.totalAmount - credit-note.paidAmount) where date <= asOfDate
 *     + Σ(debit-note.totalAmount - debit-note.paidAmount) where date <= asOfDate
 *     - Σ(payment.amount WHERE type='received' AND date <= asOfDate)
 *     + Σ(payment.amount WHERE type='paid' AND date <= asOfDate)
 *
 * Pure function — takes pre-fetched data + a date, returns the balance.
 * The API route fetches the data and passes it here.
 */

import { roundMoney } from '@/lib/money'

// ─── Types ────────────────────────────────────────────────────────────────

export interface BalanceAsOfTransaction {
  type: string          // 'sale' | 'purchase' | 'credit-note' | 'debit-note' | 'income' | 'expense'
  date: Date
  totalAmount: number
  paidAmount: number
  deletedAt: Date | null
}

export interface BalanceAsOfPayment {
  type: string          // 'received' | 'paid'
  date: Date
  amount: number
  deletedAt: Date | null
}

export interface BalanceAsOfResult {
  balance: number
  asOfDate: Date
  // Breakdown for transparency
  openingBalance: number
  salesOutstanding: number
  purchaseOutstanding: number
  creditNoteOutstanding: number
  debitNoteOutstanding: number
  paymentsReceived: number
  paymentsPaid: number
  // Transaction counts up to this date
  saleCount: number
  purchaseCount: number
  creditNoteCount: number
  debitNoteCount: number
  paymentCount: number
}

// ─── Builder ──────────────────────────────────────────────────────────────

/**
 * Compute a party's balance as of a specific date.
 *
 * Only includes non-deleted transactions and payments dated ON OR BEFORE
 * the asOfDate (inclusive — transactions ON the date are included).
 *
 * @param openingBalance - the party's opening balance (always included —
 *   it's a starting point, not a date-filtered entry)
 * @param transactions - ALL transactions for this party (the function filters by date)
 * @param payments - ALL payments for this party (the function filters by date)
 * @param asOfDate - the target date (inclusive: date <= asOfDate)
 * @returns the balance + breakdown as of that date
 */
export function computeBalanceAsOf(
  openingBalance: number,
  transactions: BalanceAsOfTransaction[],
  payments: BalanceAsOfPayment[],
  asOfDate: Date,
): BalanceAsOfResult {
  // Filter: only non-deleted + dated ON OR BEFORE asOfDate
  // Null-safe: if transactions/payments are null/undefined, treat as empty
  // 🔒 DATE BOUNDARY: date <= asOfDate is INCLUSIVE. A transaction dated
  // June 30 at 23:59:59 IS included when asOfDate = June 30.
  const asOfMs = asOfDate.getTime()
  const safeTxns = transactions || []
  const safePayments = payments || []
  const relevantTxns = safeTxns.filter(t =>
    t.deletedAt === null && t.date.getTime() <= asOfMs
  )
  const relevantPayments = safePayments.filter(p =>
    p.deletedAt === null && p.date.getTime() <= asOfMs
  )

  // Aggregate by type
  let totalSales = 0
  let totalSalesPaid = 0
  let totalPurchases = 0
  let totalPurchasesPaid = 0
  let totalCreditNotes = 0
  let totalCreditNotesPaid = 0
  let totalDebitNotes = 0
  let totalDebitNotesPaid = 0
  let saleCount = 0
  let purchaseCount = 0
  let creditNoteCount = 0
  let debitNoteCount = 0

  for (const t of relevantTxns) {
    if (t.type === 'sale') {
      totalSales = roundMoney(totalSales + t.totalAmount)
      totalSalesPaid = roundMoney(totalSalesPaid + t.paidAmount)
      saleCount++
    } else if (t.type === 'purchase') {
      totalPurchases = roundMoney(totalPurchases + t.totalAmount)
      totalPurchasesPaid = roundMoney(totalPurchasesPaid + t.paidAmount)
      purchaseCount++
    } else if (t.type === 'credit-note') {
      totalCreditNotes = roundMoney(totalCreditNotes + t.totalAmount)
      totalCreditNotesPaid = roundMoney(totalCreditNotesPaid + t.paidAmount)
      creditNoteCount++
    } else if (t.type === 'debit-note') {
      totalDebitNotes = roundMoney(totalDebitNotes + t.totalAmount)
      totalDebitNotesPaid = roundMoney(totalDebitNotesPaid + t.paidAmount)
      debitNoteCount++
    }
    // income/expense don't affect party balance
  }

  let paymentsReceived = 0
  let paymentsPaid = 0
  let paymentCount = 0

  for (const p of relevantPayments) {
    if (p.type === 'received') {
      paymentsReceived = roundMoney(paymentsReceived + p.amount)
      paymentCount++
    } else if (p.type === 'paid') {
      paymentsPaid = roundMoney(paymentsPaid + p.amount)
      paymentCount++
    }
  }

  // Outstanding amounts
  const salesOutstanding = roundMoney(totalSales - totalSalesPaid)
  const purchaseOutstanding = roundMoney(totalPurchases - totalPurchasesPaid)
  const creditNoteOutstanding = roundMoney(totalCreditNotes - totalCreditNotesPaid)
  const debitNoteOutstanding = roundMoney(totalDebitNotes - totalDebitNotesPaid)

  // Balance = same formula as computePartyBalance()
  const balance = roundMoney(
    openingBalance
    + salesOutstanding
    - purchaseOutstanding
    - creditNoteOutstanding   // reduces receivable
    + debitNoteOutstanding    // reduces payable
    - paymentsReceived
    + paymentsPaid
  )

  return {
    balance,
    asOfDate,
    openingBalance,
    salesOutstanding,
    purchaseOutstanding,
    creditNoteOutstanding,
    debitNoteOutstanding,
    paymentsReceived,
    paymentsPaid,
    saleCount,
    purchaseCount,
    creditNoteCount,
    debitNoteCount,
    paymentCount,
  }
}
