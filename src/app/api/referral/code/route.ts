import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserId } from '@/lib/get-auth'
import { withCache } from '@/lib/cache'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/referral/code
 *
 * Returns the user's referral code. Auto-generates one if it doesn't exist.
 * The code is based on the user's name + a random number (e.g. "RAHUL500").
 *
 * Also returns the referral share link + WhatsApp share text.
 */
export async function GET() {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Find existing referral code
    let referral = await db.referral.findFirst({
      where: { referrerId: userId },
    })

    // Auto-generate if doesn't exist
    if (!referral) {
      const user = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
      const namePart = (user?.name || user?.email || 'USER')
        .toUpperCase()
        .replace(/[^A-Z]/g, '')
        .slice(0, 6)
      const randomNum = Math.floor(100 + Math.random() * 900)
      const code = `${namePart}${randomNum}`

      referral = await db.referral.create({
        data: {
          referrerId: userId,
          code,
        },
      })
    }

    /*
     * 🔒 AUDIT FIX V5: Use env var instead of hardcoded URL.
     *
     * 🔒 2026-08-03: …but only if it IS a URL. Found by reading the live
     * response rather than the code: this endpoint was returning
     *
     *     "shareUrl": "NEXTAUTH_URL/?ref=RAHUL997"
     *
     * NEXT_PUBLIC_APP_URL is not set at all, so the value came from
     * NEXTAUTH_URL — whose value in the deployment environment is the literal
     * string "NEXTAUTH_URL", the variable NAME typed into the value box. The
     * code was correct; the configuration was not. Every referral link and
     * WhatsApp share a shopkeeper sent was unopenable, and nothing anywhere
     * reported a problem.
     *
     * NEXTAUTH_URL matters beyond this endpoint — it is what NextAuth uses to
     * build absolute URLs, and auth/reset-request falls back to it when a
     * request carries no Origin header, which would put a dead link in a
     * password-reset email.
     *
     * `||` only rejects an EMPTY value, so a wrong-but-present one sails
     * through. Each candidate is now checked for being an absolute http(s) URL
     * before it is trusted, so a misconfigured variable falls through to the
     * next option instead of poisoning the link. The env var still needs
     * fixing — this stops it silently reaching users while it is wrong.
     */
    const firstValidUrl = (...candidates: (string | undefined)[]): string => {
      for (const c of candidates) {
        if (!c) continue
        try {
          const u = new URL(c)
          if (u.protocol === 'http:' || u.protocol === 'https:') return c.replace(/\/+$/, '')
        } catch {
          console.warn(`[referral/code] ignoring non-URL app-url value: ${JSON.stringify(c).slice(0, 60)}`)
        }
      }
      return 'https://ekbook-pro.vercel.app'
    }
    const appUrl = firstValidUrl(process.env.NEXT_PUBLIC_APP_URL, process.env.NEXTAUTH_URL)
    const shareUrl = `${appUrl}/?ref=${referral.code}`
    const whatsappText = `🇮🇳 Check out EkBook — India's smartest ledger app! AI bill scanning, GST filing, inventory management. Use my code ${referral.code} to get started! ${shareUrl}`
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`

    return withCache({
      code: referral.code,
      shareUrl,
      whatsappUrl,
      whatsappText,
    }, { maxAge: 300, swr: 600 })
  } catch (e) {
    return apiError(e, 'Failed to get referral code', 500)
  }
}
