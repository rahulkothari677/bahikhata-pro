/**
 * The IST local time of a stored timestamp, in SQL — server only (imports
 * Prisma). The ONE place an "AT TIME ZONE" conversion is written.
 *
 * The columns are `timestamp without time zone` holding UTC. Postgres reads
 * `naive AT TIME ZONE 'Asia/Kolkata'` as "this naive time IS Indian time" and
 * converts it to UTC — it SUBTRACTS 5½ hours, the opposite of what is wanted.
 * Found 14 Oct (5b-5): on a UTC database every sale before ~11:00 IST landed
 * on the previous day's bar (and, for a customer's months, a sale on the 1st
 * landed in the previous month); on a database whose session runs in IST the
 * buckets never matched at all and the trend chart was flat at ₹0.
 *
 * Right: first say the naive value is UTC, then ask for its IST wall clock:
 *   ("date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'
 * The result is a naive IST timestamp, so DATE_TRUNC on it does not depend
 * on the session's time zone either.
 */
import { Prisma } from '@prisma/client'

/** The columns this is used on; a closed set, so Prisma.raw stays safe. */
type DateColumn = '"date"' | 't."date"' | 't.date'

/** IST wall-clock time of `column`, as a naive timestamp. */
export function istLocal(column: DateColumn): Prisma.Sql {
  return Prisma.raw(`((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')`)
}
