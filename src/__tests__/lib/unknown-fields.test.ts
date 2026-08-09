/**
 * A field we do not understand must be an error, not a shrug.
 *
 * THE BUG. `POST /api/products { name: 'Rice', stock: 100 }` returned 200 and
 * created the product with ZERO stock. The field is `openingStock`; zod drops
 * unknown keys by default, so `stock` vanished without a word.
 *
 * A silent success is the worst shape a mistake can take. The shopkeeper finds
 * out when the till says there is nothing to sell, and whoever wrote the
 * integration has no reason to suspect the line that caused it — the API said
 * it worked.
 *
 * THE RISK IN FIXING IT is the opposite failure: rejecting traffic the app
 * itself sends. Our own clients post `confirmOversell`, `isInterState` and
 * `updatedAt`, none of which are schema fields. Turning on strictness blindly
 * would trade a silent bug for a loud outage, so the last block below feeds
 * the REAL payloads through and asserts they still pass.
 */

import { findUnknownFields, didYouMean, schemaFields } from '@/lib/unknown-fields'
import {
  createProductSchema,
  updateProductSchema,
  createTransactionSchema,
  createPartySchema,
  createPaymentSchema,
} from '@/lib/validation'

describe('findUnknownFields', () => {
  const known = ['name', 'openingStock', 'salePrice', 'gstRate']

  test('a clean body reports nothing', () => {
    expect(findUnknownFields({ name: 'Rice', salePrice: 50 }, known)).toBeNull()
  })

  test('THE BUG: "stock" is caught and named', () => {
    const r = findUnknownFields({ name: 'Rice', stock: 100 }, known)
    expect(r).not.toBeNull()
    expect(r!.unknown).toEqual(['stock'])
  })

  test('and it says which field they actually meant', () => {
    // Being told "stock is unknown" saves five minutes. Being told the field is
    // called openingStock saves the twenty spent reading source.
    const r = findUnknownFields({ stock: 100 }, known)
    expect(r!.suggestions.stock).toBe('openingStock')
    expect(r!.message).toContain('did you mean "openingStock"')
  })

  test('it explains why this used to appear to work', () => {
    // Anyone hitting this got a 200 yesterday. Without saying so, the 400 looks
    // like a regression in our API rather than a bug in their payload.
    const r = findUnknownFields({ stock: 100 }, known)
    expect(r!.message).toMatch(/ignored in silence/)
  })

  test('several unknown fields are all reported, not just the first', () => {
    const r = findUnknownFields({ stock: 1, prise: 2, colour: 'red' }, known)
    expect(r!.unknown.sort()).toEqual(['colour', 'prise', 'stock'])
  })

  test('allowed extras are not errors', () => {
    // The route reads these off the body directly; they are not schema fields
    // but they are legitimate.
    expect(findUnknownFields({ name: 'Rice', confirmOversell: true }, known, ['confirmOversell'])).toBeNull()
  })

  test('a non-object body is not our business', () => {
    expect(findUnknownFields(null, known)).toBeNull()
    expect(findUnknownFields('nonsense', known)).toBeNull()
    expect(findUnknownFields([1, 2], known)).toBeNull()
  })
})

describe('didYouMean', () => {
  const known = ['openingStock', 'salePrice', 'purchasePrice', 'gstRate', 'hsn', 'lowStockThreshold']

  test('catches a contained name — the real-world case', () => {
    // "stock" is 7 edits from "openingStock" but obviously means it.
    expect(didYouMean('stock', known)).toBe('openingStock')
  })

  test('prefers the SHORTEST containing match', () => {
    // "stock" appears in both openingStock and lowStockThreshold. The shorter
    // is the likelier intent, and guessing the alarm threshold would be worse
    // than not guessing at all.
    expect(didYouMean('stock', known)).toBe('openingStock')
  })

  test('catches a near-miss spelling', () => {
    expect(didYouMean('gstRat', known)).toBe('gstRate')
    expect(didYouMean('salePrise', known)).toBe('salePrice')
  })

  test('stays silent when nothing is close', () => {
    // A wrong guess is worse than none: it sends someone to the wrong field.
    expect(didYouMean('colour', known)).toBeNull()
    expect(didYouMean('warrantyMonths', known)).toBeNull()
  })

  test('a short name does not match everything', () => {
    // With a fixed edit-distance threshold, "id" would suggest "hsn". The
    // threshold scales with length so it does not.
    expect(didYouMean('id', known)).toBeNull()
  })
})

