/**
 * 🔒 SERVICES MUST BE SELLABLE — and must stay sellable.
 *
 * THE BUG
 * -------
 * Every product was stock-tracked, unconditionally. The default stock policy
 * is 'block'. So a tailor's "Blouse stitching" sat at currentStock = 0, the
 * first sale of it read as overselling, and the shop's first ever invoice was
 * refused: "Not enough stock — record a purchase or enable overselling in
 * Settings". There is no purchase to record for a haircut, and disabling
 * overselling shop-wide surrenders the guard on real goods. Tailors, salons,
 * repair shops, photographers, tutors and consultants could not bill at all.
 *
 * WHY A GUARD AND NOT JUST A FIX
 * ------------------------------
 * Stock is written in FIVE places — create, edit, void, restore, and the
 * estimate→invoice convert — and read in a dozen more. A rule spread that
 * wide drifts; that is precisely how GSTR-1 and GSTR-3B came to classify the
 * same supply two different ways (the ₹25 gap). So there is one predicate in
 * lib/inventory-tracking.ts, and the sweep at the bottom of this file fails
 * the build if a stock write appears in a file that never consults it.
 *
 * Every behavioural test below fails if the corresponding rule is removed.
 */

import fs from 'fs'
import path from 'path'
import {
  tracksStock,
  isService,
  looksLikeService,
  defaultTracksInventory,
  stockAffectingLines,
  tracksStockForReversal,
} from '@/lib/inventory-tracking'

describe('tracksStock — what counts as having stock', () => {
  test('a normal good is tracked', () => {
    expect(tracksStock({ tracksInventory: true })).toBe(true)
  })

  test('a service is NOT tracked — this is the whole fix', () => {
    expect(tracksStock({ tracksInventory: false })).toBe(false)
    expect(isService({ tracksInventory: false })).toBe(true)
  })

  test('a row written before the column existed is tracked', () => {
    // Rows predating the migration have no value. They are goods — a service
    // could not be sold at all before this — so they must keep behaving
    // exactly as they did. If this flips, every historical product silently
    // stops guarding its stock.
    expect(tracksStock({})).toBe(true)
    expect(tracksStock({ tracksInventory: null })).toBe(true)
    expect(tracksStock({ tracksInventory: undefined })).toBe(true)
  })

  test('a partial select that omits the column fails towards TRACKING', () => {
    // The dangerous direction is the quiet one. A forgotten column that reads
    // as "service" lets stock drift with nothing to notice; one that reads as
    // "good" costs at worst a dismissible warning.
    const partiallySelected = { id: 'p1', name: 'Rice' } as { tracksInventory?: boolean }
    expect(tracksStock(partiallySelected)).toBe(true)
  })

  test('no product at all (a free-text line) has nothing to track', () => {
    expect(tracksStock(null)).toBe(false)
    expect(tracksStock(undefined)).toBe(false)
    expect(isService(null)).toBe(false)  // absent is not the same as service
  })
})

describe('looksLikeService — the SAC hint, and its limits', () => {
  test.each([
    ['9954', 'construction'],
    ['9963', 'accommodation and food'],
    ['9971', 'financial'],
    ['998314', 'IT consulting'],
    ['9997', 'other services'],
  ])('%s (%s) reads as a service', (sac) => {
    expect(looksLikeService(sac)).toBe(true)
    expect(defaultTracksInventory(sac)).toBe(false)
  })

  test.each([
    ['1006', 'rice'],
    ['3401', 'soap'],
    ['6109', 't-shirts'],
    ['8471', 'computers'],
  ])('%s (%s) reads as goods', (hsn) => {
    expect(looksLikeService(hsn)).toBe(false)
    expect(defaultTracksInventory(hsn)).toBe(true)
  })

  test('no code means no opinion — goods, the safe default', () => {
    expect(looksLikeService(null)).toBe(false)
    expect(looksLikeService(undefined)).toBe(false)
    expect(looksLikeService('')).toBe(false)
    expect(defaultTracksInventory(null)).toBe(true)
  })

  test('a half-typed "99" is not a claim about anything', () => {
    // Someone mid-keystroke must not have their product silently reclassified.
    expect(looksLikeService('99')).toBe(false)
    expect(looksLikeService('9')).toBe(false)
  })

  test('non-numeric junk never classifies', () => {
    expect(looksLikeService('99AB')).toBe(false)
    expect(looksLikeService('service')).toBe(false)
  })
})

