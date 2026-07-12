import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  title: 'Admin — BahiKhata Pro',
  description: 'Admin dashboard for BahiKhata Pro',
  robots: { index: false, follow: false },
}

// 🔒 V20-024: Dynamic rendering — nonce-based CSP requires per-request nonce.
// The nonce is generated in middleware and passed via the x-nonce header.
// Reading headers() in the layout opts out of static rendering, which is
// correct for an admin panel (all pages are behind auth anyway).
export const dynamic = 'force-dynamic'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 🔒 V20-024: Read the per-request nonce from middleware.
  // Next.js 16 App Router automatically applies this nonce to its own inline
  // scripts (hydration, runtime) when it's available via the x-nonce header.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang="en">
      <body className="antialiased bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
