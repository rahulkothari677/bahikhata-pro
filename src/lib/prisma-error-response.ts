import { NextResponse } from 'next/server'
import { mapPrismaError } from '@/lib/prisma-error-message'

/**
 * Returns a NextResponse for a Prisma error the user can act on, or null when
 * the caller should fall through to apiError().
 *
 * Split from prisma-error-message.ts deliberately: importing `next/server`
 * pulls in the edge `Request` global, which is absent in the jest environment.
 * Keeping the mapping table pure means it stays directly testable.
 */
export function prismaErrorResponse(error: unknown, route: string): NextResponse | null {
  const mapped = mapPrismaError(error)
  if (!mapped) return null
  // Logged so a support question can still be traced, without the noise level
  // (or the Sentry alert) of a genuine 500.
  console.warn(`[${route}] handled Prisma error ${mapped.code}: ${mapped.error}`)
  return NextResponse.json(
    { error: mapped.error, message: mapped.message, code: mapped.code },
    { status: mapped.status },
  )
}
