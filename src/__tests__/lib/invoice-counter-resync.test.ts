/**
 * A shop must never be unable to write a bill (2026-07-22).
 *
 * What went wrong, in shop terms: a shopkeeper moving over from a paper book
 * types the real numbers on their first few bills — INV-0045, INV-0046,
 * INV-0047. The app's own counter starts at 1 and, months later, walks into
 * that block. It retried three times, one number at a time, hit taken numbers
 * on all three, and gave up. From that moment EVERY new sale failed with
 * "Duplicate invoice number" and the shop could not bill anyone until someone
 * typed a free number by hand for each sale.
 *
 * The old code called this "extremely unlikely with the atomic counter". It is
 * not unlikely — it needs only three consecutive numbers already in use, and I
 * hit it during the regression pass with a single manually-numbered bill.
 *
 * The counter now jumps PAST every number already used in that series.
 */
import fs from 'fs'
import path from 'path'

function readStripped(rel: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const route = readStripped('app/api/transactions/route.ts')

describe('invoice number collisions resync the counter', () => {
  test('an invoiceNo conflict is distinguished from other unique conflicts', () => {
    // Blindly retrying every P2002 would also swallow the clientMutationId
    // race, which has its own idempotent handling.
    expect(route).toMatch(/const isInvoiceConflict = target\?\.includes\('invoiceNo'\)/)
    expect(route).toMatch(/isMutationIdConflict/)
  })

  test('it jumps past the highest number already used, rather than crawling', () => {
    expect(route).toMatch(/MAX\(CAST\(REPLACE\("invoiceNo"/)
    expect(route).toMatch(/invoiceCounter\.upsert/)
    expect(route).toMatch(/const nextSeq = /)
  })

  test('sales and purchases resync their own series', () => {
    // PUR- and INV- are separate counters; resyncing the wrong one would
    // leave the shop just as stuck.
    expect(route).toMatch(/const prefix = type === 'purchase' \? 'PUR-' : 'INV-'/)
    expect(route).toMatch(/type === 'purchase' \? \{ purchaseSeq: nextSeq \} : \{ seq: nextSeq \}/)
  })

  test('the scan is scoped to one shop', () => {
    const block = route.slice(route.indexOf('isInvoiceConflict'), route.indexOf('isInvoiceConflict') + 1400)
    expect(block).toMatch(/WHERE "userId" = \$\{userId\}/)
  })

  test('the query cannot hit the substring/bigint type error again', () => {
    // Passing the prefix length as a bound parameter makes Postgres look for
    // substring(text, bigint), which does not exist — this failed live before
    // being caught.
    const block = route.slice(route.indexOf('isInvoiceConflict'), route.indexOf('isInvoiceConflict') + 1400)
    expect(block).not.toMatch(/SUBSTRING\("invoiceNo" FROM \$\{/)
  })

  test('only rows that are exactly prefix + digits are considered', () => {
    // A hand-typed "INV-2024/07" must not blow up the CAST.
    expect(route).toMatch(/\^' \+ prefix \+ '\[0-9\]\+\$/)
  })
})
