import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { rateLimit, getClientIP, rateLimitedResponse } from '@/lib/rate-limit'
import { checkUsage, incrementUsage } from '@/lib/usage-limits'
import { calculateCostInr } from '@/lib/ai-pricing'
import { db } from '@/lib/db'
import { roundMoney, calculateGst, splitGst } from '@/lib/money'
import { preprocessImageForAI } from '@/lib/image-compress'
import { apiError } from '@/lib/api-error'

// ⏱️ Vercel serverless timeout — AI bill scanning can take 3-8s on big
// handwritten images. Set explicit maxDuration so the route doesn't hit
// the platform default (10s on Hobby) and fail with a 5xx.
// (Audit fix Phase 1.3)
export const maxDuration = 60

// POST /api/scan-bill - uses VLM to extract bill data from image
// Supports two modes:
// 1. Z.AI SDK (for sandbox/dev - auto-configured)
// 2. OpenAI-compatible API (for production - set VLM_API_KEY & VLM_BASE_URL env vars)
//
// Tier limits (FUP):
//   Free:  20 scans/month (DB-backed, resets monthly)
//   Pro:   50 scans/day (in-memory, resets daily) — marketed as "Unlimited"
//   Elite: 100 scans/day (in-memory, resets daily) — marketed as "Truly Unlimited"
// Plus 10 scans per IP per hour (anti-abuse — prevents account sharing)
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('scanner')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Rate limit by IP (anti-abuse — prevents one user from logging in from many IPs)
    // 🔒 FIX M1: Added { failClosed: true } — during Redis outage, the IP limiter
    // falls back to in-memory per-instance counters. On Vercel, a determined user
    // could fan out across instances and bypass the 10-scans/hour cap, burning AI
    // budget. failClosed denies the request if Redis is unavailable.
    const ip = getClientIP(req)
    const ipRL = await rateLimit(`scan:ip:${ip}`, { limit: 10, windowSec: 3600 }, { failClosed: true })
    if (!ipRL.success) return rateLimitedResponse(ipRL)

    // Tier-based quota check. For Free: monthly DB counter. For Pro/Elite:
    // daily in-memory limiter. Returns 402 with upgrade message if exceeded.
    const usageCheck = await checkUsage(userId, 'aiScans')
    if (!usageCheck.allowed) {
      return NextResponse.json({
        error: 'quota_exceeded',
        message: usageCheck.upgradeMessage,
        used: usageCheck.used,
        limit: usageCheck.limit,
        remaining: usageCheck.remaining,
        resetAt: usageCheck.resetAt.toISOString(),
        plan: usageCheck.plan,
        period: usageCheck.period,
      }, { status: 402 })
    }

    const body = await req.json()
    const { imageBase64, imageUrl, billType = 'purchase' } = body

    // 🔒 V26 M14 FIX: Validate billType + scanLang. Was: unvalidated — any
    // string could be stored as billType and interpolated into the AI prompt.
    if (!['sale', 'purchase'].includes(billType)) {
      return NextResponse.json({ error: 'billType must be "sale" or "purchase"' }, { status: 400 })
    }
    const scanLang = body.scanLang || 'original'
    const VALID_SCAN_LANGS = ['original', 'en', 'hi', 'gu', 'mr', 'ta', 'te']
    if (!VALID_SCAN_LANGS.includes(scanLang)) {
      return NextResponse.json({ error: `scanLang must be one of: ${VALID_SCAN_LANGS.join(', ')}` }, { status: 400 })
    }

    // Accept either a Cloudinary URL or base64
    const imageSource = imageUrl || imageBase64

    if (!imageSource) {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 })
    }

    // 🔒 AUDIT FIX H8: Image size + type guard (cost/DoS protection)
    // Was: no limit — a user could send a 50MB image and burn AI budget.
    // Now: reject images over 8MB; validate base64 is a valid image format.
    const MAX_IMAGE_SIZE = 8 * 1024 * 1024 // 8 MB
    if (imageBase64) {
      // Base64 is ~33% larger than binary, so check decoded size
      const decodedSize = Math.ceil(imageBase64.length * 0.75)
      if (decodedSize > MAX_IMAGE_SIZE) {
        return NextResponse.json({
          error: 'Image too large',
          message: `Image must be under 8MB. Yours is ${(decodedSize / 1024 / 1024).toFixed(1)}MB.`,
        }, { status: 413 })
      }
      // Validate it looks like a base64 image (data URI or raw base64 of JPEG/PNG/WebP)
      const isDataUri = imageBase64.startsWith('data:image/')
      if (isDataUri) {
        const mime = imageBase64.match(/^data:(image\/\w+)/)
        if (mime && !['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(mime[1])) {
          return NextResponse.json({
            error: 'Unsupported image format',
            message: `Only JPEG, PNG, and WebP are supported. Got: ${mime[1]}`,
          }, { status: 400 })
        }
      }
    }

    // 🔒 AUDIT FIX V4 AI-4: Lightweight server-side preprocessing.
    // Pipeline: grayscale → normalize/auto-contrast → resize longest edge to
    // 1600px → JPEG q80. `sharp` is already a dependency (Next.js ships it).
    // This measurably improves VLM extraction on faint thermal-printed and
    // photographed-at-angle bills (the common Indian kirana case) AND cuts
    // token cost (smaller image). Strictly-better input — no A/B needed.
    //
    // Only base64 images are preprocessed here. Cloudinary URLs (imageUrl)
    // are already optimized at upload time, so we send them as-is. (If we
    // wanted to preprocess URLs too, we'd fetch → preprocess → re-upload,
    // which is extra I/O for marginal gain.)
    let processedImageSource = imageSource
    if (imageBase64) {
      try {
        const t0 = Date.now()
        processedImageSource = await preprocessImageForAI(imageBase64)
        // 🔒 FIX L1: Removed console.log — serverless log noise
      } catch (preErr) {
        // preprocessImageForAI already swallows errors + returns the original,
        // but be defensive — never let preprocessing block a scan.
        console.warn('[scan-bill] Preprocessing skipped:', preErr)
        processedImageSource = imageSource
      }
    }

    // ⚠️ PROMPT CACHING: This prompt must be a BYTE-IDENTICAL constant across all
    // requests. Gemini 2.5 Flash has implicit context caching — if the same prompt
    // is sent within 1 hour, subsequent calls pay ~10% of input cost (vs 100%).
    // DO NOT interpolate user-specific data (userId, billType, etc.) into this
    // string — that would break the cache. Pass variable data via the image only.
    // Estimated savings: 70% on input tokens after the first scan each hour.
    //
    // LANGUAGE: The scanLang parameter controls output language for item names.
    // 'original' = keep the bill's language, 'en' = English, 'hi' = Hindi, etc.
    // This is appended to the prompt (breaks cache slightly, but language is important).
    const basePrompt = `You are an expert at reading Indian shop bills, invoices, receipts, AND handwritten notes on plain paper. Indian shop owners often write sales/purchases as rough notes on any paper — plain paper, notebook pages, diaries, even napkins. Your job is to read ANY text (printed or handwritten) and extract structured data.

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
11. Handle Hinglish: "do kilo" = 2 kg, "paanch" = 5, "sau" = 100, "hazaar" = 1000. Also fractional quantity words: "pao"/"pav" = 0.25 kg, "aadha"/"adha" = 0.5, "pauna" = 0.75, "sava" = 1.25, "dedh" = 1.5, "dhai" = 2.5, "darjan" = dozen.
11b. UNITS & RATES (very important): Indian bills price by kg/ltr even when the quantity is in gm/ml. "500 gm @ 20" means ₹20 PER KG → total ₹10, NOT 500 × 20. NEVER output a per-gm or per-ml unitPrice. For gm/ml lines: output quantity in the BASE unit as a decimal (500 gm → quantity 0.5, unit "kg"; 250 ml → 0.25, unit "ltr") with unitPrice per kg/ltr. If the line total is printed, ALWAYS trust the printed total and derive unitPrice = total ÷ quantity(base units).
12. If the image is sideways or upside down, rotate it mentally and read the text correctly.
13. For messy handwriting, try your best to read each character. If uncertain, set confidence to 0.5-0.7.
14. For clearly printed bills, set confidence to 0.9-1.0.

For printed bills:
- Extract all items, GST breakdown, and totals exactly as shown.
- If CGST+SGST shown, set both. If IGST shown, set only igst.

Return JSON only, no commentary, no markdown formatting.`

    // Language instruction (appended to prompt)
    // 'original' = keep bill language, otherwise translate item names to selected language
    // scanLang was already validated + declared at line 65 (V26 M14 fix)
    const langInstruction = scanLang === 'original'
      ? '\n\nIMPORTANT: Return item names in the SAME language as written on the bill. Do NOT translate.'
      : `\n\nIMPORTANT: Return all item names in ${getLanguageName(scanLang)} language. Translate if the bill is in a different language.`

    const prompt = basePrompt + langInstruction

    let content = ''

    // AI metadata for cost tracking — populated by the provider call,
    // logged to AiUsageLog after successful parse
    let aiProviderUsed = 'zai-sdk'
    let aiModelUsed = 'zai-sdk'
    let aiInputTokens = 0
    let aiOutputTokens = 0
    let aiTotalTokens = 0
    let aiDurationMs = 0

    // Mode 1: Try Z.AI SDK first (works in sandbox/dev)
    if (!process.env.VLM_API_KEY && !process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY) {
      try {
        const ZAI = (await import('z-ai-web-dev-sdk')).default
        const zai = await ZAI.create()
        const vlm = await (zai as any).images.vlm.create()

        const response = await vlm.invoke({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: processedImageSource } },
              ],
            },
          ],
        })

        if (typeof response === 'string') {
          content = response
        } else if (response?.choices?.[0]?.message?.content) {
          content = response.choices[0].message.content
        } else if (response?.content) {
          content = response.content
        } else {
          content = JSON.stringify(response)
        }
      } catch (zaiError) {
        console.error('Z.AI SDK error:', zaiError)
        return NextResponse.json({
          error: 'AI scanner not configured for production',
          detail: 'Set VLM_API_KEY (or GEMINI_API_KEY / OPENAI_API_KEY / GROQ_API_KEY) and VLM_BASE_URL environment variables in Vercel to enable AI bill scanning. See README for setup instructions.',
          needsConfig: true,
        }, { status: 503 })
      }
    } else {
      // Mode 2: Production — use fallback chain across configured providers.
      //
      // Chain order (best accuracy → worst, per user testing on Hindi bills):
      //   1. Gemini 2.5-flash  (best Hindi accuracy, cheapest)
      //   2. OpenAI gpt-4o-mini (good fallback, more expensive)
      //   3. Groq llama-3.2-90b (last resort, weaker on Hindi)
      //
      // Backward compat: if VLM_API_KEY is set (legacy single-provider config),
      // use it directly with no fallback. This preserves the existing setup
      // for users who haven't migrated to the multi-provider env vars yet.
      const fallbackResult = await callWithFallback(prompt, processedImageSource)

      if (!fallbackResult.success) {
        // Log the failed attempt for cost tracking (failed calls still
        // consume tokens on the provider side, so we track them too)
        await db.aiUsageLog.create({
          data: {
            userId,
            feature: 'scan-bill',
            provider: fallbackResult.providerUsed || 'unknown',
            model: fallbackResult.modelUsed || 'unknown',
            inputTokens: fallbackResult.inputTokens || 0,
            outputTokens: fallbackResult.outputTokens || 0,
            totalTokens: fallbackResult.totalTokens || 0,
            costInr: calculateCostInr(
              fallbackResult.providerUsed || 'unknown',
              fallbackResult.modelUsed || '',
              fallbackResult.inputTokens || 0,
              fallbackResult.outputTokens || 0,
            ),
            durationMs: fallbackResult.durationMs || 0,
            success: false,
            errorMessage: fallbackResult.error?.slice(0, 500),
          },
        }).catch(() => {}) // don't fail the request if logging fails

        return apiError(
          new Error('All AI providers failed'),
          'All AI providers failed — please try again',
          502,
          { providerError: fallbackResult.error?.slice(0, 500) }, // server-side only
        )
      }
      content = fallbackResult.content!
      // Save metadata for logging after successful parse
      aiProviderUsed = fallbackResult.providerUsed || 'unknown'
      aiModelUsed = fallbackResult.modelUsed || 'unknown'
      aiInputTokens = fallbackResult.inputTokens || 0
      aiOutputTokens = fallbackResult.outputTokens || 0
      aiTotalTokens = fallbackResult.totalTokens || 0
      aiDurationMs = fallbackResult.durationMs || 0
    }

    // Try to parse JSON from response
    let parsed: any = null
    try {
      parsed = JSON.parse(content)
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1])
        } catch {}
      }
      if (!parsed) {
        const objMatch = content.match(/\{[\s\S]*\}/)
        if (objMatch) {
          try {
            parsed = JSON.parse(objMatch[0])
          } catch {}
        }
      }
    }

    if (!parsed) {
      return NextResponse.json({
        error: 'Could not parse bill data',
        rawContent: content.slice(0, 2000),
      }, { status: 422 })
    }

    // Sanitize
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
    // Ensure overallConfidence exists
    if (typeof parsed.overallConfidence !== 'number') {
      parsed.overallConfidence = parsed.items.length > 0
        ? parsed.items.reduce((s: number, i: any) => s + (i.confidence || 0.8), 0) / parsed.items.length
        : 0.5
    }

    // 🔒 AUDIT FIX AI-1 (v3): Compute totals server-side, don't trust AI's arithmetic.
    // LLMs are unreliable at multi-number math. We recompute subtotal, GST, and
    // total from the item-level data using money.ts helpers. If the AI's total
    // doesn't match our computed total, we flag it as "needs review".
    //
    // 🔒 V26 H9 FIX: Was: GST computed on pre-discount gross (quantity * unitPrice).
    // The actual save (computeLineItems) computes GST on POST-DISCOUNT taxable
    // (order discount distributed proportionally). So the preview showed different
    // GST than what would be saved. Now: distribute the discount proportionally
    // across items BEFORE computing GST, matching computeLineItems' behavior.
    const aiTotalAmount = Number(parsed.totalAmount) || 0
    const grossSubtotal = roundMoney(
      parsed.items.reduce((s: number, i: any) => s + (i.quantity * i.unitPrice), 0)
    )
    const computedDiscount = Number(parsed.discountAmount) || 0

    // Distribute discount proportionally across items (matching computeLineItems)
    let computedGst = 0
    let computedSubtotal = 0
    if (grossSubtotal > 0 && computedDiscount > 0) {
      // Proportional discount distribution
      let remainingDiscount = computedDiscount
      parsed.items.forEach((item: any, idx: number) => {
        const itemGross = roundMoney(item.quantity * item.unitPrice)
        const isLast = idx === parsed.items.length - 1
        const itemDiscount = isLast
          ? remainingDiscount  // last item absorbs rounding residual
          : roundMoney((itemGross / grossSubtotal) * computedDiscount)
        remainingDiscount = roundMoney(remainingDiscount - itemDiscount)
        const itemTaxable = roundMoney(itemGross - itemDiscount)
        computedSubtotal = roundMoney(computedSubtotal + itemGross)
        computedGst = roundMoney(computedGst + calculateGst(itemTaxable, item.gstRate))
      })
    } else {
      // No discount — simple path
      computedSubtotal = grossSubtotal
      parsed.items.forEach((item: any) => {
        computedGst = roundMoney(computedGst + calculateGst(item.quantity * item.unitPrice, item.gstRate))
      })
    }

    const { cgst: computedCgst, sgst: computedSgst } = splitGst(computedGst)
    const computedTotal = roundMoney(computedSubtotal - computedDiscount + computedGst)

    // Override AI's totals with computed values (more reliable)
    parsed.subtotal = computedSubtotal
    parsed.discountAmount = computedDiscount
    parsed.cgst = computedCgst
    parsed.sgst = computedSgst
    parsed.igst = 0  // CGST+SGST is the default; inter-state is decided on save
    parsed.totalAmount = computedTotal

    // Reconciliation: if AI saw a total on the bill, compare with our computed total
    parsed.needsReview = false
    parsed.reviewReason = null
    if (aiTotalAmount > 0 && Math.abs(aiTotalAmount - computedTotal) > 1) {
      parsed.needsReview = true
      parsed.reviewReason = `Bill shows ₹${aiTotalAmount.toFixed(2)} but calculated total is ₹${computedTotal.toFixed(2)}. Please verify.`
      parsed.aiTotalAmount = aiTotalAmount  // keep the AI's number for display
    }

    // Record successful scan in usage tracking (after AI succeeded, so users
    // don't lose credits on failed scans).
    await incrementUsage(userId, 'aiScans')

    // Log the AI call with token counts + cost for the usage dashboard.
    // Fire-and-forget (non-blocking) so the user doesn't wait for the log write.
    const costInr = calculateCostInr(aiProviderUsed, aiModelUsed, aiInputTokens, aiOutputTokens)
    db.aiUsageLog.create({
      data: {
        userId,
        feature: 'scan-bill',
        provider: aiProviderUsed,
        model: aiModelUsed,
        inputTokens: aiInputTokens,
        outputTokens: aiOutputTokens,
        totalTokens: aiTotalTokens,
        costInr,
        durationMs: aiDurationMs,
        success: true,
      },
    }).catch(() => {}) // don't fail the request if logging fails

    // Include token usage in the response so the client can display it
    return NextResponse.json({
      success: true,
      bill: parsed,
      aiUsage: {
        provider: aiProviderUsed,
        model: aiModelUsed,
        inputTokens: aiInputTokens,
        outputTokens: aiOutputTokens,
        totalTokens: aiTotalTokens,
        costInr: Math.round(costInr * 100) / 100,
        durationMs: aiDurationMs,
      },
    })
  } catch (error) {
    // 🔒 V10 §3.3: was `detail: String(error)` — leaked VLM provider errors
    // (model names, API key fragments in some SDK error subclasses) to client.
    return apiError(error, 'Failed to scan bill', 500)
  }
}
// Force fresh deploy Wed Jun 24 19:32:36 UTC 2026
// Force fresh deploy for VLM config Wed Jun 24 20:09:13 UTC 2026

