import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/feature-flags
 *
 * Returns all feature flags for the app.
 * Public endpoint (no auth needed — flags are not secret).
 * Used by the app to check if features should be shown/enabled.
 */
export async function GET() {
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
      })
    }

    return NextResponse.json(flagMap)
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
    })
  }
}
