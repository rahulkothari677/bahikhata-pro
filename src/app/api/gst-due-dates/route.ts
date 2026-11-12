import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { duesAround, dueRows, filingFrequency } from '@/lib/gst-due-dates'
import { stateCodeOf } from '@/lib/gst-states'
import { gstStatus } from '@/lib/shop-tax'
import { istDateString } from '@/lib/timezone'

/**
 * 9b-4 (master plan 9b, "every due date from one place"; #106): the returns due
 * around today, for the Reports page's GST section.
 *
 * Every date comes from lib/gst-due-dates.ts, by the shop's stored frequency
 * and state (the quarterly GSTR-3B is the 22nd or 24th by state). Filed comes
 * from the stored returns (Gstr1Snapshot, GstReturn) — bounded by the four
 * periods asked about. A shop that is not registered has nothing due.
 */
export async function GET() {
  try {
    const auth = await getAuthContext()
    if (auth.error || !auth.userId) return auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(auth.role, auth.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = auth.userId

    const setting = await db.setting.findUnique({
      where: { userId },
      select: { gstin: true, state: true, gstRegistered: true, compositionCategory: true, gstFilingFrequency: true },
    })
    const status = gstStatus(setting)
    if (status === 'unregistered') return NextResponse.json({ status, items: [] })

    const today = istDateString(new Date())
    const freq = filingFrequency(setting)
    const items = duesAround(
      { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) },
      { scheme: status, freq, stateCode: stateCodeOf(setting) },
    )
    const fps = [...new Set(items.map((i) => i.fp))]
    const [g1, g3] = await Promise.all([
      db.gstr1Snapshot.findMany({ where: { userId, monthYear: { in: fps }, filingStatus: 'filed' }, select: { monthYear: true } }),
      db.gstReturn.findMany({ where: { userId, monthYear: { in: fps }, filingStatus: 'filed' }, select: { monthYear: true } }),
    ])
    const filed = new Set([...g1.map((r) => `GSTR-1|${r.monthYear}`), ...g3.map((r) => `GSTR-3B|${r.monthYear}`)])

    return NextResponse.json({
      status,
      frequency: status === 'regular' ? freq : null,
      items: dueRows(items, filed, today).map((r) => ({
        form: r.form, fp: r.fp, day: r.day, status: r.status, daysLeft: r.daysLeft, basis: r.basis,
      })),
    })
  } catch (err) {
    return apiError(err, 'Could not work out the due dates', 500)
  }
}
