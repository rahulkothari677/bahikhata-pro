import { PrismaClient } from '@prisma/client'
import { withMoneyConversion } from './prisma-money-extension'

// 🔒 V20 FIX: Use PrismaClient type for the global cache. The extension
// modifies runtime behavior (paise↔rupees conversion) but not type signatures.
// Casting to PrismaClient avoids Prisma's $extends type inference issues with
// generated model handlers (bankStatement, gstReturn, etc.).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// 🔒 SECURITY + PERFORMANCE: Only log queries in development.
const logConfig = process.env.NODE_ENV === 'development'
  ? ['query', 'error', 'warn'] as const
  : ['error', 'warn'] as const

const baseClient = new PrismaClient({
  log: [...logConfig],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
})

// 🔒 V18 Paise Migration Phase 4: Wrap PrismaClient with money conversion.
// The extension auto-converts money columns: paise (Int in DB) ↔ rupees (Float in JS).
// $queryRaw is NOT affected (Phase 2 SQL already handles paise conversion).
// Cast back to PrismaClient: the extension changes runtime behavior, not types.
const extendedClient = withMoneyConversion(baseClient) as unknown as PrismaClient
export const db = globalForPrisma.prisma ?? extendedClient

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