describe('schemaFields reads the real schemas', () => {
  test('it returns actual declared fields, not an empty list', () => {
    // A silent empty list would make findUnknownFields flag EVERY field, so
    // this must fail loudly if the zod internals ever change shape.
    expect(schemaFields(createProductSchema)).toEqual(expect.arrayContaining(['name', 'openingStock', 'gstRate']))
    expect(schemaFields(createTransactionSchema)).toEqual(expect.arrayContaining(['type', 'items', 'paymentMode']))
  })

  test('openingStock is declared and stock is NOT — the bug, at the source', () => {
    const fields = schemaFields(createProductSchema)
    expect(fields).toContain('openingStock')
    expect(fields).not.toContain('stock')
  })
})

/**
 * THE HALF THAT PROTECTS THE APP FROM ME.
 *
 * These are the bodies the app's own screens actually post. If a future
 * allowlist edit is too tight, this is what fails — before a shopkeeper
 * discovers that saving a bill now returns 400.
 */
describe('the real payloads our own clients send still pass', () => {
  test('ProductDialog creating a product', () => {
    const body = {
      name: 'Cotton Fabric 1m', sku: null, barcode: null, hsn: '5208',
      category: 'Fabric', unit: 'mtr', purchasePrice: 180, salePrice: 250,
      mrp: null, gstRate: 5, openingStock: 100, lowStockThreshold: 5,
      notes: null, priceIncludesGst: false, gstTreatment: 'taxable',
      tracksInventory: true,
    }
    expect(findUnknownFields(body, schemaFields(createProductSchema))).toBeNull()
  })

  test('ProductDialog editing one, with the concurrent-edit token', () => {
    const body = { name: 'Cotton Fabric 1m', salePrice: 260, updatedAt: '2026-08-09T12:00:00.000Z' }
    expect(findUnknownFields(body, schemaFields(updateProductSchema), ['id', 'updatedAt'])).toBeNull()
  })

  test('TransactionEntry saving a sale, oversell confirmed', () => {
    const body = {
      type: 'sale', partyId: null, date: '2026-08-09T14:00:00.000Z',
      items: [{ productId: 'p1', productName: 'Rice', quantity: 2, unitPrice: 50, gstRate: 5, unit: 'kg' }],
      discountAmount: 0, paymentMode: 'cash', notes: null, invoiceNo: null,
      paidAmount: 105, affectsStock: false,
      isInterState: false, confirmOversell: true,
    }
    expect(findUnknownFields(body, schemaFields(createTransactionSchema), ['isInterState', 'confirmOversell'])).toBeNull()
  })

  test('TransactionEntry saving a credit note', () => {
    const body = {
      type: 'credit-note', partyId: 'party1', date: '2026-08-09T14:00:00.000Z',
      items: [{ productId: 'p1', productName: 'Rice', quantity: 1, unitPrice: 50, gstRate: 5, unit: 'kg' }],
      paymentMode: 'cash', originalTransactionId: 'tx1', noteType: 'C',
      noteReason: 'return', affectsStock: true,
    }
    expect(findUnknownFields(body, schemaFields(createTransactionSchema), ['isInterState', 'confirmOversell'])).toBeNull()
  })

  test('adding a party', () => {
    const body = { name: 'Anil Kumar', type: 'customer', phone: '9811111111', openingBalance: 0 }
    expect(findUnknownFields(body, schemaFields(createPartySchema))).toBeNull()
  })

  test('the Settle dialog recording a payment', () => {
    const body = {
      partyId: 'party1', amount: 500, type: 'received', mode: 'cash',
      date: '2026-08-09T14:59:00.000Z', notes: null,
      allocations: [{ transactionId: 'tx1', amount: 500 }],
    }
    expect(findUnknownFields(body, schemaFields(createPaymentSchema), ['clientMutationId'])).toBeNull()
  })
})
