import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserId } from '@/lib/get-auth'
import { rateLimit, getClientIP, rateLimitedResponse } from '@/lib/rate-limit'

// POST /api/scan-bill - uses VLM to extract bill data from image
// Supports two modes:
// 1. Z.AI SDK (for sandbox/dev - auto-configured)
// 2. OpenAI-compatible API (for production - set VLM_API_KEY & VLM_BASE_URL env vars)
//
// Rate limited: 30 scans per user per day (protects Groq API quota)
// Plus 10 scans per IP per hour (prevents account sharing abuse)
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Rate limit by user (daily quota)
    const userRL = rateLimit(`scan:user:${userId}`, { limit: 30, windowSec: 86400 })
    if (!userRL.success) return rateLimitedResponse(userRL)

    // Rate limit by IP (anti-abuse — prevents one user from logging in from many IPs)
    const ip = getClientIP(req)
    const ipRL = rateLimit(`scan:ip:${ip}`, { limit: 10, windowSec: 3600 })
    if (!ipRL.success) return rateLimitedResponse(ipRL)

    const body = await req.json()
    const { imageBase64, imageUrl, billType = 'purchase' } = body

    // Accept either a Cloudinary URL or base64
    const imageSource = imageUrl || imageBase64

    if (!imageSource) {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 })
    }

    const prompt = `You are an expert at reading Indian shop bills, invoices, receipts, AND handwritten notes on plain paper. Indian shop owners often write sales/purchases as rough notes on any paper — plain paper, notebook pages, diaries, even napkins. Your job is to read ANY text (printed or handwritten) and extract structured data.

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
  "totalAmount": number (final payable — if written on paper, use that; else calculate subtotal - discount + tax),
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

    let content = ''

    // Mode 1: Try Z.AI SDK first (works in sandbox/dev)
    if (!process.env.VLM_API_KEY) {
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
                { type: 'image_url', image_url: { url: imageSource } },
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
          detail: 'Set VLM_API_KEY and VLM_BASE_URL environment variables in Vercel to enable AI bill scanning. See README for setup instructions.',
          needsConfig: true,
        }, { status: 503 })
      }
    } else {
      // Mode 2: Use OpenAI-compatible API (for production/Vercel)
      const baseUrl = process.env.VLM_BASE_URL || 'https://api.openai.com/v1'
      const model = process.env.VLM_MODEL || 'gpt-4o-mini'

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
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageSource } },
              ],
            },
          ],
          max_tokens: 2000,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        console.error('VLM API error:', errText)
        return NextResponse.json({
          error: 'AI scanner request failed',
          detail: errText,
        }, { status: 502 })
      }

      const data = await response.json()
      content = data.choices?.[0]?.message?.content || ''
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

    return NextResponse.json({ success: true, bill: parsed })
  } catch (error) {
    console.error('Scan bill error:', error)
    return NextResponse.json({
      error: 'Failed to scan bill',
      detail: String(error),
    }, { status: 500 })
  }
}
// Force fresh deploy Wed Jun 24 19:32:36 UTC 2026
// Force fresh deploy for VLM config Wed Jun 24 20:09:13 UTC 2026
