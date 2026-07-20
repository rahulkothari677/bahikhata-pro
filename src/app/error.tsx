'use client'

/**
 * 🔒 V26 R16 (Phase 5): Route-level error boundary.
 *
 * Phase 5 audit (R16 🟡): no `error.tsx` / `global-error.tsx` boundaries and
 * no ChunkLoadError recovery → a stale client after deploy hits a failed
 * dynamic import and stays broken until manual reload (default Next error
 * surface — unstyled, English, no recovery).
 *
 * This file catches errors thrown by any route component (Dashboard, Sales,
 * Parties, etc.). It renders a branded, Hindi/English recovery screen with a
 * "Reload" button. `global-error.tsx` catches errors in the root layout
 * itself (auth shell, providers) — it has its own <html><body>.
 *
 * ChunkLoadError is handled separately in crash-tracker.ts (auto-reload once,
 * guarded by sessionStorage to prevent loops).
 */

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to console for debugging (Sentry captures via the crash-tracker).
    console.error('[route-error-boundary]', error)
  }, [error])

  const isChunkError =
    error?.name === 'ChunkLoadError' ||
    error?.message?.includes('Loading chunk') ||
    error?.message?.includes('Loading CSS chunk')

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-card border border-border rounded-2xl shadow-lg p-6 sm:p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-7 h-7 text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">
          {isChunkError ? 'App update available' : 'Something went wrong'}
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          {isChunkError ? (
            <>
              A new version of the app was just released. Reload to get the latest version.
              <br />
              <span className="text-xs">ऐप का नया वर्ज़न आ गया है। रीलोड करें।</span>
            </>
          ) : (
            <>
              An unexpected error occurred. Try reloading — your data is safe.
              <br />
              <span className="text-xs">कुछ गड़बड़ हो गई। रीलोड करें — आपका डेटा सुरक्षित है।</span>
            </>
          )}
        </p>
        {error?.digest && (
          <p className="text-xs text-muted-foreground/60 mb-4 font-mono">
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            onClick={() => {
              if (isChunkError) {
                // Force a hard reload (bypass cache) for chunk errors.
                window.location.reload()
              } else {
                reset()
              }
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {isChunkError ? 'Reload' : 'Try again'}
          </button>
          <button
            onClick={() => {
              window.location.href = '/'
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg font-medium text-sm hover:bg-secondary/80 transition-colors"
          >
            <Home className="w-4 h-4" />
            Go home
          </button>
        </div>
      </div>
    </div>
  )
}
