/**
 * 9b-3: one rule for "the GSTR-1 figure", read by both cards on the GSTR-3B screen.
 *
 * Found on the local check: after GSTR-1 was filed at ₹180 and a bill edited down,
 * the notice-risk card said "GSTR-1 declares ₹36 more" while the card above it said
 * "GSTR-1 and GSTR-3B agree — ₹144". Each route read GSTR-1 its own way.
 */
import { gstr1Declared } from '@/lib/gst-reconciliation'
import { readCode } from '@/test-support/read-source'

describe('gstr1Declared', () => {
  const summary = { totalOutputTax: 144, totalTaxableValue: 800 }

  it('a filed GSTR-1 is the filed figure, not the books today', () => {
    expect(gstr1Declared({ summary, snapshot: { filingStatus: 'filed', filedTotalOutputTax: 180, filedTotalTaxableValue: 1000 } }))
      .toEqual({ tax: 180, taxable: 1000, filed: true })
  })

  it('a draft or no snapshot is the books — what will be filed', () => {
    expect(gstr1Declared({ summary, snapshot: { filingStatus: 'draft', filedTotalOutputTax: 180 } }))
      .toEqual({ tax: 144, taxable: 800, filed: false })
    expect(gstr1Declared({ summary, snapshot: null })).toEqual({ tax: 144, taxable: 800, filed: false })
  })
})

describe('both GSTR-3B cards read GSTR-1 through it', () => {
  it.each(['app/api/notice-risk/route.ts', 'app/api/gst-reconciliation/route.ts'])('%s', (file) => {
    const code = readCode(file)
    expect(code).toMatch(/gstr1Declared\(g1\)/)
    expect(code).not.toMatch(/g1\.summary\?\.totalOutputTax/)
  })
})
