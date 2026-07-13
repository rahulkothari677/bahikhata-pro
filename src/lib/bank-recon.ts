/**
 * 🔒 V17 Audit Phase 6 — Bank Reconciliation library.
 *
 * Parses bank statement CSVs and auto-matches bank transactions against
 * recorded payments (cash/UPI/card/bank mode). Pure functions — no DB,
 * no side effects. Fully testable.
 *
 * Matching algorithm:
 *   1. EXACT match: amount matches exactly (₹0.01 tolerance) AND date
 *      within ±2 days → confidence 1.0
 *   2. FUZZY match: amount matches within ₹5 tolerance AND date within
 *      ±5 days → confidence 0.7
 *   3. PARTIAL match: amount within 20% AND date within ±7 days → confidence 0.4
 *
 * Only UPI/card/bank payments are matched (cash payments can't be reconciled
 * against bank statements — they're physical cash).
 *
 * SIGN CONVENTION:
 *   - Bank statement: positive = credit (money IN), negative = debit (money OUT)
 *   - Payment: 'received' = money IN (customer paid us), 'paid' = money OUT (we paid supplier)
 *   - Transaction (sale with paymentMode='upi'): paidAmount = money IN
 *   - Transaction (purchase with paymentMode='upi'): paidAmount = money OUT
 *
 * Matching:
 *   - Bank credit (positive) ↔ Payment 'received' OR Sale with paymentMode='upi'/'card'/'bank'
 *   - Bank debit (negative) ↔ Payment 'paid' OR Purchase with paymentMode='upi'/'card'/'bank'
 */

import { roundMoney } from '@/lib/money'

// ─── Types ────────────────────────────────────────────────────────────────

export interface ParsedBankTransaction {
  date: Date
  description: string
  amount: number       // positive = credit, negative = debit
  balance?: number
}

export interface ParsedBankStatement {
  bankName: string
  accountNumber?: string
  statementPeriod?: string
  transactions: ParsedBankTransaction[]
  totalCredits: number
  totalDebits: number
}

export interface MatchablePayment {
  id: string
  amount: number
  date: Date
  type: string         // 'received' | 'paid'
  mode: string         // 'upi' | 'card' | 'bank' | 'cash'
  partyName?: string
  notes?: string
}

export interface MatchableTransaction {
  id: string
  type: string         // 'sale' | 'purchase'
  totalAmount: number
  paidAmount: number
  paymentMode: string  // 'upi' | 'card' | 'bank' | 'cash' | 'credit'
  date: Date
  partyName?: string
  invoiceNo?: string
}

export interface MatchResult {
  bankTxn: ParsedBankTransaction
  matchType: 'exact' | 'fuzzy' | 'partial' | 'none'
  confidence: number   // 0-1
  matchedPaymentId?: string
  matchedTransactionId?: string
  matchedDescription?: string
}

// ─── CSV Parser ───────────────────────────────────────────────────────────

/**
 * Parse a bank statement CSV into structured transactions.
 *
 * Supports common Indian bank CSV formats (HDFC, SBI, ICICI, Axis, etc.):
 *   - Auto-detects column headers (Date, Description, Amount, Balance)
 *   - Handles both "Credit/Debit" separate columns and single "Amount" column
 *   - Handles dd/mm/yyyy and yyyy-mm-dd date formats
 *   - Handles ₹ symbol and commas in amounts
 *
 * @param csvText - the raw CSV text from the bank statement
 * @param bankName - the bank name (for display)
 * @returns parsed statement with transactions
 */