describe('stockAffectingLines — the tailor scenario, end to end', () => {
  const products = new Map<string, { tracksInventory?: boolean }>([
    ['stitching', { tracksInventory: false }],   // a service, no stock, ever
    ['buttons', { tracksInventory: true }],      // real goods, counted
  ])

  test('a service line never reaches the stock guard', () => {
    // THE BUG, stated as a test. A bill for stitching alone produces no
    // stock-affecting line, so there is nothing for the 'block' policy to
    // refuse — which is what lets the tailor's first invoice save at all.
    const bill = [{ productId: 'stitching', quantity: 1 }]
    expect(stockAffectingLines(bill, products)).toHaveLength(0)
  })

  test('a mixed bill still guards the goods on it', () => {
    // The other half of the fix, and the reason this is not just "turn off
    // overselling". A tailor who also sells buttons keeps the button guard.
    const bill = [
      { productId: 'stitching', quantity: 1 },
      { productId: 'buttons', quantity: 12 },
    ]
    const affecting = stockAffectingLines(bill, products)
    expect(affecting).toHaveLength(1)
    expect(affecting[0].productId).toBe('buttons')
  })

  test('a free-text line with no product is skipped', () => {
    expect(stockAffectingLines([{ productId: null }, { productId: undefined }], products)).toHaveLength(0)
  })

  test('APPLYING to an unloadable product is skipped', () => {
    // The map is built from exactly these IDs, scoped to the user. A miss
    // means the product is not ours. Do not move stock we could not read.
    expect(stockAffectingLines([{ productId: 'someone-elses' }], products)).toHaveLength(0)
  })
})

describe('tracksStockForReversal — the unknown case flips direction', () => {
  const products = new Map<string, { tracksInventory?: boolean }>([
    ['stitching', { tracksInventory: false }],
    ['buttons', { tracksInventory: true }],
  ])

  test('a service has nothing to give back', () => {
    expect(tracksStockForReversal('stitching', products)).toBe(false)
  })

  test('goods are reversed', () => {
    expect(tracksStockForReversal('buttons', products)).toBe(true)
  })

  test('an UNLOADABLE product is still reversed — the opposite of applying', () => {
    // This asymmetry is the point of the function existing. Those units were
    // already added or taken at some past moment. Skipping the undo because
    // we could not look the product up leaves stock permanently wrong, with
    // nothing to indicate it. Applying can safely no-op; reversing cannot.
    expect(tracksStockForReversal('deleted-product', products)).toBe(true)
    expect(stockAffectingLines([{ productId: 'deleted-product' }], products)).toHaveLength(0)
  })
})

/**
 * THE SWEEP — the part that survives me.
 *
 * Any file that moves a stock number must consult the predicate. Adding a
 * sixth stock write path without it silently reintroduces the bug for that
 * path only, which is the hardest kind to notice.
 */
