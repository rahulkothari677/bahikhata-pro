import sharp from 'sharp'

/**
 * Compresses a base64 image for AI provider APIs.
 *
 * Problem: Phone HDR photos are 3-5MB. After base64 encoding (+33%), that's
 * 4-7MB. Groq's vision API rejects images over ~3.5MB with HTTP 413.
 * Gemini accepts up to 20MB but charges per token, so smaller = cheaper.
 *
 * Solution: Use sharp to resize + compress server-side before sending to
 * any provider. Targets ~500KB max output (well under all providers' limits).
 *
 * Input:  data URL (data:image/jpeg;base64,...) OR raw base64 string
 * Output: data URL with compressed JPEG (max 1000x1400, quality 80)
 */
export async function compressImageForAI(input: string): Promise<string> {
  try {
    // Extract the base64 data from a data URL
    const match = input.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!match) {
      // Not a data URL — assume it's already raw base64
      const buffer = Buffer.from(input, 'base64')
      const compressed = await sharp(buffer)
        .resize(1000, 1400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
      return `data:image/jpeg;base64,${compressed.toString('base64')}`
    }

    const [, , base64Data] = match
    const buffer = Buffer.from(base64Data, 'base64')

    // Resize + compress with sharp
    const compressed = await sharp(buffer)
      .resize(1000, 1400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()

    return `data:image/jpeg;base64,${compressed.toString('base64')}`
  } catch (error) {
    console.error('Image compression failed, using original:', error)
    // If compression fails (e.g., invalid image), return the original.
    // Better to try with the large image than to fail entirely.
    return input
  }
}
