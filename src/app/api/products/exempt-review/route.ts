import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { reviewProduct } from '@/lib/exempt-reclassification'
import { EXEMPT_TABLE_INFO } from '@/lib/exempt-goods-lookup'

/**
 * #94 — products whose GST treatment was decided by the CANCELLED notification.
 *
 * Every product entered before 29 Aug 2026 was classified against 2/2017,
 * superseded by 10/2025. Fixing the rule going forward leaves those rows
 * untouched, and GSTR-1 reads them every month.
 *
 * GET  lists what needs a look.
 * POST applies ONE confirmed answer to ONE product. Never a bulk write: the
 *      whole point is that a person decided each one.
 *
 * ── SCALE ───────────────────────────────────────────────────────────────
 *
 * The exemption table is a JSON import, not a table, so the comparison cannot
 * be a join — rows have to be read. Two things keep that honest:
 *
 *   1. The database does the narrowing. Only `gstRate = 0` rows can possibly
 *      disagree; a product carrying tax is taxable whatever its HSN says. On a
 *      real shop that is a small fraction of the catalogue.
 *   2. There is a CAP, and when it bites the response SAYS SO rather than
 *      quietly returning a short list. A silent limit on a compliance screen
 *      is a lie with a number on it — the shopkeeper would fix nine rows,
 *      see an empty list, and believe they were done.
 */
export const maxDuration = 60

/*
 * Deliberately generous but finite. A kirana with 2,000 zero-rated lines is
 * unusual; one with 200,000 is a data error, and reading it would time out
 * rather than fail cleanly.
 */
const SCAN_CAP = 2000

export async function GET() {
  try {
    const auth = await getAuthContext()
    if (auth.error || !auth.userId) return auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(auth.role, auth.permissions, 'inventory')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = auth.userId

    /*
     * gstRate: 0 is the whole population that can disagree, filtered in the
     * DATABASE rather than in memory. `take` is one past the cap so a full
     * page is distinguishable from a truncated one.
     */
    const rows = await db.product.findMany({
      where: { userId, gstRate: 0 },
      select: { id: true, name: true, hsn: true, gstRate: true, gstTreatment: true, category: true },
      orderBy: { name: 'asc' },
      take: SCAN_CAP + 1,
    })

    const truncated = rows.length > SCAN_CAP
    const scanned = truncated ? rows.slice(0, SCAN_CAP) : rows

    const findings = scanned
      .map(p => ({ product: p, review: reviewProduct(p) }))
      .filter(r => r.review.verdict !== 'ok')
      .map(({ product, review }) => ({
        id: product.id,
        name: product.name,
        hsn: product.hsn,
        category: product.category,
        currentTreatment: product.gstTreatment || 'taxable',
        ...review,
      }))

    return NextResponse.json({
      /*
       * Counted separately from `findings.length` so the screen can say "12 of
       * your 340 zero-rated items" — a bare "12 problems" reads as far worse
       * than it is, and a compliance screen that frightens people gets closed.
       */
      zeroRatedScanned: scanned.length,
      findingCount: findings.length,
      findings,
      truncated,
      truncationNote: truncated
        ? `Only the first ${SCAN_CAP} zero-rated items were checked. Fix these, then reopen this screen to check the rest.`
        : null,
      notification: EXEMPT_TABLE_INFO,
    })
  } catch (error) {
    return apiError(error, 'Failed to review product classifications', 500)
  }
}

/**
 * Apply one confirmed answer.
 *
 * The client sends the treatment the SHOPKEEPER chose, not a condition for the
 * server to re-derive. That keeps one rule in one place: the conditions were
 * answered on screen, where the person could see the item, and re-deciding
 * here from the same HSN would be a second opinion that can disagree with the
 * first.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext()
    if (auth.error || !auth.userId) return auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(auth.role, auth.permissions, 'inventory')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { productId, gstTreatment } = body ?? {}

    if (typeof productId !== 'string' || !productId) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 })
    }
    const allowed = ['taxable', 'nil', 'exempt', 'nonGst']
    if (!allowed.includes(gstTreatment)) {
      return NextResponse.json({
        error: 'Invalid treatment',
        message: 'Choose taxable, nil, exempt or nonGst.',
      }, { status: 400 })
    }

    /*
     * Scoped by userId in the WHERE, not checked after loading. One shop's
     * data must never depend on our code remembering to compare an id — the
     * database refuses instead.
     */
    const result = await db.product.updateMany({
      where: { id: productId, userId: auth.userId },
      data: { gstTreatment },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, productId, gstTreatment })
  } catch (error) {
    return apiError(error, 'Failed to update product classification', 500)
  }
}
