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
): Promise<{ userId: string | null; isImpersonated: boolean; error?: NextResponse }> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return {
      userId: null,
      isImpersonated: false,
      error: NextResponse.json({ error: 'Unauthorized — please sign in' }, { status: 401 }),
    }
  }

  const userId = session.user.ownerId || session.user.id
  const role = session.user.role || 'owner'
  const permissions = session.user.permissions

  // 🔒 FIX H1: Enforce staff permissions on the SERVER, not just the UI.
  // Was: only page.tsx checked canAccessModule. Staff could bypass by calling
  // the API directly. Now: every protected route checks server-side.
  if (!canAccessModule(role, permissions, module)) {
    return {
      userId: null,
      isImpersonated: false,
      error: NextResponse.json({
        error: 'Forbidden',
        message: `You don't have permission to access ${module}. Contact the shop owner.`,
      }, { status: 403 }),
    }
  }

  // 🔒 (audit 2026-07-27) This helper did not expose isImpersonated at all, so
  // every route using it was structurally UNABLE to check — including
  // /api/gstr-export, which dumps the full invoice register with party names
  // and GSTINs. A guard that cannot be called from the majority of routes is
  // not a guard.
  const isImpersonated = (session.user as any).isImpersonated === true
  return { userId, isImpersonated }
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
  actingUserId: string | null  // 🔒 V13 L4: the actual logged-in user (for createdByUserId)
  role: string
  permissions: any
  isImpersonated: boolean  // 🔒 2026-07-26: true when an admin is logged in AS this user
  error?: NextResponse
}> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return {
      userId: null,
      actingUserId: null,
      role: 'owner',
      permissions: null,
      isImpersonated: false,
      error: NextResponse.json({ error: 'Unauthorized — please sign in' }, { status: 401 }),
    }
  }

  const userId = session.user.ownerId || session.user.id
  const actingUserId = session.user.id  // 🔒 V13 L4: the actual user (owner or staff)
  const role = session.user.role || 'owner'
  const permissions = session.user.permissions
  const isImpersonated = (session.user as any).isImpersonated === true

  return { userId, actingUserId, role, permissions, isImpersonated }
}

/**
 * 🔒 FIX H1: Owner-only routes (payment, account delete, staff management).
 * Staff AND CA members get 403 regardless of permissions.
 * V17-Ext Tier 3: CA is also blocked from owner-only routes.
 */
export async function getAuthUserIdOwnerOnly(): Promise<{ userId: string | null; isImpersonated: boolean; error?: NextResponse }> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return {
      userId: null,
      isImpersonated: false,
      error: NextResponse.json({ error: 'Unauthorized — please sign in' }, { status: 401 }),
    }
  }

  const role = session.user.role || 'owner'
  if (role === 'staff' || role === 'ca') {
    return {
      userId: null,
      isImpersonated: false,
      error: NextResponse.json({
        error: 'Forbidden',
        message: 'Only the shop owner can perform this action.',
      }, { status: 403 }),
    }
  }

  const userId = session.user.ownerId || session.user.id
  // 🔒 2026-07-26: exposed so sensitive owner-only routes can additionally
  // block an impersonating admin (assertNotImpersonated). NOT blocked here
  // wholesale — some owner-only routes are READS support legitimately needs
  // (bootstrap, subscription/status, ai-usage); blocking bootstrap would break
  // impersonation entirely. The block is applied per-route on the mutating /
  // exporting ones.
  const isImpersonated = (session.user as any).isImpersonated === true
  return { userId, isImpersonated }
}

