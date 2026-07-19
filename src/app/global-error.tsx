'use client'

/**
 * 🔒 V26 R16 (Phase 5): Global error boundary.
 *
 * This catches errors in the ROOT layout itself (auth shell, providers,
 * ThemeProvider, AppShell). It MUST render its own <html><body> because the
 * root layout is the thing that failed — we can't reuse its chrome.
 *
 * Kept intentionally minimal (inline styles, no Tailwind dependency, no
 * providers) so it works even when the entire app fails to bootstrap.
 */

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global-error-boundary]', error)
  }, [error])

  const isChunkError =
    error?.name === 'ChunkLoadError' ||
    error?.message?.includes('Loading chunk') ||
    error?.message?.includes('Loading CSS chunk')

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#fafaf9', color: '#1c1917' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ maxWidth: '28rem', width: '100%', background: 'white', border: '1px solid #e7e5e4', borderRadius: '1rem', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', padding: '2rem', textAlign: 'center' }}>
            <div style={{ width: '3.5rem', height: '3.5rem', borderRadius: '50%', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
            </div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              {isChunkError ? 'App update available' : 'Something went wrong'}
            </h1>
            <p style={{ fontSize: '0.875rem', color: '#78716c', marginBottom: '1.5rem' }}>
              {isChunkError ? (
                <>
                  A new version of the app was just released. Reload to get the latest version.
                  <br />
                  <span style={{ fontSize: '0.75rem' }}>ऐप का नया वर्ज़न आ गया है। रीलोड करें।</span>
                </>
              ) : (
                <>
                  An unexpected error occurred. Try reloading — your data is safe.
                  <br />
                  <span style={{ fontSize: '0.75rem' }}>कुछ गड़बड़ हो गई। रीलोड करें — आपका डेटा सुरक्षित है।</span>
                </>
              )}
            </p>
            {error?.digest && (
              <p style={{ fontSize: '0.75rem', color: '#a8a29e', marginBottom: '1rem', fontFamily: 'monospace' }}>
                Error ID: {error.digest}
              </p>
            )}
            <button
              onClick={() => {
                if (isChunkError) {
                  window.location.reload()
                } else {
                  reset()
                }
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                padding: '0.5rem 1rem', background: '#0f766e', color: 'white', border: 'none',
                borderRadius: '0.5rem', fontWeight: 500, fontSize: '0.875rem', cursor: 'pointer',
              }}
            >
              {isChunkError ? 'Reload' : 'Try again'}
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
