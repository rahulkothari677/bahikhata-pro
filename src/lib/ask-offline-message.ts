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

export function askFailureMessage(isOnline: boolean): OfflineMessage {
  if (!isOnline) {
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
   * Online, but the request failed: server error, timeout, a 2G stall. NOT
   * "you're offline" — claiming that would send them to check a connection
   * that is working.
   */
  return {
    message: 'I couldn’t reach your books just now — that’s on us, not on your question. Try again in a moment.',
    offline: false,
  }
}
