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
    // 🔒 2026-07-23: report WHERE the seconds go. A scan is the slowest
    // thing a shopkeeper does in this app, and until now the only number
    // available was total AI time — so "is it the model, the image work, or
    // the network?" could not be answered without a debugger.
    let preprocessMs = 0
    const requestStart = Date.now()
    let processedImageSource = imageSource
    if (imageBase64) {
      try {
        const t0 = Date.now()
        processedImageSource = await preprocessImageForAI(imageBase64)
        preprocessMs = Date.now() - t0
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
    // 🔒 TOKEN COST (2026-07-23). This prompt was 4,692 characters —
    // about 1,173 tokens — and it is sent in full with EVERY scan. That was
    // 53% of the input on a typical bill, more than the photo itself.
    //
    // Rewritten to ~1,500 characters with every extraction RULE preserved and
    // only the padding removed: the seven-bullet list of things the image
    // "may be" (the model handles rotation and messy handwriting without being
    // told), the restated confidence bands, and the prose around the schema.
    // The gm/ml pricing rule, the Hindi numeral and Hinglish tables, the
    // never-fabricate-a-price rule and the payment-mode inference are all kept
    // verbatim — those are the ones that decide whether the money is right.
    const basePrompt = `Read this Indian shop bill, invoice, receipt or handwritten note (any language, any handwriting, any orientation) and return ONLY this JSON, no markdown:
{"invoiceNo":str|null,"date":"YYYY-MM-DD"|null,"sellerName":str|null,"sellerPhone":str|null,"sellerGSTIN":str|null,
"items":[{"name":str,"quantity":num,"unit":"pcs|kg|ltr|box|gm|ml|dozen|packet","unitPrice":num,"gstRate":num,"total":num,"confidence":0-1}],
"subtotal":num,"discountAmount":num,"cgst":num,"sgst":num,"igst":num,"totalAmount":num,
"paymentMode":"cash|upi|card|bank|credit","overallConfidence":0-1}

RULES
1. Top name = customer (sales) or supplier (purchases). Missing quantity = 1, missing unit = "pcs".
2. UNITS/RATES: Indian bills price per kg/ltr even when quantity is in gm/ml. "500 gm @ 20" = Rs 20 PER KG = total Rs 10, NOT 500x20. Never output a per-gm or per-ml unitPrice. Convert to base units: 500 gm -> quantity 0.5 unit "kg"; 250 ml -> 0.25 "ltr". If a line total is printed, trust it and derive unitPrice = total / quantity.
3. If a price sits next to a line, it is usually the line TOTAL, not the per-unit rate: set total = that number, unitPrice = total / quantity.
4. totalAmount: use the written total if present; else sum item totals + cgst + sgst + igst - discount; else 0. NEVER invent prices that are not on the bill.
5. Hindi numerals into Arabic. Hinglish: do=2, paanch=5, sau=100, hazaar=1000, pao/pav=0.25, aadha=0.5, pauna=0.75, sava=1.25, dedh=1.5, dhai=2.5, darjan=dozen.
6. Abbreviations: atta=flour, tel=oil, chai=tea, namak=salt, chini=sugar.
7. paymentMode: cash / upi or qr / card / udhaar or baad mein or credit / else cash.
8. CGST+SGST both set, or igst alone - never all three.
9. confidence: 0.9-1.0 printed, 0.5-0.7 uncertain handwriting.`


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
    let aiFallbackReason: string | undefined
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
      aiFallbackReason = fallbackResult.fallbackReason
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
      fallbackReason: aiFallbackReason,
      timings: {
        preprocessMs,
        aiMs: aiDurationMs,
        // Everything else the route spent: auth, quota checks, usage write.
        otherMs: Math.max(0, Date.now() - requestStart - preprocessMs - aiDurationMs),
        totalMs: Date.now() - requestStart,
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
  fallbackReason?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  durationMs?: number
}

async function callWithFallback(prompt: string, imageSource: string): Promise<FallbackResult> {
  const chain: FallbackProvider[] = [
    {
      name: 'gemini',
      apiKey: process.env.GEMINI_API_KEY,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      // 🔒 COST (2026-07-23). "Lite" is cheap WITHIN a generation, not
      // across them — a trap worth spelling out:
      //
      //   gemini-3.5-flash        $1.50 / $9.00   ~Rs 766 per 1000 scans
      //   gemini-3.5-flash-lite   $0.30 / $2.50   ~Rs 188
      //   gemini-2.5-flash        $0.30 / $2.50   ~Rs 188
      //   gemini-2.5-flash-lite   $0.10 / $0.40   ~Rs  41
      //   gemini-2.0-flash-lite   $0.075 / $0.30  ~Rs  31
      //
      // (2500 input + 590 output tokens, the measured shape of a 7-line kirana
      // bill, at Rs 84.5/$. That arithmetic reproduces the Rs 0.19 the app
      // showed on a real scan, so the token counts and prices are sound.)
      //
      // 3.5-flash-lite costs the SAME as the 2.5-flash this app started on —
      // the rename hid that. Reading a bill is OCR plus arithmetic, which the
      // 2.5 lite tier has done well since it shipped, at a fifth the price.
      //
      // Kept in an env var: if handwritten Devanagari accuracy drops, raise the
      // tier from the Vercel dashboard without a code deploy.
      model: process.env.GEMINI_SCAN_MODEL || 'gemini-2.5-flash-lite',
    },
    ...(process.env.VLM_API_KEY ? [{
      name: 'vlm',
      apiKey: process.env.VLM_API_KEY,
      baseUrl: process.env.VLM_BASE_URL || 'https://api.openai.com/v1/',
      model: process.env.VLM_MODEL || 'gpt-4o-mini',
    }] : []),
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
  const primaryModel = chain[0]?.model
  let fallbackReason: string | undefined
  // 🔒 2026-07-23: log which providers were skipped for want of a key.
  // The primary provider silently vanishing from the chain is exactly how the
  // Gemini "upgrade" appeared to be live while every scan actually ran on the
  // legacy fallback — the only visible symptom was a model name on screen that
  // nobody cross-checked against the code.
  const missing = missingProviderKeys()
  if (missing.length > 0) {
    console.warn(`[scan-bill] Skipping providers with no key: ${missing.join(', ')}`)
  }
  for (const provider of chain) {
    let result = await callSingleProvider(provider, prompt, imageSource)

    // 🔒 2026-07-23: a SPEED SETTING MUST NEVER COST A REQUEST.
    //
    // Rahul set GEMINI_SCAN_MODEL to gemini-2.5-flash-lite — a model Google
    // lists as current and stable — and every scan still ran on the legacy
    // fallback at 4.6x the price. The model was fine; something in OUR request
    // was refused, and the chain treated "this provider is unusable" and "this
    // provider disliked one optional field" as the same thing.
    //
    // `reasoning_effort` is a tuning knob. If the server rejects the request
    // (4xx), retry once WITHOUT it before walking away to a costlier provider.
    // Losing a little speed beats silently changing which model bills the shop.
    if (!result.success && /HTTP 4\d\d/.test(result.error || '')) {
      const retried = await callSingleProvider(provider, prompt, imageSource, true)
      if (retried.success) {
        console.warn(
          `[scan-bill] ${provider.model} rejected the tuning params; ` +
          `succeeded without them. Original: ${result.error?.slice(0, 120)}`,
        )
        result = retried
      }
    }

    if (result.success) {
      // 🔒 FIX L1: Removed console.log — serverless log noise
      return {
        success: true,
        content: result.content,
        providerUsed: provider.name,
        modelUsed: provider.model,
        // Set only when something other than the configured primary served.
        // A silent fallback cost 4.6x per scan with no visible symptom:
        // GEMINI_SCAN_MODEL pointed at a model Google had shut down, the call
        // failed, and the legacy provider answered on a tier costing
        // Rs 188/1000 instead of the Rs 41 intended. The only clue was a model
        // name on a badge that nobody had reason to distrust.
        fallbackReason: provider.model !== primaryModel ? fallbackReason : undefined,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        durationMs: result.durationMs,
      }
    }
    console.warn(`[scan-bill] Provider ${provider.name} failed: ${result.error?.slice(0, 150)}`)
    errors.push(`${provider.name}: ${result.error?.slice(0, 100)}`)
    if (!fallbackReason) {
      // The HTTP status is safe to show; the raw provider error is not (it can
      // carry key fragments), so only the status is surfaced.
      const status = result.error?.match(/HTTP (\d{3})/)?.[1]
      // A bare status ("HTTP 400") does not say WHICH field was refused, which
      // is the one thing needed to fix it. Google's error text names the
      // offending parameter and carries no credentials; the API key lives in a
      // header, never the body. Truncated hard all the same.
      const detail = result.error
        ?.replace(/HTTP \d{3}:\s*/, '')
        .replace(/\s+/g, ' ')
        .slice(0, 160)
      fallbackReason = `${provider.model} was refused${status ? ` (HTTP ${status})` : ''}` +
        (detail ? `: ${detail}` : '')
    }
  }

  return {
    success: false,
    error: `All ${chain.length} providers failed. ${errors.join(' | ')}`,
  }
}

/**
 * Which providers were skipped for want of a key. A silent fallback is how a
 * misconfigured GEMINI_API_KEY hid for weeks: the app kept working on the
 * legacy VLM provider, so nobody noticed the "upgrade" was never running.
 */
function missingProviderKeys(): string[] {
  const missing: string[] = []
  if (!process.env.GEMINI_API_KEY) missing.push('GEMINI_API_KEY')
  return missing
}

/**
 * Provider-specific request fields that keep the model from "thinking" before
 * answering. Reading a bill needs no deliberation, and thinking is billed as
 * output tokens as well as costing seconds.
 *
 * Only Gemini gets these; sending unknown fields to other providers risks a
 * 400 from stricter OpenAI-compatible servers.
 */
function thinkingControls(provider: FallbackProvider): Record<string, unknown> {
  if (provider.name !== 'gemini') return {}
  // ὑ2 CORRECTED 2026-07-23 (same day, my own bug). My first version sent
  //   extra_body: { google: { thinking_config: { thinking_level: 'minimal' } } }
  // which is the OpenAI *SDK's* convenience wrapper — the SDK unwraps it before
  // the request goes out. This route calls the endpoint with raw fetch, so the
  // field went to the server verbatim and was ignored, exactly like the
  // Anthropic-shaped `thinking` field it replaced. Scans stayed at ~7.4s of AI
  // time with the fix "in".
  //
  // Over raw REST the documented control is the top-level `reasoning_effort`.
  // Google's own curl example sets it on a 3.x model, and reasoning cannot be
  // turned off entirely on 3.x — so 'low' is the floor there, 'none' on 2.5.
  return { reasoning_effort: /gemini-3/.test(provider.model) ? 'low' : 'none' }
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
  /**
   * Drop the optional speed tuning (reasoning_effort) and send only the
   * fields every OpenAI-compatible server accepts. Used for the one retry
   * below — see the note at the call site.
   */
  plain = false,
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
        // 🔒 THIS IS THE LATENCY (2026-07-23). The line here used to be
        //   ...(provider.name === 'gemini' ? { thinking: { type: 'disabled' } } : {})
        // which is ANTHROPIC's parameter shape. Google's OpenAI-compatibility
        // layer documents no top-level `thinking` field at all, so it was
        // silently ignored and every scan ran with thinking ON — the comment
        // promised "1-3s vs 3-8s" while delivering neither.
        //
        // The documented controls are `reasoning_effort` (2.5 models) and
        // `extra_body.google.thinking_config` (3.x). They are not
        // interchangeable: reasoning "cannot be turned off for Gemini 2.5 Pro
        // or 3 models", so 3.x gets thinking_level 'minimal' instead of none.
        ...(plain ? {} : thinkingControls(provider)),
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
