import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { uploadBillImage } from '@/lib/cloudinary'
import { apiError } from '@/lib/api-error'

/**
 * The shop's own payment QR image.
 *
 * 🗑️➕ 2026-08-15. Rahul removed the shareable bill link — "sharing link or
 * directly paying option sometimes cause fear in the mind of general public" —
 * and asked for "a section in the app where the user can add the image of
 * their QR or add upi id for billing so if the customer wants to pay they
 * can pay".
 *
 * Most kirana shops already have a printed PhonePe / Paytm / BharatPe QR stuck
 * to the counter. Putting THAT code on the bill is better than one this app
 * generated: it is the one their regulars already recognise, and it settles
 * into whichever account they actually use, with none of our guesses about
 * their VPA in between.
 *
 * DELIBERATELY THE SAME SHAPE as /api/settings/logo and /api/settings/signature
 * — same auth gate, same Cloudinary path, same size cap. This is the third
 * image upload in the app; a third *way* of doing it would be the "two things
 * describing one thing" mistake with one more copy to drift.
 */

/** ~3 MB of base64 ≈ 2.2 MB of image. A QR needs a fraction of that. */
const MAX_BASE64 = 4_000_000

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { image } = body
    if (!image || typeof image !== 'string') {
      return NextResponse.json({ error: 'image (base64 data URL) is required' }, { status: 400 })
    }
    if (image.length > MAX_BASE64) {
      return NextResponse.json(
        { error: 'That image is too large. Please use one under 2 MB.' },
        { status: 413 },
      )
    }

    const dataUri = image.startsWith('data:') ? image : `data:image/png;base64,${image}`
    const uploaded = await uploadBillImage(dataUri, userId)
    if (!uploaded) {
      /*
       * A 502 and a plain message, never a silent success.
       *
       * This one matters more than the signature: a shopkeeper who believes
       * their QR is on every bill, and whose customers therefore have no way
       * to pay, loses money quietly. Failing loudly is the whole point.
       */
      return NextResponse.json(
        { error: 'Could not save the QR code. Please try again.' },
        { status: 502 },
      )
    }

    await db.setting.upsert({
      where: { userId },
      update: { paymentQrUrl: uploaded.url },
      create: { userId, paymentQrUrl: uploaded.url },
    })

    return NextResponse.json({ ok: true, paymentQrUrl: uploaded.url })
  } catch (error) {
    return apiError(error, 'Failed to save the QR code')
  }
}

/**
 * DELETE — clears the uploaded QR.
 *
 * The bill falls back to generating one from the shop's UPI id, exactly as it
 * did before any image was uploaded. The Cloudinary asset is left in place,
 * matching the logo and signature routes: deleting needs the publicId, only
 * the URL is stored, and a bad parse could delete the wrong asset.
 */
export async function DELETE() {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    await db.setting.updateMany({ where: { userId }, data: { paymentQrUrl: null } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, 'Failed to remove the QR code')
  }
}
