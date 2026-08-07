/**
 * One definition of "which product is this scanned code?".
 *
 * WHY THIS IS SHARED (2026-08-07). There were three copies and three different
 * answers:
 *
 *   ProductPicker      sku || barcode
 *   Inventory          sku || barcode || name
 *   TransactionEntry   sku || name              ← no barcode at all
 *
 * The last one is the billing screen — the place a shopkeeper actually scans,
 * dozens of times a day — and it was the one that never looked at the barcode.
 * The other two did look, at a column that did not exist on the model until
 * today, so all three matched nothing and each failed for a different reason.
 *
 * Three call sites drifting is not a coincidence; it is what copies do. One
 * function means the next screen that scans inherits the right answer instead
 * of a plausible one.
 */

export interface ScannableProduct {
  id: string
  name?: string | null
  sku?: string | null
  barcode?: string | null
}

/**
 * Find the product a scanned code refers to, or null.
 *
 * Order is deliberate — most specific identifier first:
 *
 *  1. `barcode`  — the manufacturer's code. This is what was actually scanned,
 *     so an exact hit here is the answer and nothing else should override it.
 *  2. `sku`      — the shop's own code. Shopkeepers who had no barcode field
 *     have been typing EANs into SKU for years, so this keeps their data
 *     working without a migration of their habits.
 *  3. `name`     — last, and only exact. A scanner occasionally reads a QR code
 *     containing a product name, but matching loosely here would let a stray
 *     code select the wrong product, and picking the wrong item during billing
 *     is worse than picking none.
 *
 * Comparison is trimmed and case-insensitive: codes arrive with stray
 * whitespace from some decoders, and an SKU typed as "ata001" should still
 * match "ATA001". Barcodes are digits in practice, so case costs nothing there.
 */
export function findProductByScannedCode<T extends ScannableProduct>(
  products: T[],
  code: string,
): T | null {
  const needle = (code || '').trim().toLowerCase()
  if (!needle) return null

  const eq = (value: string | null | undefined) =>
    !!value && value.trim().toLowerCase() === needle

  return (
    products.find((p) => eq(p.barcode)) ||
    products.find((p) => eq(p.sku)) ||
    products.find((p) => eq(p.name)) ||
    null
  )
}

/**
 * Does this product match what someone typed into a search box?
 *
 * WHY THIS EXISTS (2026-08-07). Scanning and typing are the same task. A
 * scanner misreads a crushed packet, the code is worn off, the phone camera
 * will not focus — so the shopkeeper reads the digits and types them. Verified
 * on production the day barcode shipped: a product with a saved barcode
 * returned "No products match your search" when its own barcode was typed in.
 *
 * The three search filters had drifted exactly like the three scan matchers
 * had, on exactly the same three screens:
 *
 *   ProductPicker      name, sku, hsn
 *   Inventory          name, sku, hsn, category
 *   TransactionEntry   name, sku, ...
 *
 * None knew about barcode, because none of them could have — the column was
 * a day old. Sharing the identifier set means the next column added to Product
 * becomes searchable in one edit rather than three, or in zero, which is what
 * actually happened here.
 *
 * SCOPE: name, sku, barcode, hsn — the identifiers all three screens already
 * agreed on, plus the new one. Category is deliberately NOT here: only
 * Inventory searched it, and folding it in would change what billing search
 * returns (typing "tea" would pull in every product in the Tea category
 * mid-sale). Inventory keeps its category check alongside this call, so no
 * screen's behaviour changes except that barcodes now match.
 */
/**
 * Which product does pressing Enter in a search box mean?
 *
 * WHY (2026-08-07). Most shop barcode scanners are "keyboard wedge" guns: they
 * type the digits into whatever field has focus, then press Enter. The app was
 * listening for neither. A gun would fill the search box and stop, and the
 * shopkeeper had to reach over and tap the product by hand — one extra tap per
 * item, all day, which is the entire reason a shop buys a gun.
 *
 * Two ways to resolve, in order:
 *
 *  1. An exact code match anywhere in the catalogue. This is the gun's case:
 *     it typed a full barcode, and that identifies one product regardless of
 *     what the visible list has been filtered down to.
 *  2. Exactly one product visible. This is the human's case: they typed
 *     "surf", one row is left, Enter takes it.
 *
 * Otherwise NULL, deliberately. If two products are on screen there is no
 * honest way to choose, and quietly adding the wrong item to a bill is far
 * worse than doing nothing — the shopkeeper sees "nothing happened" and looks,
 * whereas a wrong line gets billed to a customer and found weeks later.
 */
export function resolveProductForEnterKey<T extends ScannableProduct>(
  query: string,
  allProducts: T[],
  visibleMatches: T[],
): T | null {
  if (!(query || '').trim()) return null
  return findProductByScannedCode(allProducts, query) ||
    (visibleMatches.length === 1 ? visibleMatches[0] : null)
}

export function matchesProductSearch<T extends ScannableProduct & { hsn?: string | null }>(
  product: T,
  query: string,
): boolean {
  const q = (query || '').trim().toLowerCase()
  if (!q) return true

  const has = (value: string | null | undefined) =>
    !!value && value.toLowerCase().includes(q)

  return has(product.name) || has(product.sku) || has(product.barcode) || has(product.hsn)
}
