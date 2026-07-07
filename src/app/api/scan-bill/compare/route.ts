import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'
import { db as prisma } from '@/lib/db'
import { compressImageForAI } from '@/lib/image-compress'
import { apiError } from '@/lib/api-error'

/**
 * POST /api/scan-bill/compare
 *
 * Sends the SAME bill image to all 3 configured AI providers (Gemini,
 * OpenAI, Groq) IN PARALLEL and returns the structured result from each.
 * Used by the /settings/ai-comparison admin page to benchmark accuracy.
 *
 * Request body:
 *   { imageBase64: string, billType?: 'sale' | 'purchase', imageName?: string }
 *
 * Response:
 *   {
 *     success: true,
 *     comparisonId: string,
 *     results: {
 *       gemini:  ProviderResult | null,   // null = key not configured
 *       openai:  ProviderResult | null,
 *       groq:    ProviderResult | null,
 *     }
 *   }
 *
 * ProviderResult:
 *   { success: boolean, parsed?: BillData, error?: string, durationMs: number }
 *
 * Rate limited: 5 comparisons per user per hour (each comparison = 3 API
 * calls = costs money, so this is intentionally tight).
 */

const SHARED_PROMPT = `You are an expert at reading Indian shop bills, invoices, receipts, AND handwritten notes on plain paper. Indian shop owners often write sales/purchases as rough notes on any paper — plain paper, notebook pages, diaries, even napkins. Your job is to read ANY text (printed or handwritten) and extract structured data.

This image may be:
- A printed bill/invoice from a supplier
- A handwritten note on plain paper (rough entry)
- A diary/notebook page with entries
- A mix of printed and handwritten text
- Written in English, Hindi, or regional languages
- Written in any handwriting style (neat or messy)
- Rotated or sideways (handle any orientation)

Analyze the image carefully and extract all information.

Return ONLY a valid JSON object with this exact structure (no markdown, no extra text):
{
  "invoiceNo": "bill/invoice number if visible, else null",
  "date": "YYYY-MM-DD format if visible, else null",
  "sellerName": "name of seller/shop/customer if visible (for handwritten notes, the name at the top is usually the customer or supplier), else null",
  "sellerPhone": "phone if visible else null",
  "sellerGSTIN": "GSTIN if visible else null",
  "items": [
    {
      "name": "product name (clean up abbreviations - 'atta' = 'Wheat Flour', 'oil' = 'Cooking Oil', etc.)",
      "quantity": number,
      "unit": "unit if visible (pcs/kg/ltr/box/gm/ml/dozen/packet) else 'pcs'",
      "unitPrice": number (price per unit if visible, else calculate from total ÷ quantity),
      "gstRate": number (GST % if visible, else 0),
      "total": number (line total — if only total is written, use that; if only unit price and qty, multiply them),
      "confidence": number (0-1, how confident you are about this item's extraction)
    }
  ],
  "subtotal": number (sum of all item totals before tax/discount),
  "discountAmount": number (total discount if visible else 0),
  "cgst": number,
  "sgst": number,
  "igst": number,
  "totalAmount": number (final payable amount. Logic: 1) If a total is explicitly written on the bill, use that number. 2) If NO total is written but item prices ARE visible, calculate it: sum all item totals + cgst + sgst + igst - discountAmount. 3) If NO prices are visible anywhere on the bill (e.g., a handwritten note with only product names and quantities), return 0. Never fabricate prices that aren't on the bill.),
  "paymentMode": "cash|upi|card|bank|credit - infer from text (if 'cash' written = cash, 'upi' or 'qr' = upi, 'card' = card, 'udhaar' or 'credit' or 'baad mein' = credit, else cash)",
  "overallConfidence": number (0-1, overall confidence in the extraction)
}

CRITICAL RULES FOR HANDWRITTEN NOTES:
1. The first name at the top of the paper is usually the customer (for sales) or supplier (for purchases).
2. Each line typically has: product name + quantity + price (in any order).
3. If quantity is missing, assume 1.
4. If unit is missing, assume 'pcs'.
5. If price is written as "100" next to "2kg sugar", the 100 might be total (not per kg) — use it as total, calculate unitPrice = total ÷ quantity.
6. If only total is written (no per-unit price), set unitPrice = total ÷ quantity, and total = the written amount.
7. Numbers may be written in Hindi numerals (०-९) — convert to Arabic (0-9).
8. Product names may be abbreviated: "atta" = flour, "tel" = oil, "chai" = tea, "namak" = salt, "chini" = sugar, etc.
9. "Udhaar" or "Baad mein" or "credit" = payment mode "credit".
10. If the word "total" or "jama" is visible, the number after it is the totalAmount.
11. Handle Hinglish: "do kilo" = 2 kg, "paanch" = 5, "sau" = 100, "hazaar" = 1000.
12. If the image is sideways or upside down, rotate it mentally and read the text correctly.
13. For messy handwriting, try your best to read each character. If uncertain, set confidence to 0.5-0.7.
14. For clearly printed bills, set confidence to 0.9-1.0.

For printed bills:
- Extract all items, GST breakdown, and totals exactly as shown.
- If CGST+SGST shown, set both. If IGST shown, set only igst.

Return JSON only, no commentary, no markdown formatting.`

