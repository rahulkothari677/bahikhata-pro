/**
 * Correcting an invoice that has already been filed.
 *
 * WHY (2026-08-09). Once GSTR-1 is filed, an invoice in it cannot be edited —
 * it is corrected by declaring an amendment in a later return, carrying the
 * ORIGINAL number and date so the portal can find what is being replaced. The
 * app had none of this: editing an old bill silently changed what the next
 * return said, and nothing recorded that a correction had happened.
 *
 * It matters most to the BUYER. Their input credit comes from the seller's
 * filed invoice, so a correction that never reaches the portal leaves them
 * unable to claim — and they cannot fix it from their side.
 */
import { buildAmendments, filedInvoicesFrom, type FiledInvoice, type CurrentInvoice } from '@/lib/gstr1-amendments'

const FILED: FiledInvoice = {
  section: 'b2b', ctin: '27BBBPB1234B1Z5', inum: 'INV-100',
  idt: '05-07-2026', val: 11800, pos: '27', fp: '072026',
}

const now = (over: Partial<CurrentInvoice> = {}): CurrentInvoice => ({
  inum: 'INV-100', idt: '05-07-2026', val: 11800, pos: '27',
  ctin: '27BBBPB1234B1Z5', exists: true, ...over,
})

const map = (c: CurrentInvoice) => new Map([[c.inum, c]])

describe('nothing changed', () => {
  it('declares no amendment when the invoice still matches', () => {
    const r = buildAmendments([FILED], map(now()))
    expect(r.b2ba).toHaveLength(0)
    expect(r.b2cla).toHaveLength(0)
  })

  it('ignores sub-rupee drift', () => {
    // Returns are filed in whole rupees; 40 paise cannot be declared.
    const r = buildAmendments([FILED], map(now({ val: 11800.4 })))
    expect(r.b2ba).toHaveLength(0)
  })
})

describe('something changed', () => {
  it('carries the ORIGINAL number and date, which is what the portal matches on', () => {
    const r = buildAmendments([FILED], map(now({ val: 12000 })))
    const amended = r.b2ba[0].inv[0]
    expect(amended.oinum).toBe('INV-100')
    expect(amended.oidt).toBe('05-07-2026')
    expect(amended.val).toBe(12000)
  })

  it('says what changed, in words', () => {
    const r = buildAmendments([FILED], map(now({ val: 12000 })))
    expect(r.b2ba[0].inv[0].changes[0]).toMatch(/Value changed from ₹11800 to ₹12000/)
  })

  it('catches a changed date', () => {
    const r = buildAmendments([FILED], map(now({ idt: '06-07-2026' })))
    expect(r.b2ba[0].inv[0].changes[0]).toMatch(/Date changed/)
  })

  it('catches a changed customer GSTIN — the credit went to the wrong buyer', () => {
    const r = buildAmendments([FILED], map(now({ ctin: '29CCCPC1234C1Z5' })))
    expect(r.b2ba[0].inv[0].changes[0]).toMatch(/GSTIN changed/)
  })

  it('files the amendment under the GSTIN it was ORIGINALLY declared against', () => {
    /*
     * Not the corrected one. The portal must locate the original entry before
     * it can replace it, and it looks under the counterparty it was told about.
     * Grouping under the new GSTIN would leave the wrong buyer's credit intact.
     */
    const r = buildAmendments([FILED], map(now({ ctin: '29CCCPC1234C1Z5' })))
    expect(r.b2ba[0].ctin).toBe('27BBBPB1234B1Z5')
  })
})

describe('an invoice cancelled after filing', () => {
  it('is amended to nil rather than quietly disappearing', () => {
    /*
     * Deleting it from the books does not remove it from a filed return. Left
     * alone, the buyer keeps claiming credit on a bill that no longer exists.
     */
    const r = buildAmendments([FILED], new Map())
    expect(r.b2ba[0].inv[0].val).toBe(0)
    expect(r.b2ba[0].inv[0].oinum).toBe('INV-100')
    expect(r.b2ba[0].inv[0].changes[0]).toMatch(/cancelled after the return was filed/)
  })
})

