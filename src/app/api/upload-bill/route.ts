import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { uploadBillImage } from '@/lib/cloudinary'
import { apiError } from '@/lib/api-error'

// POST /api/upload-bill - upload a bill image to Cloudinary
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('scanner')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // 🔒 V18: Rate limit uploads (20/min per user)
    const rl = await rateLimit(`upload:${userId}`, { limit: 20, windowSec: 60 })
    if (!rl.success) return rateLimitedResponse(rl)

    const { imageBase64 } = await req.json()

    if (!imageBase64) {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 })
    }

    const result = await uploadBillImage(imageBase64, userId)

    if (!result) {
      return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      url: result.url,
      publicId: result.publicId,
    })
  } catch (error) {
    return apiError(error, 'Failed to upload image', 500)
  }
}
