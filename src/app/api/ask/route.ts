import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { roundMoney } from '@/lib/money'
import { parseAsk, ASK_EXAMPLES, type AskPeriod } from '@/lib/ask-patterns'
import { escapeLikeWildcards } from '@/lib/escape-like'
import { computePartyBalance, getReceivablePayable } from '@/lib/party-balance'
import { computeInvoiceDue } from '@/lib/invoice-due'
import { shouldHideProfit } from '@/lib/profit-visibility'
import { buildBalanceActions } from '@/lib/ask-actions'

/**
 * "Ask your books" — Phase 1. NO LANGUAGE MODEL IS INVOLVED.
 *
 * The question is matched against known shapes locally (lib/ask-patterns), and
 * the ANSWER is computed here, from the same tables the screens read. Nothing
 * is generated: every figure below is arithmetic over rows.
 *
 * WHY THAT MATTERS MORE THAN ANY FEATURE IN THIS FILE. A model that produces
 * money figures will eventually produce a confident wrong one. Once is enough:
 * the shopkeeper who catches it stops trusting every other number in the app,
 * including the ones that took weeks to make provably correct. So the model —
 * when Phase 2 adds one — will only ever translate the QUESTION. It will never
 * see a rupee, and it will never emit one.
 *
 * EVERY ANSWER CARRIES ITS RECEIPTS. `sources` lists the actual documents
 * behind the figure so the user can tap through and check. A number a
 * shopkeeper cannot trace is a number they have to take on faith, and this app
 * does not ask for faith.
 *
 * REFUSING IS A SUPPORTED OUTCOME, not an error. `answered: false` with
 * examples is a correct response to "what is the weather".
 */
export const maxDuration = 30

/** IST is UTC+5:30; the books are kept in IST days. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** Resolve a named period to a real [from, to) in UTC, on IST day boundaries. */
function resolvePeriod(period: AskPeriod): { from: Date; to: Date; label: string } {
  const nowIst = new Date(Date.now() + IST_OFFSET_MS)
  const y = nowIst.getUTCFullYear()
  const m = nowIst.getUTCMonth()
  const d = nowIst.getUTCDate()
  const istDay = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd) - IST_OFFSET_MS)

  switch (period) {
    case 'today': return { from: istDay(y, m, d), to: istDay(y, m, d + 1), label: 'today' }
    case 'yesterday': return { from: istDay(y, m, d - 1), to: istDay(y, m, d), label: 'yesterday' }
    case 'this_week': {
      const dow = nowIst.getUTCDay()           // 0 = Sunday
      const monOffset = dow === 0 ? 6 : dow - 1
      return { from: istDay(y, m, d - monOffset), to: istDay(y, m, d + 1), label: 'this week' }
    }
    case 'this_month': return { from: istDay(y, m, 1), to: istDay(y, m + 1, 1), label: 'this month' }
    case 'last_month': return { from: istDay(y, m - 1, 1), to: istDay(y, m, 1), label: 'last month' }
    case 'this_fy': {
      const fyStart = m >= 3 ? y : y - 1       // April = month index 3
      return { from: istDay(fyStart, 3, 1), to: istDay(fyStart + 1, 3, 1), label: 'this financial year' }
    }
    default: return { from: new Date(0), to: istDay(y, m, d + 1), label: 'all time' }
  }
}

