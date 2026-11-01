/**
 * Phase 8d (#116, #117) — the input credit a GSTR-3B may claim.
 * Rule 36(4) (40/2021-CT), the late-2B timing (GSTN FAQ, law report), s.16(4) (Circular 237/31/2024).
 */
import { claimForPeriod, itcMatchKey, lastClaimPeriod, earliestClaimableBill, fyStart, nextPeriod, type ItcPurchase, type TwoBLine } from '@/lib/itc-claim'

const SUP = '08AAACS1234K1Z5'
const p = (over: Partial<ItcPurchase> = {}): ItcPurchase => ({
  id: 'p1', billFp: '072026', gstin: SUP, invoiceNo: 'S-101', taxable: 66666.67, cgst: 6000, sgst: 6000, igst: 0, itcClaimedIn: null, ...over,
})
const line = (over: Partial<TwoBLine> = {}): TwoBLine => ({ supplierGstin: SUP, invoiceNumber: 'S-101', taxableValue: 55555.56, cgst: 5000, sgst: 5000, igst: 0, ...over })

describe('#116: never more than the supplier filed', () => {
  test('books say ₹12,000 of tax, the supplier filed ₹10,000 → claim ₹10,000, ₹2,000 shown as not claimed', () => {
    const r = claimForPeriod('072026', [p()], [line()])
    expect(r.claimed).toHaveLength(1)
    expect(r.claimed[0].claim).toEqual({ taxable: 55555.56, cgst: 5000, sgst: 5000, igst: 0 })
    expect(r.claimed[0].shortBy).toBe(2000)
    expect(r.totals.claim).toEqual({ taxable: 55555.56, cgst: 5000, sgst: 5000, igst: 0 })
    expect(r.totals.shortBy).toBe(2000)
  })
  test('the supplier filed MORE than the books: claim the books — credit follows your own bill', () => {
    const r = claimForPeriod('072026', [p({ cgst: 4000, sgst: 4000 })], [line()])
    expect(r.claimed[0].claim.cgst).toBe(4000)
    expect(r.claimed[0].shortBy).toBe(0)
  })
  test('head by head: the lower of IGST, CGST and SGST each, not of the totals', () => {
    const r = claimForPeriod('072026', [p({ cgst: 5000, sgst: 7000 })], [line({ cgst: 6000, sgst: 5000 })])
    expect(r.claimed[0].claim).toMatchObject({ cgst: 5000, sgst: 5000 })
    expect(r.claimed[0].shortBy).toBe(2000)
  })
  test('"inv-001" in the books matches "INV-001 " on the portal', () => {
    expect(itcMatchKey(' 08aaacs1234k1z5', 'inv-001 ')).toBe(itcMatchKey('08AAACS1234K1Z5', 'INV-001'))
  })
})

describe('#117: a supplier who files late — claimed in the month it appears, never lost, never twice', () => {
  const june = p({ id: 'june', billFp: '062026' })
  test('June\'s 2B does not have it: June defers it', () => {
    const r = claimForPeriod('062026', [june], [])
    expect(r.deferred.map((x) => x.id)).toEqual(['june'])
    expect(r.claimed).toEqual([])
  })
  test('July\'s 2B has it: July claims it, marked late', () => {
    const r = claimForPeriod('072026', [june], [line()])
    expect(r.claimed.map((c) => [c.id, c.late])).toEqual([['june', true]])
    expect(r.totals.lateCount).toBe(1)
  })
  test('August, after July was filed (stamped 072026): not claimed again', () => {
    const r = claimForPeriod('082026', [{ ...june, itcClaimedIn: '072026' }], [line()])
    expect(r.claimed).toEqual([])
  })
  test('July recomputed after filing: the same claim (its own stamp counts)', () => {
    const r = claimForPeriod('072026', [{ ...june, itcClaimedIn: '072026' }], [line()])
    expect(r.claimed.map((c) => c.id)).toEqual(['june'])
  })
  test('an older bill still missing from this 2B keeps waiting — it is not this month\'s "deferred"', () => {
    const r = claimForPeriod('082026', [june], [])
    expect(r.stillWaiting.map((x) => x.id)).toEqual(['june'])
    expect(r.deferred).toEqual([])
  })
  test('a bill dated after the period is not this period\'s', () => {
    expect(claimForPeriod('062026', [p({ billFp: '072026' })], [line()]).claimed).toEqual([])
  })
})

