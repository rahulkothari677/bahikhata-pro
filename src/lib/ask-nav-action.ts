/**
 * The way out of an answer — "Ask your books", A2.
 *
 * ── THE PROBLEM ───────────────────────────────────────────────────────
 *
 * Until A2 only balance answers offered anything to do. Ask "kitna kharcha
 * hua is mahine", get ₹5,000, and the conversation stops there: to see WHICH
 * expenses, the shopkeeper has to leave, remember where expenses live, and
 * find the month again. Master plan §4.4 calls that a failure of Control —
 * "they always know what to do next".
 *
 * ── WHY THIS IS ONE RULE AND NOT TWELVE BUTTONS ───────────────────────
 *
 * Every capability already declares `dataLivesAt` — the screen its answer was
 * computed from — added in P4.1 for exactly this. Hand-writing a button per
 * answer would be a second list describing the same fact, which is the shape
 * of four bugs fixed this week (rule B6). So the button is DERIVED: capability
 * → dataLivesAt → nav registry → label. Add a capability tomorrow and it gets
 * its way out for free.
 *
 * ── IT ADDS NOTHING TO AN ANSWER THAT ALREADY ACTS ────────────────────
 *
 * §4.2: one primary action per screen. A party balance already offers Send
 * reminder / Record payment / Open ledger, and a notice already offers Fix
 * before filing. Appending "Open Parties" to those turns a decision into a
 * menu, and a row of four buttons is read as decoration. So: an answer that
 * already acts is returned untouched.
 */

/** The subset of a nav destination this needs — so tests need no registry. */
export interface NavTarget {
  id: string
  label: string
}

export interface NavAction {
  kind: 'open-screen'
  label: string
  destinationId: string
}

export interface NavActionInput {
  /**
   * The destination for `capability.dataLivesAt`, ALREADY resolved against the
   * registry and the asker's permissions by the caller. Null means either the
   * id names no screen (party profiles and invoices are reached by id, not
   * from the registry) or this staff member may not open it — rule G6,
   * permissions are decided server-side and never by a model.
   */
  target: NavTarget | null
  /** Actions the answer already carries, if any. */
  existing?: readonly unknown[] | null
}

export function buildNavAction(input: NavActionInput): NavAction | null {
  if (input.existing && input.existing.length > 0) return null
  if (!input.target) return null

  return {
    kind: 'open-screen',
    /*
     * "Open Sales", not "View details" or "See more". The label names the
     * place, because the shopkeeper is choosing between going somewhere and
     * asking the next question — and only one of those is reversible in their
     * head. A vague label makes them tap to find out.
     */
    label: `Open ${input.target.label}`,
    destinationId: input.target.id,
  }
}

/**
 * Attach the way out, without disturbing an answer that already has one.
 *
 * Kept beside the builder so a caller cannot use one and forget the other:
 * the route calls this once, at its single exit, rather than at each of the
 * twelve places an answer is returned.
 */
export function withNavAction<
  // Record<string, unknown> so an answer payload can be passed as a literal:
  // without it TypeScript excess-property-checks the literal against the two
  // named keys and rejects `headline`.
  T extends Record<string, unknown> & { actions?: readonly unknown[]; navigate?: unknown },
>(
  payload: T,
  target: NavTarget | null,
): T & { actions?: readonly unknown[] } {
  /*
   * An answer that is ITSELF a navigation gets no button. "khata kholo" already
   * replies "Opening Parties" and takes them there; offering "Open Parties"
   * underneath would be a button to the screen they are already on.
   */
  if (payload.navigate) return payload

  const nav = buildNavAction({ target, existing: payload.actions })
  if (!nav) return payload
  return { ...payload, actions: [nav] }
}