describe('large inter-state B2C', () => {
  it('groups amendments by place of supply, not by GSTIN', () => {
    const b2cl: FiledInvoice = { section: 'b2cl', inum: 'INV-200', idt: '05-07-2026', val: 300000, pos: '29', fp: '072026' }
    const r = buildAmendments([b2cl], map(now({ inum: 'INV-200', val: 310000, pos: '29' })))
    expect(r.b2cla[0].pos).toBe('29')
    expect(r.b2ba).toHaveLength(0)
  })
})

describe('reading a filed return back', () => {
  it('extracts the invoices a stored return declared', () => {
    const raw = {
      b2b: [{ ctin: '27BBBPB1234B1Z5', inv: [{ inum: 'INV-100', idt: '05-07-2026', val: 11800, pos: '27' }] }],
      b2cl: [{ pos: '29', inv: [{ inum: 'INV-200', idt: '06-07-2026', val: 300000 }] }],
    }
    const out = filedInvoicesFrom(raw, '072026')
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ section: 'b2b', ctin: '27BBBPB1234B1Z5', inum: 'INV-100', val: 11800 })
    expect(out[1]).toMatchObject({ section: 'b2cl', inum: 'INV-200', pos: '29' })
  })

  it('survives a snapshot with no JSON', () => {
    expect(filedInvoicesFrom(null, '072026')).toEqual([])
    expect(filedInvoicesFrom({}, '072026')).toEqual([])
  })
})

describe('credit and debit notes amend into their own tables (9C)', () => {
  const filedNote = (over: Partial<FiledInvoice> = {}): FiledInvoice => ({
    section: 'cdnr', ctin: '27BBBPB1234B1Z5', ntty: 'C',
    inum: 'CN-9', idt: '10-07-2026', val: 2360, pos: '27', fp: '072026', ...over,
  })

  it('sends a registered-buyer note to cdnra, not to an invoice table', () => {
    const r = buildAmendments([filedNote()], map(now({ inum: 'CN-9', val: 3000 })))
    expect(r.cdnra[0].ctin).toBe('27BBBPB1234B1Z5')
    expect(r.cdnra[0].nt[0].oinum).toBe('CN-9')
    expect(r.cdnra[0].nt[0].val).toBe(3000)
    // A note must never leak into the invoice tables.
    expect(r.b2ba).toHaveLength(0)
    expect(r.b2cla).toHaveLength(0)
  })

  it('keeps credit and debit apart — the portal needs to know which way money moved', () => {
    const dr = buildAmendments([filedNote({ ntty: 'D' })], map(now({ inum: 'CN-9', val: 3000 })))
    expect(dr.cdnra[0].nt[0].ntty).toBe('D')
    const cr = buildAmendments([filedNote({ ntty: 'C' })], map(now({ inum: 'CN-9', val: 3000 })))
    expect(cr.cdnra[0].nt[0].ntty).toBe('C')
  })

  it('sends an unregistered-buyer note to cdnura', () => {
    const r = buildAmendments([filedNote({ section: 'cdnur', ctin: undefined })], map(now({ inum: 'CN-9', val: 3000 })))
    expect(r.cdnura).toHaveLength(1)
    expect(r.cdnura[0].oinum).toBe('CN-9')
    expect(r.cdnra).toHaveLength(0)
  })

  it('amends a note cancelled after filing to nil', () => {
    const r = buildAmendments([filedNote()], new Map())
    expect(r.cdnra[0].nt[0].val).toBe(0)
  })

  it('stays silent when a note is unchanged', () => {
    // Date must match the filed one too — otherwise this asserts silence while
    // the date has quietly changed, and would pass for the wrong reason.
    const r = buildAmendments([filedNote()], map(now({ inum: 'CN-9', val: 2360, idt: '10-07-2026' })))
    expect(r.cdnra).toHaveLength(0)
    expect(r.cdnura).toHaveLength(0)
  })

  it('reads notes back out of a filed return', () => {
    const raw = {
      cdnr: [{ ctin: '27BBBPB1234B1Z5', nt: [{ nt_num: 'CN-9', nt_dt: '10-07-2026', val: 2360, ntty: 'C', pos: '27' }] }],
      cdnur: [{ nt_num: 'CN-10', nt_dt: '11-07-2026', val: 500, ntty: 'D', pos: '29' }],
    }
    const out = filedInvoicesFrom(raw, '072026')
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ section: 'cdnr', ntty: 'C', inum: 'CN-9' })
    expect(out[1]).toMatchObject({ section: 'cdnur', ntty: 'D', inum: 'CN-10' })
  })
})
