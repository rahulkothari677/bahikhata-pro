/**
 * V26 S2 — Gate for debug/diagnostic endpoints.
 *
 * The auditor found that /api/debug/* endpoints were gated by `role === 'owner'`,
 * but EVERY primary shopkeeper account has role 'owner'. So any user could
 * invoke raw-SQL repair endpoints on their own data — a foot-gun.
 *
 * This helper gates debug endpoints behind the FOUNDER email allowlist (the
 * same list used for isFounder() in usage-limits.ts). Only the founders
 * (rahulkothari677@gmail.com + any emails in the FOUNDERS env var) can access.
 *
 * Additionally, mutating debug endpoints (repair-*) should check
 * process.env.ALLOW_REPAIR_ENDPOINTS === 'true' in production, so they're
 * inert unless deliberately enabled.
 */

import { getAuthContext } from '@/lib/get-auth'
import { isFounder } from '@/lib/usage-limits'
import { NextResponse } from 'next/server'

/**
 * Check if the current user is a founder. Returns the userId if authorized,
 * or a NextResponse error if not.
 *
 * Usage:
 *   const founderCheck = await requireFounder()
 *   if ('error' in founderCheck) return founderCheck.error
 *   const userId = founderCheck.userId
 */
export async function requireFounder(): Promise<
  { userId: string } | { error: NextResponse }
> {
  const authCtx = await getAuthContext()
  if (authCtx.error || !authCtx.userId) {
    return { error: authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const founder = await isFounder(authCtx.userId)
  if (!founder) {
    return {
      error: NextResponse.json(
        { error: 'Forbidden', message: 'These debug endpoints are restricted to founders only.' },
        { status: 403 },
      ),
    }
  }

  return { userId: authCtx.userId }
}

/**
 * Check if repair endpoints are allowed in the current environment.
 * In production, requires ALLOW_REPAIR_ENDPOINTS=true env var.
 * In development, always allowed.
 */
export function isRepairAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true
  return process.env.ALLOW_REPAIR_ENDPOINTS === 'true'
}
