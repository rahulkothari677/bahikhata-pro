/**
 * 9c-3 (#159): every "Expenses" figure is an expense's COST (subtotal), never its
 * cash (totalAmount) — lib/expense-cost.ts. One label, one number, on every screen:
 * a GST shop's ₹1,000 rent + ₹180 GST is ₹1,000 of expenses everywhere.
 *
 * The rule is a function, tested on known-bad and known-good code first (a guard
 * that cannot fail is a comment with a green tick), then run over the readers.
 */
import { readCode } from '@/test-support/read-source'
import { expenseCost } from '@/lib/expense-cost'

/** Does this code read an expense's cash as its amount? Returns the offending snippets. */
export function expenseCashReads(code: string): string[] {
  const found: string[] = []
  const patterns: RegExp[] = [
    /\(\s*'expense'\s*\)\s*\.totalAmount/g,                         // of('expense').totalAmount / sums('expense').totalAmount
    /sumOf\(\s*'expense'\s*\)/g,                                      // a totalAmount-summing helper fed 'expense'
    /"type"\s*=\s*'expense'[^\n]*THEN\s+"totalAmount"/g,             // raw SQL CASE on expenses
    /expensesByCategory\.set\([^\n]*totalAmount/g,                    // client-side category sums
  ]
  for (const p of patterns) for (const m of code.matchAll(p)) found.push(m[0])
  return found
}

describe('the rule, both ways', () => {
  it('catches each way an expense’s cash was summed', () => {
    expect(expenseCashReads("expenses: of('expense').totalAmount,")).toHaveLength(1)
    expect(expenseCashReads("const totalExpenses = roundMoney(sumOf('expense'))")).toHaveLength(1)
    expect(expenseCashReads(`SUM(CASE WHEN "type" = 'expense' AND "date" >= x THEN "totalAmount" ELSE 0 END)`)).toHaveLength(1)
    expect(expenseCashReads('expensesByCategory.set(cat, (expensesByCategory.get(cat) || 0) + txn.totalAmount)')).toHaveLength(1)
  })
  it('passes the cost', () => {
    expect(expenseCashReads("expenses: expenseCost(of('expense')),")).toEqual([])
    expect(expenseCashReads(`SUM(CASE WHEN "type" = 'expense' AND "date" >= x THEN "subtotal" ELSE 0 END)`)).toEqual([])
    // income stays on totalAmount — it has no GST split
    expect(expenseCashReads("income: of('income').totalAmount,")).toEqual([])
  })
})

const PROFIT_READERS = [
  'app/api/reports/route.ts',
  'app/api/dashboard/route.ts',
  'app/api/insights/route.ts',
  'lib/consolidated-reports.ts',
  'lib/income-expense-summary.ts',
  'app/api/ask/route.ts',
  'app/api/dashboard/explain/route.ts',
  'components/income/IncomeExpense.tsx',
]

describe('every Expenses reader uses the cost', () => {
  it.each(PROFIT_READERS)('%s', (file) => {
    expect(expenseCashReads(readCode(file))).toEqual([])
  })

  it('and calls the one rule (or its column) rather than its own', () => {
    for (const file of PROFIT_READERS) {
      const code = readCode(file)
      expect(/expenseCost\(|THEN "subtotal"/.test(code)).toBe(true)
    }
  })
})

describe('expenseCost', () => {
  it('is the amount before GST; nothing gives 0', () => {
    expect(expenseCost({ subtotal: 1000 })).toBe(1000)
    expect(expenseCost({ subtotal: null })).toBe(0)
    expect(expenseCost(null)).toBe(0)
  })
})
