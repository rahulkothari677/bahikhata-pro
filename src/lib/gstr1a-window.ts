/**
 * GSTR-1A — the only way to fix a filed GSTR-1 in its OWN period.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────
 *
 * When a shopkeeper corrects an invoice after filing, this app has one answer:
 * carry the correction into the NEXT period's GSTR-1 as a 9A/9C amendment.
 * That is correct — and it is the wrong choice while GSTR-1A is still open.
 *
 * /api/gstr-1 builds amendments from snapshots `monthYear: { not: monthYear }`,
 * so a correction to a filed period never surfaces on that period's own screen.
 * It appears next month, as an amendment, with the tax difference riding along.
 *
 * What that costs, concretely. GSTR-3B's outward table has been hard-locked
 * since July 2025 — it auto-fills from GSTR-1 and cannot be typed over. So if
 * the filed GSTR-1 overstates tax:
 *
 *   with GSTR-1A     the GSTR-1 is corrected first, GSTR-3B auto-fills from the
 *                    corrected figure, and the right tax is paid once.
 *   without it       GSTR-3B is locked to the WRONG figure, the shopkeeper pays
 *                    tax they do not owe, and reclaims it next month via an
 *                    amendment — having funded the difference in between.
 *
 * And if the filed GSTR-1 UNDERSTATES tax, the gap between GSTR-1 and GSTR-3B
 * is exactly the Rule 88C condition our Notice Risk panel already warns about.
 * We name that problem today and do not offer the cleanest remedy, which is
 * the sentence from the CA question that made this a task:
 *
 *   "So right now we name the problem without offering the best remedy."
 *
 * ── THE WINDOW ──────────────────────────────────────────────────────────
 *
 * Opens once the period's GSTR-1 is filed. Closes the moment that same
 * period's GSTR-3B is filed — permanently, for that period. It is optional,
 * and there is exactly one of them per return.
 *
 * The closing edge is what matters and it is the one the app can actually see:
 * both facts are already stored (Gstr1Snapshot.filingStatus and
 * GstReturn.filingStatus), so no guess is involved in deciding whether to
 * offer it.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────
 *
 * It does not produce a GSTR-1A upload payload. I do not hold the portal's
 * GSTR-1A JSON schema, and inventing one would produce a file that looks
 * filed-ready and is not — the most dangerous kind of wrong output this app
 * could make. It tells the shopkeeper the window is open, what belongs in it,
 * and what does not. Generating the file waits for the schema.
 *
 * ── UNCONFIRMED, AND SAID SO ────────────────────────────────────────────
 *
 * The CA left Q4.6 blank. Two things follow:
 *
 *   1. QRMP (quarterly) filers. My understanding is they get a GSTR-1A after
 *      the quarterly GSTR-1, but I have not had that confirmed, so this refuses
 *      to answer for a quarterly filer rather than guess. See `unknownForQrmp`.
 *   2. Whether practitioners use it at all. That changes emphasis, not
 *      correctness — the window either is or is not open.
 */

import { gstinChangeBlocksAmendment, GSTIN_AMENDMENT_REMEDY } from '@/lib/gstr1-amendments'

export interface Gstr1aInputs {
  /** Has the period's GSTR-1 been filed? */
  gstr1Filed: boolean
  /** Has the SAME period's GSTR-3B been filed? */
  gstr3bFiled: boolean
  /**
   * Monthly or quarterly filer. Quarterly is refused rather than guessed —
   * see the note above.
   */
  filingFrequency?: 'monthly' | 'quarterly' | null
}

export type Gstr1aState =
  /** GSTR-1 not filed yet — nothing to amend, edit the invoice directly. */
  | 'not-filed-yet'
  /** Open. A correction to this period belongs here, not in next month. */
  | 'open'
  /** GSTR-3B filed. The window has closed for good; use a later amendment. */
  | 'closed'
  /** Quarterly filer — we do not know, and will not pretend. */
  | 'unknown-for-qrmp'

