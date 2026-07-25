'use client'

import { useSession, signOut } from 'next-auth/react'
import { ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'

/**
 * ImpersonationBanner — shown when the current session was created via
 * /api/auth/impersonate (admin impersonating a shopkeeper).
 *
 * 🐛 INTEGRATION PHASE D.3 (2026-07-25):
 *   - Reads session.user.isImpersonated (set by the jwt callback when the
 *     JWT has isImpersonated=true)
 *   - Shows a yellow sticky banner at the very top of the screen
 *   - "Exit Impersonation" button calls signOut() → clears the session cookie
 *     → user is redirected to / (login screen)
 *   - Banner is dismissible (X button) but reappears on next page load —
 *     this is intentional so the admin can't forget they're impersonating
 *
 * The banner is rendered in the root layout (above the Header) so it's
 * visible on every screen.
 */
export function ImpersonationBanner() {
  const { data: session } = useSession()
  const [dismissed, setDismissed] = useState(false)

  const isImpersonated = (session?.user as any)?.isImpersonated === true
  const adminEmail = (session?.user as any)?.impersonatedBy as string | undefined

  if (!isImpersonated || dismissed) return null

  return (
    <div
      role="alert"
      aria-live="polite"
      className="sticky top-0 z-50 w-full bg-amber-500 text-white px-4 py-2 flex items-center justify-between gap-3 text-sm shadow-md"
    >
      <div className="flex items-center gap-2 min-w-0">
        <ShieldAlert className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <span className="font-medium truncate">
          Impersonating {session?.user?.email || 'user'}
        </span>
        {adminEmail && (
          <span className="text-amber-100 truncate hidden sm:inline">
            (started by {adminEmail})
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="bg-white text-amber-700 font-medium px-3 py-1 rounded text-xs hover:bg-amber-50 transition"
        >
          Exit Impersonation
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss banner"
          className="text-amber-100 hover:text-white transition p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
