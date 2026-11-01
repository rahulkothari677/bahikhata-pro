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
 * ── QUARTERLY (QRMP) FILERS — settled 1 Nov 2026 (#346) ────────────────
 *
 * GSTN advisory on FORM GSTR-1A (27 Jul 2024, under Notification 12/2024-CT):
 * for a quarterly filer GSTR-1A is available "quarterly after actual filing of
 * FORM GSTR-1 (Quarterly) or the due date … whichever is later", until the
 * quarter's GSTR-3B is filed, and it covers what went in through IFF for the
 * first two months too — there is no separate IFF amendment. Same two edges as
 * a monthly filer, counted per quarter, so the same branches answer it.
 * (The app itself files monthly today; frequency is not stored, so callers pass
 * null. The quarterly wording is ready for when it is.)
 */

import { gstinChanged, GSTIN_GSTR1A_REMEDY } from '@/lib/gstr1-amendments'

export interface Gstr1aInputs {
  /** Has the period's GSTR-1 been filed? */
  gstr1Filed: boolean
  /** Has the SAME period's GSTR-3B been filed? */
  gstr3bFiled: boolean
  /** Monthly or quarterly filer — only the wording differs (see QRMP above). */
  filingFrequency?: 'monthly' | 'quarterly' | null
}

export type Gstr1aState =
  /** GSTR-1 not filed yet — nothing to amend, edit the invoice directly. */
  | 'not-filed-yet'
  /** Open. A correction to this period belongs here, not in next month. */
  | 'open'
  /** GSTR-3B filed. The window has closed for good; use a later amendment. */
  | 'closed'

export interface Gstr1aWindow {
  state: Gstr1aState
  /** One sentence a shopkeeper can act on. */
  message: string
  /** True only when a correction should be routed to GSTR-1A. */
  isOpen: boolean
}

export function gstr1aWindow(input: Gstr1aInputs): Gstr1aWindow {
  const q = input.filingFrequency === 'quarterly'
  const period = q ? 'quarter' : 'month'
  const next = q ? 'next quarter’s' : 'next month’s'

  if (!input.gstr1Filed) {
    return {
      state: 'not-filed-yet',
      isOpen: false,
      message: `You have not filed this ${period}’s GSTR-1 yet, so just correct the bill. Nothing needs amending.`,
    }
  }

  if (input.gstr3bFiled) {
    return {
      state: 'closed',
      isOpen: false,
      message: `You have already filed GSTR-3B for this ${period}, so GSTR-1A is closed for it. Corrections now go into ${next} return as an amendment.`,
    }
  }

  return {
    state: 'open',
    isOpen: true,
    message: q
      ? 'You can still fix this quarter’s GSTR-1 — including bills you sent through IFF in the first two months — using GSTR-1A, because you have not filed GSTR-3B yet. Correcting it now means GSTR-3B fills itself with the right figure.'
      : 'You can still fix this month’s GSTR-1 using GSTR-1A, because you have not filed GSTR-3B yet. Correcting it now means GSTR-3B fills itself with the right figure — waiting means paying the wrong amount and claiming it back next month.',
  }
}

/**
 * Can THIS correction go in GSTR-1A, or must it wait for a later amendment?
 *
 * THE ONE HARD EXCLUSION: the recipient's GSTIN cannot be amended. Changing who
 * an invoice was billed to moves input credit from one taxpayer to another, and
 * no amendment is allowed to do that.
 *
 * CORRECTED AGAIN 31 Oct 2026 (#100), settled 1 Nov (#345). GSTR-1A's own
 * form text: "Amendment of a document which is related to change of
 * Recipient's GSTIN shall not be allowed in GSTR-1A" — it is a later GSTR-1
 * that takes it. How the app routes it: GSTIN_CORRECTION_ROUTE.
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
  if (gstinChanged(changes)) {
    return {
      fits: false,
      /*
       * #100 (8c-3): "not in GSTR-1A", then the route every source accepts — in
       * the same words the corrections list uses (GSTIN_CORRECTION_ROUTE).
       */
      reason: GSTIN_GSTR1A_REMEDY,
    }
  }
  return { fits: true, reason: '' }
}
