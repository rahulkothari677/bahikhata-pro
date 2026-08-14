/**
 * @jest-environment node
 *
 * What the shopkeeper is TOLD after a restore.
 *
 * WHY (audit 2026-08-14). The restore screen built its own toast from four
 * counters and never rendered the server's `message`. Two warnings added on the
 * server during this audit — "this backup file contains no payment records" and
 * "3 payment-to-bill links could not be restored" — were written, returned, and
 * dropped on the floor. The shopkeeper saw "Restore complete!".
 *
 * That is exactly the failure silent-failure-reporting.test.ts was written
 * about, reappearing one level up: the SERVER said the right thing and the USER
 * still saw success. Fixing only those two warnings would leave the next one to
 * be lost the same way, so the contract tested here is the general one — every
 * warning the server sends is rendered, whatever it says.
 */
import { describeRestoreOutcome } from '@/lib/restore-outcome'
import fs from 'fs'
import path from 'path'

const clean = {
  results: {
    products: { imported: 10, skipped: 0 },
    parties: { imported: 5, skipped: 0 },
    transactions: { imported: 40, skipped: 0, quarantined: 0, quarantineReasons: [] },
    payments: { imported: 25, skipped: 0, allocationsRestored: 25, allocationsSkipped: 0 },
    relinked: 40, unmatched: 0, stockRebuilt: 10,
  },
  warnings: [] as string[],
}

describe('a clean restore', () => {
  it('is reported as a success', () => {
    expect(describeRestoreOutcome(clean).kind).toBe('success')
  })

  it('does not invent a warning out of nothing', () => {
    expect(describeRestoreOutcome(clean).title).toBe('Restore complete!')
  })
})

describe('every server warning reaches the user', () => {
  it('shows a warning the code here has never heard of', () => {
    /*
     * THE test in this file. A future warning must surface without anyone
     * editing this function — that is the whole point of returning a list.
     */
    const out = describeRestoreOutcome({
      ...clean,
      warnings: ['Some future warning about something not yet invented.'],
    })
    expect(out.kind).toBe('warning')
    expect(out.description).toContain('Some future warning about something not yet invented.')
  })

  it('shows the warning even when another problem won the headline', () => {
    // The headline can only name one thing. The warnings must not be crowded
    // out by it — losing one because a different problem was worse is the same
    // silent drop in a new costume.
    const out = describeRestoreOutcome({
      results: { ...clean.results, payments: { imported: 20, skipped: 5 } },
      warnings: ['A warning that must not be swallowed.'],
    })
    expect(out.title).toContain('5 payment(s) NOT imported')
    expect(out.description).toContain('A warning that must not be swallowed.')
  })

  it('shows several at once', () => {
    const out = describeRestoreOutcome({ ...clean, warnings: ['First thing.', 'Second thing.'] })
    expect(out.description).toContain('First thing.')
    expect(out.description).toContain('Second thing.')
  })

  it('a warning alone is enough to stop it being called a success', () => {
    // The "backup file had no payments at all" case arrives exactly here: zero
    // payments were SKIPPED, because the file never held any to skip.
    const out = describeRestoreOutcome({
      ...clean,
      results: { ...clean.results, payments: { imported: 0, skipped: 0 } },
      warnings: ['IMPORTANT: this backup file contains no payment records.'],
    })
    expect(out.kind).toBe('warning')
    expect(out.title).not.toBe('Restore complete!')
    expect(out.description).toContain('no payment records')
  })
})

describe('payments dropped entirely', () => {
  const out = describeRestoreOutcome({
    results: { ...clean.results, payments: { imported: 20, skipped: 5 } },
  })

  it('leads with it, because those balances read too high', () => {
    expect(out.kind).toBe('warning')
    expect(out.title).toContain('5 payment(s) NOT imported')
  })

  it('says what it means before anyone chases a customer', () => {
    expect(out.description).toMatch(/HIGHER balance than they really owe/)
  })
})

describe('payments restored but not linked to their bills', () => {
  const out = describeRestoreOutcome({
    results: { ...clean.results, payments: { imported: 25, skipped: 0, allocationsSkipped: 3 } },
  })

  it('is a warning, not a success', () => {
    expect(out.kind).toBe('warning')
    expect(out.title).toContain('3 payment(s) not linked to a bill')
  })

  it('explains the exact shape of it: total right, invoices wrong', () => {
    // Subtler than a missing payment and easier to act on wrongly. The party's
    // balance is correct, so nothing looks amiss until someone opens the
    // invoice — which is the number they check before sending a reminder.
    expect(out.description).toMatch(/balance/i)
    expect(out.description).toMatch(/still show as unpaid/i)
    expect(out.description).toMatch(/reminder/i)
  })

  it('yields to fully missing payments, which are worse', () => {
    const both = describeRestoreOutcome({
      results: { ...clean.results, payments: { imported: 20, skipped: 5, allocationsSkipped: 3 } },
    })
    expect(both.title).toContain('NOT imported')
  })
})

describe('the older warnings still work', () => {
  it('quarantined transactions', () => {
    const out = describeRestoreOutcome({
      results: {
        ...clean.results,
        transactions: { imported: 38, quarantined: 2, quarantineReasons: ['INV-7: totals disagree'] },
      },
    })
    expect(out.kind).toBe('warning')
    expect(out.title).toContain('2 transaction(s) NOT imported')
    expect(out.description).toContain('INV-7: totals disagree')
  })

  it('items not linked to the catalog', () => {
    const out = describeRestoreOutcome({ results: { ...clean.results, unmatched: 4 } })
    expect(out.kind).toBe('warning')
    expect(out.title).toContain('4 item(s) not linked to catalog')
  })

  it('rows skipped without any of the above', () => {
    const out = describeRestoreOutcome({
      results: { ...clean.results, parties: { imported: 3, skipped: 2 } },
    })
    expect(out.title).toContain('2 row(s) skipped')
  })
})

describe('it does not fall over on a thin response', () => {
  it.each([
    ['empty object', {}],
    ['no results', { message: 'ok' }],
    ['empty results', { results: {} }],
  ])('%s', (_label, input) => {
    // A restore that half-answers must not turn into a blank or NaN-filled
    // toast on top of whatever already went wrong.
    const out = describeRestoreOutcome(input)
    expect(out.title.length).toBeGreaterThan(0)
    expect(out.description).not.toContain('undefined')
    expect(out.description).not.toContain('NaN')
  })
})

describe('the restore screen actually uses this', () => {
  // Source check on purpose: it asserts wiring, which the unit tests cannot see.
  const UI = fs.readFileSync(
    path.join(process.cwd(), 'src/components/settings/Settings.tsx'),
    'utf8',
  )

  it('calls it with the server response', () => {
    expect(UI).toMatch(/describeRestoreOutcome\(result\)/)
  })

  it('renders the description it returns, rather than composing its own', () => {
    expect(UI).toMatch(/description: outcome\.description/)
    expect(UI).toMatch(/toast\(outcome\.title/)
  })

  it('uses a warning toast for a warning outcome', () => {
    // A warning shown as a green success tick is barely better than silence.
    expect(UI).toMatch(/outcome\.kind === 'warning' \? sonnerToast\.warning : sonnerToast\.success/)
  })

  it('leaves no second, stale copy of the old wording behind', () => {
    // A leftover branch would drift from the tested one.
    expect(UI).not.toContain('HIGHER balance than they really owe')
  })
})
