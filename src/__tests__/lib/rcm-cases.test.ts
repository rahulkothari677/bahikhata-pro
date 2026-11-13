/**
 * 9c-2 (#126): the reverse-charge cases a shop meets, and the Rule 47A
 * self-invoice date. Pinned answers, read by hand against the law report.
 */
import { RCM_CASES, rcmCasesFor, selfInvoiceDue, SELF_INVOICE_DAYS } from '@/lib/rcm-cases'
import { readCode } from '@/test-support/read-source'

const day = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null)

describe('the four cases, each with its rate', () => {
  it('freight 5%; advocate, rent, security 18%', () => {
    expect(RCM_CASES.map((c) => `${c.id} ${c.rate}`)).toEqual(['gta 5', 'advocate 18', 'rent 18', 'security 18'])
  })

  it('a regular shop meets all four; a composition shop not rent or security; a not-registered shop none', () => {
    expect(rcmCasesFor('regular').map((c) => c.id)).toEqual(['gta', 'advocate', 'rent', 'security'])
    expect(rcmCasesFor('composition').map((c) => c.id)).toEqual(['gta', 'advocate'])
    expect(rcmCasesFor('unregistered')).toEqual([])
  })

  it('never offers "goods from an unregistered seller" — s.9(4) is only for real-estate promoters', () => {
    for (const c of RCM_CASES) expect(`${c.label} ${c.lineName}`).not.toMatch(/unregistered (seller|supplier)|goods/i)
  })
})

describe('Rule 47A: self-invoice within 30 days when the supplier is not registered', () => {
  it('received 13 Nov 2026 → due 13 Dec 2026', () => {
    expect(SELF_INVOICE_DAYS).toBe(30)
    expect(day(selfInvoiceDue('2026-11-13', null))).toBe('2026-12-13')
    expect(day(selfInvoiceDue('2026-11-13', ''))).toBe('2026-12-13')
  })

  it('across a month end: 31 Jan 2027 → 2 Mar 2027', () => {
    expect(day(selfInvoiceDue('2027-01-31', null))).toBe('2027-03-02')
  })

  it('a registered supplier issues the invoice — no self-invoice; no date, no answer', () => {
    expect(selfInvoiceDue('2026-11-13', '08AAACG1234K1ZT')).toBeNull()
    expect(selfInvoiceDue(null, null)).toBeNull()
    expect(selfInvoiceDue('not a date', null)).toBeNull()
  })
})

describe('the purchase screen uses them', () => {
  const code = readCode('components/ledger/TransactionEntry.tsx')
  it('chips from rcmCasesFor, the self-invoice date from selfInvoiceDue', () => {
    expect(code).toContain('rcmCasesFor(shopGstStatus).map((c) => (')
    expect(code).toContain('selfInvoiceDue(date, selectedParty.gstin)')
  })
  it('the old hint naming unregistered suppliers is gone', () => {
    expect(code).not.toMatch(/Usual for transport, legal services, and\s+unregistered suppliers/)
  })
})
