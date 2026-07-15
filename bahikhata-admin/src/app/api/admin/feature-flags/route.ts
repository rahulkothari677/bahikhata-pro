import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/feature-flags — list all flags
 * PUT /api/admin/feature-flags — toggle a flag { key, enabled }
 */

const DEFAULT_FLAGS = [
  { key: 'ai_scanner', label: 'AI Bill Scanner', description: 'Allow users to scan bills with AI', enabled: true },
  { key: 'voice_entry', label: 'Voice Entry', description: 'Voice-to-transaction feature', enabled: true },
  { key: 'gstr_export', label: 'GSTR-1 Export', description: 'Export GST returns in portal format', enabled: true },
  { key: 'whatsapp_sharing', label: 'WhatsApp Sharing', description: 'Send invoices/reminders via WhatsApp', enabled: true },
  { key: 'smart_insights', label: 'Smart Insights', description: 'AI-powered business insights and alerts', enabled: true },
  { key: 'recurring_entries', label: 'Recurring Entries', description: 'Auto-create rent/salary entries monthly', enabled: true },
  { key: 'new_signups', label: 'New Signups', description: 'Allow new user registrations', enabled: true },
  { key: 'payments', label: 'Payment Processing', description: 'Enable subscription payments (Razorpay)', enabled: false },
]

async function seedFlags() {
  for (const flag of DEFAULT_FLAGS) {
    const existing = await db.featureFlag.findUnique({ where: { key: flag.key } }).catch(() => null)
    if (!existing) {
      await db.featureFlag.create({ data: flag }).catch(() => {})
    }
  }
}

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    await seedFlags()
    const flags = await db.featureFlag.findMany({ orderBy: { key: 'asc' } })
    return NextResponse.json({ flags })
  } catch {
    return NextResponse.json({ flags: DEFAULT_FLAGS.map(f => ({ ...f, id: 'temp', updatedAt: new Date(), updatedBy: null })) })
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { key, enabled } = await req.json()
    if (!key || typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'key and enabled are required' }, { status: 400 })
    }

    await seedFlags()
    const flag = await db.featureFlag.update({
      where: { key },
      data: { enabled, updatedBy: auth.userId },
    })

    // Log the change
    await db.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'admin.feature_flag.toggle',
        entityType: 'feature_flag',
        entityId: key,
        metadata: { enabled },
      },
    }).catch(() => {})

    return NextResponse.json({ flag })
  } catch (error) {
    console.error('[admin/feature-flags] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update flag' }, { status: 500 })
  }
}
