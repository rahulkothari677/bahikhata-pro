/**
 * @jest-environment jsdom
 *
 * A backup that omits payments is not a backup.
 *
 * WHY (audit 2026-08-14). `exportBackup()` fetched products, parties,
 * transactions, settings and shops — and stopped. The restore route has always
 * known how to read payments (it counts them in its results), but the export
 * never wrote any. So every backup file this app has ever produced was silently
 * missing all of them.
 *
 * What that costs, in a shopkeeper's terms: restore on a new phone and every
 * invoice comes back with none of the money paid against it. A customer who
 * settled in full appears to owe the lot. And the restore reports "payments: 0"
 * and looks like it worked, because the file really did contain none — so the
 * shopkeeper goes hunting for the mistake in their own bookkeeping.
 *
 * It is the worst shape of bug: silent, and discovered only at the moment of
 * recovery, when the original is gone. Confirmed on live data before fixing —
 * that shop had 25 payments and the file it produced held 0.
 */
import { exportBackup, BACKUP_VERSION } from '@/lib/data-backup'

const mockOfflineFetch = jest.fn()
jest.mock('@/lib/offline-fetch', () => ({
  offlineFetch: (...a: unknown[]) => mockOfflineFetch(...a),
}))

/** Captures the JSON that would have been written to the downloaded file. */
let written: string | null = null

const PAYMENTS = [
  { id: 'pay_1', partyId: 'party_1', partyName: 'Anita Devi', amount: 500, type: 'received', mode: 'cash', date: '2026-08-01' },
  { id: 'pay_2', partyId: 'party_2', partyName: 'Verma Traders', amount: 250, type: 'paid', mode: 'upi', date: '2026-08-02' },
]

function respond(url: string) {
  if (url.startsWith('/api/products')) return { products: [{ id: 'prod_1', name: 'Rice' }], total: 1, truncated: false }
  if (url.startsWith('/api/parties')) return { parties: [{ id: 'party_1', name: 'Anita' }], total: 1, truncated: false }
  if (url.startsWith('/api/transactions')) return { transactions: [{ id: 'txn_1', totalAmount: 1000 }], hasMore: false }
  if (url.startsWith('/api/payments')) return { payments: PAYMENTS, total: PAYMENTS.length, truncated: false }
  if (url.startsWith('/api/settings')) return { setting: { shopName: 'Test Shop' } }
  if (url.startsWith('/api/shops')) return { shops: [{ id: 'shop_1', name: 'Test Shop' }] }
  return {}
}

beforeEach(() => {
  jest.clearAllMocks()
  written = null
  mockOfflineFetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => respond(url),
  }))

  // Capture the Blob contents instead of downloading.
  global.URL.createObjectURL = jest.fn(() => 'blob:fake') as unknown as typeof URL.createObjectURL
  global.URL.revokeObjectURL = jest.fn() as unknown as typeof URL.revokeObjectURL
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  ;(global as unknown as { Blob: unknown }).Blob = class {
    constructor(parts: string[]) { written = parts.join('') }
  }
})

const backupFile = () => JSON.parse(written as string)

describe('the file contains the money', () => {
  it('asks the server for the payments at all', async () => {
    // The whole bug in one line: this request did not exist.
    await exportBackup()
    const urls = mockOfflineFetch.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.startsWith('/api/payments'))).toBe(true)
  })

  it('writes them into the file', async () => {
    await exportBackup()
    expect(backupFile().data.payments).toHaveLength(2)
  })

  it('keeps the amount and the direction of each one', async () => {
    // Direction matters as much as amount: 'received' and 'paid' move a
    // balance opposite ways, so losing it would be as bad as losing the row.
    await exportBackup()
    const [a, b] = backupFile().data.payments
    expect(a).toMatchObject({ amount: 500, type: 'received' })
    expect(b).toMatchObject({ amount: 250, type: 'paid' })
  })

  it('keeps the party name, which is the only join key that survives a restore', async () => {
    // A restore rebuilds every party with a fresh id, so the partyId in the
    // file points at nothing on the new device. Drop the name and the file is
    // full of payments that all skip on restore — see
    // backup-payments-round-trip.test.ts, where the export end is held.
    await exportBackup()
    expect(backupFile().data.payments.map((p: { partyName: string }) => p.partyName))
      .toEqual(['Anita Devi', 'Verma Traders'])
  })

  it('still contains everything version 1 contained', async () => {
    // A fix that quietly dropped something else would be no better.
    await exportBackup()
    const d = backupFile().data
    expect(Object.keys(d).sort()).toEqual(
      ['parties', 'payments', 'products', 'settings', 'shops', 'transactions'],
    )
  })

  it('marks the file as version 2, so a restore can tell old from new', async () => {
    await exportBackup()
    expect(backupFile().version).toBe(BACKUP_VERSION)
    expect(BACKUP_VERSION).toBeGreaterThan(1)
  })

  it('fetches everything at once rather than a request per customer', async () => {
    // Reading payments party-by-party would have "worked" for a shop with 27
    // customers and fallen over for one with 5,000.
    await exportBackup()
    const paymentCalls = mockOfflineFetch.mock.calls
      .map(c => String(c[0])).filter(u => u.startsWith('/api/payments'))
    expect(paymentCalls).toHaveLength(1)
  })
})