interface ProviderResult {
  success: boolean
  parsed?: any
  error?: string
  durationMs: number
  tokensUsed?: number
}

interface ProviderConfig {
  name: 'gemini' | 'openai' | 'groq'
  apiKey: string | undefined
  baseUrl: string
  model: string
}

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('scanner')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Tight rate limit — comparisons cost 3x the API budget
    const rl = await rateLimit(`scan-compare:user:${userId}`, { limit: 5, windowSec: 3600 })
    if (!rl.success) return rateLimitedResponse(rl)

    const body = await req.json()
    const { imageBase64, billType = 'purchase', imageName } = body

    if (!imageBase64) {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 })
    }

    // Compress the image server-side before sending to AI providers.
    // Phone HDR photos are 3-5MB → Groq rejects with HTTP 413 (>3.5MB limit).
    // This brings it down to ~200-500KB, well under all providers' limits.
    const compressedImage = await compressImageForAI(imageBase64)

    // Build the list of providers to test (skip any with missing API keys)
    const providers: ProviderConfig[] = [
      {
        name: 'gemini',
        apiKey: process.env.GEMINI_API_KEY,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        model: 'gemini-2.5-flash',
      },
      {
        name: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: 'https://api.openai.com/v1/',
        model: 'gpt-4o-mini',
      },
      {
        name: 'groq',
        apiKey: process.env.GROQ_API_KEY,
        baseUrl: 'https://api.groq.com/openai/v1/',
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      },
    ]

    const configuredProviders = providers.filter((p) => p.apiKey)
    if (configuredProviders.length === 0) {
      return NextResponse.json({
        error: 'No AI providers configured. Set at least one of GEMINI_API_KEY, OPENAI_API_KEY, or GROQ_API_KEY in your environment variables. Get keys from: Gemini → aistudio.google.com/apikey, OpenAI → platform.openai.com/api-keys, Groq → console.groq.com/keys',
      }, { status: 503 })
    }

    // Fire all configured providers IN PARALLEL — Promise.allSettled means
    // one provider failing doesn't kill the others (key requirement for
    // comparison: see all results, even failures).
    const results = await Promise.allSettled(
      configuredProviders.map((p) => callProvider(p, compressedImage, SHARED_PROMPT))
    )

    // Assemble the result object
    const comparisonResults: Record<string, ProviderResult | null> = {
      gemini: null,
      openai: null,
      groq: null,
    }

    configuredProviders.forEach((provider, idx) => {
      const settled = results[idx]
      if (settled.status === 'fulfilled') {
        comparisonResults[provider.name] = settled.value
      } else {
        // Promise rejected entirely (network error, exception, etc.)
        comparisonResults[provider.name] = {
          success: false,
          error: `Provider call crashed: ${String(settled.reason).slice(0, 200)}`,
          durationMs: 0,
        }
      }
    })

    // Build a small thumbnail preview for the history list.
    // We use the compressed image since it's already small (~200-500KB).
    const imagePreview = compressedImage

    // Save to DB so admin can review history and we can compute averages
    const comparison = await prisma.scanComparison.create({
      data: {
        userId,
        imageName: imageName || null,
        imagePreview,
        billType,
        geminiResult: comparisonResults.gemini as any,
        openaiResult: comparisonResults.openai as any,
        groqResult: comparisonResults.groq as any,
      },
    })

    return NextResponse.json({
      success: true,
      comparisonId: comparison.id,
      results: comparisonResults,
    })
  } catch (error) {
    // 🔒 V10 §3.3: was `detail: String(error)` — leaked DB / SDK internals.
    return apiError(error, 'Failed to run comparison', 500)
  }
}

