import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { NextResponse } from 'next/server'

// Get the authenticated user's ID from the session
// For staff members, returns the OWNER's userId (so they see owner's data)
// For owners, returns their own userId
export async function getAuthUserId(): Promise<{ userId: string | null; error?: NextResponse }> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return {
      userId: null,
      error: NextResponse.json({ error: 'Unauthorized — please sign in' }, { status: 401 }),
    }
  }

  // If staff, use ownerId (the owner's account) so they see owner's data
  // If owner, use their own id
  const userId = session.user.ownerId || session.user.id

  return { userId }
}
