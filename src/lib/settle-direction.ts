/**
 * Which way the money is moving, when Settle opens.
 *
 * THE INVARIANT, and it is the whole point of this file:
 *
 *     the direction box must never contradict the balance label
 *
 * Settle shows "They owe you" above a positive balance and "You owe them"
 * above a negative one. If the dropdown underneath says the opposite, a
 * shopkeeper who does not catch it records the payment backwards — and a
 * backwards payment does not just fail to fix the balance, it moves it the
 * wrong way by twice the amount. ₹1,075 owed becomes ₹3,225 owed.
 *
 * WHY THIS IS NOT `party.type === 'supplier'`. That was the old rule, and it
 * breaks on a supplier who owes US — after a return, an overpayment, or a
 * debit note. The screen says "They owe you"; the old rule still said "paid",
 * because it looked at who the party is rather than which way the money sits.
 * The sign of the balance is the thing that actually answers the question.
 *
 * Party type only breaks the tie at exactly zero, where there is no debt to
 * take a sign from and "you normally pay a supplier" is the best guess left.
 */

export type PaymentDirection = 'received' | 'paid'

export function defaultSettleDirection(
  partyType: string | null | undefined,
  balance: number,
): PaymentDirection {
  if (balance > 0) return 'received'   // they owe us — collect, whoever they are
  if (balance < 0) return 'paid'       // we owe them — hand it back, whoever they are
  // Square. Nothing to settle yet; default to the ordinary shape of the
  // relationship so a fresh advance to a supplier starts pointing outward.
  return partyType === 'supplier' ? 'paid' : 'received'
}

/**
 * Does this direction contradict what the screen is telling the shopkeeper?
 *
 * Exported so the guard test can assert the invariant directly rather than
 * restating the rule, and so any future caller can check itself.
 */
export function directionContradictsBalance(
  direction: PaymentDirection,
  balance: number,
): boolean {
  if (balance > 0) return direction !== 'received'
  if (balance < 0) return direction !== 'paid'
  return false                          // at zero, either reading is honest
}
