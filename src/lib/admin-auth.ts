import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

/**
 * Admin access check — only the owner of the repo (rahulkothari677) can access admin.
 * In production, this is your account. No one else can see admin data.
 *
 * For now, we use a hardcoded admin email. Later, add an 'isAdmin' field to User schema.
 */
const ADMIN_EMAILS = [
  'rahulkothari677@gmail.com',
  'rahulkothari677@users.noreply.github.com',
]

export async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: NextResponse }> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.email) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'Unauthorized — please sign in' }, { status: 401 }),
    }
  }

  const email = session.user.email.toLowerCase()

  // Check if user is in admin list
  if (!ADMIN_EMAILS.includes(email)) {
    return {
      ok: false,
      error: NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 }),
    }
  }

  return { ok: true, userId: session.user.id }
}
