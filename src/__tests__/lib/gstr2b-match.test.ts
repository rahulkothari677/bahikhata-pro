/**
 * 9a-2: every 2B document in exactly one group, with its reason (lib/gstr2b-match.ts).
 */
import { sortTwoB, normBillNo, type MatchLine, type MatchPurchase, type StoredDecision } from '@/lib/gstr2b-match'

const G = '08AAACS1234K1Z5'
const H = '08BBBBB2222B1Z2'
const line = (no: string, over: Partial<MatchLine> = {}): MatchLine => ({
  id: `L-${no}`, docType: 'invoice', supplierGstin: G, invoiceNumber: no, originalNumber: null, invoiceDate: '10-10-2026',
  taxableValue: 1000, cgst: 90, sgst: 90, igst: 0, totalAmount: 1180, itcAvailable: true, itcReason: null, isReverseCharge: false, ...over,
})
const buy = (id: string, no: string, over: Partial<MatchPurchase> = {}): MatchPurchase => ({
  id, gstin: G, invoiceNo: no, totalAmount: 1180, cgst: 90, sgst: 90, igst: 0, date: '2026-10-10', supplier: 'Sharma Traders', ...over,
})
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id)

describe('the bill number, read the way people write it', () => {
  it('ignores separators, case and leading zeros — nothing else', () => {
    expect(normBillNo('RO/0012')).toBe('RO12')
    expect(normBillNo('ro-12')).toBe('RO12')
    expect(normBillNo('RO 12')).toBe('RO12')
    expect(normBillNo('RO-12-2026')).toBe('RO122026')
    expect(normBillNo('RO-13')).not.toBe(normBillNo('RO-12'))
    expect(normBillNo('')).toBe('')
  })
})

describe('each 2B bill lands in exactly one group', () => {
  const lines = [
    line('A-1'),                                       // matched
    line('A-2', { totalAmount: 1300 }),                // amount differs by ₹120
    line('A-3', { itcAvailable: false, itcReason: 'P' }), // in books, 2B says no credit
    line('RO/0012'),                                   // books have RO-12 → offered, not matched
    line('X-9', { supplierGstin: H }),                 // nobody's bill in the books
    line('CN-1', { docType: 'credit-note' }),          // a supplier's note
  ]
  const purchases = [buy('p1', 'A-1'), buy('p2', 'A-2'), buy('p3', 'A-3'), buy('p4', 'RO-12'), buy('p5', 'A-7')]
  const r = sortTwoB(lines, purchases, [])

  it('matched, amount differs (with the difference), no credit', () => {
    expect(r.matched.map((p) => [p.line.invoiceNumber, p.purchase.id, p.via])).toEqual([['A-1', 'p1', 'number']])
    expect(r.amountDiffers.map((p) => [p.line.invoiceNumber, p.difference])).toEqual([['A-2', 120]])
    expect(r.noCredit.map((p) => [p.line.invoiceNumber, p.purchase.id])).toEqual([['A-3', 'p3']])
  })

  it('a number written differently is offered as "same bill?", never matched on its own', () => {
    expect(r.sameBill.map((s) => [s.line.invoiceNumber, ids(s.candidates)])).toEqual([['RO/0012', ['p4']]])
    expect(r.matched.some((p) => p.purchase.id === 'p4')).toBe(false)
  })

  it('not in your books; notes kept apart; the rest of the books is waiting', () => {
    expect(r.notInBooks.map((l) => l.invoiceNumber)).toEqual(['X-9'])
    expect(r.notes.map((l) => l.invoiceNumber)).toEqual(['CN-1'])
    expect(ids(r.waiting)).toEqual(['p5']) // p4 is being asked about, so it is not also "waiting"
  })

  it('every document counted once', () => {
    const placed = r.matched.length + r.amountDiffers.length + r.noCredit.length + r.sameBill.length + r.notInBooks.length + r.notMine.length + r.notes.length
    expect(placed).toBe(lines.length)
  })
})

describe('a corrected bill (b2ba) finds the purchase entered under its old number', () => {
  it('pairs by the original number 2B names, and tells the claim which purchase it is', () => {
    const r = sortTwoB([line('S-55A', { originalNumber: 'S-55' })], [buy('p1', 'S-55')], [])
    expect(r.matched.map((p) => [p.purchase.id, p.via])).toEqual([['p1', 'corrected']])
    expect(r.claimNumber.get('L-S-55A')).toBe('S-55')
  })
  it('its own number wins when the books already carry it', () => {
    const r = sortTwoB([line('S-55A', { originalNumber: 'S-55' })], [buy('p1', 'S-55'), buy('p2', 'S-55A')], [])
    expect(r.matched.map((p) => p.purchase.id)).toEqual(['p2'])
    expect(r.claimNumber.size).toBe(0)
  })
})