export function parseBankCsv(csvText: string, bankName: string = 'Unknown'): ParsedBankStatement {
  if (!csvText || typeof csvText !== 'string') {
    return { bankName, transactions: [], totalCredits: 0, totalDebits: 0 }
  }
  const lines = csvText.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) {
    return { bankName, transactions: [], totalCredits: 0, totalDebits: 0 }
  }

  // Find the header line (the first line that contains 'date' as a column)
  let headerLineIdx = 0
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const testCols = parseCsvLine(lines[i]).map(h => h.toLowerCase().trim())
    if (testCols.some(c => c.includes('date'))) {
      headerLineIdx = i
      break
    }
  }

  // Detect column headers from the header line
  const headers = parseCsvLine(lines[headerLineIdx]).map(h => h.toLowerCase().trim())

  // Find column indices
  const dateIdx = findColumn(headers, ['date', 'txn date', 'transaction date', 'value date'])
  const descIdx = findColumn(headers, ['description', 'narration', 'particulars', 'details', 'remarks'])
  const amountIdx = findColumn(headers, ['amount', 'amt', 'withdrawal/deposit', 'transaction amount'])
  const creditIdx = findColumn(headers, ['credit', 'deposit'])
  const debitIdx = findColumn(headers, ['debit', 'withdrawal'])
  const balanceIdx = findColumn(headers, ['balance', 'running balance', 'closing balance'])
  const refIdx = findColumn(headers, ['ref', 'reference', 'chq', 'cheque', 'utr', 'rrn'])

  const transactions: ParsedBankTransaction[] = []
  let totalCredits = 0
  let totalDebits = 0

  // Skip lines before the header (bank metadata like "Statement Period")
  let startIdx = headerLineIdx + 1
  // If first data line looks like a header (no parseable date), skip it
  while (startIdx < lines.length) {
    const firstCol = parseCsvLine(lines[startIdx])[0]?.toLowerCase() || ''
    if (firstCol.includes('statement') || firstCol.includes('account') || firstCol.includes('summary')) {
      startIdx++
    } else {
      break
    }
  }

  for (let i = startIdx; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    if (cols.length < 2) continue

    const dateStr = dateIdx >= 0 ? cols[dateIdx] : cols[0]
    const date = parseDate(dateStr)
    if (!date) continue  // skip lines that don't have a valid date

    const description = (descIdx >= 0 ? cols[descIdx] : cols[1] || '').trim()
    let amount = 0

    if (creditIdx >= 0 && debitIdx >= 0) {
      // Separate credit/debit columns
      const credit = parseAmount(cols[creditIdx])
      const debit = parseAmount(cols[debitIdx])
      amount = credit - debit  // positive = credit, negative = debit
    } else if (amountIdx >= 0) {
      // Single amount column
      amount = parseAmount(cols[amountIdx])
    } else {
      // Try to find amount in any column that looks numeric
      for (const col of cols) {
        const parsed = parseAmount(col)
        if (parsed !== 0) {
          amount = parsed
          break
        }
      }
    }

    if (amount === 0) continue  // skip zero-amount rows (often header/footer)

    const balance = balanceIdx >= 0 ? parseAmount(cols[balanceIdx]) : undefined

    transactions.push({ date, description, amount, balance })

    if (amount > 0) totalCredits = roundMoney(totalCredits + amount)
    else totalDebits = roundMoney(totalDebits + Math.abs(amount))
  }

  // Extract account number from header lines if present
  let accountNumber: string | undefined
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const match = lines[i].match(/(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})|(\d{9,18})/)
    if (match) {
      accountNumber = match[1] || match[2]
      break
    }
  }

  return {
    bankName,
    accountNumber,
    transactions,
    totalCredits,
    totalDebits,
  }
}

// ─── Auto-Match Algorithm ─────────────────────────────────────────────────

/**
 * Auto-match bank transactions against recorded payments and transactions.
 *
 * Matching priority:
 *   1. EXACT: amount ±₹0.01 AND date ±2 days → confidence 1.0
 *   2. FUZZY: amount ±₹5 AND date ±5 days → confidence 0.7
 *   3. PARTIAL: amount ±20% AND date ±7 days → confidence 0.4
 *
 * Only matches non-cash payments (UPI/card/bank). Cash can't be reconciled
 * against bank statements.
 *
 * @param bankTxns - parsed bank statement transactions
 * @param payments - recorded payments (non-cash only)
 * @param transactions - recorded transactions with non-cash payment mode
 * @returns match results for each bank transaction
 */
export function autoMatch(
  bankTxns: ParsedBankTransaction[],
  payments: MatchablePayment[],
  transactions: MatchableTransaction[],
): MatchResult[] {
  // Filter to non-cash payments only (cash can't be bank-reconciled)
  const nonCashPayments = payments.filter(p => p.mode !== 'cash')
  const nonCashTxns = transactions.filter(t =>
    t.paymentMode === 'upi' || t.paymentMode === 'card' || t.paymentMode === 'bank'
  )

  // Track which payments/transactions have already been matched (1:1 matching)
  const usedPaymentIds = new Set<string>()
  const usedTransactionIds = new Set<string>()

  return bankTxns.map(bankTxn => {
    const isCredit = bankTxn.amount > 0
    const absAmount = Math.abs(bankTxn.amount)

    // Try to match against payments first (more specific than transactions)
    const paymentMatch = findBestMatch(
      bankTxn,
      absAmount,
      isCredit,
      nonCashPayments.filter(p => {
        if (usedPaymentIds.has(p.id)) return false
        // Credit bank txn ↔ 'received' payment; Debit bank txn ↔ 'paid' payment
        if (isCredit) return p.type === 'received'
        return p.type === 'paid'
      }).map(p => ({
        id: p.id,
        amount: p.amount,
        date: p.date,
        description: `${p.mode.toUpperCase()} - ${p.partyName || 'Unknown'}${p.notes ? ' - ' + p.notes : ''}`,
        type: 'payment' as const,
      })),
    )

    if (paymentMatch) {
      usedPaymentIds.add(paymentMatch.id!)
      return {
        bankTxn,
        matchType: paymentMatch.matchType,
        confidence: paymentMatch.confidence,
        matchedPaymentId: paymentMatch.id,
        matchedDescription: paymentMatch.description,
      }
    }

    // Try to match against transactions (sale/purchase with non-cash payment)
    const txnMatch = findBestMatch(
      bankTxn,
      absAmount,
      isCredit,
      nonCashTxns.filter(t => {
        if (usedTransactionIds.has(t.id)) return false
        // Credit bank txn ↔ sale (customer paid us); Debit bank txn ↔ purchase (we paid supplier)
        if (isCredit) return t.type === 'sale'
        return t.type === 'purchase'
      }).map(t => ({
        id: t.id,
        amount: t.paidAmount,  // match against paidAmount (what was actually paid)
        date: t.date,
        description: `${t.invoiceNo || t.type} - ${t.partyName || 'Unknown'} (${t.paymentMode.toUpperCase()})`,
        type: 'transaction' as const,
      })),
    )

    if (txnMatch) {
      usedTransactionIds.add(txnMatch.id!)
      return {
        bankTxn,
        matchType: txnMatch.matchType,
        confidence: txnMatch.confidence,
        matchedTransactionId: txnMatch.id,
        matchedDescription: txnMatch.description,
      }
    }

    return {
      bankTxn,
      matchType: 'none' as const,
      confidence: 0,
    }
  })
}

