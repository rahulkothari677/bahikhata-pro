/**
 * @jest-environment node
 *
 * Restoring a backup that has no payments must SAY so.
 *
 * WHY (audit 2026-08-14). Every backup file produced before version 2 is
 * missing all payments — the export never wrote them. Those files are already
 * on shopkeepers' phones and drives, and nothing can put the payments back into
 * them.
 *
 * So the fix has two halves. The export now includes payments; this is the
 * other half. Restoring an OLD file brings back every invoice with none of the
 * money paid against it, and without a warning the restore reports
 * "payments: 0" and reads as a success — because the file genuinely contained
 * none. The shopkeeper would see inflated balances and go looking for the
 * mistake in their own bookkeeping.
 *
 * These tests CALL the rule. An earlier version of this file matched regexes
 * against the route's source, which passes just as happily when the branch
 * above the code is `if (false)` — a mistake already made twice in this audit.
 */
import { missingPaymentsWarning } from '@/lib/restore-warnings'
import fs from 'fs'
import path from 'path'

describe('when the file has no payments', () => {
  it('warns', () => {
    expect(missingPaymentsWarning({}, 1)).toContain('no payment records')
  })

  it('says the invoices DID come back, so they do not re-import in a panic', () => {
    // Restoring twice is its own disaster. The message has to separate what
    // worked from what did not.
    expect(missingPaymentsWarning({}, 1)).toMatch(/invoice[\s\S]{0,80}restored/i)
  })

  it('warns that balances will read too high, which is the visible symptom', () => {
    expect(missingPaymentsWarning({}, 1)).toMatch(/more owing/i)
  })

  it('says what to do about it', () => {
    expect(missingPaymentsWarning({}, 1)).toMatch(/re-enter|restore from a backup/i)
  })

  it('names the file version, so support can tell how old it is', () => {
    expect(missingPaymentsWarning({}, 1)).toContain('file version 1')
  })

  it('says "unknown" rather than "undefined" when the file has no version', () => {
    const msg = missingPaymentsWarning({}, undefined) as string
    expect(msg).toContain('file version unknown')
    expect(msg).not.toContain('undefined')
  })
})

describe('when the file has payments', () => {
  it('stays quiet', () => {
    // Warning on every restore would train shopkeepers to ignore it — the same
    // failure as an overpayment warning that fires on nearly every payment.
    expect(missingPaymentsWarning({ payments: [{ id: 'p1', amount: 500 }] }, 2)).toBeNull()
  })

  it('stays quiet for a shop that genuinely has no payments yet', () => {
    // An empty ARRAY is a real answer: this shop recorded none. That is not the
    // same as a file with no payments section at all, and must not warn.
    expect(missingPaymentsWarning({ payments: [] }, 2)).toBeNull()
  })
})

describe('the file is judged by its contents, not its label', () => {
  it('a file stamped version 2 with no payments section still warns', () => {
    // Otherwise a hand-edited or third-party file passes on its claim alone.
    expect(missingPaymentsWarning({}, 2)).toContain('no payment records')
  })

  it('a file with payments and no version stamp does not warn', () => {
    expect(missingPaymentsWarning({ payments: [{ id: 'p1' }] }, undefined)).toBeNull()
  })

  it('a payments key that is not an array is treated as missing', () => {
    // `payments: null` or `payments: {}` carries no money either. Anything that
    // is not a list of records is the same situation as no key at all.
    expect(missingPaymentsWarning({ payments: null }, 2)).toContain('no payment records')
    expect(missingPaymentsWarning({ payments: {} }, 2)).toContain('no payment records')
  })
})

describe('the route actually uses the rule', () => {
  // The logic above is only worth testing if the restore path runs it. This is
  // a source check on purpose, and it is the ONLY one here: it asserts wiring,
  // which the unit tests above cannot see.
  const ROUTE = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/import/restore/route.ts'),
    'utf8',
  )

  it('imports it', () => {
    expect(ROUTE).toMatch(/import \{ missingPaymentsWarning \} from '@\/lib\/restore-warnings'/)
  })

  it('calls it with the restored data and the file version', () => {
    expect(ROUTE).toMatch(/missingPaymentsWarning\(data, backup\.version\)/)
  })

  it('appends the result to the message', () => {
    expect(ROUTE).toMatch(/message \+= noPaymentsWarning/)
  })

  /*
   * 🔒 The `message` alone is not enough, and that is not a theory: the restore
   * screen composed its own toast and never rendered `message`, so this warning
   * was written, returned and dropped on the floor. It must go into the
   * `warnings` LIST, which the screen always renders.
   *
   * A break-verification pass caught this gap the hard way — replacing the
   * returned list with a hardcoded `[]` broke nothing. Hence these three.
   */
  it('puts it in the warnings list, which is what the screen renders', () => {
    expect(ROUTE).toMatch(/warnings\.push\(noPaymentsWarning\.trim\(\)\)/)
  })

  it('returns the list that was actually built, not an empty one', () => {
    const response = ROUTE.slice(ROUTE.lastIndexOf('return NextResponse.json({'))
    expect(response).toMatch(/^\s*warnings,\s*$/m)
    expect(response).not.toMatch(/warnings: \[\]/)
  })

  it('the list is declared before anything pushes to it', () => {
    expect(ROUTE.indexOf('const warnings: string[] = []'))
      .toBeLessThan(ROUTE.indexOf('warnings.push('))
  })

  it('leaves no second, stale copy of the wording in the route', () => {
    // The inline version was removed when this moved to a lib. A leftover copy
    // would drift from the tested one.
    expect(ROUTE).not.toContain('IMPORTANT: this backup file contains no payment records')
  })
})
