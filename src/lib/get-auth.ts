import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { canAccessModule, type ModuleKey } from '@/lib/staff-permissions'

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

/**
 * 🔒 FIX H1: Get the authenticated user's ID AND verify they have permission
 * to access the requested module. For owners, always passes. For staff, checks
 * their permissions. If denied, returns a 403 error.
 *
 * Usage:
 *   const { userId, error } = await getAuthUserIdWithModule('reports')
 *   if (error) return error
 *
 * For owner-only routes (payment, account delete, staff management):
 *   const { userId, error } = await getAuthUserIdOwnerOnly()
 */
export async function getAuthUserIdWithModule(
  module: ModuleKey
): Promise<{ userId: string | null; error?: NextResponse }> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return {
      userId: null,
      error: NextResponse.json({ error: 'Unauthorized — please sign in' }, { status: 401 }),
    }
  }

  const userId = session.user.ownerId || session.user.id
  const role = (session.user as any).role || 'owner'
  const permissions = (session.user as any).permissions

  // 🔒 FIX H1: Enforce staff permissions on the SERVER, not just the UI.
  // Was: only page.tsx checked canAccessModule. Staff could bypass by calling
  // the API directly. Now: every protected route checks server-side.
  if (!canAccessModule(role, permissions, module)) {
    return {
      userId: null,
      error: NextResponse.json({
        error: 'Forbidden',
        message: `You don't have permission to access ${module}. Contact the shop owner.`,
      }, { status: 403 }),
    }
  }

  return { userId }
}

/**
 * 🔒 FIX H1: Get auth context including role and permissions, for routes
 * that need to check module access dynamically (e.g., transactions where
 * the module depends on the transaction type: sale→'sales', purchase→'purchases').
 *
 * Usage:
 *   const { userId, role, permissions } = await getAuthContext()
 *   if (!canAccessModule(role, permissions, 'sales')) return 403
 */
export async function getAuthContext(): Promise<{
  userId: string | null
  role: string
  permissions: any
  error?: NextResponse
}> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return {
      userId: null,
      role: 'owner',
      permissions: null,
      error: NextResponse.json({ error: 'Unauthorized — please sign in' }, { status: 401 }),
    }
  }

  const userId = session.user.ownerId || session.user.id
  const role = (session.user as any).role || 'owner'
  const permissions = (session.user as any).permissions

  return { userId, role, permissions }
}

/**
 * 🔒 FIX H1: Owner-only routes (payment, account delete, staff management).
 * Staff members get 403 regardless of permissions.
 */
export async function getAuthUserIdOwnerOnly(): Promise<{ userId: string | null; error?: NextResponse }> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return {
      userId: null,
      error: NextResponse.json({ error: 'Unauthorized — please sign in' }, { status: 401 }),
    }
  }

  const role = (session.user as any).role || 'owner'
  if (role === 'staff') {
    return {
      userId: null,
      error: NextResponse.json({
        error: 'Forbidden',
        message: 'Only the shop owner can perform this action.',
      }, { status: 403 }),
    }
  }

  const userId = session.user.ownerId || session.user.id
  return { userId }
}
