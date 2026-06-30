import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserId } from '@/lib/get-auth'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

// POST /api/voice-parse - parse voice transcript into transaction data
// Rate limited: 50 per user per day (same as scan-bill — protects Groq quota)
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Rate limit by user
    const rl = rateLimit(`voice:user:${userId}`, { limit: 50, windowSec: 86400 })
    if (!rl.success) return rateLimitedResponse(rl)

    const { transcript } = await req.json()

    if (!transcript || !transcript.trim()) {
      return NextResponse.json({ error: 'No transcript provided' }, { status: 400 })
    }

    // Check if VLM_API_KEY is configured
    if (!process.env.VLM_API_KEY) {
      return NextResponse.json({
        error: 'AI not configured. Set VLM_API_KEY in environment variables.',
      }, { status: 503 })
    }

    const prompt = `You are an expert at understanding Indian shop owners' voice commands for creating sales/purchase entries. Parse the following spoken text and extract structured transaction data.

The user might speak in English, Hindi, or a mix (Hinglish). Examples:
- "Sold 2 kg sugar to Ramesh at 50 rupees cash" → sale, customer: Ramesh, sugar 2kg @₹50, payment: cash
- "Ramesh ne 2 kg chini liya 50 rupaye cash" → sale, customer: Ramesh, sugar 2kg @₹50, payment: cash
- "Bought 10 box tea from Tata suppliers for 2000 on credit" → purchase, supplier: Tata suppliers, tea 10 box @₹200, payment: credit
- "Sold 1 oil and 2 salt to Sunita total 300 upi" → sale, customer: Sunita, oil 1 @₹140, salt 2 @₹28, total ₹300, payment: upi

Transcript: "${transcript}"

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

    const baseUrl = process.env.VLM_BASE_URL || 'https://api.groq.com/openai/v1'
    const model = process.env.VLM_MODEL || 'llama-3.3-70b-versatile'

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
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 1000,
        temperature: 0.1, // Low temperature for consistent parsing
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Voice parse API error:', errText)
      return NextResponse.json({
        error: 'Failed to parse voice entry',
        detail: errText,
      }, { status: 502 })
    }

    const data = await response.json()
    let content = data.choices?.[0]?.message?.content || ''

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

    return NextResponse.json({ success: true, transaction: parsed })
  } catch (error) {
    console.error('Voice parse error:', error)
    return NextResponse.json({ error: 'Failed to process voice entry' }, { status: 500 })
  }
}
