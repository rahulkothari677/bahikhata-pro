import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserId } from '@/lib/get-auth'
import { uploadBillImage } from '@/lib/cloudinary'

// POST /api/upload-bill - upload a bill image to Cloudinary
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    console.error('Upload bill error:', error)
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 })
  }
}
