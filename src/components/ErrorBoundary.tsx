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

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '14px', maxWidth: '800px', margin: '0 auto' }}>
          <h2 style={{ color: 'red', marginBottom: '10px' }}>Something went wrong.</h2>
          <p style={{ marginBottom: '10px' }}><strong>Error:</strong> {this.state.error?.toString()}</p>
          <p style={{ marginBottom: '10px' }}><strong>Stack:</strong></p>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f0f0f0', padding: '10px', borderRadius: '5px', marginBottom: '10px' }}>
            {this.state.error?.stack}
          </pre>
          <p style={{ marginBottom: '10px' }}><strong>Component Stack:</strong></p>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f0f0f0', padding: '10px', borderRadius: '5px', marginBottom: '10px' }}>
            {this.state.errorInfo?.componentStack}
          </pre>
          <button
            onClick={() => {
              localStorage.clear()
              window.location.reload()
            }}
            style={{ marginTop: '10px', padding: '8px 16px', cursor: 'pointer', background: '#d97706', color: 'white', border: 'none', borderRadius: '5px' }}
          >
            Clear cache & reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
