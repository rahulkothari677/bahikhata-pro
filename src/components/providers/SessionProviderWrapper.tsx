'use client'

import { SessionProvider } from 'next-auth/react'

export function SessionProviderWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      // Don't refetch session on window focus or refocus — avoids unnecessary
      // network calls and prevents NextAuth from flipping to 'unauthenticated'
      // momentarily when offline.
      refetchOnWindowFocus={false}
      refetchWhenOffline={false}
    >
      {children}
    </SessionProvider>
  )
}
