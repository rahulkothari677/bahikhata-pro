import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { DEFAULT_STAFF_PERMISSIONS, parsePermissions, type StaffPermissions } from '@/lib/staff-permissions'
import { checkEntityLimit } from '@/lib/usage-limits'
import { apiError } from '@/lib/api-error'

// GET /api/staff - list all staff members for the current owner
export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const staff = await db.user.findMany({
      where: { ownerId: userId, role: 'staff' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        createdAt: true,
      },
    })

    // Parse permissions for each staff member
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

// POST /api/staff - create a new staff account linked to the owner
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Verify the current user is an owner
    const owner = await db.user.findUnique({ where: { id: userId } })
    if (!owner) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (owner.role === 'staff') {
      return NextResponse.json({ error: 'Only owners can add staff' }, { status: 403 })
    }

    // 🔒 AUDIT FIX H2: Enforce plan limit on staff count (was: no check)
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
    const { name, email, password, permissions } = body

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const emailLower = email.toLowerCase()

    // Check if email already exists
    const existing = await db.user.findUnique({ where: { email: emailLower } })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    // Create staff account with default permissions (or custom if provided)
    const perms = permissions || DEFAULT_STAFF_PERMISSIONS

    const staff = await db.user.create({
      data: {
        email: emailLower,
        password: hashedPassword,
        name: name || null,
        role: 'staff',
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

// PATCH /api/staff?id=xxx - update staff permissions
export async function PATCH(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

    // Verify the staff member belongs to this owner
    const staff = await db.user.findFirst({ where: { id, ownerId: userId, role: 'staff' } })
    if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

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

// DELETE /api/staff?id=xxx - remove a staff member
export async function DELETE(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

    const staff = await db.user.findFirst({ where: { id, ownerId: userId, role: 'staff' } })
    if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

    await db.user.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Staff DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete staff' }, { status: 500 })
  }
}