/**
 * Calls a single OpenAI-compatible VLM provider and returns structured result.
 * Used for the comparison route — same logic as scan-bill but isolated so
 * we can measure each provider independently.
 */
async function callProvider(
  provider: ProviderConfig,
  imageBase64: string,
  prompt: string,
): Promise<ProviderResult> {
  const start = Date.now()

  try {
    const response = await fetch(`${provider.baseUrl}chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageBase64 } },
            ],
          },
        ],
        max_tokens: 2000,
      }),
    })

    const durationMs = Date.now() - start

    if (!response.ok) {
      const errText = await response.text()
      // 🔒 FIX M2: Was leaking raw VLM provider error body (HTTP status + errText)
      // to the client via the `results` field. Could expose API keys, internal IDs,
      // rate-limit details, provider response shapes. Now: generic 'provider_failed'
      // + server-side log with the real error.
      console.error('[scan-compare] Provider error:', response.status, errText.slice(0, 500))
      return {
        success: false,
        error: 'provider_failed',
        durationMs,
      }
    }

    const data = await response.json()
    const content: string = data.choices?.[0]?.message?.content || ''
    const tokensUsed: number | undefined = data.usage?.total_tokens

    // Try to parse JSON from the response
    let parsed: any = null
    try {
      parsed = JSON.parse(content)
    } catch {
      // Try extracting from ```json ... ``` block
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[1]) } catch {}
      }
      // Try extracting first {...} block
      if (!parsed) {
        const objMatch = content.match(/\{[\s\S]*\}/)
        if (objMatch) {
          try { parsed = JSON.parse(objMatch[0]) } catch {}
        }
      }
    }

    if (!parsed) {
      return {
        success: false,
        error: `Could not parse JSON. Raw response (first 500 chars): ${content.slice(0, 500)}`,
        durationMs,
        tokensUsed,
      }
    }

    // Sanitize items (same logic as scan-bill route)
    if (!parsed.items) parsed.items = []
    parsed.items = parsed.items.map((item: any) => ({
      name: String(item.name || 'Unknown Product'),
      quantity: Number(item.quantity) || 1,
      unit: String(item.unit || 'pcs'),
      unitPrice: Number(item.unitPrice) || 0,
      gstRate: Number(item.gstRate) || 0,
      total: Number(item.total) || (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
      confidence: typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 0.8,
    }))
    if (typeof parsed.overallConfidence !== 'number') {
      parsed.overallConfidence = parsed.items.length > 0
        ? parsed.items.reduce((s: number, i: any) => s + (i.confidence || 0.8), 0) / parsed.items.length
        : 0.5
    }

    return {
      success: true,
      parsed,
      durationMs,
      tokensUsed,
    }
  } catch (error) {
    return {
      success: false,
      error: 'provider_failed',  // 🔒 FIX M2: was leaking raw error string
      durationMs: Date.now() - start,
    }
  }
}
