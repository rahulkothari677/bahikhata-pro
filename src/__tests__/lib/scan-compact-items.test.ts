/**
 * Compact item format (2026-07-23).
 *
 * Output is priced 6x input on the scan tier and was 64% of the bill. About 40
 * of the ~78 tokens each item cost were the KEY NAMES — "name", "quantity",
 * "unitPrice", "gstRate", "confidence" — retyped for every line on the bill.
 *
 * Items now come back as positional arrays carrying the same data:
 *   ["Rice", 2, "kg", 50, 0, 100, 0.9]
 * about 20 tokens instead of 78, taking a 1000-scan month from ~Rs 110 to
 * ~Rs 63 with no change to what is extracted.
 *
 * The parser must accept BOTH shapes. A model can ignore the format on a hard
 * bill, older queued scans replay through the same code, and each fallback
 * provider has its own habits. Costing less must never mean failing to read a
 * shopkeeper's bill.
 */
import fs from 'fs'
import path from 'path'

const routeSrc = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/scan-bill/route.ts'),
  'utf8',
)

/**
 * Mirrors the route's normaliser. Kept in the test rather than imported
 * because the route is a Next handler that drags in auth and the database —
 * the STRUCTURAL tests below pin it to the real implementation.
 */
function normalise(raw: any) {
  const item = Array.isArray(raw)
    ? {
        name: raw[0], quantity: raw[1], unit: raw[2], unitPrice: raw[3],
        gstRate: raw[4], total: raw[5], confidence: raw[6],
      }
    : raw
  return {
    name: String(item.name || 'Unknown Product'),
    quantity: Number(item.quantity) || 1,
    unit: String(item.unit || 'pcs'),
    unitPrice: Number(item.unitPrice) || 0,
    gstRate: Number(item.gstRate) || 0,
    total: Number(item.total) || (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0),
    confidence: typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 0.8,
  }
}

describe('positional array items', () => {
  test('a compact row produces the same object a keyed row would', () => {
    const compact = normalise(['Basmati Rice', 2, 'kg', 50, 5, 100, 0.9])
    const keyed = normalise({
      name: 'Basmati Rice', quantity: 2, unit: 'kg',
      unitPrice: 50, gstRate: 5, total: 100, confidence: 0.9,
    })
    expect(compact).toEqual(keyed)
  })

  test('Devanagari names and fractional kg survive the array form', () => {
    // The real shape of Rahul's bills: Hindi item names, 0.5 kg quantities.
    const r = normalise(['आलू', 0.5, 'kg', 40, 0, 20, 0.85])
    expect(r.name).toBe('आलू')
    expect(r.quantity).toBe(0.5)
    expect(r.unit).toBe('kg')
    expect(r.total).toBe(20)
  })

  test('a price-less handwritten note still parses', () => {
    // No prices anywhere on the paper — quantities only. This must not become
    // "Unknown Product" or invent a total.
    const r = normalise(['प्याज', 10, 'kg', 0, 0, 0, 0.7])
    expect(r.name).toBe('प्याज')
    expect(r.quantity).toBe(10)
    expect(r.unitPrice).toBe(0)
    expect(r.total).toBe(0)
  })

  test('a short array does not throw or corrupt earlier fields', () => {
    // A model may emit fewer entries than asked for.
    const r = normalise(['Sugar', 1])
    expect(r.name).toBe('Sugar')
    expect(r.quantity).toBe(1)
    expect(r.unit).toBe('pcs')
    expect(r.confidence).toBe(0.8)
  })

  test('total is still derived when the model omits it', () => {
    const r = normalise(['Tea', 3, 'pcs', 20, 0, 0, 0.9])
    expect(r.total).toBe(60)
  })

  test('confidence is clamped to 0..1 whichever shape it arrives in', () => {
    expect(normalise(['X', 1, 'pcs', 0, 0, 0, 5]).confidence).toBe(1)
    expect(normalise({ name: 'X', confidence: -2 }).confidence).toBe(0)
  })
})

describe('the route asks for the compact shape and still accepts the old one', () => {
  test('the prompt specifies the positional order', () => {
    expect(routeSrc).toMatch(/\[name, quantity, unit, unitPrice, gstRate, total, confidence\]/)
  })

  test('the prompt tells the model to omit empty header fields', () => {
    // A handwritten kirana note has no invoice number, date, GSTIN or tax
    // lines; echoing them back as nulls was billed as output.
    expect(routeSrc).toMatch(/OMIT any of these unless the bill actually shows them/)
    expect(routeSrc).toMatch(/Do not send nulls or zeros/)
  })

  test('the parser branches on Array.isArray, so keyed objects still work', () => {
    expect(routeSrc).toMatch(/Array\.isArray\(raw\)/)
  })

  test('the money rules survived the prompt rewrite', () => {
    const m = routeSrc.match(/const basePrompt = `([\s\S]*?)`/)!
    for (const rule of [/PER KG/, /NEVER invent prices/, /Hindi numerals/, /darjan/, /udhaar/]) {
      expect(m[1]).toMatch(rule)
    }
  })
})
