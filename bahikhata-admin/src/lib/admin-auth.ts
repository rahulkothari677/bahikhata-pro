import { getServerSession } from 'next-auth'
import { adminAuthOptions } from '@/lib/auth'
import { NextResponse } from 'next/server'

/**
 * Require admin session for API routes.
 * Returns 401 if not logged in, 403 if not admin.
 */
export async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: NextResponse }> {
  const session = await getServerSession(adminAuthOptions)

  if (!session?.user?.email) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'Unauthorized — please login' }, { status: 401 }),
    }
  }

  // Double-check email is in admin whitelist (defense in depth)
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())
  if (!ADMIN_EMAILS.includes(session.user.email.toLowerCase())) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 }),
    }
  }

  return { ok: true, userId: session.user.id }
}

/**
 * IP whitelist check (optional, for extra security).
 * If ALLOWED_IPS env var is set, only those IPs can access.
 */
export function checkIPWhitelist(req: Request): boolean {
  const allowedIPs = process.env.ALLOWED_IPS
  if (!allowedIPs) return true // No whitelist = allow all

  const forwarded = req.headers.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown'

  const allowedList = allowedIPs.split(',').map(ip => ip.trim())
  return allowedList.includes(ip)
}