// =====================================================================
// Fallback chain — tries providers in order until one succeeds.
// Used in production when at least one AI provider env var is set.
// =====================================================================

interface FallbackProvider {
  name: string
  apiKey: string | undefined
  baseUrl: string
  model: string
}

interface FallbackResult {
  success: boolean
  content?: string
  error?: string
  providerUsed?: string
  modelUsed?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  durationMs?: number
}

async function callWithFallback(prompt: string, imageSource: string): Promise<FallbackResult> {
  // Build the fallback chain in priority order.
  // 1. If VLM_API_KEY is set, try it FIRST. If it fails (e.g., 429 quota),
  //    fall through to the multi-provider chain.
  // 2. Try Gemini → OpenAI → Groq in that order.
  if (process.env.VLM_API_KEY) {
    const result = await callSingleProvider(
      {
        name: 'vlm',
        apiKey: process.env.VLM_API_KEY,
        baseUrl: process.env.VLM_BASE_URL || 'https://api.openai.com/v1/',
        model: process.env.VLM_MODEL || 'gpt-4o-mini',
      },
      prompt,
      imageSource,
    )
    if (result.success) {
      return {
        success: true,
        content: result.content,
        providerUsed: 'vlm',
        modelUsed: process.env.VLM_MODEL || 'gpt-4o-mini',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        durationMs: result.durationMs,
      }
    }
    // VLM_API_KEY failed (e.g., 429 quota exceeded) — fall through to
    // the multi-provider chain below (Gemini → OpenAI → Groq)
    console.warn(`[scan-bill] VLM provider failed (${result.error?.slice(0, 100)}), trying fallback chain...`)
  }

  const chain: FallbackProvider[] = [
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
  ].filter((p) => p.apiKey) // skip providers with no key

  if (chain.length === 0) {
    return {
      success: false,
      error: 'No AI provider configured. Set VLM_API_KEY (legacy) or any of GEMINI_API_KEY, OPENAI_API_KEY, GROQ_API_KEY.',
    }
  }

  const errors: string[] = []
  for (const provider of chain) {
    const result = await callSingleProvider(provider, prompt, imageSource)
    if (result.success) {
      // 🔒 FIX L1: Removed console.log — serverless log noise
      return {
        success: true,
        content: result.content,
        providerUsed: provider.name,
        modelUsed: provider.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        durationMs: result.durationMs,
      }
    }
    console.warn(`[scan-bill] Provider ${provider.name} failed: ${result.error?.slice(0, 150)}`)
    errors.push(`${provider.name}: ${result.error?.slice(0, 100)}`)
  }

  return {
    success: false,
    error: `All ${chain.length} providers failed. ${errors.join(' | ')}`,
  }
}

