/**
 * Phase 2c (4 Oct 2026) — goods sent to another state, and a bill that keeps
 * its own place of supply. (#114)
 *
 * Before: the place of supply came only from the party's state, so a courier
 * sale from Jaipur to a customer in Lucknow was charged CGST + SGST; and every
 * return and print worked the place of supply out again from the party's
 * CURRENT state, so editing a party moved a filed bill's place of supply.
 *
 * Law (verified report, "Place of supply"; CBIC text for s.10(2)(c)):
 *   IGST Act s.10(1)(a) goods that move → where delivery ends
 *   s.10(1)(b) bill-to-ship-to → the instructing buyer's principal place
 *   s.10(1)(ca) unregistered buyer → the address on the invoice; Circular
 *     209/3/2024: the delivery address governs when it differs
 *   CGST Rule 46(e), (n), (o) — what the invoice must show
 *   CGST Act s.10(2)(c) — a composition shop makes no inter-state sale
 */
import fs from 'fs'
import path from 'path'
import {
  placeOfSupplyCode, supplyKind, deliveryCheck, billPlaceOfSupply, savedBillToShipTo,
  normaliseDeliveryState, compositionInterStateBlocked, rule46eMissing,
} from '@/lib/gst-states'
import { resolveBillDelivery, shipToChoiceRefusal } from '@/lib/bill-delivery'
import { placeOfSupplyLines } from '@/lib/invoice-document'
import { partyBlockLines } from '@/lib/invoice-share-image'
import { computeLineItems } from '@/lib/line-items'

const JAIPUR = { gstin: '08AAJFG2468H1Z7', state: 'Rajasthan' }
const SURAT = { gstin: '24AAACS1234A1Z5', state: 'Gujarat' }
const LUCKNOW_RETAILER = { gstin: '09XYZAB5678C1Z9', state: 'Uttar Pradesh' }
const AHMEDABAD_RETAILER = { gstin: '24ABCDE1234F1Z5', state: 'Gujarat' }

describe('the law report\'s worked examples', () => {
  test('courier to a registered buyer in another state: 100 kurtas × ₹800 at 5% → ₹4,000 IGST', () => {
    const kind = supplyKind({ shop: JAIPUR, party: LUCKNOW_RETAILER, delivery: 'Uttar Pradesh' })
    expect(kind).toMatchObject({ isInterState: true, posCode: '09' })
    const r = computeLineItems({
      items: [{ productId: null, productName: 'Kurta', quantity: 100, unitPrice: 800, gstRate: 5, unit: 'pcs' }] as never,
      productMap: new Map(),
      isInterState: kind.isInterState,
      orderDiscount: 0,
      type: 'sale',
    })
    expect(r.igst).toBe(4000)
    expect(r.cgst + r.sgst).toBe(0)
  })
  test('unregistered buyer billed in one state, delivered in another → the delivery state (Circular 209)', () => {
    expect(placeOfSupplyCode({ shop: JAIPUR, party: { state: 'Karnataka' }, delivery: 'Tamil Nadu' })).toBe('33')
  })
  test('bill-to-ship-to: Surat → Ahmedabad retailer, goods to Mumbai → Gujarat, CGST + SGST', () => {
    const kind = supplyKind({ shop: SURAT, party: AHMEDABAD_RETAILER, delivery: 'Maharashtra', billToShipTo: true })
    expect(kind).toMatchObject({ isInterState: false, posCode: '24' })
  })
  test('the same delivery for the buyer themselves → Maharashtra, IGST', () => {
    expect(supplyKind({ shop: SURAT, party: AHMEDABAD_RETAILER, delivery: 'Maharashtra', billToShipTo: false }))
      .toMatchObject({ isInterState: true, posCode: '27' })
  })
  test('bill-to-ship-to is ignored for an unregistered buyer — (ca) applies "notwithstanding" (b)', () => {
    expect(placeOfSupplyCode({ shop: SURAT, party: { state: 'Gujarat' }, delivery: 'Maharashtra', billToShipTo: true })).toBe('27')
  })
  test('a delivery inside the buyer\'s own state changes nothing', () => {
    expect(supplyKind({ shop: JAIPUR, party: LUCKNOW_RETAILER, delivery: 'UP' })).toMatchObject({ isInterState: true, posCode: '09' })
    expect(deliveryCheck({ shop: JAIPUR, party: LUCKNOW_RETAILER, delivery: 'UP' })).toEqual({ needsShipToChoice: false, buyerLosesCredit: false })
  })
})

