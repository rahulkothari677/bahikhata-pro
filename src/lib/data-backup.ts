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

export async function exportBackup(): Promise<void> {
  // Fetch all data in parallel
  const [productsRes, partiesRes, txnRes, settingsRes, shopsRes] = await Promise.all([
    offlineFetch('/api/products'),
    offlineFetch('/api/parties'),
    offlineFetch('/api/transactions?limit=10000'),
    offlineFetch('/api/settings'),
    offlineFetch('/api/shops'),
  ])

  const [products, parties, transactions, settings, shops] = await Promise.all([
    productsRes.json(),
    partiesRes.json(),
    txnRes.json(),
    settingsRes.json(),
    shopsRes.json(),
  ])

  const backup = {
    version: 1,
    app: 'BahiKhata Pro',
    exportedAt: new Date().toISOString(),
    data: {
      products: products.products || [],
      parties: parties.parties || [],
      transactions: transactions.transactions || [],
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