/**
 * V17-Ext Tier 3: Write-blocking for CA (Chartered Accountant) role.
 *
 * CAs have read-only access — they can VIEW everything in their allowed
 * modules but cannot create, edit, or delete anything. This helper checks
 * if the current user is a CA and returns a 403 error if so.
 *
 * Usage in write routes (POST/PUT/DELETE/PATCH):
 *   const authCtx = await getAuthContext()
 *   if (authCtx.error || !authCtx.userId) return authCtx.error || 401
 *   const writeError = assertCanWrite(authCtx)
 *   if (writeError) return writeError
 *
 * For routes that already use getAuthUserIdWithModule + getAuthContext,
 * call assertCanWrite AFTER the module check (so the error message is
 * about write access, not module access).
 */
export function assertCanWrite(authCtx: {
  role: string
}): NextResponse | null {
  if (authCtx.role === 'ca') {
    return NextResponse.json({
      error: 'Read-only access',
      message: 'Your CA account has read-only access. Ask the shop owner to make changes.',
    }, { status: 403 })
  }
  return null
}

/**
 * 🔒 IMPERSONATION GUARDRAIL (2026-07-26, option A).
 *
 * When an admin is logged in AS a shopkeeper (via /api/impersonate), the
 * session is a full session for that user — deliberately, so support can see
 * and fix ordinary ledger data. But some actions are irreversible or affect
 * the user's ACCESS to their own account, and an admin must never take them on
 * a user's behalf:
 *
 *   - deleting the account or wiping all data
 *   - changing the login credentials (password / email / phone)
 *   - exporting the user's entire dataset
 *   - altering standing configuration that redirects data (backup targets,
 *     forwarding, integrations)
 *
 * These stay the real owner's decision. Ordinary ledger writes are allowed so
 * impersonation remains useful for support. Every impersonated action is still
 * audit-logged (see /api/impersonate).
 *
 * Usage on a sensitive route, AFTER the auth + write checks:
 *   const imp = assertNotImpersonated(authCtx)
 *   if (imp) return imp
 */
export function assertNotImpersonated(authCtx: {
  isImpersonated?: boolean
}): NextResponse | null {
  if (authCtx.isImpersonated) {
    return NextResponse.json({
      error: 'Not allowed while impersonating',
      message:
        'This action changes account access or is irreversible, so it can only be done by the account owner — not by support acting on their behalf.',
    }, { status: 403 })
  }
  return null
}

/**
 * V17-Ext Tier 3 Step 3: Combined module-access + write-block helper for
 * write routes (POST/PUT/DELETE/PATCH).
 *
 * This is the single entry point for write routes that need BOTH:
 *   1. Module permission check (canAccessModule — staff perms + CA allowlist)
 *   2. Write block (assertCanWrite — CAs are read-only)
 *
 * Usage:
 *   const authCtx = await getAuthContextForWrite('parties')
 *   if (authCtx.error || !authCtx.userId) return authCtx.error || 401
 *   const userId = authCtx.userId
 *
 * For routes that check the module DYNAMICALLY (e.g., transactions where
 * the module depends on the type: sale→'sales', purchase→'purchases'),
 * use getAuthContext() + canAccessModule() + assertCanWrite() separately
 * instead — this helper requires a static module key.
 *
 * Returns the full auth context (userId, actingUserId, role, permissions)
 * on success, or an error response on failure.
 */
export async function getAuthContextForWrite(
  module: ModuleKey
): Promise<{
  userId: string | null
  actingUserId: string | null
  role: string
  permissions: any
  error?: NextResponse
}> {
  const authCtx = await getAuthContext()
  if (authCtx.error || !authCtx.userId) return authCtx

  // Module access check (handles staff perms + CA allowlist + fail-closed)
  if (!canAccessModule(authCtx.role, authCtx.permissions, module)) {
    return {
      ...authCtx,
      userId: null,
      error: NextResponse.json({
        error: 'Forbidden',
        message: `You don't have permission to access ${module}. Contact the shop owner.`,
      }, { status: 403 }),
    }
  }

  // Write block (CA = read-only)
  const writeError = assertCanWrite(authCtx)
  if (writeError) {
    return {
      ...authCtx,
      userId: null,
      error: writeError,
    }
  }

  return authCtx
}
