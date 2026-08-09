/**
 * Editing a sale must not erase its invoice number.
 *
 * WHY (2026-08-09, found live while walking through an amendment). The update
 * handler wrote `invoiceNo: invoiceNo || null`. When an edit did not re-send
 * the field, the destructured value was `undefined`, `undefined || null` is
 * `null`, and the stored number was wiped.
 *
 * A July invoice was created as INV-0079, the July return was FILED with it in,
 * and then its price was corrected. It came back with `invoiceNo: null` — the
 * sale still there at ₹14,160 with no number on it.
 *
 * On a filed invoice that is not cosmetic:
 *   - GSTR-1 identifies invoices by number, so the amendment engine reported it
 *     as "cancelled after filing" — a correct inference from destroyed data.
 *   - The document series declared in Table 13 develops a hole.
 *   - The audit trail loses the thread between the bill and its number.
 *
 * This is the FOURTH instance in this codebase of "an explicit mapping drops a
 * field it was not given" — after TransactionItem.hsn, the public bill page's
 * irn, and the GSTR-3B itcBasis. The distinction that matters every time is
 * between "not sent" and "sent as empty", and the same file already got it
 * right for partyId and payeeName.
 */
import fs from 'fs'
import path from 'path'

const ROUTE = path.join(process.cwd(), 'src/app/api/transactions/[id]/route.ts')

describe('an omitted field does not erase a stored one', () => {
  const source = fs.readFileSync(ROUTE, 'utf8')

  it('never writes invoiceNo with the bare `|| null` fallback', () => {
    /*
     * `invoiceNo || null` cannot tell "not sent" from "cleared". Both collapse
     * to null and the stored number is gone.
     */
    expect(source).not.toMatch(/invoiceNo:\s*invoiceNo\s*\|\|\s*null/)
  })

  it('keeps the existing number when the field is absent', () => {
    const writes = source.match(/invoiceNo:\s*invoiceNo[^,\n]*/g) || []
    expect(writes.length).toBeGreaterThan(0)
    for (const w of writes) {
      expect(w).toMatch(/invoiceNo !== undefined/)
      expect(w).toMatch(/existing\.invoiceNo/)
    }
  })

  it('still allows an explicit clear', () => {
    // Sending null deliberately must remain possible — the guard is about
    // silence, not about forbidding the change.
    for (const w of source.match(/invoiceNo:\s*invoiceNo[^,\n]*/g) || []) {
      expect(w).toMatch(/\(invoiceNo \|\| null\)/)
    }
  })
})
