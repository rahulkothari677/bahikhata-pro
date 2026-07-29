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
  // 🐛 FIX (audit 2026-07-28): was a read-then-write loop with a swallowed
  // catch on BOTH halves — one findUnique plus a possible create per flag, and
  // if either threw, that flag simply never got seeded and nothing said so.
  //
  // Two requests seeding concurrently also raced: both saw "not present" and
  // both tried to create, so one hit a unique violation. That violation was
  // what the empty catch was really absorbing — along with every other error.
  //
  // createMany + skipDuplicates is a single statement that Postgres resolves
  // atomically, so the race cannot happen and nothing needs swallowing.
  try {
    await db.featureFlag.createMany({ data: DEFAULT_FLAGS, skipDuplicates: true })
  } catch (error) {
    // Seeding is best-effort by design: isFeatureEnabled falls back to each
    // flag's declared default, so an unseeded table is survivable. But it must
    // not be INVISIBLE — an admin toggling a flag that has no row would
    // otherwise be silently ignored.
    console.error('[feature-flags] seeding failed:', error instanceof Error ? error.message : error)
    import('@sentry/nextjs')
      .then(Sentry => {
        Sentry.withScope(scope => {
          scope.setTag('source', 'feature-flags')
          Sentry.captureException(error)
        })
      })
      .catch(() => {})
  }
}

/**
 * The flags this app actually has, and what each falls back to.
 *
 * 🐛 FIX (audit 2026-07-28): `isFeatureEnabled` used to `return true` for ANY
 * key it could not find, and again for any database error. Two problems:
 *
 *   1. A typo or a wrong-cased name silently enabled the feature it was meant
 *      to gate. `isFeatureEnabled('aiScanner')` — the camelCase name belonging
 *      to the OTHER flag system in this app, the user-facing `features`
 *      toggles — returned true forever, and looked like a working check. There
 *      is no way to notice that by reading the call site.
 *   2. Every flag fell back to ON, whatever its intended default. These are
 *      kill switches; the point of `new_signups: false` is to STOP signups.
 *
 * Now: unknown keys are reported rather than assumed, and a database error
 * falls back to the flag's DECLARED default instead of a blanket `true`.
 * Every current default is `true`, so today's behaviour is unchanged — but a
 * flag added as `enabled: false` will now stay off when the database blips.
 */
const FLAG_DEFAULTS: Record<string, boolean> = Object.fromEntries(
  DEFAULT_FLAGS.map(f => [f.key, f.enabled]),
)

/** Report once per key, so a hot path can't flood Sentry with the same typo. */
const reportedUnknownFlags = new Set<string>()

function reportUnknownFlag(key: string) {
  if (reportedUnknownFlags.has(key)) return
  reportedUnknownFlags.add(key)

  const err = new Error(
    `Unknown feature flag "${key}". Known flags: ${Object.keys(FLAG_DEFAULTS).join(', ')}. ` +
      `A misspelled or wrong-cased key silently behaves as ENABLED, so this gate is not gating anything. ` +
      `Note this app has a second, separate flag system (the camelCase user-facing "features" toggles) — ` +
      `passing one of those names here is the usual cause.`,
  )
  console.error('[feature-flags]', err.message)
  import('@sentry/nextjs')
    .then(Sentry => {
      Sentry.withScope(scope => {
        scope.setTag('source', 'feature-flags')
        scope.setTag('flag_key', key)
        Sentry.captureException(err)
      })
    })
    .catch(() => {})
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const known = Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, key)
  if (!known) reportUnknownFlag(key)

  try {
    const flag = await db.featureFlag.findUnique({ where: { key } })
    // Row not yet seeded — fall back to the declared default for a known flag.
    if (!flag) return known ? FLAG_DEFAULTS[key] : true
    return flag.enabled
  } catch {
    // Deliberately fail OPEN for a read error: a database blip must not switch
    // off the bill scanner for every shop at once. But "open" means the flag's
    // own default, not `true` for everything.
    return known ? FLAG_DEFAULTS[key] : true
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