describe('deliveryCheck() — the question is asked, never assumed', () => {
  const args = { shop: SURAT, party: AHMEDABAD_RETAILER, delivery: 'Maharashtra' }
  test('registered buyer, goods to another state, unanswered → must ask', () => {
    expect(deliveryCheck(args)).toEqual({ needsShipToChoice: true, buyerLosesCredit: false })
    expect(deliveryCheck({ ...args, billToShipTo: null }).needsShipToChoice).toBe(true)
  })
  test('answered either way → no question; "the buyer" → they lose the credit', () => {
    expect(deliveryCheck({ ...args, billToShipTo: true })).toEqual({ needsShipToChoice: false, buyerLosesCredit: false })
    expect(deliveryCheck({ ...args, billToShipTo: false })).toEqual({ needsShipToChoice: false, buyerLosesCredit: true })
  })
  test('an unregistered buyer or no delivery never asks', () => {
    expect(deliveryCheck({ shop: SURAT, party: { state: 'Gujarat' }, delivery: 'Maharashtra' }).needsShipToChoice).toBe(false)
    expect(deliveryCheck({ shop: SURAT, party: AHMEDABAD_RETAILER }).needsShipToChoice).toBe(false)
  })
})

describe('billPlaceOfSupply() — a saved bill keeps its place of supply', () => {
  test('the saved code wins over a party edited afterwards', () => {
    expect(billPlaceOfSupply({ placeOfSupply: '09', isInterState: true, party: { state: 'Gujarat' } }, JAIPUR)).toBe('09')
  })
  test('an older intra-state bill is at the shop\'s state — that is what CGST + SGST means', () => {
    expect(billPlaceOfSupply({ isInterState: false, party: { state: 'Gujarat' } }, JAIPUR)).toBe('08')
  })
  test('an older inter-state bill is worked out as before', () => {
    expect(billPlaceOfSupply({ isInterState: true, party: { state: 'Gujarat' } }, JAIPUR)).toBe('24')
  })
  test('savedBillToShipTo() reads the answer back from what was stored', () => {
    expect(savedBillToShipTo({ placeOfSupply: '24', deliveryState: 'Maharashtra' })).toBe(true)
    expect(savedBillToShipTo({ placeOfSupply: '27', deliveryState: 'Maharashtra' })).toBe(false)
    expect(savedBillToShipTo({ placeOfSupply: '24' })).toBeNull()
  })
  test('round trip: decide → save → read back → decide again gives the same place', () => {
    for (const billToShipTo of [true, false]) {
      const decided = placeOfSupplyCode({ shop: SURAT, party: AHMEDABAD_RETAILER, delivery: 'Maharashtra', billToShipTo })
      const again = savedBillToShipTo({ placeOfSupply: decided, deliveryState: 'Maharashtra' })
      expect(placeOfSupplyCode({ shop: SURAT, party: AHMEDABAD_RETAILER, delivery: 'Maharashtra', billToShipTo: again })).toBe(decided)
    }
  })
})

describe('normaliseDeliveryState()', () => {
  test('any recognised form is stored as the official name', () => {
    expect(normaliseDeliveryState('U.P.')).toEqual({ ok: true, state: 'Uttar Pradesh' })
    expect(normaliseDeliveryState(' tamil nadu ')).toEqual({ ok: true, state: 'Tamil Nadu' })
  })
  test('blank is "no delivery"; anything else is refused with the reason', () => {
    expect(normaliseDeliveryState('')).toEqual({ ok: true, state: null })
    expect(normaliseDeliveryState(null)).toEqual({ ok: true, state: null })
    const bad = normaliseDeliveryState('Atlantis')
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.error).toMatch(/not a state/)
  })
})

