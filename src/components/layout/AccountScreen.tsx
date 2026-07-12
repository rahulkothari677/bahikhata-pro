'use client'

/**
 * AccountScreen — full-screen profile/account page.
 *
 * 🔒 V21-010 (Phase 2a): Empty shell. This is the foundation for the new
 * Account/Profile page that opens when the user clicks their avatar in
 * the top bar (like CRED, PhonePe).
 *
 * This phase (2a) only creates the shell — a simple page with a title
 * and placeholder text. Subsequent phases will add:
 *   - 2b: Profile header (gradient banner with avatar)
 *   - 2c: 10 menu sections (list items with icons)
 *   - 2d: Wire up avatar click to open this page
 *   - 4a-d: Move settings sections into this page
 *   - 6a-d: Add missing features (security, referral, help, about)
 *
 * Design inspiration: CRED profile page, PhonePe profile page, Flipkart
 * Account tab. Clean, premium, card-based layout.
 *
 * Layout (final, after all phases):
 *   1. Profile header (gradient, avatar, name, shop, plan badge)
 *   2. My Profile (shop info, GSTIN, address)
 *   3. Subscription (plan, usage, billing)
 *   4. Security (app lock, change password)
 *   5. Preferences (language, dark mode, notifications)
 *   6. Data & Privacy (export, clear cache, delete account)
 *   7. Staff & Access (manage staff, CA access)
 *   8. Referral (refer & earn, your code)
 *   9. Help & Support (FAQ, contact, report bug)
 *   10. About (version, privacy, terms, rate)
 *   11. Logout
 */

import { useAppStore } from '@/store/app-store'
import { haptic } from '@/lib/haptic'
import { ArrowLeft } from 'lucide-react'

export function AccountScreen() {
  const { setView, previousView, setPreviousView } = useAppStore()

  const handleBack = () => {
    haptic.click()
    setView(previousView || 'dashboard')
    setPreviousView(null)
  }

  return (
    <div className="min-h-screen bg-muted/30 w-full flex-1">
      {/* Top bar with back button */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={handleBack}
            className="p-2 -ml-2 rounded-lg hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-bold">Account</h2>
        </div>
      </div>

      {/* Placeholder content — will be replaced in Phase 2b */}
      <div className="max-w-2xl mx-auto px-4 py-8 pb-24">
        <div className="bg-card rounded-2xl shadow-sm border border-border/60 p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Account page shell — Phase 2a complete.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Profile header, menu sections, and settings will be added in
            subsequent phases.
          </p>
        </div>
      </div>
    </div>
  )
}