describe('s.16(4): 30 November after the bill\'s financial year', () => {
  test('a bill of Feb 2026 (FY 2025-26) can be claimed up to the October 2026 return', () => {
    expect(fyStart('022026')).toBe(2025)
    expect(lastClaimPeriod('022026')).toBe('102026')
    expect(claimForPeriod('102026', [p({ billFp: '022026' })], [line()]).claimed).toHaveLength(1)
  })
  test('…and not in November 2026: lapsed, shown, never claimed', () => {
    const r = claimForPeriod('112026', [p({ billFp: '022026' })], [line()])
    expect(r.claimed).toEqual([])
    expect(r.lapsed.map((x) => x.id)).toEqual(['p1'])
    expect(r.totals.lapsedTax).toBe(12000)
  })
  test('a bill of April 2026 (FY 2026-27) is fine in November 2026', () => {
    expect(lastClaimPeriod('042026')).toBe('102027')
    expect(claimForPeriod('112026', [p({ billFp: '042026' })], [line()]).claimed).toHaveLength(1)
  })
  test('the candidate window: April–October reaches back to last April; November–March only this April', () => {
    expect(earliestClaimableBill('102026')).toEqual({ month: 4, year: 2025 })
    expect(earliestClaimableBill('112026')).toEqual({ month: 4, year: 2026 })
    expect(earliestClaimableBill('032027')).toEqual({ month: 4, year: 2026 })
    expect(earliestClaimableBill('042026')).toEqual({ month: 4, year: 2025 })
  })
})

describe('#112: credit about to end (s.16(4)) — listed by bill, before it lapses', () => {
  // A 2025-26 bill: the October 2026 return is the last that can claim it.
  const old = p({ id: 'old', billFp: '022026', invoiceNo: 'S-9', cgst: 300, sgst: 300, supplier: 'Shree Traders' })
  test('the October return is final for last year\'s unfiled bills', () => {
    const r = claimForPeriod('102026', [old], [])
    expect(r.endingSoon.map((b) => [b.id, b.final, b.lastFp])).toEqual([['old', true, '102026']])
    expect(r.endingSoon[0].supplier).toBe('Shree Traders')
    expect(r.totals.endingSoonTax).toBe(600)
  })
  test('September warns a month ahead — not final yet', () => {
    const r = claimForPeriod('092026', [old], [])
    expect(r.endingSoon.map((b) => b.final)).toEqual([false])
  })
  test('August: not yet; November: lapsed, not "ending"', () => {
    expect(claimForPeriod('082026', [old], []).endingSoon).toEqual([])
    const nov = claimForPeriod('112026', [old], [])
    expect(nov.endingSoon).toEqual([])
    expect(nov.lapsed.map((b) => b.id)).toEqual(['old'])
  })
  test('a bill that reached the 2B is claimed, not listed', () => {
    const r = claimForPeriod('102026', [old], [line({ invoiceNumber: 'S-9', cgst: 300, sgst: 300 })])
    expect(r.endingSoon).toEqual([])
    expect(r.claimed.map((c) => c.id)).toEqual(['old'])
  })
  test('this year\'s bills are never "ending" in October', () => {
    expect(claimForPeriod('102026', [p({ id: 'new', billFp: '082026' })], []).endingSoon).toEqual([])
  })
  test('final first, then the biggest', () => {
    const r = claimForPeriod('102026', [
      p({ id: 'small', billFp: '052025', invoiceNo: 'A', cgst: 10, sgst: 10 }),
      p({ id: 'big', billFp: '052025', invoiceNo: 'B', cgst: 900, sgst: 900 }),
    ], [])
    expect(r.endingSoon.map((b) => b.id)).toEqual(['big', 'small'])
  })
  test('nextPeriod rolls the year', () => {
    expect(nextPeriod('122026')).toBe('012027')
    expect(nextPeriod('092026')).toBe('102026')
  })
})
