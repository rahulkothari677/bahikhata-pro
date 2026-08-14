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
  const [productsRes, partiesRes, txnRes, paymentsRes, settingsRes, shopsRes] = await Promise.all([
    offlineFetch('/api/products'),
    offlineFetch('/api/parties'),
    offlineFetch('/api/transactions?limit=10000'),
    offlineFetch('/api/payments?all=1'),
    offlineFetch('/api/settings'),
    offlineFetch('/api/shops'),
  ])

  const [products, parties, transactions, payments, settings, shops] = await Promise.all([
    productsRes.json(),
    partiesRes.json(),
    txnRes.json(),
    paymentsRes.json(),
    settingsRes.json(),
    shopsRes.json(),
  ])

  /*
   * A backup that is quietly short is worse than one that refuses. If the
   * server capped the payment list, say so and stop — the shopkeeper can act on
   * "this did not save everything", and cannot act on a file that looks fine
   * and is missing rows they will not notice until they need them.
   */
  if (payments?.truncated) {
    throw new Error(
      `This shop has ${payments.total} payments and the backup can carry ${payments.payments?.length ?? 0}. ` +
      `Nothing was saved, because a backup missing some of your payments would be worse than none. ` +
      `Please get in touch so we can export the full history for you.`,
    )
  }

  const backup = {
    version: BACKUP_VERSION,
    app: 'EkBook',
    exportedAt: new Date().toISOString(),
    data: {
      products: products.products || [],
      parties: parties.parties || [],
      transactions: transactions.transactions || [],
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
