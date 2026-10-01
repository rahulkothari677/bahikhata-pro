/**
 * SQL form of a bill line's taxable value — server only (imports Prisma).
 * The reason these exist is in lib/line-taxable.ts; read it first.
 *
 * Cast to numeric on purpose: the queries these replaced produced numeric
 * (ROUND of a numeric product), which Prisma returns as a Decimal. Integer
 * arithmetic would come back as bigint and break callers that do arithmetic
 * or JSON on the result. Values are PAISE (the columns are integers).
 */
import { Prisma } from '@prisma/client'

/** Post-discount taxable value of a line, in paise. Table alias must be `ti`. */
export const LINE_TAXABLE_SQL = Prisma.sql`((ti."total" - ti."cgst" - ti."sgst" - ti."igst" - ti."csamt")::numeric)`

/** Pre-discount taxable value of a line (what was billed before the discount), in paise. */
export const LINE_GROSS_SQL = Prisma.sql`((ti."total" - ti."cgst" - ti."sgst" - ti."igst" - ti."csamt" + ti."discountAmount")::numeric)`
