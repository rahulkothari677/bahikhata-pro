import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { buildGstr9, financialYearMonths } from '@/lib/gstr9-builder'

/**
 * GSTR-9 — the annual return.
 *
 * READS THE FILED SNAPSHOTS, NOT THE BOOKS. Every table in the real form says
 * "as declared in returns filed during the financial year", so this reads
 * GstReturn (the filed GSTR-3B) and Gstr1Snapshot (the filed GSTR-1) for the
 * twelve months of the year. Recomputing from live rows would produce an
 * annual return that disagrees with the twelve monthly ones it is meant to
 * summarise — and that difference reads as fraud rather than as an edit.
 *
 * It is also why this route does NOT call /api/gstr-1 and /api/gstr-3b the way
 * the reconciliation route does. Those return TODAY's figures, which is right
 * for "can I file this month" and wrong for "what did I file last August".
 *
 * TURNOVER MATTERS HERE. GSTR-9 is mandatory above ₹2 crore and optional
 * below, so the response carries the computed turnover and says which side of
 * the line the shop is on — a shop under the limit should not be nagged, and
 * one over it should not be left to find out in December.
 */
export const maxDuration = 60

/** Mandatory above this aggregate turnover. Optional (and unpenalised) below. */
const GSTR9_MANDATORY_ABOVE = 20_000_000  // ₹2 crore

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext()
    if (auth.error || !auth.userId) return auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(auth.role, auth.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = auth.userId

    const fy = new URL(req.url).searchParams.get('fy')
    if (!fy || !/^\d{4}-\d{2}$/.test(fy)) {
      return NextResponse.json({ error: 'fy is required (YYYY-YY, e.g. 2026-27)' }, { status: 400 })
    }

    const months = financialYearMonths(fy)

    // A composition dealer files GSTR-4, not GSTR-9. Saying so is more useful
    // than an empty return — same shape as the CMP-08 route's guard.
    const setting = await db.setting.findUnique({
      where: { userId },
      select: { compositionCategory: true, gstin: true },
    })
    if (setting?.compositionCategory) {
      return NextResponse.json({
        error: 'Not applicable to a composition dealer',
        message: 'GSTR-9 is the regular scheme’s annual return. Your shop is under the composition scheme, which files GSTR-4 instead.',
      }, { status: 400 })
    }

    /*
     * `take: 12` is the real ceiling, not a guess: `months` holds exactly the
     * twelve months of the year, and both tables are unique on
     * (userId, monthYear) — so twelve rows each is the arithmetic maximum.
     *
     * Stating it anyway because the unbounded-query guard asks for an explicit
     * cap rather than a bound a reader has to derive, and it was right to stop
     * this: "obviously bounded" is exactly how an unbounded query gets shipped.
     */
    const [months3b, months1] = await Promise.all([
      db.gstReturn.findMany({ where: { userId, monthYear: { in: months } }, take: 12 }),
      db.gstr1Snapshot.findMany({ where: { userId, monthYear: { in: months } }, take: 12 }),
    ])

    const result = buildGstr9({
      fy,
      months3b: months3b as never,
      months1: months1 as never,
    })

    const turnover = result.table5.totalTurnoverN
    return NextResponse.json({
      ...result,
      gstin: setting?.gstin || null,
      filing: {
        turnover,
        mandatoryAbove: GSTR9_MANDATORY_ABOVE,
        isMandatory: turnover > GSTR9_MANDATORY_ABOVE,
        dueDate: `31 December ${Number(fy.split('-')[0]) + 1}`,
      },
    })
  } catch (err) {
    return apiError(err, 'Failed to build GSTR-9', 500)
  }
}
