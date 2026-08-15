import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { uploadBillImage } from '@/lib/cloudinary'
import { apiError } from '@/lib/api-error'

/**
 * The shop's signature image.
 *
 * 📄 Phase 3 of docs/INVOICE-ENGINE-PLAN.md. Deliberately the same shape as
 * /api/settings/logo — same auth gate, same Cloudinary path, same size cap —
 * because a second way of doing the identical thing is how two behaviours drift
 * apart. If image upload needs fixing, both are one pattern to fix.
 *
 * WHAT IT ACCEPTS. A base64 data URL, from either the drawing canvas (a
 * transparent PNG) or a photo the shopkeeper picked. The client caps the file
 * at 2 MB; this caps the string, because a client check is a convenience and a
 * server check is the rule.
 */

/** ~3 MB of base64 ≈ 2.2 MB of image. A signature needs a fraction of that. */
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
       * A shopkeeper who believes their signature is on every bill and finds it
       * is not has been misled about a legal document — this is exactly the
       * class of silent failure the audit spent a phase removing.
       */
      return NextResponse.json(
        { error: 'Could not save the signature. Please try again.' },
        { status: 502 },
      )
    }

    await db.setting.upsert({
      where: { userId },
      update: { signatureUrl: uploaded.url },
      create: { userId, signatureUrl: uploaded.url },
    })

    return NextResponse.json({ ok: true, signatureUrl: uploaded.url })
  } catch (error) {
    return apiError(error, 'Failed to save the signature')
  }
}

/**
 * DELETE — clears the signature.
 *
 * The Cloudinary asset is left in place, matching the logo route's decision:
 * deleting needs the publicId, only the URL is stored, and an orphaned image
 * costs storage while a bad parse could delete the wrong asset. The invoice
 * simply prints an empty signature line again.
 */
export async function DELETE() {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    await db.setting.updateMany({ where: { userId }, data: { signatureUrl: null } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, 'Failed to remove the signature')
  }
}
