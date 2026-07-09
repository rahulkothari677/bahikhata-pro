import { NextResponse } from 'next/server'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { runReconciliationChecks } from '@/lib/reconciliation'

/**
 * GET /api/reconciliation
 *
 * 🔒 V17-Ext §5.1: Runs a full reconciliation health check.
 *
 * Returns { checks, allPassed, runAt } where `checks` is an array of
 * { name, description, passed, details, expected?, actual? }.
 *
 * The checks are:
 *   1. Party balances tie out (sum of per-party balances == dashboard totals)
 *   2. GST ties out (per-item GST == header GST)
 *   3. No orphaned data (no items attached to deleted transactions, etc.)
 *
 * All checks use SQL aggregates — O(1) memory regardless of data volume.
 * Requires 'reports' module access (same permission as viewing GST reports).
 */
export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdWithModule('reports')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const result = await runReconciliationChecks(userId)

    return NextResponse.json(result)
  } catch (err) {
    return apiError(err, 'Failed to run reconciliation checks', 500)
  }
}
