/**
 * Did someone else change this record while the shopkeeper had it open?
 *
 * WHY THIS IS A SHARED FUNCTION (#18, audit 2026-08-13). Two devices editing
 * one invoice is silent last-write-wins: the counter phone corrects the
 * quantity, the back-office laptop corrects the price, and whoever saves second
 * erases the other's change without either being told. On a bill, that is money.
 *
 * The same detection was written inline in the parties route and again in the
 * products route, months ago. Both are dead:
 *
 *   - the client never sends the stamp, so the check is `if (null && …)` —
 *     permanently false, it has never once fired;
 *   - nothing reads the warning the server returns;
 *   - the only tests grep the route source for the word "conflictWarning",
 *     which would pass on a comment.
 *
 * So this is one implementation, with real tests, that the routes call — rather
 * than a third copy of a rule that has never worked. Two lists describing one
 * thing will disagree eventually; three certainly will.
 *
 * DELIBERATELY A WARNING, NOT A REFUSAL. Rejecting the save loses work the
 * shopkeeper just did, and nobody can reason about a merge on a phone at a
 * counter. The write goes through and they are asked to check the bill — which
 * is a thing a shopkeeper can actually act on.
 */

/** What the record is called when we speak to the shopkeeper about it. */
export type ConflictSubject = 'bill' | 'party' | 'product'

const SUBJECT_WORD: Record<ConflictSubject, string> = {
  bill: 'bill',
  party: 'customer',
  product: 'product',
}

/**
 * Returns a sentence to show the shopkeeper, or null when there is no conflict.
 *
 * @param expected what the client held when it loaded the record. Absent means
 *   an older app build or an API caller — no check, same behaviour as before,
 *   never a new failure.
 * @param actual   what the database holds now.
 */
export function describeEditConflict(
  expected: string | Date | null | undefined,
  actual: Date | null | undefined,
  subject: ConflictSubject = 'bill',
): string | null {
  if (!expected || !actual) return null

  const expectedAt = expected instanceof Date ? expected : new Date(expected)
  // An unparseable stamp is not evidence of a conflict. Treating it as one
  // would warn on every save from a client sending something malformed.
  if (isNaN(expectedAt.getTime())) return null

  if (expectedAt.getTime() === actual.getTime()) return null

  /*
   * A stamp NEWER than the database means the caller is confused — a clock
   * skew, or a replayed request. Warning "someone changed it at <a time in
   * your past>" would be nonsense, so say the plainer true thing instead.
   */
  const noun = SUBJECT_WORD[subject]
  if (expectedAt.getTime() > actual.getTime()) {
    return (
      `This ${noun} may have been edited somewhere else. ` +
      `Your changes have been saved — please check the details are right.`
    )
  }

  const when = actual.toLocaleString('en-IN')
  return (
    `This ${noun} was also changed on another device at ${when}, after you opened it. ` +
    `Your changes have been saved — please check the details are right.`
  )
}

/** What the screen should tell the shopkeeper once a save comes back. */
export type SaveOutcome =
  | { kind: 'success'; title: string; description?: string; durationMs: number }
  | { kind: 'warning'; title: string; description: string; durationMs: number }

/**
 * Turns a save response into the message to show.
 *
 * WHY THIS IS A FUNCTION AND NOT AN `if` IN THE COMPONENT (2026-08-13). It was
 * an `if` in the component first, and my own guard for it was:
 *
 *     expect(src).toMatch(/conflictWarning/)
 *     expect(src).toMatch(/sonnerToast\.warning\(/)
 *
 * Break-testing it — replacing the condition with `if (false)` — left both
 * strings in the file and the test passed on dead code. That is the identical
 * mistake the parties/products guards make, committed by me, one file away
 * from the comment criticising it.
 *
 * A decision that can be called can be tested. The component now renders
 * whatever this returns, and the tests below drive this directly.
 */
export function describeSaveOutcome(
  response: { conflictWarning?: string | null } | null | undefined,
  opts: {
    queuedOffline: boolean
    /** What to say when it saved cleanly. Defaults to the invoice wording. */
    successTitle?: string
    /** Names the record in the warning headline. Defaults to 'bill'. */
    subject?: ConflictSubject
  },
): SaveOutcome {
  if (opts.queuedOffline) {
    return { kind: 'success', title: 'Saved offline — will sync when online', durationMs: 4000 }
  }

  const conflict = response?.conflictWarning
  if (conflict) {
    return {
      kind: 'warning',
      title: `Saved — but this ${SUBJECT_WORD[opts.subject ?? 'bill']} changed elsewhere`,
      description: conflict,
      // Long, because it asks the shopkeeper to go and look at something.
      durationMs: 15000,
    }
  }

  return { kind: 'success', title: opts.successTitle ?? 'Transaction updated', durationMs: 4000 }
}
