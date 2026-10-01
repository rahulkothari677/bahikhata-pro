/**
 * Identity keys that survive a backup round trip.
 *
 * WHY THIS FILE EXISTS (audit 2026-08-14). A restore rebuilds every row with a
 * FRESH id, so no id written into a backup file means anything on the device
 * that reads it. Anything in the file that points at another row has to point
 * by something the restore can recognise again.
 *
 * That rule was already broken once in this very fix: payments were exported
 * carrying `partyId`, while the restore joins them by party NAME. The file
 * looked complete and every payment in it skipped on restore. The lesson is not
 * "remember the right field" — it is that BOTH ends must call the SAME function,
 * so a change to one cannot silently disagree with the other.
 */

import { istDateString } from '@/lib/timezone'

/**
 * How a bill is recognised across devices: invoice number, date and total.
 *
 * The restore already used this exact triple to spot rows it had imported on a
 * previous attempt; it is now shared rather than spelled out inline at each
 * site.
 *
 * The date is reduced to a calendar day on purpose. A backup carries an ISO
 * timestamp and the restored row is re-parsed from it, so comparing to the
 * millisecond would fail on rows that are plainly the same bill.
 *
 * The day is the shop's IST calendar day (2026-10-01). It was the UTC day, so a
 * bill made between 00:00 and 05:29 IST keyed as the day before. Both the
 * export and the restore call this one function, so they stay in agreement.
 *
 * It is not a perfect key. Two bills with no invoice number, on the same day,
 * for the same amount are indistinguishable — and callers must treat that as
 * "cannot be certain" rather than guessing, the same way an ambiguous party
 * name is treated.
 */
export function billKey(bill: {
  invoiceNo?: string | null
  date: Date | string
  totalAmount?: number | null
}): string {
  const day = istDateString(new Date(bill.date))
  return `${bill.invoiceNo || ''}|${day}|${bill.totalAmount ?? 0}`
}
