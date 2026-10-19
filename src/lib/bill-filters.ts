/**
 * The Bills list's filters — ONE reading of the request, two renderings: the
 * Prisma `where` the list pages through, and the SQL the period totals sum
 * over (Phase 5d-1, #184). Two definitions of "which bills" would disagree;
 * this is the only one.
 *
 * #184: the Sales list's "Total sales" was summed over the rows loaded so far
 * (50 a page), so saving an estimate pushed a sale out of the first page and
 * the total fell from ₹47,655.84 to ₹46,707.76 with nothing sold. Totals now
 * come from the database for every bill these filters select.
 */
import { Prisma } from '@prisma/client'
import { escapeLikeWildcards } from './escape-like'
import { DUE_SQL } from './invoice-due-sql'

export interface BillFilters {
  types: string[]
  voided: boolean
  from: Date | null
  to: Date | null
  /** Already escaped for LIKE (escapeLikeWildcards); '' when no search. */
  search: string
  /**
   * Only bills still due after later settlements (the Bills "Unpaid" chip,
   * 5d-2). SQL only — the rule compares a bill with its settlements (DUE_SQL),
   * which Prisma's where cannot express; the list route selects ids in SQL.
   */
  unpaid: boolean
}

/** The fields a bill search looks in — both renderings use this list. */
export const SEARCH_FIELDS = ['invoiceNo', 'notes', 'partyName', 'partyPhone'] as const

export function parseBillFilters(sp: URLSearchParams): BillFilters {
  const type = sp.get('type')
  const types = type && type !== 'all' ? type.split(',').map((t) => t.trim()).filter(Boolean) : []
  const date = (s: string | null) => {
    if (!s) return null
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return {
    types,
    voided: sp.get('voided') === 'true',
    from: date(sp.get('from')),
    to: date(sp.get('to')),
    search: escapeLikeWildcards((sp.get('search') || '').trim()),
    unpaid: sp.get('status') === 'unpaid',
  }
}

/** The Prisma where for the list (the keyset cursor is added by the caller). */
export function billWhere(userId: string, f: BillFilters): Record<string, any> {
  const where: Record<string, any> = f.voided ? { userId, deletedAt: { not: null } } : { userId, deletedAt: null }
  if (f.types.length === 1) where.type = f.types[0]
  else if (f.types.length > 1) where.type = { in: f.types }
  if (f.from || f.to) {
    where.date = {}
    if (f.from) where.date.gte = f.from
    if (f.to) where.date.lte = f.to
  }
  if (f.search) {
    const match: Record<(typeof SEARCH_FIELDS)[number], Record<string, any>> = {
      invoiceNo: { invoiceNo: { contains: f.search, mode: 'insensitive' } },
      notes: { notes: { contains: f.search, mode: 'insensitive' } },
      partyName: { party: { name: { contains: f.search, mode: 'insensitive' } } },
      partyPhone: { party: { phone: { contains: f.search } } },
    }
    where.AND = [{ OR: SEARCH_FIELDS.map((k) => match[k]) }]
  }
  return where
}

/**
 * The same selection as SQL, for `FROM "Transaction" t LEFT JOIN "Party" p ON p."id" = t."partyId"`
 * (plus ALLOCATED_JOIN when `unpaid` is set). Tenant first, always ANDed.
 */
export function billWhereSql(userId: string, f: BillFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`t."userId" = ${userId}`, f.voided ? Prisma.sql`t."deletedAt" IS NOT NULL` : Prisma.sql`t."deletedAt" IS NULL`]
  if (f.types.length > 0) parts.push(Prisma.sql`t."type" IN (${Prisma.join(f.types)})`)
  if (f.from) parts.push(Prisma.sql`t."date" >= ${f.from}`)
  if (f.to) parts.push(Prisma.sql`t."date" <= ${f.to}`)
  if (f.search) {
    const like = `%${f.search}%`
    const match: Record<(typeof SEARCH_FIELDS)[number], Prisma.Sql> = {
      invoiceNo: Prisma.sql`t."invoiceNo" ILIKE ${like}`,
      notes: Prisma.sql`t."notes" ILIKE ${like}`,
      partyName: Prisma.sql`p."name" ILIKE ${like}`,
      partyPhone: Prisma.sql`p."phone" LIKE ${like}`,
    }
    parts.push(Prisma.sql`(${Prisma.join(SEARCH_FIELDS.map((k) => match[k]), ' OR ')})`)
  }
  if (f.unpaid) parts.push(Prisma.sql`${DUE_SQL} > 0`)
  return Prisma.join(parts, ' AND ')
}
