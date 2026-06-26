'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { SessionProviderWrapper } from '@/components/providers/SessionProviderWrapper'
import { OfflineError } from '@/lib/offline-fetch'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 60s stale time — balances freshness with reduced server load.
            // User-triggered refreshes (manual button, post-mutation invalidate)
            // still fetch immediately. Only background refetches are throttled.
            staleTime: 60 * 1000,
            gcTime: 5 * 60 * 1000, // keep unused data in cache 5 min (was default 5 min, made explicit)
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
      }),
  )

  return (
    <SessionProviderWrapper>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProviderWrapper>
  )
}
