/**
 * @jest-environment node
 *
 * 9b-3: what /api/notice-risk compares.
 *   - Rule 88C takes the FILED GSTR-1 tax once GSTR-1 is filed, not the books today.
 *   - Rule 88D takes 2B's credit by document (#357): bills with credit, less
 *     suppliers' credit notes — against 3B's claim less the shop's own debit notes.
 *   - The 88C gap's bills come back for GSTR-1A when its window is open (#101).
 */
const mockGroupBy = jest.fn()
jest.mock('@/lib/db', () => ({
  db: {
    gstr2bImport: { findFirst: jest.fn().mockResolvedValue({ id: 'imp1', invoiceCount: 2, importedAt: new Date('2026-11-14') }) },
    gstr2bInvoice: { groupBy: (...a: unknown[]) => mockGroupBy(...a) },
  },
}))
jest.mock('@/lib/get-auth', () => ({
  getAuthContext: jest.fn().mockResolvedValue({ userId: 'user_1', role: 'owner', permissions: null, error: null }),
}))
jest.mock('@/lib/staff-permissions', () => ({ canAccessModule: () => true }))

import { GET } from '@/app/api/notice-risk/route'

let g1: Record<string, unknown>
let g3: Record<string, unknown>
const realFetch = global.fetch

beforeEach(() => {
  g1 = { summary: { totalOutputTax: 800 }, snapshot: null, gstr1a: null }
  g3 = { totalOutputTax: 800, totalItc: 1800, totalDebitNoteTax: 0 }
  mockGroupBy.mockReset()
  mockGroupBy.mockResolvedValue([
    { docType: 'invoice', itcAvailable: true, isReverseCharge: false, _sum: { igst: 0, cgst: 900, sgst: 900 } },
  ])
  global.fetch = jest.fn(async (url: string) => ({
    ok: true, status: 200, json: async () => (String(url).includes('/api/gstr-1') ? g1 : g3),
  })) as unknown as typeof fetch
})
afterAll(() => { global.fetch = realFetch })

const get = async () => (await GET(new Request('https://app.test/api/notice-risk?month=2026-10') as never)).json()
const rule = (body: { rules: Array<{ rule: string }> }, r: string) => body.rules.find((x) => x.rule === r) as any

describe('9b-3: Rule 88C reads the filed GSTR-1', () => {
  it('a filed GSTR-1 of ₹1,000 against 3B ₹800 is a ₹200 gap, though the books now say ₹800', async () => {
    g1 = { ...g1, snapshot: { filingStatus: 'filed', filedTotalOutputTax: 1000 } }
    const body = await get()
    expect(body.inputs.gstr1Filed).toBe(true)
    expect(rule(body, '88C').excess).toBe(200)
    expect(body.gstr1aFix).toBeNull()
  })

  it('before filing, the books are what will be filed', async () => {
    const body = await get()
    expect(body.inputs.gstr1Filed).toBe(false)
    expect(rule(body, '88C').excess).toBe(0)
  })

  it('with GSTR-1A open, the changed bill is offered and the advice names it', async () => {
    g1 = {
      ...g1,
      snapshot: { filingStatus: 'filed', filedTotalOutputTax: 1000 },
      gstr1a: { window: { isOpen: true }, corrections: [{ inum: 'INV-0007', changes: ['taxable value'], fitsGstr1a: true, reason: '' }], blockedCount: 0 },
    }
    const body = await get()
    expect(body.gstr1aFix).toEqual({ bills: [{ inum: 'INV-0007', changes: ['taxable value'] }], blockedCount: 0 })
    expect(rule(body, '88C').action).toBe('File GSTR-1A for this bill before you file GSTR-3B.')
  })
})

describe('9b-3 (#357): Rule 88D reads 2B by document', () => {
  it('a supplier credit note of ₹180 not in the books shows as ₹180 over 2B', async () => {
    mockGroupBy.mockResolvedValue([
      { docType: 'invoice', itcAvailable: true, isReverseCharge: false, _sum: { igst: 0, cgst: 900, sgst: 900 } },
      { docType: 'credit-note', itcAvailable: true, isReverseCharge: false, _sum: { igst: 0, cgst: 90, sgst: 90 } },
    ])
    g3 = { ...g3, itcDetail: { unrecordedNotesCount: 1 } }
    const body = await get()
    expect(body.inputs.gstr2bItc).toBe(1620)
    expect(rule(body, '88D').excess).toBe(180)
    // the cause is the unrecorded note, so the advice names it
    expect(rule(body, '88D').action).toBe('Record the supplier’s credit note in Supplier bills (GSTR-2B).')
  })

  it('once the shop records its return entry (₹180 debit note), the claim matches 2B', async () => {
    mockGroupBy.mockResolvedValue([
      { docType: 'invoice', itcAvailable: true, isReverseCharge: false, _sum: { igst: 0, cgst: 900, sgst: 900 } },
      { docType: 'credit-note', itcAvailable: true, isReverseCharge: false, _sum: { igst: 0, cgst: 90, sgst: 90 } },
    ])
    g3 = { ...g3, totalDebitNoteTax: 180 }
    const body = await get()
    expect(body.inputs.claimedItc).toBe(1620)
    expect(rule(body, '88D').excess).toBe(0)
  })
})
