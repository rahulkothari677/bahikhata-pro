/**
 * @jest-environment node
 *
 * A credit note is filed according to the invoice it cancels — even when that
 * invoice was in an earlier month.
 *
 * WHY (BUG-062, raised 2026-07-19, closed 2026-08-14). GSTR-1 puts a note for
 * an unregistered buyer in one of two places:
 *
 *   CDNUR (Table 9B)  the original was B2CL: inter-state AND over ₹1 lakh
 *   B2CS              everything else, netted in as a reduction
 *
 * The rule is about the ORIGINAL supply, not the note. The first fix passed the
 * note's `originalTransactionId` to the builder, which looked the original up
 * with `txns.find(...)` — and `txns` is only the filing month's transactions.
 *
 * A credit note is almost always issued in a LATER month than the invoice it
 * cancels. So the original was usually absent, the lookup silently failed, and
 * it fell back to the note's own values — exactly the behaviour BUG-062 was
 * raised about. The fix worked only when note and original happened to land in
 * the same month, which is the rarer case, and the comment above it read as
 * though the whole problem were solved.
 *
 * These tests use a note whose original is NOT in the array, because that is
 * the normal case and the one that was broken.
 */
import fs from 'fs'
import path from 'path'
import { buildCDNUR, buildB2CS, type Gstr1Transaction, type ShopInfo } from '@/lib/gstr1-builder'

const SHOP: ShopInfo = { gstin: '27AAAAA0000A1Z5', state: 'Maharashtra', stateCode: '27' }

const item = (rate: number, txval: number, inter: boolean) => ({
  productId: null, productName: 'Thing', hsn: '1234', quantity: 1, unit: 'pcs',
  unitPrice: txval, gstRate: rate, discountAmount: 0,
  cgst: inter ? 0 : (txval * rate) / 200,
  sgst: inter ? 0 : (txval * rate) / 200,
  igst: inter ? (txval * rate) / 100 : 0,
  csamt: 0,
})

/** A note for an UNREGISTERED buyer. Its own values are deliberately modest. */
const note = (over: Partial<Gstr1Transaction> = {}): Gstr1Transaction => ({
  id: 'note_1', type: 'credit-note', invoiceNo: 'CN-1', date: new Date('2026-08-05'),
  totalAmount: 5_000, subtotal: 5_000, discountAmount: 0,
  cgst: 450, sgst: 450, igst: 0,
  isInterState: false,          // the note itself looks intra-state and small
  isReverseCharge: false,
  partyId: 'p1', partyName: 'Walk-in', partyGstin: null, partyState: 'Maharashtra',
  items: [item(18, 5_000, false)],
  originalTransactionId: 'invoice_from_july',
  ...over,
})

/** July's invoice: inter-state and over ₹1 lakh, so its notes belong in CDNUR. */
const JULY_B2CL = new Map([['invoice_from_july', { isInterState: true, totalAmount: 250_000 }]])

describe('the original is in an earlier month — the normal case', () => {
  it('WITHOUT the lookup, the note is misfiled (this is the bug)', () => {
    // No originals supplied: the builder can only see the note's own values,
    // which say intra-state and ₹5,000 — so it never reaches CDNUR.
    const cdnur = buildCDNUR([note()], SHOP)
    expect(cdnur).toHaveLength(0)
  })

  it('WITH the lookup, it is filed in CDNUR as its original demands', () => {
    const cdnur = buildCDNUR([note()], SHOP, JULY_B2CL)
    expect(cdnur).toHaveLength(1)
    expect(cdnur[0].typ).toBe('B2CL')
    expect(cdnur[0].nt_num).toBe('CN-1')
    expect(cdnur[0].ntty).toBe('C')
  })

  it('and it is NOT also netted into B2CS — a note belongs in one place', () => {
    // Declaring the same reduction twice understates the tax owed.
    const b2cs = buildB2CS([note()], SHOP, JULY_B2CL)
    const fromNote = b2cs.filter(e => e.txval < 0)
    expect(fromNote).toHaveLength(0)
  })
})

