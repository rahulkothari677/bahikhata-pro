/**
 * Data Backup & Restore — export all user data to JSON, import on any device.
 *
 * Backup: fetches all products, parties, transactions, settings, shops
 * → packages as a single JSON file → downloads.
 *
 * Restore: uploads a JSON file → creates all records via API.
 * Used for: device migration, data safety, switching phones.
 */

import { offlineFetch } from './offline-fetch'

/**
 * The backup file format. Bumped when the SHAPE changes, so a restore can tell
 * an old file from a new one and say what it is missing.
 *
 * 1 — products, parties, transactions, settings, shops. **No payments.**
 * 2 — adds payments.
 */
export const BACKUP_VERSION = 2

/**
 * Refuse to write the file rather than write a short one.
 *
 * A silently partial backup is the worst possible outcome: it looks like
 * safety, and the gap is discovered at the moment of recovery, when the
 * original is gone.
 */
function assertComplete(what: string, truncated: unknown, total?: number, got?: number): void {
  if (!truncated) return
  throw new Error(
    `This shop has ${total ?? 'more'} ${what} and the backup could only read ${got ?? 0}. ` +
    `Nothing was saved, because a backup missing some of your ${what} would be worse than none. ` +
    `Please get in touch so we can export the full history for you.`,
  )
}

/**
 * Every transaction, by following the server's own pagination.
 *
 * 🔒 2026-08-14: THE BACKUP WAS KEEPING ONLY THE NEWEST 200 INVOICES.
 *
 * This used to be a single `GET /api/transactions?limit=10000`. That endpoint
 * caps `limit` at 200 — deliberately, to protect its memory — and returns
 * `hasMore: true` with a cursor for the rest. The export ignored both, so it
 * wrote the newest 200 rows and called it a backup.
 *
 * Found on live data: the shop's oldest exported invoice was 1 June while
 * payments plainly referred to bills from April. Nothing warned, and nothing
 * ever would have: the file was well-formed, and only a restore would reveal
 * that a year of trading had gone.
 *
 * Worse than the missing payments, because these are the invoices themselves —
 * the GST already filed against them, the stock movements, the whole history.
 */
async function fetchAllTransactions(): Promise<Record<string, unknown>[]> {
  /*
   * ~50 pages. Generous for any real shop, and a hard stop so a broken cursor
   * cannot spin forever on someone's phone. Hitting it means the export is
   * incomplete, which is a refusal, not a silent trim.
   */
  const MAX_PAGES = 50
  const all: Record<string, unknown>[] = []
  let cursor: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `/api/transactions?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const res = await offlineFetch(url)
    const body = await res.json()
    all.push(...(body.transactions || []))

    if (!body.hasMore) return all
    if (!body.nextCursor) {
      // hasMore with no cursor means the page cannot be advanced. Stopping here
      // would write a short file that looks whole.
      throw new Error(
        `The backup could not read past ${all.length} transactions. Nothing was saved — a backup ` +
        `missing part of your history would be worse than none. Please try again in a moment.`,
      )
    }
    cursor = body.nextCursor
  }

  throw new Error(
    `This shop has more than ${all.length} transactions, which is more than the backup can read in ` +
    `one go. Nothing was saved. Please get in touch so we can export your full history for you.`,
  )
}

export async function exportBackup(): Promise<void> {
  /*
   * 🔒 2026-08-14: PAYMENTS ARE IN THE BACKUP.
   *
   * Version 1 fetched products, parties, transactions, settings and shops, and
   * stopped. The restore route has always known how to read payments — it
   * counts them in its results — but the export never wrote any, so every
   * backup file was silently missing all of them.
   *
   * What that costs, in a shopkeeper's terms: restore on a new phone and every
   * invoice comes back with none of the money paid against it. A customer who
   * settled in full appears to owe the lot. The restore reports "payments: 0"
   * and looks like it worked, because the file really did contain none.
   *
   * It is the worst shape of bug — silent, and discovered only at the moment of
   * recovery, when the original is already gone. Confirmed on live data before
   * fixing: that shop had 25 payments and the file it produced held 0.
   */
  const [productsRes, partiesRes, paymentsRes, settingsRes, shopsRes] = await Promise.all([
    offlineFetch('/api/products'),
    offlineFetch('/api/parties'),
    offlineFetch('/api/payments?all=1'),
    offlineFetch('/api/settings'),
    offlineFetch('/api/shops'),
  ])

  const [products, parties, payments, settings, shops] = await Promise.all([
    productsRes.json(),
    partiesRes.json(),
    paymentsRes.json(),
    settingsRes.json(),
    shopsRes.json(),
  ])

  const transactions = await fetchAllTransactions()

  /*
   * A backup that is quietly short is worse than one that refuses. The
   * shopkeeper can act on "this did not save everything"; they cannot act on a
   * file that looks fine and is missing rows they will not notice until the day
   * they need them.
   *
   * Checked for EVERY list, not just the one that happened to be broken. The
   * products and parties endpoints have reported `truncated` for some time and
   * nothing here was reading it.
   */
  assertComplete('payments', payments?.truncated, payments?.total, payments?.payments?.length)
  assertComplete('products', products?.truncated, products?.total, products?.products?.length)
  assertComplete('parties', parties?.truncated, parties?.total, parties?.parties?.length)

  const backup = {
    version: BACKUP_VERSION,
    app: 'EkBook',
    exportedAt: new Date().toISOString(),
    data: {
      products: products.products || [],
      parties: parties.parties || [],
      transactions,
      payments: payments.payments || [],
      settings: settings.setting || {},
      shops: shops.shops || [],
    },
  }

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const date = new Date().toISOString().slice(0, 10)
  a.download = `bahikhata-backup-${date}.json`
  a.click()
  URL.revokeObjectURL(url)
}
