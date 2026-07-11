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

    // 🔒 AUDIT FIX V5: Use env var instead of hardcoded URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://ekbook-pro.vercel.app'
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
