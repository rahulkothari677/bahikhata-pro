/**
 * #86 — one rate list was doing two jobs.
 *
 * "What rate might I meet in this shop's data?" and "what rate may I charge on
 * a bill I am writing today?" are different questions with different answers,
 * and using one list for both is why 12% still appeared on a new sale.
 *
 * 12% was removed for goods by Notification 09/2025-CT(R), effective
 * 22 Sep 2025. Verified against the notification this repo actually holds
 * rather than from commentary: of the parsed rate rows, ZERO are 12%.
 */

import {
  GST_RATE_SLABS,
  CURRENT_GST_RATE_SLABS,
  ratesForPicker,
  isLegacyGstRate,
  isStandardGstRate,
} from '@/lib/gst-rates'
import { readCode } from '@/test-support/read-source'
import rateTable from '@/lib/data/gst-goods-rates.json'

describe('12% is gone from what a new bill may charge', () => {
  test('a new sale is not offered 12%', () => {
    expect(CURRENT_GST_RATE_SLABS).not.toContain(12)
    expect(ratesForPicker()).not.toContain(12)
    expect(ratesForPicker(0)).not.toContain(12)
    expect(ratesForPicker(18)).not.toContain(12)
  })

  test('the live notification really has no 12% row', () => {
    /*
     * The claim checked against the document rather than taken on trust. If a
     * future notification brings 12% back, this fails and someone has to look
     * — which is the right outcome, because the picker would then be wrong.
     */
    const rates = new Set<number>()
    for (const rules of Object.values(rateTable.codes as Record<string, Array<{ gstRate: number }>>)) {
      for (const r of rules) rates.add(r.gstRate)
    }
    expect([...rates]).not.toContain(12)
    // And the ones that ARE live are all offered or deliberately excluded.
    expect([...rates].sort((a, b) => a - b)).toEqual([0.25, 1.5, 3, 5, 18, 28, 40])
  })
})

describe('but 12% must stay reachable, and this is the half a naive fix breaks', () => {
  test('an existing 12% product keeps 12% on its own picker', () => {
    /*
     * THE REAL RISK. A shadcn Select whose value has no matching option renders
     * blank, and the next save writes whatever is then picked. Simply deleting
     * 12% would silently rewrite the rate on every pre-September product the
     * moment somebody opened it to fix a typo.
     */
    const opts = ratesForPicker(12)
    expect(opts).toContain(12)
    expect(opts).toEqual([0, 3, 5, 12, 18, 28, 40])
  })

  test('it is labelled as old, so nobody picks it for a new line by accident', () => {
    expect(isLegacyGstRate(12)).toBe(true)
    expect(isLegacyGstRate(18)).toBe(false)
  })

  test('12% is still VALID — an old bill is not an error', () => {
    /*
     * An invoice dated before 22 Sep 2025 is correctly 12%, and so is a credit
     * note raised against it today. Validation and reporting keep the full
     * historical set; only the picker narrowed.
     */
    expect(isStandardGstRate(12)).toBe(true)
    expect(GST_RATE_SLABS).toContain(12)
  })

  test('an unusual rate a shop genuinely uses is kept too', () => {
    // 0.25% and 1.5% are real slabs left off the picker on purpose — see the
    // note in gst-rates.ts. A shop that has one must not lose it on edit.
    expect(ratesForPicker(0.25)).toContain(0.25)
    expect(ratesForPicker(1.5)).toContain(1.5)
  })
})

describe('both pickers use the narrowed list', () => {
  test.each([
    'src/components/inventory/ProductDialog.tsx',
    'src/components/ledger/TransactionEntry.tsx',
  ])('%s offers current rates, and passes its own value', file => {
    /*
     * Passing the value is not optional decoration — it is what stops the
     * silent rewrite described above. A picker that called ratesForPicker()
     * with no argument would look correct and destroy data.
     */
    const ui = readCode(file)
    expect(ui).toContain('ratesForPicker(')
    expect(ui).not.toMatch(/ratesForPicker\(\)/)
    expect(ui).not.toContain('GST_RATES.map')
  })
})
