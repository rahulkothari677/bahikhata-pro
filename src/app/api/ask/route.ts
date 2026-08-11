import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { roundMoney } from '@/lib/money'
import { parseAsk, mustRefuse, ASK_EXAMPLES, type AskPeriod } from '@/lib/ask-patterns'
import { escapeLikeWildcards } from '@/lib/escape-like'
import { computePartyBalance, getReceivablePayable } from '@/lib/party-balance'
import { computeInvoiceDue } from '@/lib/invoice-due'
import { shouldHideProfit } from '@/lib/profit-visibility'
import { buildBalanceActions } from '@/lib/ask-actions'
import { describeParties } from '@/lib/describe-parties'
import { activeTransactionWhere } from '@/lib/query-helpers'
import { routeWithAi } from '@/lib/ask-router'
import { getCapability } from '@/lib/ask-capabilities'
import { buildNoticeLine } from '@/lib/ask-notice-line'
import { findDestinations } from '@/lib/nav-match'
import { NAV_REGISTRY, filterByPermissions } from '@/lib/nav-registry'

/**
 * "Ask your books" — A MODEL CHOOSES THE QUESTION. IT NEVER TOUCHES THE MONEY.
 *
 * (This header used to read "NO LANGUAGE MODEL IS INVOLVED", which was true
 * until P4.3 and is now not. Left visible rather than quietly reworded,
 * because the promise it was protecting has NOT changed — only which part of
 * the pipeline keeps it.)
 *
 * The question is matched against known shapes locally (lib/ask-patterns)
 * first. Only if no rule matches does a model see it, and all it returns is
 * WHICH capability was meant and with what arguments (lib/ask-router). The
 * ANSWER is computed here, from the same tables the screens read. Nothing is
 * generated: every figure below is arithmetic over rows.
 *
 * WHY THAT MATTERS MORE THAN ANY FEATURE IN THIS FILE. A model that produces
 * money figures will eventually produce a confident wrong one. Once is enough:
 * the shopkeeper who catches it stops trusting every other number in the app,
 * including the ones that took weeks to make provably correct. So the model
 * only ever translates the QUESTION. It never sees a rupee, and it never
 * emits one. If it misreads, the shopkeeper gets the wrong SCREEN — visible,
 * and labelled "read by AI" — rather than a wrong NUMBER, which is not.
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
function resolvePeriod(
  period: AskPeriod,
  custom?: { from?: string; to?: string },
): { from: Date; to: Date; label: string } {
  /*
   * An explicit range the shopkeeper gave us — "14 June to 27 July". The dates
   * were parsed and validated locally; here they are simply honoured.
   */
  if (period === 'custom' && custom?.from && custom?.to) {
    const from = new Date(custom.from)
    const to = new Date(custom.to)
    const d = (x: Date) => new Date(x.getTime() + IST_OFFSET_MS)
      .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    return { from, to, label: `${d(from)} to ${d(new Date(to.getTime() - 86_400_000))}` }
  }

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

    /*
     * PATTERNS FIRST, ALWAYS. They are instant, free, work with no signal and
     * cannot hallucinate. The model is for the long tail — the phrasings
     * nobody wrote a rule for — so the common questions never cost a paisa.
     */
    let q = parseAsk(question)

    /*
     * SOME QUESTIONS ARE REFUSED BEFORE A MODEL IS EVEN ASKED.
     *
     * Advice and predictions. `parseAsk` already returns null for both, but
     * null from the parser only means "no rule matched" — it is the same
     * signal as an unusual phrasing, so the model would take its turn and
     * answer. Adversarial testing caught it: "next month kitni sale hogi" came
     * back as "₹3,262.00 of sales this month", a forecast question answered
     * with history.
     *
     * Asking the model nicely in a prompt is a preference. Checking here is a
     * rule, and it also saves the call.
     */
    const refusal = mustRefuse(question)
    if (refusal) {
      return NextResponse.json({
        answered: false,
        question,
        message: refusal === 'prediction'
          ? 'I can only tell you what your books already record — I can’t predict what’s coming.'
          : refusal === 'bad_date'
            ? 'That date range doesn’t look right — check the dates and ask me again.'
            : 'I can show you the figures, but I can’t tell you what you should do.',
        examples: ASK_EXAMPLES,
      })
    }

    if (!q) {
      const routed = await routeWithAi(question)
      q = routed.query

      /*
       * Cost and latency are logged whether or not the answer was usable,
       * because a model that keeps returning nothing is a thing we need to
       * see. Fire-and-forget: a logging failure must never cost the shopkeeper
       * their answer.
       */
      if (routed.provider) {
        import('@/lib/ai-pricing').then(({ calculateCostInr }) => {
          db.aiUsageLog.create({
            data: {
              userId, feature: 'ask', provider: routed.provider!, model: routed.model!,
              inputTokens: routed.inputTokens || 0,
              outputTokens: routed.outputTokens || 0,
              totalTokens: (routed.inputTokens || 0) + (routed.outputTokens || 0),
              /*
               * ROUNDED, because `costInr` is an Int column — and that is a
               * real mismatch, logged as its own task rather than fixed here.
               *
               * calculateCostInr returns RUPEES AS A FLOAT ("@returns cost in
               * INR (paisa precision)"), and every reader formats it as rupees
               * — formatCostInr renders anything under ₹1 as paise. But the
               * column cannot hold ₹0.02. A routing call costs roughly 1–3
               * paise, so the honest value here rounds to zero.
               *
               * Passing the float unrounded is worse than useless: Prisma
               * rejects it, and the `.catch(() => {})` below swallows the
               * rejection, so the row is silently never written. scan-bill and
               * voice-parse pass it unrounded today.
               *
               * So: round, and record the truth about it. Token counts and
               * duration are still exact, which is what actually tells us
               * whether routing is behaving.
               */
              costInr: Math.round(calculateCostInr(
                routed.provider!, routed.model!, routed.inputTokens || 0, routed.outputTokens || 0,
              )),
              durationMs: routed.durationMs || 0,
              success: !!routed.query,
            },
          }).catch(() => {})
        }).catch(() => {})
      }
    }

    if (!q) {
      return NextResponse.json({
        answered: false,
        question,
        message: 'I can’t answer that one yet.',
        examples: ASK_EXAMPLES,
      })
    }

    /*
     * PERMISSION IS CHECKED AFTER ROUTING AND BY US, NEVER BY THE MODEL.
     *
     * The model is not told which module gates which capability — the registry
     * deliberately withholds that from the wire. It names a capability; we
     * decide whether THIS user may have it. Otherwise "show me the profit"
     * phrased cleverly enough becomes a way around a permission, and a staff
     * member who cannot open the P&L could read it out of a chat box.
     */
    const capability = getCapability(q.intent)
    if (capability && !canAccessModule(auth.role, auth.permissions, capability.module)) {
      return NextResponse.json({
        answered: false, question, understoodAs: q.understoodAs,
        message: 'You don’t have permission to see that in this shop.',
      })
    }

    const { from, to, label } = resolvePeriod(q.period, { from: q.customFrom, to: q.customTo })

    switch (q.intent) {
      /* ───────────────────────────── PARTY BALANCE ─────────────────── */
      case 'party_balance': {
        const name = q.partyName || ''
        /*
         * `deletedAt: null` IS NOT OPTIONAL, and leaving it out is what Rahul
         * hit: his Parties page listed one customer while Ask offered three to
         * choose between — the other two deleted, each with their phone number
         * and balance printed next to their name.
         *
         * A deleted party is deleted. Bringing one back inside a chat answer
         * republishes a contact the shopkeeper removed on purpose, and makes
         * Ask disagree with the screen it is supposed to be a shortcut to.
         * /api/parties has always filtered this way; this query simply never
         * copied it.
         */
        const parties = await db.party.findMany({
          where: {
            userId,
            deletedAt: null,
            name: { contains: escapeLikeWildcards(name), mode: 'insensitive' },
          },
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
        // Same omission as the balance lookup above: a deleted party must not
        // be named in the receivables or payables list either.
        const names = await db.party.findMany({
          where: { userId, deletedAt: null },
          // `type` too — see the wording note below. Without it this answer
          // guesses what someone is from which way their money points.
          select: { id: true, name: true, type: true }, take: 500,
        })
        const nameById = new Map(names.map(n => [n.id, n.name]))
        const typeById = new Map(names.map(n => [n.id, n.type]))
        const parties = [...partyBalances.entries()]
          .map(([id, v]) => ({
            id, name: nameById.get(id) || '(unnamed)',
            type: typeById.get(id), balance: v.balance,
          }))
          .filter(p => wantOwedToMe ? p.balance > 0.005 : p.balance < -0.005)
          .sort((a, b) => wantOwedToMe ? b.balance - a.balance : a.balance - b.balance)
          .slice(0, 20)
        const total = roundMoney(parties.reduce((s, p) => s + Math.abs(p.balance), 0))
        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: wantOwedToMe
            ? `${money(total)} is owed to you`
            : `You owe ${money(total)}`,
          /*
           * NAME THEM BY WHAT THEY ARE, not by which way their money points.
           *
           * This read `wantOwedToMe ? 'customer' : 'supplier'` — inferring the
           * relationship from the direction of the balance. Those are
           * independent, and the app already contains the counter-example:
           * Anil Kumar is a CUSTOMER whose credit notes exceed his bills, so
           * the shop owes him. "Total payables" called him "1 supplier".
           *
           * The same mistake as Settle's payment direction earlier today —
           * asking who somebody is instead of reading the fact recorded about
           * them. A shopkeeper who sees their customer described as a supplier
           * has been told something untrue about their own books.
           */
          detail: parties.length
            ? `Across ${parties.length} ${describeParties(parties)}. Largest first.`
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
        /*
         * GST IS FILED ONE MONTH AT A TIME, so a multi-month range cannot be
         * answered as a single GSTR-3B figure.
         *
         * "1 april to 30 june ka GST" returned "₹0.00 of GST payable for APRIL
         * 2026" while the caption above it read "1 Apr 2026 to 30 Jun 2026".
         * The label promised a quarter and the number was one month — the
         * caption and the figure disagreeing, which is the same defect as
         * calling a customer a supplier, in a place where it would be quoted
         * to a tax officer.
         *
         * Adding three months together would be worse: no such figure appears
         * on any return, so nobody could check it. Saying what we can do is
         * the only honest answer.
         */
        if (q.period === 'custom') {
          const a = new Date(from.getTime() + IST_OFFSET_MS)
          const lastDay = new Date(to.getTime() + IST_OFFSET_MS - 86_400_000)
          const sameMonth = a.getUTCFullYear() === lastDay.getUTCFullYear()
            && a.getUTCMonth() === lastDay.getUTCMonth()
          if (!sameMonth) {
            return NextResponse.json({
              answered: false, question, understoodAs: q.understoodAs,
              message: 'GST is filed one month at a time, so I can’t total it across a range. Ask me for a single month — “April ka GST” — and I’ll give you the figure that gets filed.',
            })
          }
        }

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

        /*
         * ── THE ANSWER CARRIES THE FILING RISK ────────────────────────
         *
         * Master plan §0: "Every competitor built a REGISTER that shows you
         * your numbers. We build a COMPLIANCE ENGINE that tells you whether
         * your numbers will survive the department."
         *
         * This answer was a register answer. It returned "₹112 of GST payable"
         * and stopped — the single most-asked GST question, answered exactly
         * as Vyapar would answer it, while the thing that makes us different
         * sat computed and unread on a screen most people never open.
         *
         * Rule 88C: GSTR-1 tax exceeding 3B by more than 20% AND more than
         * ₹25 lakh triggers DRC-01B automatically. Seven days to respond, and
         * then the next GSTR-1 is BLOCKED — which stops the shop's B2B
         * customers receiving input credit, so they stop buying. Vyapar sells
         * a separate product for this. We compute it already.
         *
         * CALLING THE ENDPOINT, NOT THE LIBRARY. assessNoticeRisk() needs the
         * GSTR-1 tax, the 3B tax, the claimed ITC and the imported 2B totals.
         * /api/notice-risk assembles all four. Importing the library here and
         * re-assembling those inputs would be a SECOND thing deciding notice
         * risk, and the answer would drift from the panel — rule B6, and the
         * shape of four bugs already fixed this week.
         *
         * A failure here must never cost the shopkeeper their tax figure, so
         * the risk block is additive and the answer survives without it.
         */
        /*
         * The wording lives in lib/ask-notice-line so all three states can be
         * tested — a real `notice` needs GSTR-1 to exceed 3B by over ₹25 lakh,
         * so it could never be reached from this shop's books.
         *
         * The ASSESSMENT is not made here. /api/notice-risk assembles the
         * GSTR-1 tax, the 3B tax, the claimed ITC and the imported 2B totals
         * and applies Rule 88C/88D. One thing decides risk; this only speaks.
         *
         * Wrapped, because a failure fetching the risk must never cost the
         * shopkeeper their tax figure. No note is honest; a broken answer is not.
         */
        let notice = buildNoticeLine(null)
        try {
          const rr = await fetch(`${origin}/api/notice-risk?month=${month}`, {
            headers: { cookie: req.headers.get('cookie') || '' }, cache: 'no-store',
          })
          if (rr.ok) {
            const risk = await rr.json()
            notice = buildNoticeLine({
              overall: risk.overall,
              rule: (risk.rules || []).find((x: any) => x.rule === '88C') || (risk.rules || [])[0] || null,
            })
          }
        } catch { /* leave it unassessed — see above */ }

        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: `${money(net)} of GST payable for ${g3.period?.monthLabel || month}`,
          detail: [
            notice.line,
            `Output tax ${money(g3.totalOutputTax || 0)} less credit notes ${money(g3.totalCreditNoteTax || 0)} and input credit ${money(g3.totalItc || 0)}. This is the GSTR-3B figure.`,
          ].filter(Boolean).join('\n\n'),
          actions: notice.action ? [notice.action] : undefined,
          sources: [],
        })
      }

      /* ────────────────────── EXPENSES (running costs) ─────────────── */
      case 'expenses_period': {
        /*
         * WHAT THIS COUNTS, and why it is not "everything that left the till".
         *
         * `type: 'expense'` only — rent, salary, electricity. Buying stock is a
         * PURCHASE and has its own capability, because a shopkeeper does not
         * think of them as the same thing and neither does the P&L: purchases
         * become cost of goods sold, expenses sit below the gross-profit line.
         * Adding them together would produce a number that appears on no
         * report we publish, which is the definition of a figure nobody can
         * check.
         *
         * activeTransactionWhere, not a hand-written where clause: it puts
         * userId and deletedAt LAST so neither can be overridden, and it is
         * the same helper the reports use. Rule G8 — a deleted record stays
         * deleted everywhere.
         */
        const rows = await db.transaction.findMany({
          where: activeTransactionWhere(userId, { type: 'expense', date: { gte: from, lt: to } }),
          select: { id: true, category: true, totalAmount: true, date: true, notes: true },
          orderBy: { date: 'desc' },
          take: 200,
        })

        /*
         * A NAMED CATEGORY IS RESOLVED, NEVER ASSUMED.
         *
         * "kitni salary di" narrows to one category. If the shop has no
         * category by that name we say so — exactly as the stock answer says
         * "no stocked product named rice" rather than quietly widening to
         * every product. Silently answering the broader question would hand
         * back a bigger number under the label the user asked for, which is
         * the wrong-subject bug all over again.
         */
        const wanted = q.categoryName?.toLowerCase()
        const matching = wanted
          ? rows.filter(r => (r.category || '').toLowerCase().includes(wanted))
          : rows

        if (wanted && matching.length === 0) {
          const known = [...new Set(rows.map(r => r.category).filter(Boolean))]
          return NextResponse.json({
            answered: false, question, understoodAs: q.understoodAs,
            message: known.length
              ? `No “${q.categoryName}” spending recorded ${label}. Recorded categories: ${known.join(', ')}.`
              : `No expenses recorded ${label} at all.`,
          })
        }

        const total = roundMoney(matching.reduce((s, r) => s + r.totalAmount, 0))

        // Where the money went, as words. The breakdown is what a shopkeeper
        // acts on, but it belongs in the sentence — see below for why it is
        // not the receipts.
        const byCategory = new Map<string, number>()
        for (const r of matching) {
          const key = r.category || 'Uncategorised'
          byCategory.set(key, roundMoney((byCategory.get(key) || 0) + r.totalAmount))
        }
        const groups = [...byCategory.entries()].sort((a, b) => b[1] - a[1])
        const breakdown = groups.map(([n, v]) => `${n} ${money(v)}`).join(', ')

        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: `${money(total)} spent ${label}`,
          detail: matching.length
            ? wanted
              ? `Across ${matching.length} ${q.categoryName} entr${matching.length === 1 ? 'y' : 'ies'}. Running costs only — buying stock is counted separately.`
              : `${breakdown}. Running costs only — buying stock is counted separately.`
            : `Nothing recorded ${label}.`,
          /*
           * REAL DOCUMENTS, NOT CATEGORY TOTALS.
           *
           * This first shipped grouped by category, with ids like
           * "category:Rent" and a comment claiming the tap would fall back to
           * the income-and-expense screen. It does not — the client sets that
           * string as a transaction id and navigates, so tapping "Rent ₹5,000"
           * landed on "Transaction not found".
           *
           * I had verified this answer against a shop with NO expenses, where
           * there were no rows to tap and the bug could not appear. Rahul's
           * instruction to record the data and re-check is what surfaced it.
           *
           * Receipts are the promise of this feature: every figure opens the
           * document behind it. A category total has no document. So the rows
           * are the actual expense entries — the same shape sales and
           * purchases already use — and the category breakdown moved into the
           * sentence above, where it reads better anyway.
           */
          sources: matching.slice(0, 10).map(r => ({
            kind: 'transaction' as const,
            id: r.id,
            label: r.category || 'Uncategorised',
            amount: r.totalAmount,
            date: r.date,
          })),
        })
      }

      /* ────────────────────── PURCHASES (buying stock) ─────────────── */
      case 'purchases_period': {
        // Purchases net of debit notes, mirroring how sales are shown net of
        // credit notes. Anything else and the two answers would not be
        // comparable, which is the first thing a shopkeeper does with them.
        const rows = await db.transaction.findMany({
          where: activeTransactionWhere(userId, { type: 'purchase', date: { gte: from, lt: to } }),
          select: { id: true, invoiceNo: true, date: true, totalAmount: true },
          orderBy: { date: 'desc' },
          take: 50,
        })
        const returns = await db.transaction.aggregate({
          where: activeTransactionWhere(userId, { type: 'debit-note', date: { gte: from, lt: to } }),
          _sum: { totalAmount: true },
        })
        const gross = roundMoney(rows.reduce((s, r) => s + r.totalAmount, 0))
        const returned = roundMoney(returns._sum.totalAmount || 0)

        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: `${money(gross - returned)} of purchases ${label}`,
          detail: returned > 0
            ? `${rows.length} bill${rows.length === 1 ? '' : 's'} totalling ${money(gross)}, less ${money(returned)} returned. Includes GST.`
            : `${rows.length} bill${rows.length === 1 ? '' : 's'}. Includes GST. This is stock bought — running costs are counted separately.`,
          sources: rows.slice(0, 10).map(r => ({
            kind: 'transaction' as const, id: r.id,
            label: r.invoiceNo || '(no number)', amount: r.totalAmount, date: r.date,
          })),
        })
      }

      /* ────────────────────── OPEN A SCREEN ────────────────────────── */
      case 'open_screen': {
        const asked = q.screenName || ''
        /*
         * PERMISSIONS ARE APPLIED BEFORE MATCHING, not after.
         *
         * Filtering the results would still have searched a list containing
         * screens this user may not open — and with a choice list, would show
         * their names. A command must not become a way to enumerate what the
         * menus deliberately hide.
         *
         * Feature flags are NOT evaluated here: they live in the client store
         * and the server has no view of them. The client checks those again
         * before navigating, so each side filters on what it actually knows.
         */
        const allowed = filterByPermissions(NAV_REGISTRY, {
          canAccess: (m) => canAccessModule(auth.role, auth.permissions, m),
          isFlagEnabled: () => true,
          isOwner: auth.role === 'owner',
        })
        const allowedIds = new Set(allowed.map(d => d.id))
        const matches = findDestinations(asked).filter(m => allowedIds.has(m.destination.id))

        if (matches.length === 0) {
          return NextResponse.json({
            answered: false, question, understoodAs: q.understoodAs,
            message: `I couldn’t find a screen called “${asked}”.`,
            examples: ASK_EXAMPLES,
          })
        }

        if (matches.length > 1) {
          /*
           * Several screens fit. Offer them rather than picking — the same
           * treatment two customers named Ramesh get. "profit and loss"
           * legitimately means either the P&L Statement or the Reports hub.
           */
          return NextResponse.json({
            answered: false, question, understoodAs: q.understoodAs,
            message: `Which one did you mean?`,
            choices: matches.map(m => ({ id: m.destination.id, name: m.destination.label })),
          })
        }

        const dest = matches[0].destination
        /*
         * CARRY THE PERIOD, when one was named. "pichhle mahine ki P&L" should
         * land on the P&L already showing last month — opening the report and
         * leaving the shopkeeper to change the date picker is half the job.
         *
         * The dates are sent, not a preset name: which preset (if any) matches
         * exactly is decided on the client, where the picker's own definitions
         * live. See lib/ask-period-preset for why "this week" and "this FY"
         * deliberately map to no preset at all.
         */
        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: `Opening ${dest.label}`,
          detail: dest.description || undefined,
          navigate: {
            kind: 'screen' as const, destinationId: dest.id, label: dest.label,
            ...(q.period !== 'all_time'
              ? { period: q.period, from: from.toISOString(), to: to.toISOString() }
              : {}),
          },
          sources: [],
        })
      }

      /* ────────────────────── OPEN ONE BILL ────────────────────────── */
      case 'open_invoice': {
        const no = q.invoiceNo?.trim()
        const partyName = q.partyName?.trim()

        /*
         * The filter is written INSIDE the call rather than built into a
         * variable above it, on purpose. The soft-delete sweep reads each
         * query's own arguments — a `where` assembled elsewhere is invisible
         * to it, and it flagged this line for exactly that reason. Making the
         * guard able to see the filter is worth two extra lines.
         */
        const extra = no
          ? { invoiceNo: { equals: no, mode: 'insensitive' as const } }
          : { party: { is: { name: { contains: escapeLikeWildcards(partyName || ''), mode: 'insensitive' as const }, deletedAt: null } } }

        // Newest first, so "Anil ka last bill" means his LAST one.
        const bill = await db.transaction.findFirst({
          where: activeTransactionWhere(userId, extra),
          orderBy: { date: 'desc' },
          select: { id: true, invoiceNo: true, type: true, totalAmount: true, date: true, party: { select: { name: true } } },
        })

        if (!bill) {
          return NextResponse.json({
            answered: false, question, understoodAs: q.understoodAs,
            message: no
              ? `No bill numbered “${no}”. Check the number, or open the ledger to browse.`
              : `No bills found for “${partyName}”.`,
          })
        }

        const label = bill.invoiceNo || '(no number)'
        return NextResponse.json({
          answered: true, question, understoodAs: q.understoodAs,
          headline: `Opening ${label}`,
          detail: `${bill.party?.name || 'Walk-in'} · ${money(bill.totalAmount)}`,
          navigate: { kind: 'record' as const, transactionId: bill.id, label },
          sources: [{ kind: 'transaction' as const, id: bill.id, label, amount: bill.totalAmount, date: bill.date }],
        })
      }
    }

    return NextResponse.json({ answered: false, question, message: 'I can’t answer that one yet.', examples: ASK_EXAMPLES })
  } catch (err) {
    return apiError(err, 'Could not answer that', 500)
  }
}
