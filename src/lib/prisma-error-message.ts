/**
 * Turn a Prisma infrastructure error into a message a shopkeeper can act on.
 *
 * WHY (2026-07-22): Rahul reported "editing a sale ALWAYS fails" with the toast
 * "Failed to update transaction" — the generic 500 text from apiError. The real
 * cause was invisible from the client: apiError deliberately returns nothing but
 * an errorId, and the actual Prisma code only exists in the Vercel log. That is
 * correct for genuine internal errors, but several of these are ORDINARY,
 * user-resolvable conditions that were being flattened into an unactionable 500:
 *
 *   P2002  the unique constraint on (userId, invoiceNo) — a duplicate invoice
 *          number is a data-entry mistake, not a server fault.
 *   P2024  connection-pool timeout — retry, or the pool is too small.
 *   P2028  interactive-transaction timeout — the 5s default is tight on Neon
 *          when a bill has many line items and the DB is cold.
 *   P1001/P1017  DB unreachable / connection closed mid-request.
 *
 * Returning a real message AND the code means the next failure reports its own
 * cause instead of needing a log dive. Errors not listed here fall through to
 * apiError unchanged, so nothing internal starts leaking.
 */

export interface MappedPrismaError {
  error: string
  message: string
  status: number
  code: string
}

export function mapPrismaError(error: unknown): MappedPrismaError | null {
  const err = error as any
  const code: string | undefined = err?.code
  if (!code) return null

  switch (code) {
    case 'P2002': {
      // meta.target names the offending column(s) when Prisma knows them.
      const target = Array.isArray(err?.meta?.target)
        ? err.meta.target.join(', ')
        : String(err?.meta?.target ?? '')
      const isInvoiceNo = /invoiceNo/i.test(target)
      return {
        error: isInvoiceNo ? 'Duplicate invoice number' : 'Duplicate entry',
        message: isInvoiceNo
          ? 'Another bill already uses this invoice number. Change the invoice number and save again.'
          : `This would create a duplicate${target ? ` (${target})` : ''}. Change the highlighted value and try again.`,
        status: 409,
        code,
      }
    }
    case 'P2024':
      return {
        error: 'Server busy',
        message: 'The database was busy and the save timed out. Nothing was changed — please try again.',
        status: 503,
        code,
      }
    case 'P2028':
      return {
        error: 'Save timed out',
        message: 'This save took too long and was rolled back, so nothing changed. Try again; if a bill has many items it can help to save it in smaller edits.',
        status: 503,
        code,
      }
    case 'P1001':
    case 'P1017':
      return {
        error: 'Database unreachable',
        message: 'Could not reach the database. Nothing was changed — check your connection and try again.',
        status: 503,
        code,
      }
    default:
      return null
  }
}
