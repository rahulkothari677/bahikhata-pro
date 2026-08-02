/**
 * 🔒 AUDIT C5 — ONE definition of "how much is still due on this bill".
 *
 * THE DEFECT: a "Settle" payment reduced the PARTY balance but no bill knew
 * about it, so an invoice kept showing its original amount as due forever.
 * Party outstanding and the sum of bill dues disagreed permanently, from the
 * first partial payment onward. The stale "Due" then invited the shopkeeper to
 * collect that amount again — and nothing would have stopped them, because
 * settling a bill for exactly what it claims to owe looks entirely correct.
 *
 * WHY THIS FILE EXISTS AT ALL: "due" is rendered in the ledger list, the bill
 * detail, the party statement, reminders, ageing and PDFs. This project's worst
 * bugs — three different party balances (V7), two GSTR-1 thresholds (G4), stock
 * value computed four ways (N6) — were all ONE concept implemented in several
 * places that drifted. So there is exactly one implementation here, and every
 * screen calls it.
 *
 * All amounts are RUPEES. Callers reading straight from $queryRaw must convert
 * paise first — the money extension does it automatically for Prisma reads.
 */

import { roundMoney } from './money'

export interface DueInput {
  /** Invoice total, after discount and round-off. */
  totalAmount: number
  /** Recorded on the bill at billing time ("Paid Amount" on the sale form). */
  paidAmount?: number | null
  /** Σ of Payment allocations pointing at this bill. */
  allocatedAmount?: number | null
}

export interface DueBreakdown {
  totalAmount: number
  /** Paid when the bill was made. */
  paidAtBilling: number
  /** Settled afterwards, via payments allocated to this bill. */
  settledLater: number
  /** paidAtBilling + settledLater. */
  totalPaid: number
  /** What remains. Never negative — see computeInvoiceDue. */
  due: number
  isFullyPaid: boolean
}

/**
 * How much is still owed on one bill.
 *
 *     due = totalAmount − paidAmount − Σ(allocations)
 *
 * CLAMPED AT ZERO, deliberately. A negative due would mean the bill collected
 * more than its own value, and it would then subtract from OTHER bills if
 * anything ever summed dues across a party — turning one over-collection into a
 * wrong total everywhere. Over-payment is a real thing, but it belongs in the
 * party's advance balance, not hidden inside a bill as a negative.
 *
 * The write path enforces `paidAmount + Σ(allocations) ≤ totalAmount`, so a
 * clamp here should be unreachable. It is kept because "unreachable" and
 * "never happens to money" are not the same claim.
 */
export function computeInvoiceDue(input: DueInput): number {
  const total = roundMoney(input.totalAmount || 0)
  const paid = roundMoney(input.paidAmount || 0)
  const allocated = roundMoney(input.allocatedAmount || 0)
  return Math.max(0, roundMoney(total - paid - allocated))
}

/**
 * The same number, with its parts — so a bill can show
 *
 *     Total ₹2,992.50
 *     Paid at billing ₹0.00
 *     Settled later ₹1,000.00
 *     Due ₹1,992.50
 *
 * rather than a figure that silently shrank with nothing to explain it. That
 * traceability is the point: the original bug was invisible precisely because
 * the money moved without leaving a mark on the bill.
 */
export function computeDueBreakdown(input: DueInput): DueBreakdown {
  const totalAmount = roundMoney(input.totalAmount || 0)
  const paidAtBilling = roundMoney(input.paidAmount || 0)
  const settledLater = roundMoney(input.allocatedAmount || 0)
  const totalPaid = roundMoney(paidAtBilling + settledLater)
  const due = Math.max(0, roundMoney(totalAmount - totalPaid))
  return {
    totalAmount,
    paidAtBilling,
    settledLater,
    totalPaid,
    due,
    isFullyPaid: due === 0,
  }
}

export interface AllocatableBill {
  id: string
  /** Used only for ordering — oldest first. */
  date: Date | string
  totalAmount: number
  paidAmount?: number | null
  allocatedAmount?: number | null
}

export interface Allocation {
  transactionId: string
  amount: number
}

export interface AllocationPlan {
  allocations: Allocation[]
  /** Left over once every open bill is cleared — held as an advance. */
  unallocated: number
}

/**
 * Spread a payment across open bills, OLDEST FIRST.
 *
 * This is what makes the fix invisible in the common case: the shopkeeper types
 * "₹1,000" exactly as before, and the app works out which bills that clears.
 * Forcing a bill to be chosen on every payment would add friction to the single
 * most frequent action in the app, and oldest-first is how a khata is settled
 * anyway.
 *
 * Any remainder is returned as `unallocated` rather than being forced onto a
 * bill. Advances are legitimate — money often arrives before the invoice does —
 * and inventing an allocation for it would be a lie about which bill was paid.
 *
 * Ordering note: bills are sorted by date, then by id. The id tiebreak matters
 * — several bills on one day is normal in a shop, and without it the allocation
 * would depend on the order rows happened to come back from the database, so
 * the same payment could allocate differently on two runs.
 */
export function planAllocationOldestFirst(
  bills: AllocatableBill[],
  paymentAmount: number,
): AllocationPlan {
  let remaining = roundMoney(paymentAmount || 0)
  const allocations: Allocation[] = []

  if (remaining <= 0) return { allocations, unallocated: 0 }

  const open = bills
    .map(b => ({ bill: b, due: computeInvoiceDue(b) }))
    .filter(x => x.due > 0)
    .sort((a, b) => {
      const ta = new Date(a.bill.date).getTime()
      const tb = new Date(b.bill.date).getTime()
      if (ta !== tb) return ta - tb
      return a.bill.id < b.bill.id ? -1 : a.bill.id > b.bill.id ? 1 : 0
    })

  for (const { bill, due } of open) {
    if (remaining <= 0) break
    const take = roundMoney(Math.min(due, remaining))
    if (take <= 0) continue
    allocations.push({ transactionId: bill.id, amount: take })
    remaining = roundMoney(remaining - take)
  }

  return { allocations, unallocated: Math.max(0, remaining) }
}

/**
 * Guard for the write path: would these allocations over-settle a bill?
 *
 * This is the invariant that makes the original defect impossible — not the
 * allocation itself. Without it, a payment could still be pointed at an
 * already-settled bill and the double-collection would go through.
 *
 * Returns null when valid, or a message naming the offending bill.
 */
export function validateAllocations(
  allocations: Allocation[],
  billsById: Map<string, AllocatableBill>,
  paymentAmount: number,
): string | null {
  let sum = 0

  for (const a of allocations) {
    if (!(a.amount > 0)) {
      return `Allocation amounts must be greater than zero.`
    }
    const bill = billsById.get(a.transactionId)
    if (!bill) {
      // Also covers a bill belonging to another party or another user: the
      // caller builds this map from bills it has already scoped.
      return `Cannot settle against a bill that does not belong to this party.`
    }
    const due = computeInvoiceDue(bill)
    if (a.amount > due) {
      return due === 0
        ? `This bill is already fully paid.`
        : `Cannot settle ₹${a.amount.toFixed(2)} against a bill with only ₹${due.toFixed(2)} still due.`
    }
    sum = roundMoney(sum + a.amount)
  }

  if (sum > roundMoney(paymentAmount)) {
    return `Allocations (₹${sum.toFixed(2)}) exceed the payment amount (₹${roundMoney(paymentAmount).toFixed(2)}).`
  }

  return null
}
