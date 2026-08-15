/**
 * Phase 5: the shop's own fields are typed, snapshotted, and cannot forge a
 * Rule 46 particular.
 *
 * 📄 docs/INVOICE-ENGINE-PLAN.md Phase 5.
 *
 * THE THREE FAILURES THIS GUARDS:
 *
 *  1. A custom field that impersonates a legal one. A bill carrying two GSTINs
 *     that disagree is worse than one carrying none — it looks authoritative
 *     and is wrong. This is the §0 refusal, and it is the first test here.
 *  2. A rename that rewrites history. Values are snapshotted WITH their label,
 *     so changing "Batch" to "Lot No." in March cannot alter an invoice issued
 *     in February that a customer is still holding.
 *  3. A money custom field joining the paise arithmetic. The extension
 *     intercepts named columns on known models; a number inside a JSON blob is
 *     invisible to it, so a rupee value stored as though it were paise is the
 *     100x bug with a new hiding place.
 *
 * Every rule below is a plain function called with two arguments, rather than
 * a sweep that can only be exercised by committing a real bug — the rule
 * CLAUDE.md's Cause 7 earned after five guards that could not fail.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { readCode } from '@/test-support/read-source'
import {
  reservedLabelError,
  keyFromLabel,
  parseCustomValue,
  snapshotCustomValues,
  formatCustomValue,
  readCustomValues,
  MAX_FIELDS_PER_ENTITY,
  type CustomFieldDef,
} from '@/lib/custom-fields'
import { buildInvoiceDocument, type InvoiceSource, type InvoiceShop } from '@/lib/invoice-document'

const def = (over: Partial<CustomFieldDef> = {}): CustomFieldDef => ({
  id: 'd1', entity: 'item', key: 'batch', label: 'Batch', type: 'text',
  showOnInvoice: true, required: false, order: 0, ...over,
})

describe('§0 — a custom field cannot forge a legal one', () => {
  it.each([
    'GSTIN', 'gstin', 'GST No', 'gst  no', 'HSN', 'Invoice Number',
    'Taxable Value', 'CGST', 'Total', 'Place of Supply', 'IRN',
  ])('refuses %s', label => {
    expect(reservedLabelError(label)).not.toBeNull()
  })

  it('allows the fields a real trade actually needs', () => {
    // Pharma, transport, jewellery — the reason this phase exists.
    for (const ok of ['Batch No.', 'Expiry', 'MRP', 'Vehicle Number', 'PO Number', 'HUID', 'FSSAI']) {
      expect({ label: ok, error: reservedLabelError(ok) }).toEqual({ label: ok, error: null })
    }
  })

  it('refuses an empty name', () => {
    expect(reservedLabelError('   ')).not.toBeNull()
  })

  it('the API enforces it, not just this function', () => {
    // A rule nothing calls is a comment. This is the caller.
    expect(readCode('src/app/api/custom-fields/route.ts')).toContain('reservedLabelError')
  })
})

describe('keys are stable, labels are not', () => {
  it('derives a key from a label', () => {
    expect(keyFromLabel('Batch No.')).toBe('batch_no')
    expect(keyFromLabel('  Expiry   Date ')).toBe('expiry_date')
  })

  it('the PATCH route never rewrites the key', () => {
    /*
     * The key is what issued bills are keyed on. If a rename changed it, every
     * previous invoice would lose the value it stored — which is a data loss
     * caused by a typo correction.
     */
    const route = readCode('src/app/api/custom-fields/route.ts')
    const patch = route.slice(route.indexOf('export async function PATCH'))
    expect(patch).not.toContain('data.key')
    expect(patch).not.toContain('keyFromLabel')
  })
})

describe('values are typed, and refused when they are not', () => {
  it('parses a number, rejecting what is not one', () => {
    expect(parseCustomValue(def({ type: 'number' }), '12')).toEqual({ ok: true, value: 12 })
    expect(parseCustomValue(def({ type: 'number' }), '1,250')).toEqual({ ok: true, value: 1250 })
    expect(parseCustomValue(def({ type: 'number' }), 'abc').ok).toBe(false)
  })

  it('stores a date as YYYY-MM-DD, never a locale string', () => {
    const r = parseCustomValue(def({ type: 'date', label: 'Expiry' }), '2027-03-12')
    expect(r).toEqual({ ok: true, value: '2027-03-12' })
  })

  it('refuses a date it cannot read rather than guessing today', () => {
    // Guessing would put a wrong expiry on a medicine bill.
    expect(parseCustomValue(def({ type: 'date' }), 'sometime').ok).toBe(false)
  })

  it('keeps money as rupees, NOT paise', () => {
    /*
     * The paise extension intercepts named columns on known models. A number
     * inside a JSON blob is invisible to it, so storing 45000 for ₹450 here
     * would be the 100x bug with a new hiding place — and this one would not
     * even be caught by the money tests, because it is not a money column.
     */
    expect(parseCustomValue(def({ type: 'money' }), '450.50')).toEqual({ ok: true, value: 450.5 })
    expect(readCode('src/lib/custom-fields.ts')).not.toContain('toPaise')
  })

  it('enforces required, and allows blank when it is not', () => {
    expect(parseCustomValue(def({ required: true, label: 'Batch' }), '').ok).toBe(false)
    expect(parseCustomValue(def({ required: false }), '')).toEqual({ ok: true, value: null })
  })

  it('caps a pasted paragraph', () => {
    expect(parseCustomValue(def(), 'x'.repeat(201)).ok).toBe(false)
  })
})

