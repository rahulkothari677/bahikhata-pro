'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { SessionProviderWrapper } from '@/components/providers/SessionProviderWrapper'
import { ServiceWorkerRegistration } from '@/components/providers/ServiceWorkerRegistration'
import { CapacitorBridge } from '@/components/providers/CapacitorBridge'
import { OfflineError } from '@/lib/offline-fetch'

// 🔒 V11 §3.3: Export a module-level queryClient singleton so the prefetch
// helper (src/lib/prefetch.ts) can access it without being inside a React
// component. Was: queryClient was created inside the Providers component as
// local state, inaccessible from outside.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 2 min stale time — balances freshness with reduced server load.
      // Most data (products, parties, transactions) doesn't change every second.
      // User-triggered refreshes (manual button, post-mutation invalidate)
      // still fetch immediately. Only background refetches are throttled.
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000, // keep unused data in cache 10 min
      refetchOnWindowFocus: false,
      refetchOnReconnect: true, // refetch when coming back online (after offline mode)
      // Don't retry on OfflineError — it will keep failing until the
      // user comes back online, and the cache (if any) was already
      // returned. Retry once on other errors (transient network blips).
      retry: (failureCount, error) => {
        if (error instanceof OfflineError) return false
        return failureCount < 1
      },
    },
  },
})

export function Providers({ children }: { children: React.ReactNode }) {
  // 🔒 V11 §3.3: Use the module-level queryClient singleton (was: useState).
  // The singleton is stable across renders and accessible from outside React.
  return (
    <SessionProviderWrapper>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ServiceWorkerRegistration />
          <CapacitorBridge />
          {children}
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProviderWrapper>
  )
}