const money = (n: number) => `₹${roundMoney(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * "3 days ago" / "2 months ago" — how people place a customer in time.
 *
 * A date ("09/08/2026") makes the reader do arithmetic; "last week" is what
 * they already remember. Used only to help tell two same-named people apart,
 * so approximate is not merely acceptable, it is the point.
 */
function relativeDay(d: Date): string {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`
  if (days < 365) return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`
  return `${Math.floor(days / 365)} year${days < 730 ? '' : 's'} ago`
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext()
    if (auth.error || !auth.userId) return auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(auth.role, auth.permissions, 'reports')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = auth.userId

    const body = await req.json().catch(() => ({}))
    const question = typeof body.question === 'string' ? body.question : ''
    if (!question.trim()) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 })
    }

    const q = parseAsk(question)
    if (!q) {
      return NextResponse.json({
        answered: false,
        question,
        message: 'I can’t answer that one yet.',
        examples: ASK_EXAMPLES,
      })
    }

    const { from, to, label } = resolvePeriod(q.period)

    switch (q.intent) {
      /* ───────────────────────────── PARTY BALANCE ─────────────────── */
      case 'party_balance': {
        const name = q.partyName || ''
        const parties = await db.party.findMany({
          where: { userId, name: { contains: escapeLikeWildcards(name), mode: 'insensitive' } },
          select: { id: true, name: true, type: true, phone: true },
          take: 5,
        })
        if (parties.length === 0) {
          return NextResponse.json({
            answered: false, question, understoodAs: q.understoodAs,
            message: `No customer or supplier named “${name}”. Check the spelling, or add them first.`,
          })
        }
        /*
         * MORE THAN ONE MATCH: ASK, NEVER PICK.
         *
         * And a bare list of identical names is no better than picking — two
         * customers called Ramesh tell the shopkeeper nothing. So each choice
         * carries the things people actually remember someone by: their phone,
         * what they owe, and WHEN YOU LAST DEALT WITH THEM. "The Ramesh I saw
         * last week" is how this recall actually works.
         *
         * Costs one extra query on a path that only runs when there IS an
         * ambiguity, which is rare — and being fast is worth nothing here if
         * the shopkeeper cannot tell the two apart.
         */
        if (parties.length > 1) {
          const enriched = await Promise.all(parties.map(async p => {
            const [stats, last] = await Promise.all([
              computePartyBalance(userId, p.id),
              db.transaction.findFirst({
                where: { userId, deletedAt: null, partyId: p.id },
                select: { invoiceNo: true, date: true },
                orderBy: { date: 'desc' },
              }),
            ])
            return {
              id: p.id,
              name: p.name,
              phone: p.phone,
              balance: stats.balance,
              lastInvoiceNo: last?.invoiceNo ?? null,
              lastActivity: last?.date ? relativeDay(last.date) : null,
            }
          }))
          return NextResponse.json({
            answered: false, question, understoodAs: q.understoodAs,
            message: `${enriched.length} matches for “${name}”. Which one?`,
            choices: enriched,
          })
        }
        const p = parties[0]
        /*
         * `balance` is NOT a column — it is computed, and computePartyBalance
         * is the one implementation every screen already uses. Typecheck
         * caught me selecting it as though it were stored, which is exactly
         * the mistake worth catching: a second, hand-rolled balance formula
         * would drift from the party screen and the shopkeeper would be shown
         * two different truths about the same customer.
         *
         * Same for a bill's due. computeInvoiceDue folds in the payment
         * allocations, which are a separate table — subtracting paidAmount
         * alone would call a settled bill unpaid.
         */
        const stats = await computePartyBalance(userId, p.id)
        const bills = await db.transaction.findMany({
          where: { userId, deletedAt: null, partyId: p.id, type: { in: ['sale', 'purchase'] } },
          select: {
            id: true, invoiceNo: true, date: true, totalAmount: true, paidAmount: true, type: true,
            paymentAllocations: { select: { amount: true } },
          },
          orderBy: { date: 'desc' },
          take: 20,
        })
        const withDue = bills.map(b => ({
          ...b,
          due: computeInvoiceDue({
            totalAmount: b.totalAmount,
            paidAmount: b.paidAmount,
            allocatedAmount: b.paymentAllocations.reduce((s, a) => s + a.amount, 0),
          }),
        }))
        const unpaid = withDue.filter(b => b.due > 0.005)
        const owed = stats.balance

        /*
         * WHAT TO DO ABOUT IT — Phase 2.2.
         *
         * The answer already tells the shopkeeper Anil owes ₹1,025. They asked
         * because they intend to do something about it, and we know what: chase
         * it, or record what came in. So the button goes on the answer.
         *
         * DIRECTION DECIDES THE VERBS, and getting this wrong is not cosmetic —
         * offering "send reminder" on a supplier would have us nagging someone
         * we owe money to. Positive balance means they owe us; negative means we
         * owe them, and then the only sane action is recording what we paid.
         *
         * A REMINDER NEEDS A PHONE NUMBER. Without one the endpoint has nowhere
         * to send it, so the button is not offered rather than offered and then
         * failing — a dead button teaches the shopkeeper not to trust the row.
         *
         * SETTLE AGAINST A SPECIFIC BILL when there is exactly one unpaid, which
         * is what PartyBills does. With several, we deliberately do NOT choose:
         * allocating a payment to the wrong invoice is a real accounting error,
         * and the Settle page already lets them pick.
         *
         * The 0.005 threshold is half a paisa — the same rounding guard used on
         * `unpaid` two lines up, so a balance of exactly zero never offers a
         * payment button.
         */
        const actions = buildBalanceActions({
          partyId: p.id,
          phone: p.phone,
          balance: owed,
          unpaid: unpaid.map(b => ({ id: b.id, invoiceNo: b.invoiceNo, due: b.due })),
        })

        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: owed >= 0
            ? `${p.name} owes you ${money(owed)}`
            : `You owe ${p.name} ${money(Math.abs(owed))}`,
          detail: unpaid.length
            ? `Across ${unpaid.length} unpaid bill${unpaid.length === 1 ? '' : 's'}.`
            : 'No unpaid bills — this is the running account balance.',
          sources: unpaid.map(b => ({
            kind: 'transaction', id: b.id,
            label: b.invoiceNo || '(no number)',
            amount: b.due,
            date: b.date,
          })),
          actions,
        })
      }

      /* ───────────────────────────── SALES ─────────────────────────── */
      case 'sales_period': {
        const rows = await db.transaction.findMany({
          where: { userId, deletedAt: null, type: 'sale', date: { gte: from, lt: to } },
          select: { id: true, invoiceNo: true, date: true, totalAmount: true },
          orderBy: { date: 'desc' },
          take: 50,
        })
        const notes = await db.transaction.aggregate({
          where: { userId, deletedAt: null, type: 'credit-note', date: { gte: from, lt: to } },
          _sum: { totalAmount: true }, _count: true,
        })
        const gross = rows.reduce((s, r) => s + r.totalAmount, 0)
        const returned = notes._sum.totalAmount || 0
        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: `${money(gross - returned)} of sales ${label}`,
          detail: returned > 0
            ? `${rows.length} bill${rows.length === 1 ? '' : 's'} totalling ${money(gross)}, less ${money(returned)} returned. Includes GST.`
            : `${rows.length} bill${rows.length === 1 ? '' : 's'}. Includes GST.`,
          sources: rows.slice(0, 10).map(r => ({
            kind: 'transaction', id: r.id, label: r.invoiceNo || '(no number)', amount: r.totalAmount, date: r.date,
          })),
        })
      }

      /* ───────────────────────────── PROFIT ────────────────────────── */
      case 'profit_period': {
        /*
         * A NEW DOOR TO AN OLD SECRET.
         *
         * Staff can be set to "hide profit" — the reports strip cost and
         * margin for them, because sale price minus cost price is the shop's
         * commercial position and not a counter assistant's business. This
         * route opened a way straight past that: the staff member simply ASKS
         * "is mahine ka profit" and gets the number the reports refuse them.
         *
         * The repo's own profit-leak sweep caught it, which is exactly what
         * that guard is for — every new route that can emit a margin is a
         * fresh chance to leak one.
         *
         * Refusing is right rather than returning zero: a zero would be a
         * lie, and staff should know the answer exists and is not theirs.
         */
        if (await shouldHideProfit(userId, auth.role)) {
          return NextResponse.json({
            answered: false, question, understoodAs: q.understoodAs,
            message: 'Profit figures are not shown on your login. Ask the shop owner.',
          })
        }
        /*
         * THE SIGN IS ALREADY IN THE STORED VALUE. Do not apply it twice.
         *
         * A credit note's grossProfit is persisted NEGATIVE (a ₹1,000 return
         * stores −1000). I first wrote `sales − notes`, which turned the
         * subtraction into an addition and reported ₹3,880 where the P&L said
         * ₹1,740 — the same month, two screens, two answers.
         *
         * Caught by checking this answer against the P&L on live data, which
         * is the rule this feature lives by: an answer must agree with the
         * screen it came from, to the paisa. Same family as the GSTR-9
         * double-subtraction — assuming a sign that had already been applied.
         *
         * So: one aggregate over sales AND credit notes together, letting the
         * stored signs do the work.
         */
        const sales = await db.transaction.aggregate({
          where: { userId, deletedAt: null, type: { in: ['sale', 'credit-note'] }, date: { gte: from, lt: to } },
          _sum: { grossProfit: true }, _count: true,
        })
        const saleCount = await db.transaction.count({
          where: { userId, deletedAt: null, type: 'sale', date: { gte: from, lt: to } },
        })
        const profit = roundMoney(sales._sum.grossProfit || 0)
        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: `${money(profit)} gross profit ${label}`,
          detail: `From ${saleCount} sale${saleCount === 1 ? '' : 's'}, net of returns. Sale price less cost price, before expenses and excluding GST.`,
          sources: [],
        })
      }

      /* ─────────────────────── RECEIVABLES / PAYABLES ──────────────── */
      case 'receivables':
      case 'payables': {
        const wantOwedToMe = q.intent === 'receivables'
        /*
         * getReceivablePayable is the ONE implementation the dashboard and the
         * parties screen already use. It exists because a naive multi-JOIN
         * produced a Cartesian product — a party with T bills and P payments
         * gave T×P rows and a multiplied total. Writing my own query here
         * would have been a fresh opportunity to reintroduce exactly that.
         */
        const { partyBalances } = await getReceivablePayable(userId)
        const names = await db.party.findMany({
          where: { userId }, select: { id: true, name: true }, take: 500,
        })
        const nameById = new Map(names.map(n => [n.id, n.name]))
        const parties = [...partyBalances.entries()]
          .map(([id, v]) => ({ id, name: nameById.get(id) || '(unnamed)', balance: v.balance }))
          .filter(p => wantOwedToMe ? p.balance > 0.005 : p.balance < -0.005)
          .sort((a, b) => wantOwedToMe ? b.balance - a.balance : a.balance - b.balance)
          .slice(0, 20)
        const total = roundMoney(parties.reduce((s, p) => s + Math.abs(p.balance), 0))
        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: wantOwedToMe
            ? `${money(total)} is owed to you`
            : `You owe ${money(total)}`,
          detail: parties.length
            ? `Across ${parties.length} ${wantOwedToMe ? 'customer' : 'supplier'}${parties.length === 1 ? '' : 's'}. Largest first.`
            : 'Nobody has an outstanding balance.',
          sources: parties.slice(0, 10).map(p => ({
            kind: 'party', id: p.id, label: p.name, amount: Math.abs(p.balance),
          })),
        })
      }

      /* ───────────────────────────── TOP PRODUCTS ──────────────────── */
      case 'top_products': {
        const items = await db.transactionItem.findMany({
          where: { transaction: { userId, deletedAt: null, type: 'sale', date: { gte: from, lt: to } } },
          select: { productId: true, productName: true, quantity: true, total: true },
          take: 2000,
        })
        const byProduct = new Map<string, { name: string; qty: number; value: number }>()
        for (const it of items) {
          const key = it.productId || it.productName
          const prev = byProduct.get(key)
          byProduct.set(key, {
            name: it.productName,
            qty: (prev?.qty || 0) + (it.quantity || 0),
            value: roundMoney((prev?.value || 0) + (it.total || 0)),
          })
        }
        const top = [...byProduct.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 5)
        if (top.length === 0) {
          return NextResponse.json({
            answered: true, question, understoodAs: q.understoodAs,
            headline: `No sales ${label}`, detail: 'Nothing was sold in this period.', sources: [],
          })
        }
        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: `${top[0][1].name} sold most ${label}`,
          detail: `${money(top[0][1].value)} from ${top[0][1].qty} sold. Top ${top.length} below, by value.`,
          sources: top.map(([id, v]) => ({ kind: 'product', id, label: v.name, amount: v.value, quantity: v.qty })),
        })
      }

      /* ───────────────────────────── STOCK ─────────────────────────── */
      case 'stock_item': {
        const where: Record<string, unknown> = { userId, tracksInventory: true }
        if (q.itemName) where.name = { contains: escapeLikeWildcards(q.itemName), mode: 'insensitive' }
        const products = await db.product.findMany({
          where: where as never,
          select: { id: true, name: true, currentStock: true, unit: true, lowStockThreshold: true },
          orderBy: { currentStock: 'asc' },
          take: 10,
        })
        if (products.length === 0) {
          return NextResponse.json({
            answered: false, question, understoodAs: q.understoodAs,
            message: q.itemName
              ? `No stocked product named “${q.itemName}”. Services are not counted — they have no stock.`
              : 'No stocked products yet.',
          })
        }
        const p = products[0]
        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: q.itemName
            ? `${p.name}: ${p.currentStock} ${p.unit} left`
            : `${products.length} product${products.length === 1 ? '' : 's'}, lowest stock first`,
          detail: q.itemName && p.currentStock <= p.lowStockThreshold
            ? `That is at or below your alert level of ${p.lowStockThreshold} ${p.unit}.`
            : 'Services are excluded — they have no stock to count.',
          sources: products.map(x => ({ kind: 'product', id: x.id, label: x.name, quantity: x.currentStock, unit: x.unit })),
        })
      }

      /* ───────────────────────────── TAX ───────────────────────────── */
      case 'tax_due': {
        // Ask the GSTR-3B route rather than recomputing: the answer must be
        // the number that will actually be filed, not a second opinion.
        const monthIst = new Date(from.getTime() + IST_OFFSET_MS)
        const month = `${monthIst.getUTCFullYear()}-${String(monthIst.getUTCMonth() + 1).padStart(2, '0')}`
        const origin = new URL(req.url).origin
        const r = await fetch(`${origin}/api/gstr-3b?month=${month}`, {
          headers: { cookie: req.headers.get('cookie') || '' }, cache: 'no-store',
        })
        if (!r.ok) throw new Error(`gstr-3b returned ${r.status}`)
        const g3 = await r.json()
        const net = g3.netTaxPayable || 0
        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: `${money(net)} of GST payable for ${g3.period?.monthLabel || month}`,
          detail: `Output tax ${money(g3.totalOutputTax || 0)} less credit notes ${money(g3.totalCreditNoteTax || 0)} and input credit ${money(g3.totalItc || 0)}. This is the GSTR-3B figure.`,
          sources: [],
        })
      }
    }

    return NextResponse.json({ answered: false, question, message: 'I can’t answer that one yet.', examples: ASK_EXAMPLES })
  } catch (err) {
    return apiError(err, 'Could not answer that', 500)
  }
}