describe('a snapshot carries its own label, type and visibility', () => {
  const defs = [
    def({ key: 'batch', label: 'Batch', order: 1 }),
    def({ key: 'expiry', label: 'Expiry', type: 'date', order: 0 }),
  ]

  it('stores what the field was called AT THE TIME', () => {
    const r = snapshotCustomValues(defs, { batch: 'A-118', expiry: '2027-03-12' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Sorted by the definition's order, so the bill reads the same way twice.
    expect(r.values.map(v => v.label)).toEqual(['Expiry', 'Batch'])
    expect(r.values.every(v => typeof v.show === 'boolean')).toBe(true)
  })

  it('renaming the field later does not touch the stored value', () => {
    /*
     * THE POINT OF THE WHOLE DESIGN. A customer is holding a bill that says
     * "Batch". Renaming the field must not change what that bill said.
     */
    const issued = snapshotCustomValues(defs, { batch: 'A-118' })
    expect(issued.ok).toBe(true)
    if (!issued.ok) return

    const renamed = defs.map(d => (d.key === 'batch' ? { ...d, label: 'Lot No.' } : d))
    const later = snapshotCustomValues(renamed, { batch: 'B-220' })
    expect(later.ok).toBe(true)
    if (!later.ok) return

    // The old snapshot is untouched; only the new bill uses the new name.
    expect(issued.values.find(v => v.key === 'batch')?.label).toBe('Batch')
    expect(later.values.find(v => v.key === 'batch')?.label).toBe('Lot No.')
  })

  it('drops blanks rather than storing empty keys forever', () => {
    const r = snapshotCustomValues(defs, { batch: '', expiry: '' })
    expect(r).toEqual({ ok: true, values: [] })
  })

  it('reports the first problem, by name', () => {
    const r = snapshotCustomValues([def({ label: 'Expiry', type: 'date' , key: 'expiry' })], { expiry: 'junk' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('Expiry')
  })
})

describe('reading back is defensive', () => {
  it('survives anything that is not the shape it expects', () => {
    // The column is JSON. A bill that throws while rendering because one
    // custom field is malformed is worse than a bill missing that field.
    expect(readCustomValues(null)).toEqual([])
    expect(readCustomValues('nonsense')).toEqual([])
    expect(readCustomValues([{ key: 'a' }])).toEqual([])
    expect(readCustomValues([{ key: 'a', label: 'A', type: 'wat', value: 1, show: true }])).toEqual([])
  })

  it('keeps the entries it does recognise', () => {
    const good = [{ key: 'batch', label: 'Batch', type: 'text', value: 'A-118', show: true }]
    expect(readCustomValues([...good, { junk: true }])).toEqual(good)
  })
})

describe('formatting', () => {
  it('writes a date the Indian way and money with a rupee sign', () => {
    expect(formatCustomValue({ key: 'e', label: 'Expiry', type: 'date', value: '2027-03-12', show: true }))
      .toMatch(/12 Mar 2027/)
    expect(formatCustomValue({ key: 'm', label: 'MRP', type: 'money', value: 450.5, show: true }))
      .toBe('₹450.50')
  })
})

describe('the columns reach the bill', () => {
  const SHOP: InvoiceShop = { name: 'Sharma Medical', state: 'Bihar' }
  const SRC: InvoiceSource = {
    invoiceNo: 'SM/1', date: '2026-08-15', party: { name: 'Walk-in' },
    items: [{
      productName: 'Crocin 500', quantity: 1, unitPrice: 30, gstRate: 12, total: 33.6,
      customCols: [
        { key: 'batch', label: 'Batch', type: 'text', value: 'A-118', show: true },
        { key: 'expiry', label: 'Expiry', type: 'date', value: '2027-03-12', show: true },
        { key: 'cost', label: 'Our cost', type: 'money', value: 22, show: false },
      ],
    }],
    subtotal: 30, discountAmount: 0, cgst: 1.8, sgst: 1.8, igst: 0,
    totalAmount: 33.6, paidAmount: 33.6, paymentMode: 'cash',
  }

  it('carries only the columns marked to print', () => {
    const doc = buildInvoiceDocument(SRC, SHOP)
    expect(doc.items[0].customCols.map(v => v.label)).toEqual(['Batch', 'Expiry'])
    // "Our cost" is the shop's own margin. It must never reach a customer.
    expect(JSON.stringify(doc.items[0].customCols)).not.toContain('Our cost')
  })

  it('every renderer draws them, or a pharmacy bill is missing its batch', () => {
    for (const file of [
      'src/lib/invoice-pdf.ts',
      'src/lib/invoice-share-image.ts',
      'src/components/settings/InvoicePreview.tsx',
    ]) {
      expect({ file, draws: readCode(file).includes('customCols') })
        .toEqual({ file, draws: true })
    }
  })
})

describe('the schema and the code agree', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

  it('stores values on the record, not in a values table', () => {
    /*
     * BUILD FOR MILLIONS. Drawing one bill is the hot path; a values table
     * would put a join on it for every render, thirty million rows deep, to
     * print a grocery bill.
     */
    expect(schema).toContain('model CustomFieldDef')
    expect(schema).not.toContain('model CustomFieldValue')
    for (const col of ['customFields', 'customCols']) {
      expect({ col, present: schema.includes(col) }).toEqual({ col, present: true })
    }
  })

  it('retires a definition softly, because issued bills still carry it', () => {
    const route = readCode('src/app/api/custom-fields/route.ts')
    const del = route.slice(route.indexOf('export async function DELETE'))
    expect(del).toContain('deletedAt')
    expect(del).not.toContain('deleteMany')
    expect(del).not.toContain('.delete(')
  })

  it('caps how many a shop can define', () => {
    expect(MAX_FIELDS_PER_ENTITY).toBeGreaterThan(4)
    expect(MAX_FIELDS_PER_ENTITY).toBeLessThanOrEqual(20)
    expect(readCode('src/app/api/custom-fields/route.ts')).toContain('MAX_FIELDS_PER_ENTITY')
  })
})