// ─── Matching helpers ─────────────────────────────────────────────────────

interface CandidateMatch {
  id: string
  amount: number
  date: Date
  description: string
  type: 'payment' | 'transaction'
}

function findBestMatch(
  bankTxn: ParsedBankTransaction,
  targetAmount: number,
  _isCredit: boolean,
  candidates: CandidateMatch[],
): { id: string; matchType: 'exact' | 'fuzzy' | 'partial'; confidence: number; description: string } | null {
  if (candidates.length === 0) return null

  let bestMatch: { id: string; matchType: 'exact' | 'fuzzy' | 'partial'; confidence: number; description: string } | null = null

  for (const candidate of candidates) {
    const amountDiff = Math.abs(targetAmount - candidate.amount)
    const dateDiffDays = Math.abs(daysBetween(bankTxn.date, candidate.date))

    // EXACT: amount ±₹0.01 AND date ±2 days
    if (amountDiff <= 0.01 && dateDiffDays <= 2) {
      return { id: candidate.id, matchType: 'exact', confidence: 1.0, description: candidate.description }
    }

    // FUZZY: amount ±₹5 AND date ±5 days
    if (amountDiff <= 5 && dateDiffDays <= 5) {
      const confidence = 0.7 - (amountDiff / 10) - (dateDiffDays / 20)
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { id: candidate.id, matchType: 'fuzzy', confidence: Math.max(confidence, 0.4), description: candidate.description }
      }
      continue
    }

    // PARTIAL: amount ±20% AND date ±7 days
    const amountPctDiff = targetAmount > 0 ? amountDiff / targetAmount : 1
    if (amountPctDiff <= 0.2 && dateDiffDays <= 7) {
      const confidence = 0.4 - (amountPctDiff / 2) - (dateDiffDays / 30)
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { id: candidate.id, matchType: 'partial', confidence: Math.max(confidence, 0.1), description: candidate.description }
      }
    }
  }

  return bestMatch
}

function daysBetween(d1: Date, d2: Date): number {
  return (d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24)
}

// ─── CSV parsing helpers ──────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

function findColumn(headers: string[], names: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase()
    for (const name of names) {
      if (header.includes(name)) return i
    }
  }
  return -1
}

function parseDate(str: string): Date | null {
  if (!str) return null
  str = str.trim()

  // dd/mm/yyyy (Indian format)
  let match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (match) {
    const [, d, m, y] = match
    const date = new Date(Number(y), Number(m) - 1, Number(d))
    if (!isNaN(date.getTime())) return date
  }

  // yyyy-mm-dd (ISO format)
  match = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (match) {
    const [, y, m, d] = match
    const date = new Date(Number(y), Number(m) - 1, Number(d))
    if (!isNaN(date.getTime())) return date
  }

  // dd-mm-yyyy
  match = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
  if (match) {
    const [, d, m, y] = match
    const date = new Date(Number(y), Number(m) - 1, Number(d))
    if (!isNaN(date.getTime())) return date
  }

  // Try Date.parse as fallback
  const parsed = new Date(str)
  if (!isNaN(parsed.getTime())) return parsed

  return null
}

function parseAmount(str: string): number {
  if (!str) return 0
  // Remove ₹ symbol, commas, spaces, quotes
  const cleaned = str.replace(/[₹,\s"]/g, '').replace(/\(/g, '-').replace(/\)/g, '')
  const parsed = parseFloat(cleaned)
  return isNaN(parsed) ? 0 : parsed
}
