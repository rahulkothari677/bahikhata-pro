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

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [...logConfig],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db