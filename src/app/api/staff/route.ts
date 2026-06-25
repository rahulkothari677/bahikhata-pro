import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'

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
        createdAt: true,
      },
    })

    return NextResponse.json({ staff })
  } catch (error) {
    console.error('Staff GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 })
  }
}

// POST /api/staff - create a new staff account linked to the owner
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Verify the current user is an owner
    const owner = await db.user.findUnique({ where: { id: userId } })
    if (!owner || owner.role !== 'owner') {
      return NextResponse.json({ error: 'Only owners can add staff' }, { status: 403 })
    }

    const { name, email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    const emailLower = email.toLowerCase()

    // Check if email already exists
    const existing = await db.user.findUnique({ where: { email: emailLower } })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    // Create staff account linked to owner
    const staff = await db.user.create({
      data: {
        email: emailLower,
        password: hashedPassword,
        name: name || null,
        role: 'staff',
        ownerId: userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ staff })
  } catch (error) {
    console.error('Staff POST error:', error)
    return NextResponse.json({ error: 'Failed to create staff account' }, { status: 500 })
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

    // Verify the staff belongs to this owner
    const staff = await db.user.findFirst({ where: { id, ownerId: userId, role: 'staff' } })
    if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

    await db.user.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Staff DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete staff' }, { status: 500 })
  }
}
