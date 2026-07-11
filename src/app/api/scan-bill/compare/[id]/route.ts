import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { db as prisma } from '@/lib/db'
import { apiError } from '@/lib/api-error'

/**
 * PATCH /api/scan-bill/compare/[id]
 *
 * Saves the ground truth (what the user manually entered as the correct
 * answer for this bill) and recomputes accuracy scores for each provider.
 *
 * Request body:
 *   {
 *     groundTruth: {
 *       sellerName?: string | null,
 *       totalAmount?: number | null,
 *       itemsCount?: number | null,
 *       items?: Array<{ name: string, quantity: number, total: number }>
 *     }
 *   }
 *
 * Scoring rubric (0-100 per provider):
 *   - 25 pts: sellerName matches (case-insensitive, trim)
 *   - 25 pts: totalAmount within ±2% of ground truth
 *   - 25 pts: itemsCount matches exactly
 *   - 25 pts: items array — % of ground-truth items found by name match
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('scanner')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json()
    const { groundTruth } = body

    if (!groundTruth || typeof groundTruth !== 'object') {
      return NextResponse.json({ error: 'groundTruth object is required' }, { status: 400 })
    }

    // Fetch the comparison record (must belong to this user)
    const comparison = await prisma.scanComparison.findFirst({
      where: { id, userId },
    })

    if (!comparison) {
      return NextResponse.json({ error: 'Comparison not found' }, { status: 404 })
    }

    // Compute scores for each provider
    const geminiScore = comparison.geminiResult
      ? scoreProvider(comparison.geminiResult as any, groundTruth)
      : null
    const openaiScore = comparison.openaiResult
      ? scoreProvider(comparison.openaiResult as any, groundTruth)
      : null
    const groqScore = comparison.groqResult
      ? scoreProvider(comparison.groqResult as any, groundTruth)
      : null

    const updated = await prisma.scanComparison.update({
      where: { id },
      data: {
        groundTruth,
        geminiScore,
        openaiScore,
        groqScore,
      },
    })

    return NextResponse.json({
      success: true,
      scores: { gemini: geminiScore, openai: openaiScore, groq: groqScore },
    })
  } catch (error) {
    return apiError(error, 'Failed to save ground truth', 500)
  }
}

/**
 * Scores a provider's result against the ground truth.
 * Returns a number 0-100.
 */
function scoreProvider(result: any, truth: any): number {
  if (!result || !result.success || !result.parsed) return 0

  const parsed = result.parsed
  let score = 0

  // 1. Seller name match (25 pts)
  if (truth.sellerName && parsed.sellerName) {
    const a = String(truth.sellerName).toLowerCase().trim()
    const b = String(parsed.sellerName).toLowerCase().trim()
    if (a === b) score += 25
    else if (a.includes(b) || b.includes(a)) score += 15 // partial match
  } else if (!truth.sellerName && !parsed.sellerName) {
    score += 25 // both correctly absent
  }

  // 2. Total amount match (25 pts) — within 2% tolerance
  if (typeof truth.totalAmount === 'number' && typeof parsed.totalAmount === 'number') {
    const truthAmt = truth.totalAmount
    const parsedAmt = parsed.totalAmount
    if (truthAmt === 0 && parsedAmt === 0) {
      score += 25
    } else if (truthAmt > 0) {
      const diff = Math.abs(parsedAmt - truthAmt) / truthAmt
      if (diff <= 0.02) score += 25
      else if (diff <= 0.05) score += 15
      else if (diff <= 0.10) score += 5
    }
  }

  // 3. Items count match (25 pts)
  if (typeof truth.itemsCount === 'number' && Array.isArray(parsed.items)) {
    if (parsed.items.length === truth.itemsCount) score += 25
    else if (Math.abs(parsed.items.length - truth.itemsCount) === 1) score += 15
    else if (Math.abs(parsed.items.length - truth.itemsCount) === 2) score += 5
  }

  // 4. Items name match (25 pts) — % of truth items found in parsed
  if (Array.isArray(truth.items) && truth.items.length > 0 && Array.isArray(parsed.items)) {
    const parsedNames = parsed.items.map((i: any) => String(i.name || '').toLowerCase().trim())
    let matched = 0
    for (const truthItem of truth.items) {
      const tn = String(truthItem.name || '').toLowerCase().trim()
      // Match if truth name appears as substring of any parsed name (or vice versa)
      const found = parsedNames.some((pn: string) => pn && (pn.includes(tn) || tn.includes(pn)))
      if (found) matched++
    }
    score += Math.round((matched / truth.items.length) * 25)
  }

  return Math.min(100, Math.max(0, score))
}
