/**
 * A scanned code is resolved to a product in exactly one place.
 *
 * WHY (2026-08-07). Four screens mount the barcode scanner. Three of them
 * turned the scanned code into a product, and all three did it by hand:
 *
 *   ProductPicker      p.sku === code || p.barcode === code
 *   Inventory          p.sku === code || p.barcode === code || name match
 *   TransactionEntry   p.sku === code || name match          ← no barcode
 *
 * The billing screen — the one a shopkeeper actually scans at, dozens of times
 * a day — was the one that never looked at the barcode. Nobody decided that.
 * It is what three copies do when each is edited on a different day.
 *
 * The other two looked at `Product.barcode`, which did not exist on the model
 * until today. TypeScript did not object because one of them read the array as
 * `any[]` and the other's type came from an API response shape, not the schema.
 * So all three matched nothing, and each was broken for a different reason —
 * which is why fixing one would not have revealed the others.
 *
 * WHAT THIS BANS: resolving a scanned code to a product anywhere except
 * src/lib/find-product-by-code.ts. Not "call the helper" as a style rule — the
 * point is that when the matching rule changes (a shop wants case-insensitive
 * SKUs, or aliases, or a check-digit), it changes once and every scanner on
 * every screen changes with it. A second copy is a future disagreement that
 * has not happened yet.
 *
 * This does not check that each screen scans WELL — whether it adds the item,
 * focuses quantity, or beeps. It checks that they all agree on which product
 * was scanned, which is the part that silently diverged.
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

/**
 * Files allowed to name these fields next to `===`.
 *
 * Compared with forward slashes throughout: path.relative gives backslashes on
 * Windows and forward slashes on CI, so a raw comparison would pass locally and
 * quietly skip nothing (or everything) on Linux. Normalising also makes the
 * failure messages copy-pasteable into an editor on either platform.
 */
const ALLOWED = new Set<string>([
  // The one file that knows the matching rule.
  'src/lib/find-product-by-code.ts',
  // Its behaviour test, which must name the fields to assert on them.
  'src/__tests__/lib/find-product-by-code.test.ts',
  // This guard: its own explanation quotes the three old lines verbatim, and
  // the whole point of quoting them is that the next person can see what the
  // divergence looked like.
  'src/__tests__/lib/scanned-codes-resolve-one-way.test.ts',
])

const slash = (p: string) => p.split(path.sep).join('/')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      sourceFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Hand-rolled matching of a scanned code against a product identifier.
 *
 * Matches `p.sku === code`, `p.barcode === scanned`, `x.sku?.toLowerCase() ===
 * code.toLowerCase()` and the like. Deliberately anchored on the IDENTIFIER
 * FIELD (`sku` / `barcode`), not on the word "code" — a copy that renamed its
 * parameter to `value` or `scanned` is the same bug, and the whole reason this
 * guard exists is that copies drift in exactly such small ways.
 *
 * Narrow on purpose: `.sku ===` in a query filter or a sort comparator is not
 * this bug, and a guard that fires on those gets deleted, which is how the bug
 * it guards comes back.
 */
const HAND_ROLLED = /\.(sku|barcode)\b[^\n=]{0,40}===/g

/**
 * Hand-rolled SEARCHING of a typed query against a product identifier.
 *
 * Scanning and typing are the same task with different input hardware, and
 * they drifted the same way on the same three screens. On the day barcode
 * shipped, a product with a saved barcode returned "No products match your
 * search" when its own barcode was typed into Inventory — because all three
 * search filters listed their fields by hand and none had been told about the
 * new column.
 *
 * Matches `p.sku?.toLowerCase().includes(q)` and friends. `.name` is not
 * listed: plenty of legitimate code lowercases a name for reasons that have
 * nothing to do with product search, and a guard that fires on those gets
 * switched off.
 */
const HAND_ROLLED_SEARCH = /\.(sku|barcode|hsn)\b[^\n]{0,40}\.includes\(/g

const files = sourceFiles(SRC)

describe('the scan is not vacuous', () => {
  it('found source files to check', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('found the shared matcher it is protecting', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/lib/find-product-by-code.ts'))).toBe(true)
  })

  it('found screens that mount a scanner, so there is something to keep in step', () => {
    const mounts = files.filter((f) => /<BarcodeScanner/.test(fs.readFileSync(f, 'utf8')))
    // Four today: ProductPicker, Inventory, ProductDialog, TransactionEntry.
    expect(mounts.length).toBeGreaterThan(2)
  })
})

describe('only one place decides which product a scanned code means', () => {
  it('no screen matches a code against sku or barcode by hand', () => {
    const offenders: string[] = []

    for (const file of files) {
      const rel = slash(path.relative(process.cwd(), file))
      if (ALLOWED.has(rel)) continue

      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(HAND_ROLLED)) {
        const line = src.slice(0, m.index).split('\n').length
        offenders.push(
          `${rel}:${line} — ${m[0].trim()}\n` +
            '    This screen decides for itself which product a scanned code means. ' +
            'That is how the billing screen ended up ignoring barcodes while two other ' +
            'screens honoured them. Use findProductByScannedCode() from ' +
            '@/lib/find-product-by-code so every scanner agrees, and change the rule there.',
        )
      }
    }

    expect(offenders).toEqual([])
  })

  it('no screen searches products by listing identifier fields by hand', () => {
    const offenders: string[] = []

    for (const file of files) {
      const rel = slash(path.relative(process.cwd(), file))
      if (ALLOWED.has(rel)) continue

      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(HAND_ROLLED_SEARCH)) {
        const line = src.slice(0, m.index).split('\n').length
        offenders.push(
          `${rel}:${line} — ${m[0].trim()}\n` +
            '    This screen lists the searchable fields itself, so the next identifier ' +
            'added to Product will be searchable here and nowhere else — which is exactly ' +
            'how a saved barcode became untypeable on all three screens at once. Use ' +
            'matchesProductSearch() from @/lib/find-product-by-code.',
        )
      }
    }

    expect(offenders).toEqual([])
  })
})
