import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'
import {
  DEFAULT_STAFF_PERMISSIONS,
  parsePermissions,
  isValidSubAccountRole,
  type StaffPermissions,
} from '@/lib/staff-permissions'
import { checkEntityLimit } from '@/lib/usage-limits'
import { apiError } from '@/lib/api-error'
import { validateBody, updateStaffSchema } from '@/lib/validation'

// GET /api/staff - list all sub-accounts (staff + CA) for the current owner
export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // V17-Ext Tier 3 Step 2: List BOTH staff and CA accounts. Was: role:'staff' only.
    // CAs are sub-accounts managed in the same UI, so they must appear here.
    const staff = await db.user.findMany({
      where: { ownerId: userId, role: { in: ['staff', 'ca'] } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        createdAt: true,
      },
    })

    // Parse permissions for each member. For CAs, permissions are null in the DB
    // (their access is hardcoded in canAccessModule), so parsePermissions returns
    // defaults — but the UI should use the `role` field, not permissions, to
    // decide whether to show the permissions matrix.
    const staffWithPerms = staff.map((s) => ({
      ...s,
      permissions: parsePermissions(s.permissions),
    }))

    return NextResponse.json({ staff: staffWithPerms })
  } catch (error) {
    // 🔒 V10 §3.3: was `detail: String(error)` — leaked DB internals.
    return apiError(error, 'Failed to fetch staff', 500)
  }
}

// POST /api/staff - create a new sub-account (staff or CA) linked to the owner
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 🔒 V19-008 FIX: Rate limit moved from GET to POST (was blocking list, not creation)
    const rl = await rateLimit(`staff-create:${userId}`, { limit: 5, windowSec: 3600 })
    if (!rl.success) return rateLimitedResponse(rl)

    // Verify the current user is an owner
    const owner = await db.user.findUnique({ where: { id: userId } })
    if (!owner) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (owner.role === 'staff' || owner.role === 'ca') {
      return NextResponse.json({ error: 'Only owners can add sub-accounts' }, { status: 403 })
    }

    // 🔒 AUDIT FIX H2: Enforce plan limit on sub-account count (staff + CA combined).
    // V17-Ext Tier 3 Step 2: checkEntityLimit now counts role: { in: ['staff', 'ca'] }.
    const limitCheck = await checkEntityLimit(userId, 'staff')
    if (!limitCheck.allowed) {
      return NextResponse.json({
        error: 'plan_limit_reached',
        message: limitCheck.upgradeMessage,
        used: limitCheck.used,
        limit: limitCheck.limit,
      }, { status: 402 })
    }

    const body = await req.json()
    const { name, email, password, permissions, role } = body

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    // V17-Ext Tier 3 Step 2: Validate the role. Default to 'staff' for backward
    // compat (existing callers that don't send a role field still create staff).
    // 🔒 SECURITY: isValidSubAccountRole rejects 'owner', 'admin', and any
    // unknown string — a malicious client cannot escalate to owner via the API.
    const accountRole = role || 'staff'
    if (!isValidSubAccountRole(accountRole)) {
      return NextResponse.json({
        error: 'Invalid role',
        message: `Role must be one of: staff, ca. Received: ${accountRole}`,
      }, { status: 400 })
    }

    const emailLower = email.toLowerCase()

    // Check if email already exists
    const existing = await db.user.findUnique({ where: { email: emailLower } })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    // V17-Ext Tier 3 Step 2: CA accounts get permissions=null — their access
    // is hardcoded in canAccessModule (read-only allowlist). Staff accounts
    // get the default or custom permissions as before.
    const perms = accountRole === 'ca' ? null : (permissions || DEFAULT_STAFF_PERMISSIONS)

    const staff = await db.user.create({
      data: {
        email: emailLower,
        password: hashedPassword,
        name: name || null,
        role: accountRole,
        ownerId: userId,
        permissions: perms,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ staff: { ...staff, permissions: parsePermissions(staff.permissions) } })
  } catch (error) {
    // 🔒 V10 §3.3: was `detail: String(error instanceof Error ? error.message : error)`.
    return apiError(error, 'Failed to create staff account', 500)
  }
}

