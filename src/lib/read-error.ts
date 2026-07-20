/**
 * 🔒 V26 R14 (Phase 5): Shared error-message reader for client fetch calls.
 *
 * Phase 5 audit (R14 🟡): 14+ client call sites used the pattern
 * `if (!r.ok) throw new Error('Failed')` — discarding the server's actionable
 * message. The user saw a generic toast instead of "Period locked" or
 * "Payment date cannot be in the future" or "Not enough stock".
 *
 * This helper reads the server's JSON error body and returns the message.
 * Falls back to 'Something went wrong' if the body isn't JSON or has no
 * message/error field.
 *
 * Usage:
 *   if (!r.ok) throw new Error(await readError(r))
 *   // or:
 *   if (!r.ok) {
 *     const msg = await readError(r)
 *     sonnerToast.error(msg)
 *     return
 *   }
 */

export async function readError(r: Response): Promise<string> {
  try {
    const body = await r.json()
    // Server's apiError helper returns { error, message, errorId }.
    // Prefer `message` (user-facing) over `error` (short code).
    if (typeof body?.message === 'string' && body.message.trim()) return body.message
    if (typeof body?.error === 'string' && body.error.trim()) return body.error
    // Some routes return { error: { message: '...' } } (zod validation).
    if (body?.error?.message && typeof body.error.message === 'string') return body.error.message
    // Some routes return { errors: [...] } (zod issues array).
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      const first = body.errors[0]
      if (typeof first?.message === 'string') return first.message
    }
  } catch {
    // Body wasn't JSON — fall through to status-based fallback.
  }
  // Status-based fallback.
  if (r.status === 401) return 'You need to sign in again.'
  if (r.status === 403) return 'You do not have permission to do this.'
  if (r.status === 404) return 'This could not be found. It may have been deleted.'
  if (r.status === 429) return 'Too many requests. Please wait a moment and try again.'
  if (r.status >= 500) return 'The server had an error. Please try again in a moment.'
  return 'Something went wrong'
}
