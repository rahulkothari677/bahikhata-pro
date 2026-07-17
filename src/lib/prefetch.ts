'use client'

/**
 * 🔒 V11 §3.3: Prefetch helper for route chunks + queries.
 *
 * Problem: When the user clicks a nav item (e.g., "Reports"), the browser:
 *   1. Downloads the Reports JS chunk (1-3s on 4G)
 *   2. Mounts the component
 *   3. The component's useQuery fires the API call (1-2s cold DB)
 *   = 3 sequential waits behind a spinner.
 *
 * Solution: On hover (desktop) / touchStart (mobile), prefetch BOTH:
 *   - The JS chunk (by importing the component module early)
 *   - The query data (via React Query's prefetchQuery)
 *
 * When the user finally clicks, the chunk is already downloaded and the
 * data is already cached → the page appears instantly.
 *
 * Usage in a nav button:
 *   onMouseEnter={() => prefetchView('reports')}
 *   onTouchStart={() => prefetchView('reports')}
 */

import { queryClient } from '@/components/providers'

// Map view IDs to their dynamic import functions.
// These MUST match the dynamic(() => import(...)) calls in page.tsx.
// Importing the module early triggers the chunk download.
const VIEW_IMPORTS: Record<string, () => Promise<any>> = {
  reports: () => import('@/components/reports/Reports'),
  settings: () => import('@/components/settings/Settings'),
  inventory: () => import('@/components/inventory/Inventory'),
  parties: () => import('@/components/parties/Parties'),
  pricing: () => import('@/components/subscription/PricingPlans'),
  scanner: () => import('@/components/scanner/BillScanner'),
  // 🔒 AUDIT V25 FIX §2.1 (Batch 2): Added Sidebar Tools views to prefetch map.
  'document-vault': () => import('@/components/documents/DocumentVault'),
  'ai-usage': () => import('@/components/settings/AIUsage'),
  'ai-comparison': () => import('@/components/settings/AIComparison'),
}

// Map view IDs to their query keys + query functions.
// These MUST match the useQuery calls in each component.
// Only prefetch the "first screen" query — components can fetch
// secondary queries after mount.
const VIEW_QUERIES: Record<string, { queryKey: string[]; queryFn: () => Promise<any> }> = {
  inventory: {
    queryKey: ['products'],
    queryFn: async () => {
      const r = await fetch('/api/products')
      return r.json()
    },
  },
  parties: {
    queryKey: ['parties'],
    queryFn: async () => {
      const r = await fetch('/api/parties')
      return r.json()
    },
  },
  // Reports, Settings, Scanner have complex/parameterized queries that
  // depend on user-selected date ranges or other state. Prefetching them
  // without the right parameters would waste a request. Skip these —
  // the chunk prefetch alone still helps.
}

// Track which views have already been prefetched (avoid duplicate work).
const prefetchedViews = new Set<string>()

/**
 * Prefetch a view's JS chunk + (optionally) its query data.
 * Safe to call multiple times — only the first call does the work.
 */
export function prefetchView(viewId: string): void {
  if (prefetchedViews.has(viewId)) return
  prefetchedViews.add(viewId)

  // 1. Prefetch the JS chunk (import the module early).
  const importFn = VIEW_IMPORTS[viewId]
  if (importFn) {
    importFn().catch(() => {
      // If the import fails (e.g., network error), remove from set so
      // a future hover can retry.
      prefetchedViews.delete(viewId)
    })
  }

  // 2. Prefetch the query data (if this view has a simple first-screen query).
  const queryConfig = VIEW_QUERIES[viewId]
  if (queryConfig && queryClient) {
    queryClient.prefetchQuery({
      queryKey: queryConfig.queryKey,
      queryFn: queryConfig.queryFn,
      // Short staleTime so the prefetched data is used immediately when
      // the user clicks, but re-fetches if they navigate away and back.
      staleTime: 30 * 1000, // 30 seconds
    }).catch(() => {
      // Prefetch failures are non-critical — the component will retry
      // when it mounts.
    })
  }
}
