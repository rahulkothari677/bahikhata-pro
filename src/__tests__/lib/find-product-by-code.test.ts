/**
 * Behaviour of the one scanned-code matcher.
 *
 * The sibling guard (scanned-codes-resolve-one-way) stops the rule from being
 * copied. This pins what the rule actually is, so that "change it in one place"
 * means something.
 */
import { findProductByScannedCode, matchesProductSearch } from '@/lib/find-product-by-code'

const products = [
  { id: 'a', name: 'Aashirvaad Atta 5kg', sku: 'ATA001', barcode: '8901030865278' },
  { id: 'b', name: 'Tata Salt 1kg', sku: 'SLT001', barcode: '8901058000313' },
  { id: 'c', name: 'Loose Rice', sku: null, barcode: null },
]

describe('findProductByScannedCode', () => {
  it('matches a barcode', () => {
    expect(findProductByScannedCode(products, '8901030865278')?.id).toBe('a')
  })

  it('matches an SKU — the shop\'s own code still works', () => {
    expect(findProductByScannedCode(products, 'ATA001')?.id).toBe('a')
  })

  it('matches an exact name, for scanners that read a QR with text in it', () => {
    expect(findProductByScannedCode(products, 'Tata Salt 1kg')?.id).toBe('b')
  })

  it('ignores case and stray whitespace from the decoder', () => {
    expect(findProductByScannedCode(products, '  ata001 ')?.id).toBe('a')
    expect(findProductByScannedCode(products, 'tata salt 1kg')?.id).toBe('b')
  })

  it('returns null for an unknown code rather than guessing', () => {
    expect(findProductByScannedCode(products, '0000000000000')).toBeNull()
  })

  it('returns null for an empty code, and does not match the product with no codes', () => {
    // Product 'c' has null sku and null barcode. A naive `p.sku === code`
    // with an empty string would not hit it, but a loose truthiness check
    // could — and selecting "Loose Rice" because the scanner returned nothing
    // is worse than selecting nothing at all.
    expect(findProductByScannedCode(products, '')).toBeNull()
    expect(findProductByScannedCode(products, '   ')).toBeNull()
  })

  it('prefers a barcode hit over an SKU hit when a code is both', () => {
    // Real case: shopkeepers typed EANs into SKU before there was a barcode
    // field. After they scan the real product in, the same digits exist twice.
    // The barcode is the more specific claim, so it wins.
    const overlapping = [
      { id: 'old', name: 'Atta (typed in)', sku: '8901030865278', barcode: null },
      { id: 'new', name: 'Atta (scanned in)', sku: 'ATA002', barcode: '8901030865278' },
    ]
    expect(findProductByScannedCode(overlapping, '8901030865278')?.id).toBe('new')
  })
})

describe('matchesProductSearch', () => {
  const atta = products[0]

  it('finds a product by its barcode when the shopkeeper types it', () => {
    // The case seen on production: a scanner that will not read a crushed
    // packet, so the digits get typed instead. This returned "no products
    // match" for a product whose own barcode was in the box.
    expect(matchesProductSearch(atta, '8901030865278')).toBe(true)
  })

  it('finds by a partial barcode, since long codes get typed a few digits at a time', () => {
    expect(matchesProductSearch(atta, '890103')).toBe(true)
  })

  it('still finds by name, sku and hsn', () => {
    expect(matchesProductSearch({ ...atta, hsn: '1101' }, 'aashirvaad')).toBe(true)
    expect(matchesProductSearch(atta, 'ata0')).toBe(true)
    expect(matchesProductSearch({ ...atta, hsn: '1101' }, '1101')).toBe(true)
  })

  it('does not match an unrelated query', () => {
    expect(matchesProductSearch(atta, 'colgate')).toBe(false)
  })

  it('treats an empty query as "show everything", not "show nothing"', () => {
    expect(matchesProductSearch(atta, '')).toBe(true)
    expect(matchesProductSearch(atta, '   ')).toBe(true)
  })

  it('does not crash on a product with no codes at all', () => {
    expect(matchesProductSearch(products[2], '8901030865278')).toBe(false)
  })
})