describe('compositionInterStateBlocked() — s.10(2)(c)', () => {
  test('a composition shop selling to another state is flagged; same state, or a regular shop, is not', () => {
    expect(compositionInterStateBlocked('composition', { shop: JAIPUR, party: { state: 'Gujarat' } })).toBe(true)
    expect(compositionInterStateBlocked('composition', { shop: JAIPUR, party: { state: 'RJ' } })).toBe(false)
    expect(compositionInterStateBlocked('composition', { shop: JAIPUR })).toBe(false)
    expect(compositionInterStateBlocked('regular', { shop: JAIPUR, party: { state: 'Gujarat' } })).toBe(false)
  })
})

describe('rule46eMissing() — ₹50,000+ to a buyer with no GST number', () => {
  test('below ₹50,000 nothing is required; from ₹50,000 exactly it is', () => {
    expect(rule46eMissing({ taxableValue: 49999.99, party: null })).toEqual([])
    expect(rule46eMissing({ taxableValue: 50000, party: null })).toEqual(['name', 'address', 'state'])
  })
  test('a registered buyer is outside 46(e)', () => {
    expect(rule46eMissing({ taxableValue: 90000, party: { name: 'X', gstin: LUCKNOW_RETAILER.gstin } })).toEqual([])
  })
  test('a delivery state counts as the state; a complete buyer passes', () => {
    expect(rule46eMissing({ taxableValue: 60000, party: { name: 'Asha', address: 'Lucknow 226001' }, deliveryState: 'UP' })).toEqual([])
    expect(rule46eMissing({ taxableValue: 60000, party: { name: 'Asha', state: 'Bihar' } })).toEqual(['address'])
  })
})

