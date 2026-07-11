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

    const body = await req.json()
    const { permissions } = body as { permissions: StaffPermissions }

    if (!permissions || typeof permissions !== 'object') {
      return NextResponse.json({ error: 'Permissions object required' }, { status: 400 })
    }

    // Merge with defaults to ensure all keys are present
    const mergedPerms = { ...DEFAULT_STAFF_PERMISSIONS, ...permissions }

    const updated = await db.user.update({
      where: { id },
      data: { permissions: mergedPerms },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ staff: { ...updated, permissions: parsePermissions(updated.permissions) } })
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

    await db.user.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Staff DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete staff' }, { status: 500 })
  }
}