// PATCH /api/staff?id=xxx - update staff permissions (staff only, NOT CA)
export async function PATCH(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

    // V17-Ext Tier 3 Step 2: Find both staff AND CA accounts (so we can return
    // a proper 400 for CAs instead of a misleading 404). Was: role:'staff' only.
    const staff = await db.user.findFirst({
      where: { id, ownerId: userId, role: { in: ['staff', 'ca'] } },
    })
    if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

    // V17-Ext Tier 3 Step 2: CA accounts have hardcoded read-only access —
    // their permissions CANNOT be modified. Reject with a clear 400 so the
    // UI (Step 4) can display an appropriate message. This is a guardrail:
    // even if the UI accidentally sends a PATCH for a CA, the server refuses.
    if (staff.role === 'ca') {
      return NextResponse.json({
        error: 'Cannot modify CA permissions',
        message: 'CA accounts have fixed read-only access. Their module access cannot be customized.',
      }, { status: 400 })
    }

    // 🔒 V26 H6 FIX: Use validateBody with updateStaffSchema. Was: raw body
    // with type assertion — arbitrary keys in permissions were spread and stored.
    const body = await req.json()
    const validation = validateBody(updateStaffSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    const { permissions } = validation.data

    // Merge with defaults to ensure all keys are present
    const mergedPerms = { ...DEFAULT_STAFF_PERMISSIONS, ...permissions }

    // 🔒 V26 S1 FIX: Bump tokenVersion on permission change so the staff
    // member's existing JWT is invalidated within ~5 seconds (Redis cache TTL).
    // Was: only updated permissions — the staff member kept their OLD permissions
    // in their JWT until it expired (7 days) or they manually logged out.
    // Now: tokenVersion bump forces re-login, which re-reads the new permissions.
    const updated = await db.user.update({
      where: { id },
      data: {
        permissions: mergedPerms,
        tokenVersion: { increment: 1 },  // 🔒 V26 S1: invalidate existing session
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        createdAt: true,
      },
    })

    // 🔒 V26 S1: Invalidate the Redis cache so the revocation takes effect
    // within ~5s instead of waiting for the 5s TTL to expire naturally.
    const { invalidateTokenVersionCache } = await import('@/lib/auth')
    await invalidateTokenVersionCache(id)

    return NextResponse.json({
      staff: { ...updated, permissions: parsePermissions(updated.permissions) },
      // 🔒 V26 F5: Tell the UI that the staff member needs to re-login.
      // The tokenVersion bump revokes their current session (~5s). The UI
      // should show a note: "X will need to sign in again for these changes to take effect."
      notice: `${updated.name} will need to sign in again for these changes to take effect. Their current session has been revoked for security.`,
    })
  } catch (error) {
    console.error('Staff PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update staff permissions' }, { status: 500 })
  }
}

// DELETE /api/staff?id=xxx - remove a sub-account (staff or CA)
export async function DELETE(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdOwnerOnly()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

    // V17-Ext Tier 3 Step 2: Allow deleting both staff AND CA accounts.
    // Was: role:'staff' only — CA accounts couldn't be removed via the API.
    const staff = await db.user.findFirst({
      where: { id, ownerId: userId, role: { in: ['staff', 'ca'] } },
    })
    if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

    // 🔒 V26 S1 FIX: Bump tokenVersion BEFORE deleting the user, then invalidate
    // the cache. This ensures the deleted staff member's JWT is revoked within
    // ~5 seconds (Redis TTL). Was: just deleted the row — the jwt callback's
    // getCachedTokenVersion returned 0 for the missing user (same as a fresh
    // account's default), so the revocation check passed and the session stayed
    // valid for up to 7 days.
    //
    // We do the bump + delete in a transaction for atomicity. The bump updates
    // the row before delete so the cache invalidation can read the new version.
    // After delete, getCachedTokenVersion will return null (user not found),
    // which the jwt callback now treats as "revoke" (V26 S1 fix in auth.ts).
    await db.$transaction(async (tx) => {
      // Bump tokenVersion (this row will be deleted immediately after, but
      // the cache invalidation below needs to run against the user ID).
      await tx.user.update({
        where: { id },
        data: { tokenVersion: { increment: 1 } },
      })
      await tx.user.delete({ where: { id } })
    })

    // Invalidate the Redis cache so the revocation takes effect within ~5s
    // instead of waiting for the cache TTL to expire.
    const { invalidateTokenVersionCache } = await import('@/lib/auth')
    await invalidateTokenVersionCache(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Staff DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete staff' }, { status: 500 })
  }
}
