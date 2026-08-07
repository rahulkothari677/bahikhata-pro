/**
 * An invoice number is a legal document number, not free text.
 *
 * WHY (2026-08-08). A generated GSTR-1 for August 2026 carried an invoice
 * numbered "qnip535d", sitting among INV-0041…INV-0075 — a random-looking
 * string filed as the number of a tax invoice.
 *
 * It got there because two things lined up:
 *   - createTransactionSchema accepted `z.string().max(100)`: a hundred
 *     characters of anything at all.
 *   - The transactions route prefers the client's value over its own series
 *     (`invoiceNo || generated`), so whatever arrives becomes the number of
 *     record.
 *
 * CGST Rule 46(b) is specific: a consecutive serial number, not exceeding
 * SIXTEEN characters, containing only alphanumerics, hyphen and slash, unique
 * within a financial year.
 *
 * These tests pin the two halves the schema can enforce — length and character
 * set. Consecutiveness and per-year uniqueness are properties of the series
 * rather than of one value, and belong to the counter, not here.
 *
 * NOTE the override itself is deliberate and stays: a shopkeeper continuing a
 * paper series ("2026/RG/001"), or recording a supplier's own bill number on a
 * purchase, both need it. The fault was never that the field exists — it is
 * that it accepted anything.
 */
import { createTransactionSchema } from '@/lib/validation'

const base = {
  type: 'sale' as const,
  items: [{ productName: 'Item', quantity: 1, unitPrice: 100, gstRate: 5 }],
}

const withNo = (invoiceNo: string) => createTransactionSchema.safeParse({ ...base, invoiceNo })

describe('invoice numbers a shop legitimately uses are accepted', () => {
  it.each([
    ['INV-0041', 'the app’s own series'],
    ['2026/RG/001', 'a paper series carried over, slashes allowed by the rule'],
    ['A1', 'short is fine'],
    ['ABCDEFGH12345678', 'exactly 16 characters — the legal maximum'],
    ['SUP-2026-0007', 'a supplier’s own bill number on a purchase'],
  ])('%s — %s', (value) => {
    expect(withNo(value).success).toBe(true)
  })
})

describe('numbers Rule 46 does not permit are refused', () => {
  it('refuses more than 16 characters', () => {
    // The portal rejects doc_issue ranges over 16 chars outright, and the rule
    // caps the number itself at 16.
    const r = withNo('ABCDEFGH123456789')
    expect(r.success).toBe(false)
  })

  it('refuses spaces', () => {
    expect(withNo('INV 0041').success).toBe(false)
  })

  it('refuses punctuation outside hyphen and slash', () => {
    for (const v of ['INV#0041', 'INV_0041', 'INV.0041', 'INV@41', 'INV,41']) {
      expect(withNo(v).success).toBe(false)
    }
  })

  it('refuses an empty or whitespace-only number', () => {
    // Blank is not a number. It would also produce an empty from/to in the
    // document-issued table.
    expect(withNo('').success).toBe(false)
    expect(withNo('   ').success).toBe(false)
  })

  it('still accepts the field being absent — the app then generates the series', () => {
    // Most sales send nothing and get INV-XXXX from the atomic counter. The
    // validation must not force shopkeepers to invent a number.
    expect(createTransactionSchema.safeParse(base).success).toBe(true)
    expect(createTransactionSchema.safeParse({ ...base, invoiceNo: null }).success).toBe(true)
  })
})

describe('the specific value that was found in a filed return', () => {
  it('accepts "qnip535d" on its characters alone — which is why length and charset are not the whole answer', () => {
    /*
     * Recorded deliberately, because it is the limit of what a schema can do.
     * "qnip535d" is eight alphanumeric characters: legal under Rule 46 read
     * literally, and indistinguishable from a real short series like "A1".
     *
     * So this validation stops the egregious cases — 100-character strings,
     * spaces, punctuation — but it CANNOT stop a client that sends a plausible
     * random id. That requires finding the caller that produced this one. The
     * fix here narrows the hole; it does not close it, and saying so is more
     * useful than a test that pretends otherwise.
     */
    expect(withNo('qnip535d').success).toBe(true)
  })
})
