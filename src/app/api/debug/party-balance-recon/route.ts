import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { computePartyBalance, getReceivablePayable } from '@/lib/party-balance'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/debug/party-balance-recon
 *
 * 🔒 V26 M11: Runtime reconciliation between computePartyBalance (Prisma managed
 * aggregate, used by party-detail endpoint) and getReceivablePayable (raw
 * $queryRaw, used by party-list + dashboard). The auditor's live pass found
 * these two paths DISAGREED on a local Postgres proxy — most likely a
 * prepared-statement collision corrupting the raw SQL results, not a code bug.
 *
 * This endpoint is the auditor's "10-minute production sanity check": on a
 * real Neon/Postgres DB, hit this endpoint and compare the two paths for
 * every party. If they match → the local divergence was environmental, close
 * M11. If they diverge → it's a CRITICAL bug and getReceivablePayable needs
 * a rewrite.
 *
 * Auth: owner only. Returns per-party comparison + summary.
 *
 * Response shape:
 *   {
 *     summary: { totalParties: number, matched: number, diverged: number },
 *     parties: [
 *       { partyId, partyName, detailBalance, listBalance, difference, matched }
 *     ]
 *   }
 *
 * After verification, this endpoint can be removed (or left behind a feature
 * flag) — it's a diagnostic tool, not a user-facing feature.
 */
export const maxDuration = 60

export async function GET() {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) {
      return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Owner-only — this is a diagnostic tool that reads all party balances.
    if (authCtx.role !== 'owner') {
      return NextResponse.json({ error: 'Owner only' }, { status: 403 })
    }
    const userId = authCtx.userId

    // Path 1: getReceivablePayable (raw SQL) — returns ALL parties at once.
    const listResult = await getReceivablePayable(userId)

    // Path 2: computePartyBalance (Prisma managed) — one call per party.
    // Fetch all party IDs first.
    const parties = await db.party.findMany({
      where: { userId, deletedAt: null },
      select: { id: true, name: true },
    })

    const comparisons: Array<{
      partyId: string
      partyName: string
      detailBalance: number
      listBalance: number
      difference: number
      signedDifference: number
      matched: boolean
      detailUrl: string
    }> = []

    let matched = 0
    let diverged = 0

    for (const party of parties) {
      // Detail path
      const detailResult = await computePartyBalance(userId, party.id)
      const detailBalance = detailResult.balance

      // List path (from the Map built by getReceivablePayable)
      const listEntry = listResult.partyBalances.get(party.id)
      const listBalance = listEntry?.balance ?? 0

      // Compare with a TIGHT tolerance — any difference ≥ 1 paisa (₹0.01)
      // counts as a divergence. The auditor asked us to flag "ANY inconsistency,
      // even small ones" so a ₹990 gap is easy to spot but a smaller stale-data
      // gap elsewhere might not have shown up as a "diverged" flag if it
      // happened to round close enough. Tight tolerance closes that blind spot.
      const rawDifference = detailBalance - listBalance
      const absDifference = Math.abs(rawDifference)
      const isMatched = absDifference < 0.01

      if (isMatched) {
        matched++
      } else {
        diverged++
      }

      comparisons.push({
        partyId: party.id,
        partyName: party.name,
        detailBalance,
        listBalance,
        difference: absDifference,
        signedDifference: rawDifference,  // positive = detail higher; negative = list higher
        matched: isMatched,
        // 🔒 V26 M11: include the detail-URL for deep investigation of any
        // diverged party. The user can click through to see every raw row +
        // component-by-component breakdown + data-quality scan.
        detailUrl: `/api/debug/party-balance-detail?partyId=${party.id}`,
      })
    }

    // Sort: diverged first (so issues are visible at the top), then by
    // descending difference.
    comparisons.sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? 1 : -1
      return b.difference - a.difference
    })

    // 🔒 V26 M11: also scan for "near-misses" — parties where the difference
    // is small (₹0.01–₹1) but non-zero. These might indicate a subtle rounding
    // or float-precision issue that's worth knowing about even if it's not
    // a "real" divergence. The auditor asked for the true scope of ANY
    // inconsistency, not just the big ones.
    const nearMisses = comparisons.filter(
      c => c.matched === false && c.difference < 1,
    )
    const realDivergences = comparisons.filter(
      c => c.matched === false && c.difference >= 1,
    )

    return NextResponse.json({
      summary: {
        totalParties: parties.length,
        matched,
        diverged,
        realDivergences: realDivergences.length,
        nearMisses: nearMisses.length,
        listTotalReceivable: listResult.totalReceivable,
        listTotalPayable: listResult.totalPayable,
      },
      parties: comparisons,
      interpretation: {
        allMatched: diverged === 0,
        message:
          diverged === 0
            ? `✅ All ${matched} parties match between detail (computePartyBalance) and list (getReceivablePayable) — tolerance < ₹0.01. The M11 live-divergence was a local-proxy artifact — safe to close.`
            : `❌ ${diverged} of ${parties.length} parties DIVERGE between detail and list paths (${realDivergences.length} real divergences ≥ ₹1, ${nearMisses.length} near-misses < ₹1). For each diverged party, hit its detailUrl to see the full breakdown + raw rows + data-quality scan. Top divergences listed first.`,
      },
    })
  } catch (err) {
    return apiError(err, 'Failed to run party-balance reconciliation', 500)
  }
}
