/**
 * What to call a group of parties in a sentence.
 *
 * WHY THIS IS NOT A TERNARY AT THE CALL SITE. It used to be exactly that:
 *
 *     wantOwedToMe ? 'customer' : 'supplier'
 *
 * which infers what somebody IS from which way their money points. Those two
 * facts are independent, and the app already holds the counter-example — a
 * customer whose credit notes exceed his bills is someone the shop OWES, and
 * "total payables" duly described him as "1 supplier".
 *
 * A shopkeeper reading that has been told something untrue about their own
 * books, in the app that is supposed to be the record of them.
 *
 * So the rule is: read the type we stored. Where a list is all one kind, name
 * that kind. Where it is mixed, say so rather than picking the majority — a
 * shopkeeper scanning "3 customers" should not find a supplier in the list.
 */

import { translations } from './i18n'
import { isWalkInParty } from './walk-in-party'

export type PartyKind = string | null | undefined

/**
 * `describeParties([{type:'customer'}, {type:'customer'}])` → "customers"
 * `describeParties([{type:'customer'}, {type:'supplier'}])` → "customers and suppliers"
 * `describeParties([{type:null}])`                          → "party"
 *
 * The count is supplied by the caller, so the noun agrees with the number the
 * sentence already carries.
 */
export function describeParties(parties: readonly { type?: PartyKind }[]): string {
  const plural = parties.length !== 1

  const hasCustomer = parties.some(p => p.type === 'customer')
  const hasSupplier = parties.some(p => p.type === 'supplier')

  if (hasCustomer && hasSupplier) return 'customers and suppliers'
  if (hasCustomer) return plural ? 'customers' : 'customer'
  if (hasSupplier) return plural ? 'suppliers' : 'supplier'

  /*
   * Neither — an unset or unrecognised type. "party" is duller than naming a
   * kind, and duller is right: inventing "customer" for a record that does not
   * say so is how the original bug read.
   */
  return plural ? 'parties' : 'party'
}

/** What the walk-in khata is called wherever it is shown — the app's own words (i18n 'khata.counter', #267). */
export const COUNTER_RETURNS_LABEL: string = translations.en['khata.counter']

/**
 * #271 (Phase 5f-4): "who owes / is owed" in one phrase, with the walk-in khata
 * counted on its own — it holds counter returns and is nobody, never "a customer".
 * "Across 4 customers", "Across 4 customers and the counter-returns khata",
 * "Only the counter-returns khata".
 */
export function describeOwing(parties: readonly { type?: PartyKind; name?: string | null }[]): string {
  const people = parties.filter((p) => !isWalkInParty(p))
  const counter = people.length < parties.length
  if (people.length === 0) return counter ? 'Only the counter-returns khata' : 'Nobody'
  return `Across ${people.length} ${describeParties(people)}${counter ? ' and the counter-returns khata' : ''}`
}
