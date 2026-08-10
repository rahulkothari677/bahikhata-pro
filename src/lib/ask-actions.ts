/**
 * What to offer doing about an answer — Ask your books, Phase 2.2.
 *
 * WHY THIS IS A FUNCTION AND NOT SIX LINES IN THE ROUTE. The decision it makes
 * is a direction decision about money, and the failure mode is not cosmetic:
 * offer "send reminder" on the wrong sign and the app cheerfully nags a
 * supplier we owe money to, in the shopkeeper's own name, over WhatsApp. That
 * deserves a test that can be written without a database.
 *
 * IT DECIDES NOTHING ABOUT MONEY ITSELF. The balance arrives already computed
 * by computePartyBalance, and each action is a handle — an intent plus ids —
 * that the client passes to the same Settle page and the same reminder endpoint
 * the rest of the app uses. Nothing here writes, sends, or arithmetics.
 */

export interface BalanceActionInput {
  partyId: string
  /** Null or empty when we have no number to message. */
  phone?: string | null
  /** From computePartyBalance. Positive: they owe us. Negative: we owe them. */
  balance: number
  /** Bills with a real outstanding amount, already filtered by the caller. */
  unpaid: readonly { id: string; invoiceNo: string | null; due: number }[]
}

export interface BalanceAction {
  kind: 'remind' | 'settle' | 'open-party'
  label: string
  partyId: string
  transactionId?: string
  invoiceNo?: string | null
  amount?: number
}

/**
 * Half a paisa. The same threshold the caller uses to decide a bill is unpaid,
 * so a balance that is zero to the last paisa never grows a payment button.
 */
export const SETTLED_EPSILON = 0.005

export function buildBalanceActions(input: BalanceActionInput): BalanceAction[] {
  const { partyId, phone, balance, unpaid } = input
  const actions: BalanceAction[] = []

  const theyOweUs = balance > SETTLED_EPSILON
  const weOweThem = balance < -SETTLED_EPSILON

  /*
   * A reminder needs BOTH a debt in our favour and somewhere to send it.
   *
   * Without a phone number the endpoint has nothing to address, so the button
   * is withheld rather than shown and then failing — one dead button teaches a
   * shopkeeper that the whole row is decorative.
   */
  if (theyOweUs && phone && phone.trim()) {
    actions.push({ kind: 'remind', label: 'Send reminder', partyId })
  }

  if (theyOweUs || weOweThem) {
    /*
     * Name the bill only when there is exactly one it could be.
     *
     * With several unpaid we send no transactionId at all, and Settle asks.
     * Picking for them would allocate a payment against an invoice the
     * shopkeeper never chose, and a misallocated payment is a real error in
     * the books — it shows the wrong bill as closed and keeps the right one
     * open. "Probably the oldest" is not good enough when it is someone's
     * money.
     */
    const only = unpaid.length === 1 ? unpaid[0] : null
    actions.push({
      kind: 'settle',
      // The verb follows the direction. "Record payment" on a supplier would
      // read as money coming in when it is going out.
      label: theyOweUs ? 'Record payment' : 'Record payment made',
      partyId,
      ...(only ? { transactionId: only.id, invoiceNo: only.invoiceNo, amount: only.due } : {}),
    })
  }

  // Always available, including at a zero balance — "show me everything" is a
  // reasonable thing to want from any answer about a person.
  actions.push({ kind: 'open-party', label: 'Open ledger', partyId })

  return actions
}
