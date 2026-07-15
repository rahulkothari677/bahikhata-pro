import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { uploadDocument, deleteDocument } from '@/lib/cloudinary'
import { rateLimit } from '@/lib/rate-limit'
import { apiError } from '@/lib/api-error'

// File uploads to Cloudinary can take time — allow up to 60s
export const maxDuration = 60

// GET /api/documents — list all documents for the current user (excluding soft-deleted)
// Supports optional ?category= filter
export async function GET(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')

    const documents = await ((db as any).document).findMany({
      where: {
        userId: authCtx.userId,
        deletedAt: null,
        ...(category && category !== 'all' ? { category } : {}),
      },
      orderBy: { uploadedAt: 'desc' },
    })

    return NextResponse.json({ documents })
  } catch (error) {
    return apiError(error, 'Failed to load documents', 500)
  }
}

// POST /api/documents — upload a new document
// Body: { name, category, fileType, fileData (base64), notes?, tags? }
export async function POST(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    // 🔒 Rate limit: 10 uploads per minute per user
    const rl = await rateLimit(`doc-upload:${userId}`, { limit: 10, windowSec: 60 })
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many uploads. Please wait a minute.' }, { status: 429 })
    }

    const body = await req.json()
    const { name, category, fileType, fileData, notes, tags } = body

    // Validate required fields
    if (!name || !fileType || !fileData) {
      return NextResponse.json({ error: 'Missing required fields: name, fileType, fileData' }, { status: 400 })
    }

    // Validate category
    const validCategories = ['bill', 'invoice', 'gst-certificate', 'bank-statement', 'id-proof', 'other']
    const finalCategory = validCategories.includes(category) ? category : 'other'

    // Validate file size (max 10MB via base64 length check)
    const base64Content = fileData.split(',')[1] || fileData
    const estimatedSize = (base64Content.length * 3) / 4
    if (estimatedSize > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Maximum size is 10MB.' }, { status: 413 })
    }

    // Upload to Cloudinary
    const uploadResult = await uploadDocument(fileData, userId, fileType, name)
    if (!uploadResult) {
      return NextResponse.json({ error: 'Failed to upload file to storage' }, { status: 500 })
    }

    // Save metadata to DB
    const document = await ((db as any).document).create({
      data: {
        userId,
        name,
        category: finalCategory,
        fileType,
        fileSize: uploadResult.fileSize,
        cloudinaryUrl: uploadResult.url,
        cloudinaryPublicId: uploadResult.publicId,
        notes: notes || null,
        tags: Array.isArray(tags) ? tags : [],
      },
    })

    return NextResponse.json({ success: true, document })
  } catch (error) {
    return apiError(error, 'Failed to upload document', 500)
  }
}

// DELETE /api/documents — soft-delete a document (marks deletedAt, doesn't remove from Cloudinary immediately)
// Body: { id }
export async function DELETE(req: NextRequest) {
  try {
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    const { searchParams } = new URL(req.url)
    const docId = searchParams.get('id')

    if (!docId) {
      return NextResponse.json({ error: 'Missing document id' }, { status: 400 })
    }

    // Find the document (must belong to the user)
    const document = await ((db as any).document).findFirst({
      where: { id: docId, userId, deletedAt: null },
    })

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Soft-delete in DB
    await ((db as any).document).update({
      where: { id: docId },
      data: { deletedAt: new Date() },
    })

    // Also delete from Cloudinary (best-effort — don't fail if it errors)
    const resourceType = document.fileType.startsWith('image/') ? 'image' : 'raw'
    await deleteDocument(document.cloudinaryPublicId, resourceType).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    return apiError(error, 'Failed to delete document', 500)
  }
}
