/**
 * What to say when the question never reached the books — B3.
 *
 * ── THE DISTINCTION THIS EXISTS TO KEEP ───────────────────────────────
 *
 * "I can't reach your books" and "I can't answer that" are different
 * sentences, and telling a shopkeeper the second when the first is true says
 * their question was the problem. On EDGE and 2G — the normal case in the
 * geographies this app is for — that will be a daily event, and the app that
 * blames you for its own bad connection is one you stop asking.
 *
 * Master plan §4.3: offline-first is not negotiable. Ask cannot ANSWER
 * offline, because every figure is computed on the server from the same
 * tables the screens read — and the alternative, answering from a stale
 * cache, would be worse than silence: a balance from Tuesday presented as
 * today's is exactly the kind of confidently wrong number this whole feature
 * is built to prevent. So the honest offline behaviour is to say so plainly
 * and say the books are safe.
 */

export interface OfflineMessage {
  message: string
  /** True when the phone has no connection, as opposed to the server failing. */
  offline: boolean
}

export interface AskFailure {
  /**
   * `navigator.onLine`. Trustworthy ONLY when false.
   *
   * Rahul's phone showed 5G in the status bar while every request died with
   * ERR_NAME_NOT_RESOLVED — so `true` means "this device has a network
   * interface", nothing more. `false`, though, is definite: the device knows
   * it has no connection.
   */
  online: boolean
  /**
   * Did a response ever come back?
   *
   * This is the signal that actually separates the two failures, and it needs
   * no guessing: if `fetch` threw, we never reached the server — whatever the
   * radio claims. If it returned and the body was unusable, the server
   * answered and the fault is ours.
   */
  reachedServer: boolean
}

export function askFailureMessage(failure: AskFailure): OfflineMessage {
  if (!failure.online) {
    /*
     * Three things, in this order: what happened, that it is not their fault
     * or their data, and what changes it. "Nothing is lost" matters because
     * the shopkeeper has just watched a question disappear, and the ledger is
     * the thing they cannot afford to doubt.
     */
    return {
      message: 'You’re offline, so I can’t read your books right now. Nothing is lost — ask me again when you’re back on the network.',
      offline: true,
    }
  }

  /*
   * NEVER GOT A RESPONSE, while the device insists it is online.
   *
   * This is the case Rahul's screenshot caught: offline in every way that
   * matters, but `navigator.onLine` said true, so this function called it a
   * server fault and told him "that's on us". It was not on us — nothing had
   * left the phone. Saying "the connection" rather than "you are offline" is
   * the honest wording, because from here we cannot tell a dead radio from a
   * blocked DNS, and both are fixed by the same thing.
   */
  if (!failure.reachedServer) {
    return {
      message: 'I couldn’t reach your books — the connection isn’t getting through. Nothing is lost; try again when you have signal.',
      offline: true,
    }
  }

  /*
   * The server answered and the answer was unusable: a 500, or a body we
   * could not read. This is the only case that is genuinely our fault, and
   * the only one where "try again in a moment" is true rather than hopeful.
   */
  return {
    message: 'I couldn’t reach your books just now — that’s on us, not on your question. Try again in a moment.',
    offline: false,
  }
}