describe('resolveBillDelivery() — one rule for create, edit and convert', () => {
  const noDb = { transaction: { findFirst: async () => { throw new Error('should not read') } } }
  test('a purchase never carries a delivery', async () => {
    expect(await resolveBillDelivery(noDb, 'u1', { type: 'purchase', deliveryState: 'Bihar' }))
      .toMatchObject({ ok: true, deliveryState: null, deliveryAddress: null, original: null })
  })
  test('a sale stores the official name and the trimmed address', async () => {
    expect(await resolveBillDelivery(noDb, 'u1', { type: 'sale', deliveryState: 'UP', deliveryAddress: '  12 MG Road, Lucknow 226001 ', billToShipTo: true }))
      .toEqual({ ok: true, deliveryState: 'Uttar Pradesh', deliveryAddress: '12 MG Road, Lucknow 226001', billToShipTo: true, original: null })
  })
  test('an address with no state, or a state not on the list, is refused', async () => {
    expect(await resolveBillDelivery(noDb, 'u1', { type: 'sale', deliveryAddress: 'Lucknow' })).toMatchObject({ ok: false })
    expect(await resolveBillDelivery(noDb, 'u1', { type: 'sale', deliveryState: 'Narnia' })).toMatchObject({ ok: false })
  })
  test('an edit that sends no delivery keeps what the bill saved', async () => {
    expect(await resolveBillDelivery(noDb, 'u1', { type: 'sale', existing: { deliveryState: 'Maharashtra', deliveryAddress: 'Mumbai', placeOfSupply: '24' } }))
      .toEqual({ ok: true, deliveryState: 'Maharashtra', deliveryAddress: 'Mumbai', billToShipTo: true, original: null })
  })
  test('an edit that clears the delivery clears it', async () => {
    expect(await resolveBillDelivery(noDb, 'u1', { type: 'sale', deliveryState: null, existing: { deliveryState: 'Maharashtra' } }))
      .toMatchObject({ ok: true, deliveryState: null })
  })
  test('a credit note against a saved bill takes that bill\'s delivery, scoped to the shop', async () => {
    const seen: any[] = []
    const db = { transaction: { findFirst: async (args: any) => { seen.push(args); return { isInterState: true, placeOfSupply: '09', deliveryState: 'Uttar Pradesh', deliveryAddress: 'Lucknow', party: { state: 'Rajasthan' } } } } }
    const r = await resolveBillDelivery(db, 'u1', { type: 'credit-note', originalTransactionId: 't9', deliveryState: 'Bihar' })
    expect(r).toMatchObject({ ok: true, deliveryState: 'Uttar Pradesh', billToShipTo: false, original: { isInterState: true, placeOfSupply: '09' } })
    expect(seen[0].where).toEqual({ id: 't9', userId: 'u1', deletedAt: null })
  })
  test('the refusal names both states in plain words', () => {
    expect(shipToChoiceRefusal({ name: 'Mehta Traders', gstin: AHMEDABAD_RETAILER.gstin }, 'Maharashtra'))
      .toEqual({ error: 'SHIP_TO_CHOICE', message: expect.stringMatching(/Mehta Traders's GSTIN is from Gujarat, but the goods go to Maharashtra/) })
  })
})

describe('the printed bill — Rule 46(n) and (o)', () => {
  test('place of supply prints the official name and code, from the saved code — not the typed "RJ"', () => {
    expect(placeOfSupplyLines({ party: { name: 'G', gstin: JAIPUR.gstin, state: 'RJ' }, isInterState: false, placeOfSupply: '08' }, JAIPUR))
      .toEqual({ placeOfSupply: 'Rajasthan (08)', shipTo: null })
  })
  test('a courier sale prints the delivery state as place of supply, and the ship-to line', () => {
    expect(placeOfSupplyLines({ party: { name: 'Asha', state: 'Rajasthan' }, isInterState: true, placeOfSupply: '09', deliveryState: 'Uttar Pradesh', deliveryAddress: '12 MG Road, Lucknow 226001' }, JAIPUR))
      .toEqual({ placeOfSupply: 'Uttar Pradesh (09)', shipTo: '12 MG Road, Lucknow 226001 — Uttar Pradesh (09)' })
  })
  test('bill-to-ship-to prints the buyer\'s state as place of supply and the other state as ship-to', () => {
    expect(placeOfSupplyLines({ party: { name: 'M', gstin: AHMEDABAD_RETAILER.gstin }, isInterState: false, placeOfSupply: '24', deliveryState: 'Maharashtra' }, SURAT))
      .toEqual({ placeOfSupply: 'Gujarat (24)', shipTo: 'Maharashtra (27)' })
  })
  test('a walk-in counter sale prints neither', () => {
    expect(placeOfSupplyLines({ party: null, isInterState: false, placeOfSupply: '08' }, JAIPUR)).toEqual({ placeOfSupply: null, shipTo: null })
  })
  test('the bill picture budgets two lines for the ship-to', () => {
    expect(partyBlockLines({ party: { name: 'A', address: 'x' }, shipTo: 'y' })).toBe(4)
    expect(partyBlockLines({ party: { name: 'A' }, shipTo: null })).toBe(0)
  })
})

/**
 * THE CLASS. A place of supply worked out at READ time from the party's
 * current state (or typed text) instead of the code saved on the bill. Two
 * structural rules, each runnable on a good and a bad input:
 *  1. Every Prisma data block that writes isInterState also writes
 *     placeOfSupply — so no write path can save a bill without it.
 *  2. Return/print code never derives a place of supply from a party:
 *     placeOfSupplyCode(…) is called only inside gst-states.ts, and no
 *     renderer prints party.state as the place of supply.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, b => b.replace(/[^\n]/g, ''))
    .replace(/(^|[ \t])\/\/[^\n]*/gm, (_m, lead) => lead)
}

/** The brace-balanced object literal that contains position `at`, and where it opens. */
function enclosingObject(src: string, at: number): { start: number; text: string } {
  let depth = 0
  let start = -1
  for (let i = at; i >= 0; i--) {
    if (src[i] === '}') depth++
    else if (src[i] === '{') { if (depth === 0) { start = i; break } depth-- }
  }
  if (start < 0) return { start: -1, text: '' }
  depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return { start, text: src.slice(start, i + 1) } }
  }
  return { start, text: src.slice(start) }
}

