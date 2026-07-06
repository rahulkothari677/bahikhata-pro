import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'

/**
 * 🔒 V10 §3.3: Shared error-response helper.
 *
 * WHY: The V9 dashboard route was fixed to use generic messages + errorId,
 * but 8 other routes still echoed `String(error)` or `error.message` to the
 * client — leaking internal details (file paths, SQL fragments, stack traces
 * in some Node error subclasses) that help attackers fingerprint the stack.
 *
 * This helper:
 *   1. Logs the real error server-side with a short errorId for log lookup.
 *   2. Returns a generic message + the errorId to the client.
 *
 * Usage:
 *   } catch (error) {
 *     return apiError(error, 'Failed to load transactions', 500)
 *   }
 *
 * The client can show `errorId` to the user, who can quote it to support
 * for log lookup — without ever seeing the raw error string.
 */

export function apiError(
  error: unknown,
  message: string,
  status: number = 500,
  context?: Record<string, unknown>,
): NextResponse {
  // Short 8-char errorId — easy to read aloud / paste in a support email
  const errorId = randomBytes(4).toString('hex')

  // Server-side log with the full error + errorId + optional context.
  // Never sent to the client.
  console.error(`[apiError ${errorId}]`, message, error, context ?? '')

  return NextResponse.json(
    {
      error: message,
      errorId,
    },
    { status },
  )
}

