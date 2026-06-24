import { NextRequest, NextResponse } from 'next/server'
import { getAuthUserId } from '@/lib/get-auth'

// POST /api/scan-bill - uses VLM to extract bill data from image
// Supports two modes:
// 1. Z.AI SDK (for sandbox/dev - auto-configured)
// 2. OpenAI-compatible API (for production - set VLM_API_KEY & VLM_BASE_URL env vars)
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserId()
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { imageBase64, imageUrl, billType = 'purchase' } = body

    // Accept either a Cloudinary URL or base64
    const imageSource = imageUrl || imageBase64

    if (!imageSource) {
      return NextResponse.json({ error: 'Image is required' }, { status: 400 })
    }

    const prompt = `You are an expert at reading Indian shop bills, invoices and receipts. Carefully analyze this ${billType} bill image and extract all information.

Return ONLY a valid JSON object with this exact structure (no markdown, no extra text):
{
  "invoiceNo": "bill/invoice number if visible, else null",
  "date": "YYYY-MM-DD format if visible, else null",
  "sellerName": "name of seller/shop if visible else null",
  "sellerPhone": "phone if visible else null",
  "sellerGSTIN": "GSTIN if visible else null",
  "items": [
    {
      "name": "product name",
      "quantity": number,
      "unit": "unit if visible (pcs/kg/ltr/box) else 'pcs'",
      "unitPrice": number (price per unit, exclude tax),
      "gstRate": number (GST % if visible, else 0),
      "total": number (line total including tax)
    }
  ],
  "subtotal": number (sum before tax),
  "discountAmount": number (total discount if visible else 0),
  "cgst": number,
  "sgst": number,
  "igst": number,
  "totalAmount": number (final payable),
  "paymentMode": "cash|upi|card|bank|credit - infer from bill"
}

Rules:
- If a value is not visible, use null (for strings) or 0 (for numbers).
- Extract EVERY item line in the bill, do not skip any.
- Quantities should be numbers (e.g. 2 not "2 pcs").
- Prices should be numbers without currency symbols.
- GST rate is the percentage (5, 12, 18, 28), not the amount.
- For CGST/SGST/IGST provide the actual tax amount, not percentage.
- If the bill shows CGST+SGST, set both and igst=0. If shows IGST, set igst and cgst=sgst=0.
- Match each item's name with what's written, even if abbreviated.
- Return JSON only, no commentary.`

    let content = ''

    // Mode 1: Try Z.AI SDK first (works in sandbox/dev)
    if (!process.env.VLM_API_KEY) {
      try {
        const ZAI = (await import('z-ai-web-dev-sdk')).default
        const zai = await ZAI.create()
        const vlm = await zai.images.vlm.create()

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
    let parsed = null
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
    }))

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