/** Data blocks (`data: { … }`) that store isInterState without placeOfSupply. */
function writesWithoutPlaceOfSupply(source: string): string[] {
  const src = codeOnly(source)
  const bad: string[] = []
  const re = /^[ \t]+isInterState\b\s*(?::|,|\r?$)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const obj = enclosingObject(src, m.index + m[0].indexOf('isInterState'))
    if (obj.start < 0) continue
    const opensData = /\bdata:\s*$/.test(src.slice(Math.max(0, obj.start - 20), obj.start))
    if (opensData && !/\bplaceOfSupply\b/.test(obj.text)) bad.push(obj.text.slice(0, 60).replace(/\s+/g, ' '))
  }
  return bad
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const ROOT = path.join(__dirname, '..', '..')
const rel = (f: string) => path.relative(path.join(ROOT, '..'), f).replace(/\\/g, '/')

describe('guard — every bill write saves its place of supply', () => {
  test('catches a data block with isInterState and no placeOfSupply', () => {
    const bad = `await tx.transaction.create({\r\n  data: {\r\n    userId,\r\n    isInterState: !!isInterState,\r\n    notes,\r\n  },\r\n})`
    expect(writesWithoutPlaceOfSupply(bad)).toHaveLength(1)
  })
  test('passes the fixed shape, a shorthand property, and ignores comments and selects', () => {
    const ok = `tx.transaction.create({\n  data: {\n    isInterState,\n    // isInterState: true\n    placeOfSupply: posCode,\n  },\n})\nconst x = { select: { isInterState: true } }`
    expect(writesWithoutPlaceOfSupply(ok)).toEqual([])
  })
  test('sweep: every route that writes a bill', () => {
    const offenders: string[] = []
    for (const f of sourceFiles(path.join(ROOT, 'app', 'api'))) {
      for (const o of writesWithoutPlaceOfSupply(fs.readFileSync(f, 'utf8'))) offenders.push(`${rel(f)}: ${o}`)
    }
    expect(offenders).toEqual([])
  })
})

describe('guard — no place of supply derived from a party at read time', () => {
  const files = sourceFiles(ROOT).map(f => ({ rel: rel(f), code: codeOnly(fs.readFileSync(f, 'utf8')) }))
  const DERIVES = /\bplaceOfSupplyCode\(/
  const PRINTS_PARTY_STATE = /(?:Place of Supply|placeOfSupply)[^\n]{0,80}party\??\.state|party\??\.state[^\n]{0,80}(?:Place of Supply|placeOfSupply)/
  test('the rules catch the old shapes', () => {
    expect(DERIVES.test(codeOnly(`const pos = placeOfSupplyCode({ shop, party: t.party })`))).toBe(true)
    expect(PRINTS_PARTY_STATE.test(codeOnly(`placeOfSupply: src.party?.gstin || src.isInterState ? src.party?.state ?? null : null,`))).toBe(true)
    expect(PRINTS_PARTY_STATE.test(codeOnly(`const placeOfSupply = invoice.party?.state`))).toBe(true)
    expect(DERIVES.test(codeOnly(`// was placeOfSupplyCode(x)\nconst pos = billPlaceOfSupply(t, shop)`))).toBe(false)
  })
  test('sweep: placeOfSupplyCode() only inside gst-states.ts; no renderer prints party.state as place of supply', () => {
    expect(files.filter(f => f.rel !== 'src/lib/gst-states.ts' && DERIVES.test(f.code)).map(f => f.rel)).toEqual([])
    expect(files.filter(f => PRINTS_PARTY_STATE.test(f.code)).map(f => f.rel)).toEqual([])
  })
})
