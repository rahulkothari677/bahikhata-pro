'use client'

import React from 'react'

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: any; errorInfo: any }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error }
  }

  componentDidCatch(error: any, errorInfo: any) {
    this.setState({ errorInfo })
    console.error('ErrorBoundary caught:', error)
    console.error('Component stack:', errorInfo?.componentStack)
  }

  handleClearAndReload = async () => {
    try {
      // Clear localStorage
      localStorage.clear()

      // Clear IndexedDB (where offline session + cache live)
      if (typeof indexedDB !== 'undefined') {
        const dbs = await indexedDB.databases?.()
        if (dbs) {
          await Promise.all(
            dbs.map(
              (db) =>
                new Promise<void>((resolve) => {
                  const req = indexedDB.deleteDatabase(db.name!)
                  req.onsuccess = () => resolve()
                  req.onerror = () => resolve()
                  req.onblocked = () => resolve()
                }),
            ),
          )
        }
      }

      // Unregister service workers
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }

      // Clear caches API
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch (e) {
      console.error('Failed to clear cache:', e)
    }
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      const isTimeError =
        this.state.error?.message?.includes('Invalid time value') ||
        this.state.error?.toString()?.includes('Invalid time value')

      return (
        <div
          style={{
            padding: '20px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '14px',
            maxWidth: '600px',
            margin: '40px auto',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ color: '#dc2626', marginBottom: '12px' }}>
            {isTimeError ? 'Cache issue detected' : 'Something went wrong'}
          </h2>
          {isTimeError && (
            <p style={{ marginBottom: '16px', color: '#666' }}>
              We found a corrupted offline cache from a previous version. Click the button below to clear
              it and reload — you&apos;ll need to sign in again, but your data is safe on the server.
            </p>
          )}
          <p style={{ marginBottom: '20px', color: '#666' }}>
            <strong>Error:</strong> {this.state.error?.toString()}
          </p>
          <button
            onClick={this.handleClearAndReload}
            style={{
              marginTop: '10px',
              padding: '12px 24px',
              cursor: 'pointer',
              background: '#d97706',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '15px',
              fontWeight: 500,
            }}
          >
            Clear cache &amp; reload
          </button>
          <details style={{ marginTop: '20px', textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer', color: '#888' }}>Show technical details</summary>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                background: '#f5f5f5',
                padding: '10px',
                borderRadius: '5px',
                marginTop: '10px',
                fontSize: '11px',
                overflow: 'auto',
              }}
            >
              {this.state.error?.stack}
              {'\n\nComponent Stack:\n'}
              {this.state.errorInfo?.componentStack}
            </pre>
          </details>
        </div>
      )
    }
    return this.props.children
  }
}
