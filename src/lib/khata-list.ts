/**
 * Khata — every customer or supplier, with search, sort and group chips
 * (Phase 5e-1, ledger model v4 §7). Pure, so it is tested; the route feeds
 * it the shop's parties with the balances from getReceivablePayable (the ONE
 * balance definition Home, Khata and Insights share) and returns a page.
 *
 * Replaces the screen loading up to 5,000 parties and adding them up on the
 * phone: counts and totals are now worked out over EVERY party on the server,
 * and the screen gets 60 rows at a time.
 *
 * Which side a party is on comes from its type (customer / supplier / both),
 * never from its balance's sign (#261, Cause 6). On the customer side a
 * positive balance is owed to you and a negative one is an advance; on the
 * supplier side a negative balance is what you owe and a positive one is
 * money the supplier owes you back.
 */

import { isWalkInParty } from './walk-in-party'

export type KhataSide = 'customer' | 'supplier'
export const KHATA_CHIPS = ['all', 'due', 'old', 'settled', 'advance'] as const
export type KhataChip = (typeof KHATA_CHIPS)[number]
export const KHATA_SORTS = ['balance', 'name', 'recent', 'oldest'] as const
export type KhataSort = (typeof KHATA_SORTS)[number]
/** "Over 30 days": the oldest unpaid bill is older than this. */
export const OLD_DAYS = 30
export const KHATA_PAGE = 60

export interface KhataParty {
  id: string
  name: string
  phone: string | null
  type: string
  balance: number
  /** Days since the oldest bill still due (sales, customers only); null when none. */
  oldestDays: number | null
  /** Last bill or payment, ISO; null when none. */
  lastAt: string | null
  /** Shown on the rows and filled into the edit form; carried through untouched. */
  gstin?: string | null
  email?: string | null
  address?: string | null
  state?: string | null
  openingBalance?: number
  transactionCount?: number
}

export function onSide(type: string, side: KhataSide): boolean {
  return type === side || type === 'both'
}

const paise = (r: number) => Math.round((Number(r) || 0) * 100)

export interface SidedBalance { type: string; name?: string | null; balance: number }

/**
 * #261 — who owes whom, by WHO the party is: the one rule Home's "To collect /
 * To pay", Khata's cards and Insights' Udhaar share. It replaced counting every
 * positive balance as "from N customers" and every negative one as "to N
 * suppliers", which put an overpaid supplier among the customers who owe you
 * and a customer's advance among the suppliers you owe (Cause 6).
 *
 * - collect: customers (and "both") who owe you
 * - pay: suppliers (and "both") you owe
 * - advance: customers whose money you hold (a negative customer balance)
 * - refund: suppliers who owe you money back (a positive supplier balance)
 *
 * The walk-in khata (counter returns) is nobody: never counted as a customer
 * (#267), and nobody can be asked to pay it. The BOOKS' totals — every debit
 * or credit balance whoever holds it — stay getReceivablePayable's
 * totalReceivable / totalPayable (Reports' trial balance, reconciliation).
 */
export function khataSides<T extends SidedBalance>(all: T[]) {
  const people = all.filter((p) => !isWalkInParty(p))
  const group = (keep: (p: T, b: number) => boolean) => {
    const parties = people.filter((p) => keep(p, paise(p.balance)))
    return { amount: parties.reduce((s, p) => s + Math.abs(paise(p.balance)), 0) / 100, count: parties.length, parties }
  }
  return {
    collect: group((p, b) => b > 0 && onSide(p.type, 'customer')),
    pay: group((p, b) => b < 0 && onSide(p.type, 'supplier')),
    advance: group((p, b) => b < 0 && p.type === 'customer'),
    refund: group((p, b) => b > 0 && p.type === 'supplier'),
  }
}

/** Is this party in this chip, on this side? */
export function inChip(p: KhataParty, side: KhataSide, chip: KhataChip): boolean {
  const b = paise(p.balance)
  const owedToYou = b > 0, youOwe = b < 0
  switch (chip) {
    case 'all': return true
    case 'due': return side === 'customer' ? owedToYou : youOwe
    case 'old': return side === 'customer' && owedToYou && (p.oldestDays ?? 0) > OLD_DAYS
    case 'settled': return b === 0
    case 'advance': return side === 'customer' ? youOwe : owedToYou
  }
}

const digits = (s: string) => s.replace(/\D/g, '')

export function matchesSearch(p: KhataParty, q: string): boolean {
  const t = q.trim().toLowerCase()
  if (!t) return true
  if (p.name.toLowerCase().replace(/\s+/g, '').includes(t.replace(/\s+/g, ''))) return true
  if (p.gstin && p.gstin.toLowerCase().includes(t)) return true
  const d = digits(t)
  return d.length >= 3 && !!p.phone && digits(p.phone).includes(d)
}

/** The page, the counts of every chip and the side's totals — all over every party, never just the page. */
export function khataList(all: KhataParty[], opts: { side: KhataSide; chip: KhataChip; search: string; sort: KhataSort; offset: number; limit?: number }) {
  // #267: the walk-in khata (counter returns) is not a customer — kept out of the list and every count, sent on its own.
  const walkIn = all.find((p) => isWalkInParty(p)) ?? null
  const side = all.filter((p) => onSide(p.type, opts.side) && p !== walkIn)
  const searched = side.filter((p) => matchesSearch(p, opts.search))
  const counts = Object.fromEntries(KHATA_CHIPS.map((c) => [c, searched.filter((p) => inChip(p, opts.side, c)).length])) as Record<KhataChip, number>
  const rows = searched.filter((p) => inChip(p, opts.side, opts.chip))
  // Most owed first on either side: the customer who owes most, the supplier you owe most.
  const owedSize = (p: KhataParty) => (opts.side === 'customer' ? paise(p.balance) : -paise(p.balance))
  const byName = (a: KhataParty, b: KhataParty) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  const cmp: Record<KhataSort, (a: KhataParty, b: KhataParty) => number> = {
    balance: (a, b) => owedSize(b) - owedSize(a) || byName(a, b),
    name: byName,
    recent: (a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || byName(a, b),
    oldest: (a, b) => (b.oldestDays ?? -1) - (a.oldestDays ?? -1) || byName(a, b),
  }
  rows.sort(cmp[opts.sort])
  const limit = opts.limit ?? KHATA_PAGE
  // Totals of the whole side (search ignored): what the card above the list says — the
  // shared khataSides rule, so Home's card that opens this side shows the same rupees.
  const sides = khataSides(all)
  const owing = opts.side === 'customer' ? sides.collect : sides.pay
  return {
    rows: rows.slice(opts.offset, opts.offset + limit),
    matched: rows.length,
    hasMore: opts.offset + limit < rows.length,
    counts,
    totals: { amount: owing.amount, owing: owing.count, parties: side.length },
    // The counter-returns khata, customer side only, when it has ever been used.
    counter: opts.side === 'customer' && walkIn && ((walkIn.transactionCount ?? 0) > 0 || paise(walkIn.balance) !== 0)
      ? { id: walkIn.id, balance: walkIn.balance, transactionCount: walkIn.transactionCount ?? 0 }
      : null,
  }
}
