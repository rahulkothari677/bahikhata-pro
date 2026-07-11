import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isEmailConfigured } from '@/lib/email'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/feature-flags
 *
 * Returns all feature flags for the app.
 * Public endpoint (no auth needed — flags are not secret).
 * Used by the app to check if features should be shown/enabled.
 *
 * 🔒 V6 PP5: Also returns `passwordResetEmailEnabled` so the login screen
 * can show an honest message ("contact support to reset") when no email
 * provider is configured, instead of letting users think reset is broken.
 */
export async function GET() {
  // Email config is not secret — just whether RESEND_API_KEY is set.
  const passwordResetEmailEnabled = isEmailConfigured()

  try {
    const flags = await db.featureFlag.findMany({
      select: { key: true, enabled: true },
    })

    // Convert to object for easy lookup: { ai_scanner: true, voice_entry: false, ... }
    const flagMap: Record<string, boolean> = {}
    flags.forEach(f => { flagMap[f.key] = f.enabled })

    // If no flags exist yet, return all enabled (fail-open)
    if (Object.keys(flagMap).length === 0) {
      return NextResponse.json({
        ai_scanner: true,
        voice_entry: true,
        gstr_export: true,
        whatsapp_sharing: true,
        smart_insights: true,
        recurring_entries: true,
        new_signups: true,
        payments: false,
        passwordResetEmailEnabled,  // 🔒 V6 PP5
      })
    }

    return NextResponse.json({
      ...flagMap,
      passwordResetEmailEnabled,  // 🔒 V6 PP5 — always included
    })
  } catch {
    // Fail-open: all features enabled
    return NextResponse.json({
      ai_scanner: true,
      voice_entry: true,
      gstr_export: true,
      whatsapp_sharing: true,
      smart_insights: true,
      recurring_entries: true,
      new_signups: true,
      payments: false,
      passwordResetEmailEnabled,  // 🔒 V6 PP5
    })
  }
}