/**
 * Calls a single OpenAI-compatible VLM provider. Returns the raw text
 * response (which should be JSON containing the parsed bill data) plus
 * token usage info for cost tracking.
 */
async function callSingleProvider(
  provider: FallbackProvider,
  prompt: string,
  imageSource: string,
): Promise<{
  success: boolean
  content?: string
  error?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  durationMs?: number
}> {
  const start = Date.now()
  try {
    // 🔒 V26 R8 (Phase 5): Per-provider timeout. Was: no AbortSignal → a hung
    // primary provider consumed the whole 60s budget before the fallback chain
    // ran. Now: 15s per provider — if it doesn't respond, the fallback fires.
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
              { type: 'image_url', image_url: { url: imageSource } },
            ],
          },
        ],
        // 🔒 AUDIT FIX AI-2 (v3): Force JSON response format.
        // Was: model wraps JSON in ```json fences, or adds commentary text
        // → JSON.parse fails → fallback regex extraction → sometimes misses.
        // Now: response_format tells the model to return pure JSON.
        // Gemini's OpenAI-compatible endpoint supports this via response_format.
        response_format: { type: 'json_object' },
        max_tokens: 2000,
        // 🔒 AUDIT FIX AI-3 (v3): Temperature 0 for deterministic extraction.
        // Was: no temperature set → defaults to 1.0 → run-to-run variance on
        // the same bill. Now: 0 for extraction (no randomness).
        temperature: 0,
        // Disable Gemini "thinking" mode for faster response (1-3s vs 3-8s)
        // Slight accuracy tradeoff, but much better UX
        ...(provider.name === 'gemini' ? { thinking: { type: 'disabled' } } : {}),
      }),
      // 🔒 V26 R8 (Phase 5): 15s per-provider timeout. If the primary provider
      // hangs, the fallback chain runs instead of consuming the whole 60s budget.
      signal: AbortSignal.timeout(15_000),
    })

    const durationMs = Date.now() - start

    if (!response.ok) {
      const errText = await response.text()
      return { success: false, error: `HTTP ${response.status}: ${errText.slice(0, 200)}`, durationMs }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    if (!content) {
      return { success: false, error: 'Empty response from provider', durationMs }
    }

    // Extract token usage from the provider's response.
    // OpenAI-compatible APIs return: { usage: { prompt_tokens, completion_tokens, total_tokens } }
    const inputTokens = data.usage?.prompt_tokens || 0
    const outputTokens = data.usage?.completion_tokens || 0
    const totalTokens = data.usage?.total_tokens || (inputTokens + outputTokens)

    return { success: true, content, inputTokens, outputTokens, totalTokens, durationMs }
  } catch (error) {
    return { success: false, error: String(error).slice(0, 200), durationMs: Date.now() - start }
  }
}

// Helper: get language name from code for AI prompt
function getLanguageName(code: string): string {
  const names: Record<string, string> = {
    'en': 'English',
    'hi': 'Hindi',
    'ta': 'Tamil',
    'gu': 'Gujarati',
    'mr': 'Marathi',
    'bn': 'Bengali',
    'te': 'Telugu',
    'kn': 'Kannada',
    'ml': 'Malayalam',
    'pa': 'Punjabi',
  }
  return names[code] || 'English'
}
