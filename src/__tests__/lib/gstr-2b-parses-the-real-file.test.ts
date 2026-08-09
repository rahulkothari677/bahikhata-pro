/**
 * The 2B importer must read the file the portal actually gives you.
 *
 * WHY (2026-08-09, found by uploading one). The parser was written against a
 * flat shape — `{ gstin, rtnprd, b2b: [...] }` — that the GST portal does not
 * produce. Two failures followed, and the second is the dangerous one:
 *
 *   1. A REAL FILE WAS REJECTED with "does not contain a GSTIN" — the very file
 *      the error tells you to download. Only hand-flattened files imported.
 *   2. A FILE THAT DID IMPORT READ ₹0. The money in a 2B sits on the ITEMS
 *      (`itms[].itm_det.txval`), not on the invoice, which carries only `val`.
 *      So an import could report "1 invoice found, taxable ₹0" and call itself
 *      a success. Under Rule 36(4) this app limits input credit to what 2B
 *      contains — so a silent zero tells the shopkeeper they may claim nothing
 *      and they pay tax they never owed.
 *
 * These pin the parsing shape. The route is thin around it; what matters is
 * that both nestings resolve and the amounts come off the items.
 */

/** The extraction the route performs, kept in step with it. */
function extract(data: any) {
  const root = data?.data && typeof data.data === 'object' ? data.data : data
  const docdata = root?.docdata && typeof root.docdata === 'object' ? root.docdata : root
  const out: Array<{ inum: string; taxable: number; cgst: number; sgst: number; igst: number }> = []
  for (const entry of docdata.b2b || []) {
    for (const inv of entry.inv || []) {
      const items = Array.isArray(inv.itms) ? inv.itms : []
      const sum = (f: string) =>
        items.reduce((s: number, it: any) => s + (Number(it?.itm_det?.[f]) || 0), 0)
      out.push({
        inum: inv.inum,
        taxable: items.length ? sum('txval') : Number(inv.txval) || 0,
        cgst: items.length ? sum('camt') : Number(inv.camt) || 0,
        sgst: items.length ? sum('samt') : Number(inv.samt) || 0,
        igst: items.length ? sum('iamt') : Number(inv.iamt) || 0,
      })
    }
  }
  return { gstin: root.gstin, period: root.rtnprd || root.fp, invoices: out }
}

const ONE_INVOICE = {
  inum: 'SUP-11', idt: '05-08-2026', val: 11800, pos: '27', rchrg: 'N',
  itms: [{ num: 1, itm_det: { rt: 18, txval: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0 } }],
}

describe('the shape the GST portal actually produces', () => {
  it('reads a genuine GSTR-2B download', () => {
    const portalFile = {
      chksum: 'abc',
      data: { gstin: '27ABCDE1234F1Z5', rtnprd: '082026', docdata: { b2b: [{ ctin: '29BBBBB1111B1Z2', inv: [ONE_INVOICE] }] } },
    }
    const r = extract(portalFile)
    expect(r.gstin).toBe('27ABCDE1234F1Z5')
    expect(r.period).toBe('082026')
    expect(r.invoices).toHaveLength(1)
    expect(r.invoices[0].taxable).toBe(10000)
  })

  it('still reads the flattened shape', () => {
    const flat = { gstin: '27ABCDE1234F1Z5', rtnprd: '082026', b2b: [{ ctin: '29BBBBB1111B1Z2', inv: [ONE_INVOICE] }] }
    expect(extract(flat).invoices[0].taxable).toBe(10000)
  })
})

describe('the money comes off the items', () => {
  it('does not read zero from an invoice that only carries val', () => {
    // This was the bug: `val` is the gross invoice value, not the taxable value.
    const r = extract({ gstin: 'G', rtnprd: '082026', b2b: [{ ctin: 'C', inv: [ONE_INVOICE] }] })
    expect(r.invoices[0].taxable).toBe(10000)
    expect(r.invoices[0].cgst).toBe(900)
    expect(r.invoices[0].sgst).toBe(900)
    expect(r.invoices[0].taxable).not.toBe(0)
  })

  it('adds up every rate line on one invoice', () => {
    const mixed = {
      inum: 'SUP-12', val: 12600,
      itms: [
        { num: 1, itm_det: { rt: 18, txval: 10000, iamt: 0, camt: 900, samt: 900 } },
        { num: 2, itm_det: { rt: 5, txval: 1000, iamt: 0, camt: 25, samt: 25 } },
      ],
    }
    const r = extract({ gstin: 'G', b2b: [{ ctin: 'C', inv: [mixed] }] })
    expect(r.invoices[0].taxable).toBe(11000)
    expect(r.invoices[0].cgst).toBe(925)
  })

  it('falls back to invoice-level amounts when there are no items', () => {
    const noItems = { inum: 'SUP-13', txval: 500, camt: 45, samt: 45, iamt: 0 }
    const r = extract({ gstin: 'G', b2b: [{ ctin: 'C', inv: [noItems] }] })
    expect(r.invoices[0].taxable).toBe(500)
    expect(r.invoices[0].cgst).toBe(45)
  })
})