describe('the other direction is equally wrong', () => {
  const JULY_SMALL = new Map([['invoice_from_july', { isInterState: false, totalAmount: 4_000 }]])

  /** A note that LOOKS like B2CL on its own, against a small intra-state original. */
  const looksBig = note({
    isInterState: true, totalAmount: 250_000, subtotal: 250_000,
    cgst: 0, sgst: 0, igst: 45_000, items: [item(18, 250_000, true)],
  })

  it('a note whose original was small must not land in CDNUR', () => {
    // Without the lookup it would, on its own inflated values — and CDNUR
    // entries are declared `typ: B2CL`, which the portal cross-checks.
    expect(buildCDNUR([looksBig], SHOP, JULY_SMALL)).toHaveLength(0)
  })

  it('it is netted into B2CS instead, as a reduction', () => {
    const b2cs = buildB2CS([looksBig], SHOP, JULY_SMALL)
    expect(b2cs.some(e => e.txval < 0)).toBe(true)
  })
})

describe('the in-period path and the fallback both still work', () => {
  it('finds an original that IS in this month, with no lookup supplied', () => {
    const original: Gstr1Transaction = {
      ...note(), id: 'invoice_from_july', type: 'sale', invoiceNo: 'INV-9',
      isInterState: true, totalAmount: 250_000, originalTransactionId: null,
    }
    const cdnur = buildCDNUR([original, note()], SHOP)
    expect(cdnur).toHaveLength(1)
  })

  it('a standalone note with no original still uses its own values', () => {
    // The app allows a note that names no original. It must not crash, and its
    // own values are the only information there is.
    const standalone = note({
      originalTransactionId: null,
      isInterState: true, totalAmount: 250_000, subtotal: 250_000,
      cgst: 0, sgst: 0, igst: 45_000, items: [item(18, 250_000, true)],
    })
    expect(buildCDNUR([standalone], SHOP, JULY_B2CL)).toHaveLength(1)
  })

  it('an original that cannot be found anywhere falls back rather than throwing', () => {
    const orphan = note({ originalTransactionId: 'deleted_long_ago' })
    expect(() => buildCDNUR([orphan], SHOP, JULY_B2CL)).not.toThrow()
    expect(buildCDNUR([orphan], SHOP, JULY_B2CL)).toHaveLength(0)
  })
})

describe('the route actually supplies the lookup', () => {
  // The rule being right is half of it. If the caller never fetches the
  // out-of-period originals, the builder is back to guessing — which is exactly
  // how this bug survived its first fix.
  const src = fs.readFileSync(path.join(process.cwd(), 'src/app/api/gstr-1/route.ts'), 'utf8')

  it('fetches originals that are not in the filing period', () => {
    expect(src).toMatch(/missingOriginalIds/)
    expect(src).toMatch(/originalInvoices\.set\(/)
  })

  it('scopes that fetch by userId, so one shop cannot classify by another\'s invoice', () => {
    expect(src).toMatch(/where: \{ userId, id: \{ in: missingOriginalIds \}/)
  })

  it('passes it to the builder on EVERY call site', () => {
    /*
     * Balanced parentheses, not a fixed window — this repo has been bitten
     * three times by guards that measured nearby text instead of structure.
     *
     * And this assertion earned its keep immediately: the first attempt at the
     * fix wired only the SECOND of the two call sites, leaving the main GSTR-1
     * endpoint still guessing. The scripted edit reported success because it
     * had matched nothing.
     */
    const calls: string[] = []
    let from = 0
    for (;;) {
      const start = src.indexOf('buildGstr1(', from)
      if (start === -1) break
      let depth = 0
      let end = start
      for (let i = src.indexOf('(', start); i < src.length; i++) {
        if (src[i] === '(') depth++
        else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break } }
      }
      calls.push(src.slice(start, end + 1))
      from = end + 1
    }

    // Control: if this found no calls, everything below would pass vacuously.
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const call of calls) {
      expect(call).toContain('originalInvoices')
    }
  })
})
