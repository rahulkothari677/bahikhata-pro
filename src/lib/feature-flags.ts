import { db } from '@/lib/db'

const DEFAULT_FLAGS = [
  { key: 'ai_scanner', label: 'AI Bill Scanner', description: 'Allow users to scan bills with AI', enabled: true },
  { key: 'voice_entry', label: 'Voice Entry', description: 'Voice-to-transaction feature', enabled: true },
  { key: 'gstr_export', label: 'GSTR-1 Export', description: 'Export GST returns in portal format', enabled: true },
  { key: 'whatsapp_sharing', label: 'WhatsApp Sharing', description: 'Send invoices/reminders via WhatsApp', enabled: true },
  { key: 'smart_insights', label: 'Smart Insights', description: 'AI-powered business insights and alerts', enabled: true },
  { key: 'recurring_entries', label: 'Recurring Entries', description: 'Auto-create rent/salary entries monthly', enabled: true },
  { key: 'new_signups', label: 'New Signups', description: 'Allow new user registrations', enabled: true },
  // 🔒 AUDIT FIX A1: Enabled payments flag — was false, blocking all Razorpay
  // payments even though the integration is fully wired. Users can now pay.
  { key: 'payments', label: 'Payment Processing', description: 'Enable subscription payments (Razorpay)', enabled: true },
]

export async function seedFeatureFlags() {
  try {
    for (const flag of DEFAULT_FLAGS) {
      const existing = await db.featureFlag.findUnique({ where: { key: flag.key } }).catch(() => null)
      if (!existing) {
        await db.featureFlag.create({ data: flag } as any).catch(() => {})
      }
    }
  } catch {}
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  try {
    const flag = await db.featureFlag.findUnique({ where: { key } })
    if (!flag) return true
    return flag.enabled
  } catch {
    return true
  }
}

export async function getAllFeatureFlags() {
  try {
    await seedFeatureFlags()
    return await db.featureFlag.findMany({ orderBy: { key: 'asc' } })
  } catch {
    return DEFAULT_FLAGS.map(f => ({ ...f, id: 'temp', updatedAt: new Date(), updatedBy: null }))
  }
}

export async function toggleFeatureFlag(key: string, enabled: boolean, adminUserId: string) {
  try {
    return await db.featureFlag.update({
      where: { key },
      data: { enabled, updatedBy: adminUserId },
    })
  } catch {
    throw new Error('Failed to update feature flag')
  }
}
