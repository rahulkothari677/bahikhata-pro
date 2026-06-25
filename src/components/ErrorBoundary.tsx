'use client'

import React from 'react'

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: any }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error }
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('ErrorBoundary caught:', error)
    console.error('Component stack:', errorInfo.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '14px' }}>
          <h2 style={{ color: 'red' }}>Something went wrong.</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.toString()}
          </pre>
          <button
            onClick={() => {
              localStorage.clear()
              window.location.reload()
            }}
            style={{ marginTop: '10px', padding: '8px 16px', cursor: 'pointer' }}
          >
            Clear cache & reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
