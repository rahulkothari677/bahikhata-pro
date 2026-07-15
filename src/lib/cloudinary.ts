import { v2 as cloudinary } from 'cloudinary'

// Configure Cloudinary with env vars
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export { cloudinary }

// Upload a base64 image to Cloudinary
// Returns the secure URL of the uploaded image
export async function uploadBillImage(base64Image: string, userId: string): Promise<{ url: string; publicId: string } | null> {
  try {
    // Ensure the base64 has the data URL prefix
    const dataUri = base64Image.startsWith('data:') ? base64Image : `data:image/jpeg;base64,${base64Image}`

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: `ekbook/bills/${userId}`,
      resource_type: 'image',
      transformation: [
        { width: 1200, height: 1600, crop: 'limit' }, // Max 1200x1600, maintains aspect ratio
        { quality: 'auto' }, // Auto-optimize quality
        { fetch_format: 'auto' }, // Auto-select best format (webp, etc.)
      ],
    })

    return {
      url: result.secure_url,
      publicId: result.public_id,
    }
  } catch (error) {
    console.error('Cloudinary upload error:', error)
    return null
  }
}

// Delete an image from Cloudinary (when transaction is deleted)
export async function deleteBillImage(publicId: string): Promise<boolean> {
  try {
    await cloudinary.uploader.destroy(publicId)
    return true
  } catch (error) {
    console.error('Cloudinary delete error:', error)
    return false
  }
}

// 🔒 V22-14 (Batch D, Phase 7g): Upload a document (any file type) to Cloudinary.
// Supports images, PDFs, and other file types. Stores in a separate folder
// from bill images. Returns secure URL + public ID for deletion.
export async function uploadDocument(
  base64Data: string,
  userId: string,
  fileType: string,
  fileName: string,
): Promise<{ url: string; publicId: string; fileSize: number } | null> {
  try {
    const isImage = fileType.startsWith('image/')
    const isPdf = fileType === 'application/pdf'
    const resourceType = isImage ? 'image' : 'raw'  // PDFs and other files use 'raw'

    // Ensure the base64 has the data URL prefix
    const mimeType = fileType || 'application/octet-stream'
    const dataUri = base64Data.startsWith('data:')
      ? base64Data
      : `data:${mimeType};base64,${base64Data}`

    // Calculate file size from base64 (approximate)
    const base64Content = base64Data.split(',')[1] || base64Data
    const fileSize = Math.ceil((base64Content.length * 3) / 4)

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: `ekbook/documents/${userId}`,
      resource_type: resourceType,
      // Only apply image transformations for images
      ...(isImage ? {
        transformation: [
          { width: 1600, height: 2000, crop: 'limit' },
          { quality: 'auto' },
          { fetch_format: 'auto' },
        ],
      } : {}),
      // Use original filename as public_id (sanitized)
      public_id: fileName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) + '_' + Date.now(),
    })

    return {
      url: result.secure_url,
      publicId: result.public_id,
      fileSize,
    }
  } catch (error) {
    console.error('Cloudinary document upload error:', error)
    return null
  }
}

// Delete a document from Cloudinary
export async function deleteDocument(publicId: string, resourceType: 'image' | 'raw' = 'raw'): Promise<boolean> {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType })
    return true
  } catch (error) {
    console.error('Cloudinary document delete error:', error)
    return false
  }
}
