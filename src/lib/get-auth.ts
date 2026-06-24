import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { NextResponse } from 'next/server'

// Get the authenticated user's ID from the session
// Returns { userId, error } — if error is set, return it as NextResponse
export async function getAuthUserId(): Promise<{ userId: string | null; error?: NextResponse }> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return {
      userId: null,
      error: NextResponse.json({ error: 'Unauthorized — please sign in' }, { status: 401 }),
    }
  }

  return { userId: session.user.id }
}