describe('every stock write consults the predicate', () => {
  const API_DIR = path.join(process.cwd(), 'src', 'app', 'api')

  function walk(dir: string): string[] {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(full)
      return entry.isFile() && full.endsWith('.ts') ? [full] : []
    })
  }

  /** Writes that CHANGE a stock level. A `where: { currentStock: { gte } }`
   *  clause only reads, so it is not matched here. */
  const STOCK_WRITE = /data:\s*\{[^}]*currentStock|currentStock:\s*\{\s*(?:in|de)crement/

  // Restoring a backup rebuilds stock from the file's own rows rather than
  // from a bill, so there is no product to consult. Listed explicitly so that
  // exempting a file is a visible decision rather than a silent gap.
  const EXEMPT = ['import/restore/route.ts']

  const offenders = walk(API_DIR).filter(file => {
    const rel = path.relative(API_DIR, file).replace(/\\/g, '/')
    if (EXEMPT.some(e => rel.endsWith(e))) return false
    const src = fs.readFileSync(file, 'utf8')
    if (!STOCK_WRITE.test(src)) return false
    return !src.includes('@/lib/inventory-tracking')
  })

  test('no API route writes stock without importing lib/inventory-tracking', () => {
    expect(offenders.map(f => path.relative(process.cwd(), f))).toEqual([])
  })

  /**
   * Importing the module is necessary but not sufficient — a route could
   * import it and consult it in only one of its several stock paths. These
   * pin the specific call site in each, because each is a separate way for a
   * tailor's bill to fail. Source assertions, matching the pattern in
   * transaction-tx-budget.test.ts.
   */
  const routeSrc = (rel: string) =>
    fs.readFileSync(path.join(API_DIR, rel), 'utf8')

  test('POST skips services in BOTH the warning and the write', () => {
    // These two must agree. If the warning skipped and the write did not, the
    // bill would pass the friendly check and then die inside the transaction
    // with a STOCK_BLOCK the shopkeeper cannot act on.
    const src = routeSrc('transactions/route.ts')
    expect(src).toMatch(/if \(!tracksStock\(product\)\) continue/)              // warning loop
    expect(src).toMatch(/if \(!tracksStock\(productMap\.get\(item\.productId\)\)\) continue/) // block-mode write
    expect(src).toMatch(/stockAffectingLines\(txItems, productMap\)/)           // allow-mode write
  })

  test('PUT skips services when reversing AND when re-applying', () => {
    const src = routeSrc('transactions/[id]/route.ts')
    expect(src).toMatch(/tracksStockForReversal\(oldItem\.productId, productMap\)/)
    expect(src).toMatch(/stockAffectingLines\(txItems, productMap\)/)
  })

  test('PUT loads the OLD lines products, not just the incoming ones', () => {
    // The map used to be built from `items` alone, so a line REMOVED by an
    // edit was absent from it — and an absent product cannot be identified as
    // a good, so its stock would not be given back.
    const src = routeSrc('transactions/[id]/route.ts')
    expect(src).toMatch(/oldItems\.map\(i => i\.productId\)/)
  })

  test('DELETE skips services when reversing a void', () => {
    const src = routeSrc('transactions/[id]/route.ts')
    expect(src).toMatch(/tracksStockForReversal\(item\.productId, delProductMap\)/)
  })

  test('restore skips exactly what the void skipped', () => {
    // Asymmetry here would invent stock: the void gave nothing back for a
    // service, so the un-void must not take anything either.
    const src = routeSrc('transactions/[id]/restore/route.ts')
    expect(src).toMatch(/stockAffectingLines\(items, restoreProductMap\)/)
  })

  test('estimate-to-invoice convert skips services in both stock modes', () => {
    const src = routeSrc('transactions/[id]/convert/route.ts')
    const calls = src.match(/stockAffectingLines\(computed\.txItems, productMap\)/g) || []
    expect(calls.length).toBe(2)  // block mode and allow mode
  })

  test('the dashboard counts services as products but not as stock', () => {
    /*
     * I got this wrong on the first pass and browser verification caught it.
     *
     * The filter was put on the WHERE clause, which applies to all three
     * aggregates at once — so a salon with eight services and two goods
     * reported "Total products: 2". A service is a product; it is just not
     * a product with a stock level.
     *
     * The two populations must stay separate: productCount over everything,
     * lowStockCount and stockValue over goods only.
     */
    const src = fs.readFileSync(path.join(API_DIR, 'dashboard', 'route.ts'), 'utf8')
    const totals = src.slice(src.indexOf('AS "productCount"') - 400, src.indexOf('AS "stockValuePaise"') + 200)

    // The stock aggregates carry their own FILTER ...
    expect(totals).toMatch(/FILTER \(\s*WHERE "tracksInventory" = true AND "currentStock" <= "lowStockThreshold"\s*\)/)
    expect(totals).toMatch(/FILTER \(WHERE "tracksInventory" = true\)/)
    // ... and the WHERE clause does NOT, or it would silently re-apply to
    // productCount and put the bug straight back.
    const whereClause = src.slice(src.indexOf('AS "stockValuePaise"'), src.indexOf('AS "stockValuePaise"') + 300)
    expect(whereClause).not.toMatch(/WHERE "userId" = \$\{userId\}\s*\n\s*AND "tracksInventory"/)
  })

  test('the sweep actually looks at the known stock-writing routes', () => {
    // A sweep that silently matches nothing passes forever. This asserts the
    // walk and the pattern still find the five paths the fix touched — if a
    // route is renamed or the write is reshaped, this fails and someone looks.
    const found = walk(API_DIR)
      .filter(f => STOCK_WRITE.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.relative(API_DIR, f).replace(/\\/g, '/'))

    expect(found).toEqual(expect.arrayContaining([
      'transactions/route.ts',
      'transactions/[id]/route.ts',
      'transactions/[id]/convert/route.ts',
      'transactions/[id]/restore/route.ts',
    ]))
  })
})