describe('every transaction is in the file, not just the newest page', () => {
  /*
   * 🔒 THE BIGGEST ONE (audit 2026-08-14). The export asked for
   * `/api/transactions?limit=10000`. That endpoint caps `limit` at 200 —
   * deliberately, to protect its memory — and returns `hasMore: true` with a
   * cursor for the rest. The export ignored both and wrote the newest 200 rows.
   *
   * Found on live data: the shop's oldest exported invoice was 1 June while
   * payments plainly referred to bills from April. The file was well-formed and
   * nothing warned; only a restore would have revealed the missing history.
   *
   * Worse than the missing payments, because these are the invoices themselves
   * — the GST filed against them, the stock movements, the lot.
   */
  function paged(pages: { transactions: unknown[]; hasMore: boolean; nextCursor?: string }[]) {
    let call = 0
    mockOfflineFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (url.startsWith('/api/transactions') ? pages[call++] : respond(url)),
    }))
  }

  it('follows the cursor to the end', async () => {
    paged([
      { transactions: [{ id: 't1' }, { id: 't2' }], hasMore: true, nextCursor: '2026-06-01|t2' },
      { transactions: [{ id: 't3' }], hasMore: false },
    ])
    await exportBackup()
    expect(backupFile().data.transactions.map((t: { id: string }) => t.id)).toEqual(['t1', 't2', 't3'])
  })

  it('sends the cursor it was given', async () => {
    paged([
      { transactions: [{ id: 't1' }], hasMore: true, nextCursor: '2026-06-01|t1' },
      { transactions: [{ id: 't2' }], hasMore: false },
    ])
    await exportBackup()
    const urls = mockOfflineFetch.mock.calls.map(c => String(c[0])).filter(u => u.startsWith('/api/transactions'))
    expect(urls).toHaveLength(2)
    expect(urls[1]).toContain('cursor=')
    // Cursors are "date|id"; an unescaped pipe would silently truncate the query.
    expect(urls[1]).toContain(encodeURIComponent('2026-06-01|t1'))
  })

  it('does not ask for more than the endpoint will give', async () => {
    // Asking for 10,000 is what hid the bug: the server quietly returned 200
    // and the export believed it had everything.
    await exportBackup()
    const url = mockOfflineFetch.mock.calls.map(c => String(c[0])).find(u => u.startsWith('/api/transactions'))
    expect(url).not.toContain('limit=10000')
  })

  it('stops after one page when there is no more', async () => {
    await exportBackup()
    const urls = mockOfflineFetch.mock.calls.map(c => String(c[0])).filter(u => u.startsWith('/api/transactions'))
    expect(urls).toHaveLength(1)
  })

  it('refuses rather than writing a short file when the cursor is missing', async () => {
    // hasMore with no cursor means the paging cannot advance. Stopping quietly
    // here would produce exactly the file this whole test exists to prevent.
    paged([{ transactions: [{ id: 't1' }], hasMore: true }])
    await expect(exportBackup()).rejects.toThrow(/could not read past/i)
    expect(written).toBeNull()
  })

  it('refuses rather than looping forever on a stuck cursor', async () => {
    mockOfflineFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.startsWith('/api/transactions')
          ? { transactions: [{ id: 'stuck' }], hasMore: true, nextCursor: 'same-forever' }
          : respond(url),
    }))
    await expect(exportBackup()).rejects.toThrow(/more than/i)
    expect(written).toBeNull()
  })
})

describe('a partial backup is refused, not written', () => {
  it('throws rather than saving a file the server said was capped', async () => {
    /*
     * A backup that is quietly short is worse than one that refuses: the
     * shopkeeper can act on "this did not save everything", and cannot act on a
     * file that looks fine and is missing rows they will not miss until they
     * need them.
     */
    mockOfflineFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.startsWith('/api/payments')
          ? { payments: PAYMENTS, total: 12_000, truncated: true }
          : respond(url),
    }))
    await expect(exportBackup()).rejects.toThrow(/12000|12,000/)
    expect(written).toBeNull()
  })

  it.each([
    ['products', '/api/products', 'products'],
    ['parties', '/api/parties', 'parties'],
  ])('refuses when the server says the %s list was capped', async (_label, prefix, key) => {
    // These endpoints have reported `truncated` for some time and the export
    // was reading none of them — only the payments flag it had just been given.
    mockOfflineFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.startsWith(prefix)
          ? { [key]: [{ id: 'x' }], total: 9_000, truncated: true }
          : respond(url),
    }))
    await expect(exportBackup()).rejects.toThrow(/9000|9,000/)
    expect(written).toBeNull()
  })

  it('the refusal says what to do next', async () => {
    mockOfflineFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.startsWith('/api/payments')
          ? { payments: PAYMENTS, total: 12_000, truncated: true }
          : respond(url),
    }))
    await expect(exportBackup()).rejects.toThrow(/get in touch|contact/i)
  })
})
