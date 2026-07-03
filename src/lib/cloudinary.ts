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
