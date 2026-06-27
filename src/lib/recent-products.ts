'use client'

/**
 * Recently-used products — stored per-user in localStorage.
 * Used to show a "Recent" quick-pick row at the top of the product picker,
 * so shopkeepers can quickly add items they sell frequently.
 *
 * We don't need a server-side table for this — it's a per-device UX nicety.
 * If the user switches devices, the list rebuilds naturally as they make sales.
 */

const KEY = 'bahikhata:recent-products'
const MAX_ITEMS = 8
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

type RecentEntry = {
  productId: string
  productName: string
  usedAt: number // epoch ms
}

type Store = {
  v: 1
  items: RecentEntry[]
}

function read(): Store {
  if (typeof window === 'undefined') return { v: 1, items: [] }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { v: 1, items: [] }
    const s = JSON.parse(raw) as Store
    if (s.v !== 1) return { v: 1, items: [] }
    // Expire old entries
    const now = Date.now()
    s.items = s.items.filter((i) => now - i.usedAt < TTL_MS)
    return s
  } catch {
    return { v: 1, items: [] }
  }
}

function write(store: Store) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // silent
  }
}

/**
 * Add (or bump) a product in the recent list.
 * Called when a transaction is saved with this product.
 */
export function trackRecentProduct(productId: string, productName: string) {
  if (!productId) return
  const store = read()
  // Remove existing entry (if any) so we can re-insert at top
  store.items = store.items.filter((i) => i.productId !== productId)
  // Insert at top
  store.items.unshift({ productId, productName, usedAt: Date.now() })
  // Trim to max
  store.items = store.items.slice(0, MAX_ITEMS)
  write(store)
}

/**
 * Get the list of recent product IDs (most recent first).
 * Pass to your products API client to filter/sort.
 */
export function getRecentProductIds(): string[] {
  return read().items.map((i) => i.productId)
}

/**
 * Get the full recent entries (with names + timestamps).
 */
export function getRecentProducts(): RecentEntry[] {
  return read().items
}

/**
 * Clear the recent products list (e.g., on logout).
 */
export function clearRecentProducts() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(KEY)
  } catch {
    // silent
  }
}
