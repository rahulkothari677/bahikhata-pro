import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { roundMoney } from '@/lib/money'
import {
  assessItcReversal,
  needsAttention,
  RULE_37_DAYS,
  WARN_WITHIN_DAYS,
} from '@/lib/itc-180-day'

/**
 * #88 — purchases whose input credit is about to be lost, or already should be.
 *
 * If a supplier is not paid within 180 days of their invoice, the input credit
 * claimed on that bill must be reversed with interest (second proviso to
 * Section 16(2), Rule 37). Nothing in this app — or in a paper ledger — counts
 * those days, so the first a shop hears of it is a demand.
 *
 * ── SCALE ───────────────────────────────────────────────────────────────
 *
 * The database does the narrowing, and it can narrow hard:
 *
 *   type = 'purchase'     sales cannot carry input credit
 *   isReverseCharge=false RCM is outside the rule entirely
 *   date >= floor         a five-year-old bill is a different conversation
 *   date <= horizon       anything newer than (180 − 30) days cannot yet warn
 *
 * That last pair is what keeps this small. On a shop with years of history the
 * rows that can possibly matter are a narrow date band, not the catalogue, and
 * `[userId, type, date]` is already indexed.
 *
 * Allocations are included rather than counted separately because this rule
 * needs their payment DATES, not just a sum — a supplier paid on day 200 was
 * late, and only the dates can show that.
 */
export const maxDuration = 60

/*
 * A cap, and it is reported when it bites.
 *
 * A silent limit here would be worse than most: the shopkeeper clears nine
 * warnings, sees an empty list, and concludes the credit is safe.
 */
const SCAN_CAP = 1000

/*
 * How far back to look. Two financial years is the range where a reversal is
 * still a live conversation with a CA; older than that and it is history a
 * warning panel cannot help with, but it would still push the genuinely urgent
 * rows off the screen.
 */
const LOOKBACK_DAYS = 730

export async function GET() {
  try {
    const auth = await getAuthContext()
    if (auth.error || !auth.userId) return auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(auth.role, auth.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = auth.userId

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    /*
     * The newest invoice that could possibly need a warning today. A bill dated
     * after this still has more than WARN_WITHIN_DAYS of its window left, so it
     * cannot be 'due-soon' or 'overdue' and there is no reason to read it.
     */
    const horizon = new Date(today)
    horizon.setDate(horizon.getDate() - (RULE_37_DAYS - WARN_WITHIN_DAYS))

    const floor = new Date(today)
    floor.setDate(floor.getDate() - LOOKBACK_DAYS)

    const rows = await db.transaction.findMany({
      where: {
        userId,
        type: 'purchase',
        deletedAt: null,
        isReverseCharge: false,
        date: { gte: floor, lte: horizon },
      },
      select: {
        id: true, invoiceNo: true, date: true, totalAmount: true, paidAmount: true,
        cgst: true, sgst: true, igst: true, itcBlockedReason: true, isReverseCharge: true,
        party: { select: { id: true, name: true } },
        paymentAllocations: { select: { amount: true, payment: { select: { date: true, deletedAt: true } } } },
      },
      orderBy: { date: 'asc' },
      take: SCAN_CAP + 1,
    })

    const truncated = rows.length > SCAN_CAP
    const scanned = truncated ? rows.slice(0, SCAN_CAP) : rows

    const findings = scanned
      .map(t => {
        const assessment = assessItcReversal({
          invoiceDate: t.date,
          totalAmount: roundMoney(t.totalAmount),
          paidAmount: roundMoney(t.paidAmount),
          /*
           * A DELETED payment never happened, so its allocation must not count
           * as money reaching the supplier. Filtering here rather than in the
           * query because the allocation belongs to the payment, and Prisma
           * cannot filter a nested relation's parent in the same select
           * without dropping the allocation row entirely.
           */
          allocations: t.paymentAllocations
            .filter(a => !a.payment.deletedAt)
            .map(a => ({ amount: roundMoney(a.amount), date: a.payment.date })),
          taxAmount: roundMoney(t.cgst) + roundMoney(t.sgst) + roundMoney(t.igst),
          isReverseCharge: t.isReverseCharge,
          itcBlockedReason: t.itcBlockedReason,
        }, today)
        return { t, assessment }
      })
      .filter(r => needsAttention(r.assessment))
      .map(({ t, assessment }) => ({
        id: t.id,
        invoiceNo: t.invoiceNo,
        date: t.date.toISOString(),
        supplier: t.party?.name || 'Unknown supplier',
        partyId: t.party?.id || null,
        totalAmount: roundMoney(t.totalAmount),
        ...assessment,
        deadline: assessment.deadline?.toISOString() ?? null,
      }))

    /*
     * Split by urgency in the RESPONSE rather than on screen, so the counts and
     * the totals cannot disagree with the list they describe.
     */
    const overdue = findings.filter(f => f.status === 'overdue')
    const dueSoon = findings.filter(f => f.status === 'due-soon')
    const paidLate = findings.filter(f => f.status === 'paid-late')

    return NextResponse.json({
      purchasesChecked: scanned.length,
      findingCount: findings.length,
      overdue,
      dueSoon,
      paidLate,
      totals: {
        overdueItc: roundMoney(overdue.reduce((s, f) => s + f.itcAtRisk, 0)),
        dueSoonItc: roundMoney(dueSoon.reduce((s, f) => s + f.itcAtRisk, 0)),
        paidLateItc: roundMoney(paidLate.reduce((s, f) => s + f.itcAtRisk, 0)),
      },
      rule: {
        days: RULE_37_DAYS,
        warnWithinDays: WARN_WITHIN_DAYS,
        citation: 'Second proviso to Section 16(2) and Rule 37, CGST Rules',
      },
      truncated,
      truncationNote: truncated
        ? `Only the first ${SCAN_CAP} purchases were checked. Clear these, then reopen this screen to check the rest.`
        : null,
      lookbackDays: LOOKBACK_DAYS,
    })
  } catch (error) {
    return apiError(error, 'Failed to check input credit reversals', 500)
  }
}
