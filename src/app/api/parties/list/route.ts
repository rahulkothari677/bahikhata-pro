import { NextRequest, NextResponse } from 'next/server'
import { db, withConnectionRetry } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { noStore } from '@/lib/cache'
import { apiError } from '@/lib/api-error'
import { getReceivablePayable } from '@/lib/party-balance'
import { oldestDueSaleSql } from '@/lib/invoice-due-sql'
import { ageBandOf, customerGroupOf, istDaysBetween } from '@/lib/insights'
import { focusParam, parseKhataFocus } from '@/lib/list-focus'
import { customerActivityInPeriod } from '@/lib/insights-queries'
import { rangeWindow } from '@/lib/period'
import { khataList, khataSides, onSide, KHATA_CHIPS, KHATA_SORTS, type KhataChip, type KhataParty, type KhataSide, type KhataSort } from '@/lib/khata-list'

/**
 * GET /api/parties/list?side=customer|supplier&chip&search&sort&offset
 *
 * Phase 5e-1: Khata's list, 60 parties at a time, with every chip's count and
 * the side's totals worked out over ALL the shop's parties (lib/khata-list.ts).
 * The screen used to load up to 5,000 parties and add them up itself.
 *
 * Balances are getReceivablePayable's — the one definition Home, Khata and
 * Insights share; "over 30 days" reads the same "still due" rule as Debt
 * Aging and Insights (oldestDueSaleSql). /api/parties stays as it is for the
 * party pickers.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('parties')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const sp = new URL(req.url).searchParams
    const side = (sp.get('side') === 'supplier' ? 'supplier' : 'customer') as KhataSide
    const chip = ((KHATA_CHIPS as readonly string[]).includes(sp.get('chip') ?? '') ? sp.get('chip') : 'all') as KhataChip
    const sort = ((KHATA_SORTS as readonly string[]).includes(sp.get('sort') ?? '') ? sp.get('sort') : 'balance') as KhataSort
    const offset = Math.max(0, parseInt(sp.get('offset') || '0') || 0)
    const search = (sp.get('search') || '').slice(0, 100)

    const w = rangeWindow(null, null, new Date())!
    // Phase 5e-4b: opened from an Insights group (lib/list-focus.ts). A customer group is counted over the
    // period Insights showed it for; an udhaar age is as of today.
    const focus = parseKhataFocus(sp.get('focus'))
    const askedWindow = focus?.kind === 'group' && (sp.get('from') || sp.get('to'))
    const fw = askedWindow ? rangeWindow(sp.get('from'), sp.get('to'), new Date()) : null
    if (askedWindow && !fw) return NextResponse.json({ error: 'Bad period' }, { status: 400 })
    const [parties, rp, activity, oldest, last, focusActivity] = await Promise.all([
      withConnectionRetry(() => db.party.findMany({
        where: { userId, deletedAt: null },
        // Everything the rows show and the edit form fills.
        select: { id: true, name: true, phone: true, type: true, gstin: true, email: true, address: true, state: true, openingBalance: true },
      })),
      getReceivablePayable(userId),
      // Regular / Gone quiet / New and the sales sort: Insights' customer query and rule, over this month.
      customerActivityInPeriod(userId, w),
      db.$queryRaw<Array<{ partyId: string; oldest: Date }>>(oldestDueSaleSql(userId)),
      db.$queryRaw<Array<{ partyId: string; last: Date }>>`
        SELECT x."partyId", MAX(x.d) AS "last" FROM (
          SELECT "partyId", "date" AS d FROM "Transaction" WHERE "userId" = ${userId} AND "deletedAt" IS NULL AND "partyId" IS NOT NULL
          UNION ALL
          SELECT "partyId", "date" AS d FROM "Payment" WHERE "userId" = ${userId} AND "deletedAt" IS NULL AND "partyId" IS NOT NULL
        ) x GROUP BY x."partyId"`,
      fw ? customerActivityInPeriod(userId, fw) : Promise.resolve(null),
    ])
    const now = new Date()
    const oldestMap = new Map(oldest.map((r) => [r.partyId, new Date(r.oldest)]))
    const lastMap = new Map(last.map((r) => [r.partyId, new Date(r.last).toISOString()]))
    const activityMap = new Map(activity.map((r) => [r.id, r]))
    const rows: KhataParty[] = parties.map((p) => {
      const o = oldestMap.get(p.id)
      const b = rp.partyBalances.get(p.id)
      const a = activityMap.get(p.id)
      return {
        ...p,
        balance: b?.balance ?? 0,
        transactionCount: b?.transactionCount ?? 0,
        oldestDays: o ? istDaysBetween(o, now) : null,
        lastAt: lastMap.get(p.id) ?? null,
        // No bill in either period → not in the activity rows → "inactive", exactly as Insights counts it.
        group: onSide(p.type, 'customer') ? customerGroupOf(a ?? { billsNow: 0, billsPrev: 0, firstBill: null }, w.from) : undefined,
        salesNow: a?.salesNow ?? 0,
      }
    })
    // Who is in the focused group — Insights' own rules, worked out here over every party (never ids from the phone).
    let focusIds: Set<string> | null = null
    if (focus?.kind === 'group') {
      const win = fw ?? w
      const acts = focusActivity ? new Map(focusActivity.map((r) => [r.id, r])) : activityMap
      focusIds = new Set(rows
        .filter((p) => onSide(p.type, 'customer') && customerGroupOf(acts.get(p.id) ?? { billsNow: 0, billsPrev: 0, firstBill: null }, win.from) === focus.id)
        .map((p) => p.id))
    } else if (focus?.kind === 'age') {
      // Insights ages the customers who owe you (khataSides' collect) by their oldest unpaid bill.
      focusIds = new Set(khataSides(rows).collect.parties.filter((p) => ageBandOf(p.oldestDays) === focus.id).map((p) => p.id))
    }
    return noStore({ side, chip, sort, offset, focus: focus ? focusParam(focus) : null, ...khataList(rows, { side, chip, search, sort, offset, focusIds }) })
  } catch (err) {
    return apiError(err, 'Failed to load khata', 503)
  }
}
