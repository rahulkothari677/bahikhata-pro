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
