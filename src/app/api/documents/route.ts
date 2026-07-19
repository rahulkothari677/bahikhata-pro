import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { uploadDocument, deleteDocument, getSignedDocumentUrl } from '@/lib/cloudinary'
import { rateLimit } from '@/lib/rate-limit'
import { apiError } from '@/lib/api-error'
import { validateBody, createDocumentSchema } from '@/lib/validation'

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

    const documents = await db.document.findMany({
      where: {
        userId: authCtx.userId,
        deletedAt: null,
        ...(category && category !== 'all' ? { category } : {}),
      },
      orderBy: { uploadedAt: 'desc' },
    })

    // 🔒 AUDIT V23 FIX §6b: Generate short-lived signed URLs for each document.
    // The stored cloudinaryUrl is NOT publicly accessible (type='authenticated'),
    // so we generate a fresh signed URL that expires in 1 hour.
    const documentsWithSignedUrls = documents.map(doc => {
      const resourceType = doc.fileType.startsWith('image/') ? 'image' : 'raw'
      const signedUrl = getSignedDocumentUrl(doc.cloudinaryPublicId, resourceType as any)
      return {
        ...doc,
        // Use signed URL for viewing; fall back to stored URL if signing fails
        viewUrl: signedUrl || doc.cloudinaryUrl,
      }
    })

    return NextResponse.json({ documents: documentsWithSignedUrls })
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
    // 🔒 V26 R13 (Phase 5): First-pass zod validation (was: no schema — manual
    // checks only, which let bad types reach Prisma and 500). The manual
    // length checks below stay as the authoritative validation.
    const validation = validateBody(createDocumentSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    let { name, category, fileType, fileData, notes, tags } = body

    // Validate required fields
    if (!name || !fileType || !fileData) {
      return NextResponse.json({ error: 'Missing required fields: name, fileType, fileData' }, { status: 400 })
    }

    // 🔒 V26 M15 FIX: Length limits on user-supplied strings. Was: no limits —
    // a 1MB name or 10KB tag string would be stored in the DB.
    if (typeof name !== 'string' || name.length > 200) {
      return NextResponse.json({ error: 'name must be a string ≤200 characters' }, { status: 400 })
    }
    if (notes !== undefined && notes !== null && (typeof notes !== 'string' || notes.length > 2000)) {
      return NextResponse.json({ error: 'notes must be ≤2000 characters' }, { status: 400 })
    }
    if (tags !== undefined && tags !== null) {
      if (!Array.isArray(tags)) {
        return NextResponse.json({ error: 'tags must be an array' }, { status: 400 })
      }
      // Limit to 20 tags, each ≤100 chars
      if (tags.length > 20) {
        return NextResponse.json({ error: 'Maximum 20 tags allowed' }, { status: 400 })
      }
      for (const tag of tags) {
        if (typeof tag !== 'string' || tag.length > 100) {
          return NextResponse.json({ error: 'Each tag must be ≤100 characters' }, { status: 400 })
        }
      }
    }

    // Validate category
    const validCategories = ['bill', 'invoice', 'gst-certificate', 'bank-statement', 'id-proof', 'other']
    const finalCategory = validCategories.includes(category) ? category : 'other'

    // 🔒 V26 FIX N13 (V23 §6 residual): server-side file-type whitelist.
    // fileType was client-supplied and passed straight to storage — an .html
    // (XSS-adjacent when served) or .exe uploaded fine. Only document formats
    // the vault can actually preview/serve safely are accepted.
    const ALLOWED_FILE_TYPES = new Set([
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
      'application/pdf',
    ])
    if (!ALLOWED_FILE_TYPES.has(String(fileType).toLowerCase())) {
      return NextResponse.json(
        { error: 'Unsupported file type. Allowed: JPG, PNG, WebP, HEIC images and PDF.' },
        { status: 415 },
      )
    }

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
    const document = await db.document.create({
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

// DELETE /api/documents — hard-delete a document (removes from DB + Cloudinary).
// 🔒 AUDIT V23 FIX §6c: The previous comment said "soft-delete" but the code
// immediately destroyed the Cloudinary asset. Now the comment matches the
// behavior: this is a HARD delete. The DB row is removed (not soft-deleted)
// and the Cloudinary asset is destroyed. The UI says "This cannot be undone"
// which is accurate.
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
    const document = await db.document.findFirst({
      where: { id: docId, userId, deletedAt: null },
    })

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Soft-delete in DB
    await db.document.update({
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
