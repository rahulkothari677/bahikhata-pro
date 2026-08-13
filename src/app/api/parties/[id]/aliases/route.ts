import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext } from '@/lib/get-auth'
import { canAccessModule } from '@/lib/staff-permissions'
import { apiError } from '@/lib/api-error'
import { canLearnAlias } from '@/lib/can-learn-alias'

/**
 * The names THIS shop uses for a party — C2c.
 *
 * ── NOTHING HERE TOUCHES MONEY, AND THAT IS LOAD-BEARING ──────────────
 *
 * PartyAlias has no money columns and no Prisma money handler, so a query
 * rooted here would hand back raw paise for any Party it included. The
 * money-relations guard let this table through on one condition, recorded in
 * its exemption: **alias reads never include money fields.** So every select
 * below is ids, names and dates. A balance is read from Party, directly, the
 * way the rest of the app already does it.
 *
 * ── WHY THERE IS NO "ADD ALIAS" FORM ──────────────────────────────────
 *
 * POST exists for the app to call after a shopkeeper CONFIRMS a choice —
 * "which Ramesh?" answered by tapping one. Learning from a decision they were
 * already making costs them nothing; a settings screen asking them to type in
 * nicknames would be filled in by nobody, and the feature would quietly do
 * nothing forever.
 */

/** GET — what this shop calls this party. Shown on the party screen. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthContext()
    if (auth.error || !auth.userId) return auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(auth.role, auth.permissions, 'parties')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = auth.userId
    const { id } = await params

    const aliases = await db.partyAlias.findMany({
      where: { userId, partyId: id },
      select: { id: true, alias: true, saidAs: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      /*
       * A shop does not have fifty nicknames for one customer. This is an
       * honest ceiling on a naturally tiny list, not a cap that could change
       * an answer — and if one ever hits it, the party screen showing fifty
       * names is already telling them something has gone wrong.
       */
      take: 50,
    })

    return NextResponse.json({ aliases })
  } catch (err) {
    return apiError(err, 'Failed to load names')
  }
}

/**
 * POST — learn a name, if it is safe to learn one.
 *
 * Refusing is the common and correct outcome. See lib/can-learn-alias for the
 * trap: a shop with Anil Kumar and Anil Sharma who picks Kumar for "anil" has
 * NOT told us that "anil" means Kumar — and learning it would make Sharma
 * unreachable by his own name, silently and permanently.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthContext()
    if (auth.error || !auth.userId) return auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(auth.role, auth.permissions, 'parties')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = auth.userId
    const { id } = await params

    const body = await req.json().catch(() => ({}))
    const said = typeof body.said === 'string' ? body.said.trim() : ''
    if (!said) return NextResponse.json({ error: 'said is required' }, { status: 400 })

    // The party must be this shop's, and must still exist. Checked before
    // anything is written — an alias pointing at someone else's customer
    // would be the worst possible row in this table.
    const party = await db.party.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true, name: true },
    })
    if (!party) return NextResponse.json({ error: 'Party not found' }, { status: 404 })

    /*
     * ONLY THE NAMES THAT COULD CONFLICT — not every party in the shop.
     *
     * My first version read every name, which the unbounded-query guard
     * rightly rejected: a shop with 20,000 customers would load 20,000 rows
     * to answer one yes/no question. Filtering by prefix is both bounded and
     * more precise, because the dangerous case IS a literal prefix — "anil"
     * with an Anil Kumar and an Anil Sharma.
     *
     * The case this misses is a name that only collides after spelling is
     * folded ("aneel" against "Anil"), and missing it is harmless: that alias
     * would point at the same person the ordinary matching already finds.
     * The destructive case — learning a prefix that genuinely means two
     * different people — is caught exactly.
     */
    const firstWord = said.split(/\s+/)[0] || said
    const couldConflict = await db.party.findMany({
      where: { userId, deletedAt: null, name: { startsWith: firstWord, mode: 'insensitive' } },
      select: { name: true },
      take: 20,
    })

    const verdict = canLearnAlias({ said, allPartyNames: couldConflict.map(p => p.name) })
    if (!verdict.learn) {
      /*
       * 200, not an error. Nothing went wrong — we decided not to learn, and
       * the caller is a background action after a tap. A red toast for "we
       * correctly did nothing" would train people to distrust the feature.
       */
      return NextResponse.json({ learned: false, reason: verdict.reason })
    }

    /*
     * upsert, because the same lesson can arrive twice — two taps, an offline
     * replay, a double-click. The unique index on (userId, alias) makes a
     * second insert an error; this makes it a no-op that keeps the newest
     * spelling of what they said.
     */
    const saved = await db.partyAlias.upsert({
      where: { userId_alias: { userId, alias: verdict.alias } },
      create: { userId, partyId: party.id, alias: verdict.alias, saidAs: said },
      update: { partyId: party.id, saidAs: said },
      select: { id: true, alias: true, saidAs: true },
    })

    return NextResponse.json({ learned: true, alias: saved })
  } catch (err) {
    return apiError(err, 'Failed to save the name')
  }
}

/**
 * DELETE — forget a name.
 *
 * Not optional. A mis-tap teaches the app the wrong thing, and without a way
 * to undo it every future question about that name goes to the wrong
 * customer's ledger with nothing on screen explaining why.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthContext()
    if (auth.error || !auth.userId) return auth.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessModule(auth.role, auth.permissions, 'parties')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const userId = auth.userId
    const { id } = await params

    const aliasId = new URL(req.url).searchParams.get('aliasId')
    if (!aliasId) return NextResponse.json({ error: 'aliasId is required' }, { status: 400 })

    // Scoped by BOTH the shop and the party, so an id from elsewhere deletes
    // nothing rather than someone else's row.
    const result = await db.partyAlias.deleteMany({
      where: { id: aliasId, userId, partyId: id },
    })

    if (result.count === 0) return NextResponse.json({ error: 'Name not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err, 'Failed to remove the name')
  }
}
