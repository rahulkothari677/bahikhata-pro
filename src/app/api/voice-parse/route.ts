import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserId } from '@/lib/get-auth'
import { checkUsage, incrementUsage } from '@/lib/usage-limits'
import { tryParseLocally } from '@/lib/voice-regex-parser'

// POST /api/voice-parse - parse voice transcript into transaction data
// Tier limits (FUP):
//   Free:  20 voice entries/month (DB-backed, resets monthly)
//   Pro:   50 voice entries/day (in-memory, resets daily) — marketed as "Unlimited"
//   Elite: 100 voice entries/day (in-memory, resets daily) — marketed as "Truly Unlimited"
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Tier-based quota check. For Free: monthly DB counter. For Pro/Elite:
    // daily in-memory limiter. Returns 402 with upgrade message if exceeded.
    const usageCheck = await checkUsage(userId, 'voiceParses')
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

    const { transcript } = await req.json()

    if (!transcript || !transcript.trim()) {
      return NextResponse.json({ error: 'No transcript provided' }, { status: 400 })
    }

    // Phase 2.2: Local regex pre-filter. For simple entries like "cash 500"
    // or "ram ko 1000 upi diya", parse locally WITHOUT calling the LLM.
    // Saves ~₹0.01 + ~500ms latency per match. ~20% of voice entries hit this.
    const localParsed = tryParseLocally(transcript)
    if (localParsed) {
      // Still increment usage so the daily quota applies (otherwise users
      // could bypass limits with simple entries)
      await incrementUsage(userId, 'voiceParses')
      return NextResponse.json({
        success: true,
        transaction: localParsed,
        _source: 'regex',  // analytics: how often regex hits vs LLM
      })
    }

    // Check if VLM_API_KEY is configured
    if (!process.env.VLM_API_KEY) {
      return NextResponse.json({
        error: 'AI not configured. Set VLM_API_KEY in environment variables.',
      }, { status: 503 })
    }

    // ⚠️ PROMPT CACHING: This system prompt must be a BYTE-IDENTICAL constant.
    // Gemini 2.5 Flash has implicit context caching — if the same prompt prefix
    // is sent within 1 hour, subsequent calls pay ~10% of input cost.
    // The user's transcript is sent as a SEPARATE message so the system prompt
    // stays cache-friendly. DO NOT interpolate transcript into this string.
    const systemPrompt = `You are an expert at understanding Indian shop owners' voice commands for creating sales/purchase entries. Parse the spoken text provided by the user and extract structured transaction data.

The user might speak in English, Hindi, or a mix (Hinglish). Examples:
- "Sold 2 kg sugar to Ramesh at 50 rupees cash" → sale, customer: Ramesh, sugar 2kg @₹50, payment: cash
- "Ramesh ne 2 kg chini liya 50 rupaye cash" → sale, customer: Ramesh, sugar 2kg @₹50, payment: cash
- "Bought 10 box tea from Tata suppliers for 2000 on credit" → purchase, supplier: Tata suppliers, tea 10 box @₹200, payment: credit
- "Sold 1 oil and 2 salt to Sunita total 300 upi" → sale, customer: Sunita, oil 1 @₹140, salt 2 @₹28, total ₹300, payment: upi

Return ONLY a valid JSON object with this structure (no markdown):
{
  "type": "sale" | "purchase",
  "partyName": "customer or supplier name (null if not mentioned)",
  "items": [
    {
      "name": "product name (clean up: chini=sugar, tel=oil, atta=flour, chai=tea, namak=salt)",
      "quantity": number,
      "unit": "kg|ltr|pcs|box|gm|ml|dozen|packet (default: pcs)",
      "unitPrice": number (price per unit, 0 if not mentioned)
    }
  ],
  "paymentMode": "cash|upi|card|bank|credit (infer from words: udhaar/credit/baad mein = credit, cash/nagad = cash, upi/qr = upi, card = card)",
  "totalAmount": number (if mentioned, else 0 — will be calculated from items)
}

Rules:
- Default type is "sale" unless words like "bought", "khareeda", "purchase" are present
- If quantity missing, default to 1
- If unit missing, default to "pcs"
- Convert Hindi words: chini=sugar, tel=oil, atta=flour, chai=tea, namak=salt, dudh=milk, dal=pulses, chawal=rice, sabzi=vegetables
- Numbers like "pachaas" = 50, "sau" = 100, "do" = 2, "paanch" = 5

Return JSON only, no commentary.`

    const baseUrl = process.env.VLM_BASE_URL || 'https://api.groq.com/openai/v1/'

    // Smart default model: if VLM_MODEL isn't set, infer from the base URL.
    // This prevents the bug where VLM_BASE_URL points to Gemini but VLM_MODEL
    // defaults to a Groq model (llama-3.3-70b-versatile) → 404 error.
    const defaultModel = baseUrl.includes('generativelanguage')
      ? 'gemini-2.5-flash'
      : baseUrl.includes('api.openai.com')
      ? 'gpt-4o-mini'
      : 'llama-3.3-70b-versatile'
    const model = process.env.VLM_MODEL || defaultModel

    // If VLM_API_KEY is not set, try the fallback chain (same as scan-bill)
    if (!process.env.VLM_API_KEY) {
      // Try Gemini → OpenAI → Groq using their dedicated env vars
      const geminiKey = process.env.GEMINI_API_KEY
      const groqKey = process.env.GROQ_API_KEY

      if (geminiKey) {
        // Use Gemini for voice parsing
        const aiStart = Date.now()
        const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${geminiKey}`,
          },
          body: JSON.stringify({
            model: 'gemini-2.5-flash',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: transcript },
            ],
            max_tokens: 1000,
            temperature: 0.1,
          }),
        })
        const aiDurationMs = Date.now() - aiStart

        if (geminiResponse.ok) {
          const data = await geminiResponse.json()
          const content = data.choices?.[0]?.message?.content || ''
          const inputTokens = data.usage?.prompt_tokens || 0
          const outputTokens = data.usage?.completion_tokens || 0
          const totalTokens = data.usage?.total_tokens || (inputTokens + outputTokens)

          // Try to parse JSON
          let parsed: any = null
          try {
            parsed = JSON.parse(content)
          } catch {
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
            if (jsonMatch) { try { parsed = JSON.parse(jsonMatch[1]) } catch {} }
            if (!parsed) {
              const objMatch = content.match(/\{[\s\S]*\}/)
              if (objMatch) { try { parsed = JSON.parse(objMatch[0]) } catch {} }
            }
          }

          if (parsed) {
            // Sanitize
            if (!parsed.items) parsed.items = []
            parsed.items = parsed.items.map((item: any) => ({
              name: String(item.name || 'Unknown Product'),
              quantity: Number(item.quantity) || 1,
              unit: String(item.unit || 'pcs'),
              unitPrice: Number(item.unitPrice) || 0,
            }))

            await incrementUsage(userId, 'voiceParses')

            // Log usage
            const { calculateCostInr } = await import('@/lib/ai-pricing')
            const { db } = await import('@/lib/db')
            const costInr = calculateCostInr('gemini', 'gemini-2.5-flash', inputTokens, outputTokens)
            db.aiUsageLog.create({
              data: {
                userId, feature: 'voice-parse', provider: 'gemini', model: 'gemini-2.5-flash',
                inputTokens, outputTokens, totalTokens, costInr, durationMs: aiDurationMs, success: true,
              },
            }).catch(() => {})

            return NextResponse.json({
              success: true,
              transaction: parsed,
              _source: 'llm',
              aiUsage: { provider: 'gemini', model: 'gemini-2.5-flash', inputTokens, outputTokens, totalTokens, costInr: Math.round(costInr * 100) / 100, durationMs: aiDurationMs },
            })
          }
        } else {
          const errText = await geminiResponse.text()
          return NextResponse.json({
            error: 'Gemini voice parse failed',
            detail: `HTTP ${geminiResponse.status}: ${errText.slice(0, 300)}`,
          }, { status: 502 })
        }
      }

      if (groqKey) {
        // Fall back to Groq with llama-3.3-70b (text-only, fine for voice parsing)
        const aiStart = Date.now()
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: transcript },
            ],
            max_tokens: 1000,
            temperature: 0.1,
          }),
        })
        const aiDurationMs = Date.now() - aiStart

        if (groqResponse.ok) {
          const data = await groqResponse.json()
          const content = data.choices?.[0]?.message?.content || ''
          const inputTokens = data.usage?.prompt_tokens || 0
          const outputTokens = data.usage?.completion_tokens || 0
          const totalTokens = data.usage?.total_tokens || (inputTokens + outputTokens)

          let parsed: any = null
          try {
            parsed = JSON.parse(content)
          } catch {
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
            if (jsonMatch) { try { parsed = JSON.parse(jsonMatch[1]) } catch {} }
            if (!parsed) {
              const objMatch = content.match(/\{[\s\S]*\}/)
              if (objMatch) { try { parsed = JSON.parse(objMatch[0]) } catch {} }
            }
          }

          if (parsed) {
            if (!parsed.items) parsed.items = []
            parsed.items = parsed.items.map((item: any) => ({
              name: String(item.name || 'Unknown Product'),
              quantity: Number(item.quantity) || 1,
              unit: String(item.unit || 'pcs'),
              unitPrice: Number(item.unitPrice) || 0,
            }))

            await incrementUsage(userId, 'voiceParses')

            const { calculateCostInr } = await import('@/lib/ai-pricing')
            const { db } = await import('@/lib/db')
            const costInr = calculateCostInr('groq', 'llama-3.3-70b-versatile', inputTokens, outputTokens)
            db.aiUsageLog.create({
              data: {
                userId, feature: 'voice-parse', provider: 'groq', model: 'llama-3.3-70b-versatile',
                inputTokens, outputTokens, totalTokens, costInr, durationMs: aiDurationMs, success: true,
              },
            }).catch(() => {})

            return NextResponse.json({
              success: true,
              transaction: parsed,
              _source: 'llm',
              aiUsage: { provider: 'groq', model: 'llama-3.3-70b-versatile', inputTokens, outputTokens, totalTokens, costInr: Math.round(costInr * 100) / 100, durationMs: aiDurationMs },
            })
          }
        } else {
          const errText = await groqResponse.text()
          return NextResponse.json({
            error: 'Groq voice parse failed',
            detail: `HTTP ${groqResponse.status}: ${errText.slice(0, 300)}`,
          }, { status: 502 })
        }
      }

      return NextResponse.json({
        error: 'AI not configured',
        detail: 'Set VLM_API_KEY (or GEMINI_API_KEY / GROQ_API_KEY) in environment variables.',
      }, { status: 503 })
    }

    // VLM_API_KEY is set — use the legacy single-provider path
    const aiStart = Date.now()
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.VLM_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: transcript,
          },
        ],
        max_tokens: 1000,
        temperature: 0.1, // Low temperature for consistent parsing
      }),
    })
    const aiDurationMs = Date.now() - aiStart

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.error('Voice parse API error:', {
        status: response.status,
        statusText: response.statusText,
        baseUrl,
        model,
        errText: errText.slice(0, 500),
      })
      // Build a detailed error message that will show in the toast
      const errorDetail = errText
        ? `HTTP ${response.status} ${response.statusText}: ${errText.slice(0, 300)}`
        : `HTTP ${response.status} ${response.statusText} (provider: ${baseUrl.includes('generativelanguage') ? 'Gemini' : baseUrl.includes('groq') ? 'Groq' : 'OpenAI'}, model: ${model}). Provider returned empty error body — check if the model name is valid for this provider.`

      // Log the failed attempt
      ;(await import('@/lib/db')).db.aiUsageLog.create({
        data: {
          userId,
          feature: 'voice-parse',
          provider: 'vlm',
          model,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costInr: 0,
          durationMs: aiDurationMs,
          success: false,
          errorMessage: errorDetail.slice(0, 500),
        },
      }).catch(() => {})
      return NextResponse.json({
        error: 'Failed to parse voice entry',
        detail: errorDetail,
      }, { status: 502 })
    }

    const data = await response.json()
    let content = data.choices?.[0]?.message?.content || ''

    // Extract token usage from the provider's response
    const inputTokens = data.usage?.prompt_tokens || 0
    const outputTokens = data.usage?.completion_tokens || 0
    const totalTokens = data.usage?.total_tokens || (inputTokens + outputTokens)

    // Parse JSON from response
    let parsed: any = null
    try {
      parsed = JSON.parse(content)
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[1]) } catch {}
      }
      if (!parsed) {
        const objMatch = content.match(/\{[\s\S]*\}/)
        if (objMatch) {
          try { parsed = JSON.parse(objMatch[0]) } catch {}
        }
      }
    }

    if (!parsed) {
      return NextResponse.json({
        error: 'Could not parse the voice input. Please try speaking more clearly.',
      }, { status: 422 })
    }

    // Sanitize
    if (!parsed.items) parsed.items = []
    parsed.items = parsed.items.map((item: any) => ({
      name: String(item.name || 'Unknown Product'),
      quantity: Number(item.quantity) || 1,
      unit: String(item.unit || 'pcs'),
      unitPrice: Number(item.unitPrice) || 0,
    }))

    // Record successful voice parse in usage tracking (after AI succeeded).
    await incrementUsage(userId, 'voiceParses')

    // Log the AI call with token counts + cost for the usage dashboard.
    const { calculateCostInr } = await import('@/lib/ai-pricing')
    const { db } = await import('@/lib/db')
    const costInr = calculateCostInr('vlm', model, inputTokens, outputTokens)
    db.aiUsageLog.create({
      data: {
        userId,
        feature: 'voice-parse',
        provider: 'vlm',
        model,
        inputTokens,
        outputTokens,
        totalTokens,
        costInr,
        durationMs: aiDurationMs,
        success: true,
      },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      transaction: parsed,
      _source: 'llm',  // analytics: came from LLM, not regex
      aiUsage: {
        provider: 'vlm',
        model,
        inputTokens,
        outputTokens,
        totalTokens,
        costInr: Math.round(costInr * 100) / 100,
        durationMs: aiDurationMs,
      },
    })
  } catch (error) {
    console.error('Voice parse error:', error)
    return NextResponse.json({ error: 'Failed to process voice entry' }, { status: 500 })
  }
}
