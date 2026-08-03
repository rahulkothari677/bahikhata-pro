/**
 * 🔒 DUPLICATE PARTIES — detection and the rule we enforce.
 *
 * Reported by Rahul, 2026-08-03, after spotting two distinct parties both named
 * "RAHUL KOTHARI" (balances ₹492.50 and ₹50) in the live party report, plus
 * several near-duplicate suppliers all shown as "rahul".
 *
 * WHY IT MATTERS more than it looks. Every report groups by partyId, so two
 * ledgers for one real person means:
 *   - the outstanding shown for that customer is only PART of what they owe;
 *   - a payment settles bills on one ledger while the other keeps chasing;
 *   - the party picker shows two identical rows and the shopkeeper cannot tell
 *     which is which at the moment of choosing.
 * None of that surfaces as an error. It surfaces as a customer being asked for
 * money they already paid.
 *
 * WHAT ESTABLISHED LEDGER SOFTWARE DOES — the convention is a hard block, not
 * a soft warning:
 *   Tally          ledger names are unique; a duplicate is an error
 *   QuickBooks     display name unique across customers/vendors/employees
 *   Zoho Books     display name must be unique
 *   Xero           contact name must be unique
 *   Vyapar         party name unique per business
 *
 * So: block an exact name match (case-insensitive, whitespace-normalised) and
 * an exact phone match, and return the conflicting party so the caller can
 * offer to use it. A shopkeeper with two genuine "Ramesh Kumar"s can still
 * record both — by distinguishing them ("Ramesh Kumar (Market)"), which is the
 * same thing every app above requires and is what makes the ledger legible
 * afterwards.
 *
 * ENFORCED IN APPLICATION CODE, NOT AS A DB CONSTRAINT. Duplicates already
 * exist in live data, so adding @@unique([userId, name]) would fail to apply.
 * Existing pairs are left alone; only new names and renames are checked.
 */
import { db } from '@/lib/db'

export interface DuplicatePartyHit {
  field: 'name' | 'phone'
  party: { id: string; name: string; phone: string | null; type: string }
}

/** Case- and spacing-insensitive comparison key for a party name. */
export function normalizePartyName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Digits only, so "98765 43210", "+91 98765 43210" and "9876543210" are
 * recognised as one number. Compares the last 10 digits: an Indian mobile is
 * 10 digits, and the same phone is routinely stored with and without +91.
 */
export function normalizePartyPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  if (!digits) return null
  return digits.length > 10 ? digits.slice(-10) : digits
}

/**
 * Returns the first conflicting party, or null.
 *
 * Name is checked with a DB-side case-insensitive equals; phone needs
 * normalising on both sides, so candidates are narrowed by a digit-suffix
 * match and compared in JS. `excludeId` lets a rename skip the party itself.
 */
export async function findDuplicateParty(
  userId: string,
  input: { name?: string | null; phone?: string | null; excludeId?: string },
): Promise<DuplicatePartyHit | null> {
  const select = { id: true, name: true, phone: true, type: true }
  const notSelf = input.excludeId ? { id: { not: input.excludeId } } : {}

  const cleanName = (input.name || '').trim().replace(/\s+/g, ' ')
  if (cleanName) {
    const byName = await db.party.findFirst({
      where: {
        userId,
        deletedAt: null,
        ...notSelf,
        name: { equals: cleanName, mode: 'insensitive' },
      },
      select,
    })
    if (byName) return { field: 'name', party: byName }
  }

  const cleanPhone = normalizePartyPhone(input.phone)
  if (cleanPhone) {
    // `endsWith` narrows to a handful of rows; the exact comparison below is
    // what decides, so a stored "919876543210" still matches "9876543210".
    const candidates = await db.party.findMany({
      where: {
        userId,
        deletedAt: null,
        ...notSelf,
        phone: { endsWith: cleanPhone },
      },
      select,
      take: 20,
    })
    const hit = candidates.find(c => normalizePartyPhone(c.phone) === cleanPhone)
    if (hit) return { field: 'phone', party: hit }
  }

  return null
}

/**
 * Short text for the line UNDER the offending field.
 *
 * Kept to one clause on purpose: it sits beside the input the shopkeeper is
 * about to correct, so it needs to say which field is wrong and what to do —
 * nothing else. The longer `duplicatePartyMessage` still explains WHY, for
 * places that have room (offline sync failures, API consumers).
 */
export function duplicatePartyFieldError(hit: DuplicatePartyHit): string {
  return hit.field === 'name'
    ? `This name already exists — try a different name.`
    : `This number already exists — try a different number.`
}

/** The message the shopkeeper sees. Names the existing party so they can act. */
export function duplicatePartyMessage(hit: DuplicatePartyHit): string {
  const p = hit.party
  const who = p.phone ? `${p.name} (${p.phone})` : p.name
  return hit.field === 'name'
    ? `${who} already exists. Use that ${p.type} instead, or give this one a different name — two parties with the same name split their dues across two ledgers.`
    : `${who} already uses this phone number. Use that ${p.type} instead, or enter a different number.`
}
