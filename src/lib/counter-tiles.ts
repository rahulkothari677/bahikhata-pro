/**
 * The Counter's quick tiles (Phase 6c, final design plan §1 and §5).
 *
 * WHY THIS EXISTS. On New Sale the "Recently used" row re-ordered itself the
 * moment an item was added, so the next tap at the same spot added a
 * DIFFERENT item (#181: Toor Dal went in while atta was being tapped; #146:
 * the list re-laid out under the finger). A counter must never move what is
 * under the thumb.
 *
 * The rule: tiles are the shop's own best sellers (most bills in the last 90
 * days, counted by the database — /api/products/top-sellers), then the items
 * used most recently on this phone, then the rest by name. The ranking the
 * order comes from is FROZEN while a bill is open (freezeWhileBillOpen), so
 * adding, removing or saving an item can never move a tile. A new bill takes
 * a fresh ranking.
 */

export interface TileProduct {
  id: string
  name: string
  category?: string | null
}

/** "Top" — the tiles shown before a category is chosen. */
export const TOP_TILES = '__top__'
/** Tiles shown for Top on any screen; a category shows up to CATEGORY_TILE_LIMIT. */
export const TOP_TILE_LIMIT = 12
export const CATEGORY_TILE_LIMIT = 24
/** #229: after this many bill lines the tiles fold to one row, so a phone shows the bill. */
export const COUNTER_FOLD_AFTER = 6

/**
 * The order of the tiles: ranked items first (in rank order), then recent ones,
 * then every other item by name. Pure and deterministic — the same inputs give
 * the same order, whatever the products array's own order is.
 */
export function counterTiles<P extends TileProduct>(
  products: P[],
  opts: { rankIds: string[]; recentIds: string[]; category: string | null; limit: number },
): P[] {
  const pool = opts.category === null || opts.category === TOP_TILES
    ? products
    : products.filter((p) => (p.category || 'Uncategorized') === opts.category)
  const byId = new Map(pool.map((p) => [p.id, p]))
  const out: P[] = []
  const seen = new Set<string>()
  const take = (id: string) => {
    const p = byId.get(id)
    if (p && !seen.has(id)) { seen.add(id); out.push(p) }
  }
  opts.rankIds.forEach(take)
  opts.recentIds.forEach(take)
  pool
    .filter((p) => !seen.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .forEach((p) => { seen.add(p.id); out.push(p) })
  return out.slice(0, opts.limit)
}

/**
 * Which ranking the tiles use: the live one while no bill is open, the one
 * taken when the bill started while it is. `snapshot` is what the caller kept
 * from last time; the return value is what it should keep now.
 */
export function freezeWhileBillOpen<T>(live: T, snapshot: T | undefined, billOpen: boolean): T {
  return billOpen && snapshot !== undefined ? snapshot : live
}

/** #229: the tiles to show — one row once the bill is long, unless the shopkeeper asked for all. */
export function foldTiles<P>(tiles: P[], lineCount: number, expanded: boolean, perRow: number): { shown: P[]; folded: boolean } {
  if (expanded || lineCount <= COUNTER_FOLD_AFTER || tiles.length <= perRow) return { shown: tiles, folded: false }
  return { shown: tiles.slice(0, perRow), folded: true }
}