describe('the shop’s answers, remembered', () => {
  const lines = [line('RO/0012'), line('X-9', { supplierGstin: H })]
  const purchases = [buy('p4', 'RO-12')]
  const say = (d: Partial<StoredDecision>): StoredDecision => ({ supplierGstin: G, docType: 'invoice', documentNumber: 'RO/0012', decision: 'same-bill', purchaseId: 'p4', ...d })

  it('"Same bill" pairs it, and the claim follows the purchase’s number', () => {
    const r = sortTwoB(lines, purchases, [say({})])
    expect(r.matched.map((p) => [p.line.invoiceNumber, p.purchase.id, p.via])).toEqual([['RO/0012', 'p4', 'confirmed']])
    expect(r.claimNumber.get('L-RO/0012')).toBe('RO-12')
    expect(r.sameBill).toEqual([])
  })

  it('"Different bills" stops the offer; the bill is then not in your books and the purchase waits', () => {
    const r = sortTwoB(lines, purchases, [say({ decision: 'different-bills' })])
    expect(r.sameBill).toEqual([])
    expect(r.notInBooks.map((l) => l.invoiceNumber)).toEqual(['RO/0012', 'X-9'])
    expect(ids(r.waiting)).toEqual(['p4'])
  })

  it('"Not mine" moves the bill out of the lists', () => {
    const r = sortTwoB(lines, purchases, [say({ supplierGstin: H, documentNumber: 'X-9', decision: 'not-mine', purchaseId: '' })])
    expect(r.notMine.map((l) => l.invoiceNumber)).toEqual(['X-9'])
    expect(r.notInBooks).toEqual([])
  })

  it('an answer about a purchase since deleted is ignored, never fatal', () => {
    const r = sortTwoB(lines, [], [say({})])
    expect(r.matched).toEqual([])
    expect(r.notInBooks.map((l) => l.invoiceNumber)).toEqual(['RO/0012', 'X-9'])
  })
})

describe('9a-4: suppliers’ notes', () => {
  const cn = (no: string, total = 590, over: Partial<MatchLine> = {}) => line(no, { docType: 'credit-note', totalAmount: total, taxableValue: 500, cgst: 45, sgst: 45, ...over })
  const ret = (id: string, no: string, total = 590): MatchPurchase => buy(id, no, { totalAmount: total })

  it('a supplier’s DEBIT note is a bill (IMS "Inv/DN"): matched to the purchase entered under its number', () => {
    const r = sortTwoB([line('DN-7', { docType: 'debit-note' })], [buy('p1', 'DN-7')], [])
    expect(r.matched.map((p) => [p.line.invoiceNumber, p.purchase.id])).toEqual([['DN-7', 'p1']])
    expect(r.notes).toEqual([])
  })

  it('a credit note with no return entry is "to record"', () => {
    const r = sortTwoB([cn('CN-14')], [], [], [])
    expect(r.notesToRecord.map((l) => l.invoiceNumber)).toEqual(['CN-14'])
  })

  it('the same supplier’s return for the same amount is OFFERED, never assumed', () => {
    const r = sortTwoB([cn('CN-14')], [], [], [ret('d1', 'DN-0003'), ret('d2', 'DN-0004', 600)])
    expect(r.notesOffered.map((x) => [x.line.invoiceNumber, ids(x.candidates)])).toEqual([['CN-14', ['d1']]])
    expect(r.notesRecorded).toEqual([])
  })

  it('another supplier’s return of the same amount is not offered', () => {
    const r = sortTwoB([cn('CN-14')], [], [], [buy('d1', 'DN-0003', { gstin: H, totalAmount: 590 })])
    expect(r.notesToRecord.map((l) => l.invoiceNumber)).toEqual(['CN-14'])
  })

  it('the shop’s answer records it; "No" stops the offer', () => {
    const yes = sortTwoB([cn('CN-14')], [], [{ supplierGstin: G, docType: 'credit-note', documentNumber: 'CN-14', decision: 'same-bill', purchaseId: 'd1' }], [ret('d1', 'DN-0003')])
    expect(yes.notesRecorded.map((p) => [p.line.invoiceNumber, p.purchase.invoiceNo])).toEqual([['CN-14', 'DN-0003']])
    const no = sortTwoB([cn('CN-14')], [], [{ supplierGstin: G, docType: 'credit-note', documentNumber: 'CN-14', decision: 'different-bills', purchaseId: 'd1' }], [ret('d1', 'DN-0003')])
    expect(no.notesToRecord.map((l) => l.invoiceNumber)).toEqual(['CN-14'])
  })

  it('an answer about a bill is not read as an answer about a note with the same number', () => {
    const r = sortTwoB([cn('X-1')], [], [{ supplierGstin: G, docType: 'invoice', documentNumber: 'X-1', decision: 'same-bill', purchaseId: 'd1' }], [ret('d1', 'DN-0003')])
    expect(r.notesRecorded).toEqual([])
  })
})

describe('each purchase is used once', () => {
  it('two 2B lines cannot both claim one purchase', () => {
    const r = sortTwoB([line('A-1'), line('A-1', { id: 'L-dup' })], [buy('p1', 'A-1')], [])
    expect(r.matched.length).toBe(1)
    expect(r.notInBooks.length).toBe(1)
  })
})
