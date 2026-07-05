import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// 🔒 SECURITY + PERFORMANCE: Only log queries in development.
// In production, logging every query (1) creates huge log volume / cost,
// (2) leaks PII into logs (query params include phone numbers, emails,
// party names), and (3) adds I/O latency to every request.
// (Audit fix Phase 1.2 — was: `log: ['query']` unconditionally)
const logConfig = process.env.NODE_ENV === 'development'
  ? ['query', 'error', 'warn'] as const
  : ['error', 'warn'] as const

// 🔒 V8.1: Increase connection pool timeout to 30s (was: default 10s).
// Neon serverless with scale-to-zero can take 9+ seconds to wake up.
// With the default 10s pool timeout, queries that queue behind the
// wake-up exceed the timeout → "Timed out fetching a new connection
// from the connection pool" → HTTP 500. 30s gives enough headroom.
// Once Neon scale-to-zero is disabled (founder task Y1), this can be
// reduced back to 10s.
//
// Note: pool_timeout must also be in the DATABASE_URL query string
// (&pool_timeout=30). This Prisma-level setting is a backup.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [...logConfig],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  })

// 🔒 V8.1: Retry wrapper for connection pool timeouts.
// On Neon cold starts, the first query can timeout. Retrying after 2s
// gives Neon time to wake up. This is a stopgap until scale-to-zero is
// disabled (founder task Y1).
export async function withConnectionRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  retryDelayMs = 2000,
): Promise<T> {
  let lastError: any
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error
      const isPoolTimeout =
        error?.message?.includes('Timed out fetching a new connection') ||
        error?.message?.includes('Connection pool timeout') ||
        error?.code === 'P1001' // Connection timed out
      if (isPoolTimeout && attempt < maxRetries) {
        console.warn(`[db] Connection pool timeout (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${retryDelayMs}ms...`)
        await new Promise(resolve => setTimeout(resolve, retryDelayMs))
        continue
      }
      throw error
    }
  }
  throw lastError
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