export interface Gstr1aWindow {
  state: Gstr1aState
  /** One sentence a shopkeeper can act on. */
  message: string
  /** True only when a correction should be routed to GSTR-1A. */
  isOpen: boolean
}

export function gstr1aWindow(input: Gstr1aInputs): Gstr1aWindow {
  if (!input.gstr1Filed) {
    return {
      state: 'not-filed-yet',
      isOpen: false,
      message: 'You have not filed this month’s GSTR-1 yet, so just correct the bill. Nothing needs amending.',
    }
  }

  /*
   * Checked BEFORE the 3B test, not after.
   *
   * A quarterly filer whose GSTR-3B is unfiled would otherwise fall into
   * 'open' and be told a window is available on a schedule I have not
   * confirmed. Refusing beats guessing, and the refusal has to come before the
   * branch that would answer confidently.
   *
   * The order is load-bearing, so it is pinned by a test that moves this block
   * below the 3B check and watches the quarterly case start returning 'open'.
   */
  if (input.filingFrequency === 'quarterly') {
    return {
      state: 'unknown-for-qrmp',
      isOpen: false,
      message: 'You file quarterly (QRMP). GSTR-1A works differently for quarterly filers and we have not had that confirmed, so please ask your CA before relying on this.',
    }
  }

  if (input.gstr3bFiled) {
    return {
      state: 'closed',
      isOpen: false,
      message: 'You have already filed GSTR-3B for this month, so GSTR-1A is closed for it. Corrections now go into next month’s return as an amendment.',
    }
  }

  return {
    state: 'open',
    isOpen: true,
    message: 'You can still fix this month’s GSTR-1 using GSTR-1A, because you have not filed GSTR-3B yet. Correcting it now means GSTR-3B fills itself with the right figure — waiting means paying the wrong amount and claiming it back next month.',
  }
}

/**
 * Can THIS correction go in GSTR-1A, or must it wait for a later amendment?
 *
 * THE ONE HARD EXCLUSION: the recipient's GSTIN cannot be amended. Changing who
 * an invoice was billed to moves input credit from one taxpayer to another, and
 * no amendment is allowed to do that.
 *
 * CORRECTED 29 Aug 2026. This comment used to end "it has to go through the
 * later-period route", and the message said the same. That was wrong: a GSTIN
 * cannot be amended in a later period either. Sending someone to next month's
 * amendment screen would have cost them a rejected return and a wasted month.
 * The real remedy is a credit note plus a fresh invoice (#90).
 *
 * This matters because the GSTIN case is not rare: typing the wrong customer's
 * GSTIN is one of the commonest filing mistakes there is. Offering GSTR-1A for
 * it would send a shopkeeper to a screen that refuses the change, and they
 * would conclude the app was wrong rather than the route.
 *
 * @param changes the `changes` array buildAmendments already produces
 */
export function correctionFitsGstr1a(changes: string[]): {
  fits: boolean
  reason: string
} {
  /*
   * ONE definition of the GSTIN rule, imported rather than repeated (#90).
   *
   * This file asked the question with its own regex and the amendments lib now
   * asks it too. Two rules deciding whether a GSTIN change is allowed would
   * eventually disagree, and the disagreement would be invisible: one route
   * would offer a correction the other refuses, on the same invoice.
   */
  if (gstinChangeBlocksAmendment(changes)) {
    return {
      fits: false,
      /*
       * CORRECTED 29 Aug 2026. This used to say the change "has to go in next
       * month's return as an amendment" — which is wrong, and wrong in the
       * direction that costs the shopkeeper a rejected return. A GSTIN cannot
       * be amended in ANY period. The remedy is a credit note plus a fresh
       * invoice, and it now says so in the same words the amendment screen
       * uses.
       */
      reason: GSTIN_AMENDMENT_REMEDY,
    }
  }
  return { fits: true, reason: '' }
}
