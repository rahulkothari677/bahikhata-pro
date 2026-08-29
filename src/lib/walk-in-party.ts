/**
 * The counter customer who has no name.
 *
 * THE BUG THIS CLOSES. A cash sale to someone who walks in has no party. When
 * that sale came back, the app refused the credit note — a note against nobody
 * adjusts nobody's balance — and told the shopkeeper to adjust stock instead.
 *
 * **A stock adjustment does not reduce output GST.** So a shop that refunded a
 * counter customer followed our own instructions and then paid tax on a sale
 * that came back. Every time. Silently. The CA review ranked this second out
 * of everything in the app and was blunt about why: *"Nothing else in this
 * document costs users actual money the way this does, today."*
 *
 * WHY A REAL PARTY RATHER THAN ALLOWING A NULL ONE. Every downstream figure —
 * receivable, ageing, the party statement, WhatsApp reminders — is built on a
 * note having somebody to credit. Letting `partyId` be null would satisfy the
 * GST side and quietly break all of those, which is the trade the original
 * rejection was protecting against and was right to.
 *
 * So the counter customer becomes a real, reserved party. The khata keeps
 * every invariant it has; GSTR-1 nets the note into B2CS exactly as it does
 * for any unregistered buyer, because that is what it already does with a
 * party carrying no GSTIN.
 *
 * ONE PER SHOP, FOUND NOT CREATED-AGAIN. Reserved by name, case-insensitively,
 * so a shop does not accumulate a new "Walk-in Customer" per refund — which
 * would scatter the very balances this exists to keep whole.
 *
 * NOT A REAL PERSON, AND SAID SO. It carries no phone and no GSTIN. It must
 * never be offered a payment reminder, and it is not evidence a shop has a
 * customer of that name.
 */
import type { PrismaClient, Prisma } from '@prisma/client'

/** The reserved name. Matched case-insensitively; created exactly like this. */
export const WALK_IN_PARTY_NAME = 'Walk-in Customer'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * The shop's walk-in party, creating it the first time it is needed.
 *
 * Deliberately lazy: a shop that never takes a counter return never gets a
 * party it did not ask for cluttering its list.
 */
export async function getOrCreateWalkInParty(db: Db, userId: string): Promise<string> {
  const existing = await db.party.findFirst({
    where: {
      userId,
      deletedAt: null,
      name: { equals: WALK_IN_PARTY_NAME, mode: 'insensitive' },
    },
    select: { id: true },
  })
  if (existing) return existing.id

  const created = await db.party.create({
    data: {
      userId,
      name: WALK_IN_PARTY_NAME,
      type: 'customer',
      // No phone: a reminder must never be sent to it. No GSTIN: that is what
      // makes GSTR-1 treat its notes as B2C and net them into B2CS.
      phone: null,
      gstin: null,
    },
    select: { id: true },
  })
  return created.id
}

/** True when this party is the reserved counter customer, not a real person. */
export function isWalkInParty(party: { name?: string | null } | null | undefined): boolean {
  return (party?.name || '').trim().toLowerCase() === WALK_IN_PARTY_NAME.toLowerCase()
}
