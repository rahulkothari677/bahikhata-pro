/**
 * IMS — the month where doing nothing is an answer.
 *
 * ── WHAT CHANGED, AND WHY IT IS NOT JUST ANOTHER RECONCILIATION ─────────
 *
 * The portal now shows every invoice a supplier has filed against your GSTIN,
 * and you accept or reject each one. Section 38 was substituted by Notification
 * 16/2025-Central Tax (17 Sep 2025) so that input credit is built from what you
 * ACCEPT — and, critically:
 *
 *     AN INVOICE YOU DO NOT ACT ON IS DEEMED ACCEPTED.
 *
 * Silence used to be neutral. It is now agreement — with the invoice AND with
 * the tax treatment the supplier put on it. Tied to ITC from 1 October 2025 and
 * compulsory for every GSTR-3B filer from 1 April 2026.
 *
 * ── WHY THIS FILE EXISTS WHEN /api/gstr-2b/reconcile ALREADY MATCHES ────
 *
 * The matching is already built and it is good: matched / booksOnly / twoBOnly.
 * What is missing is not arithmetic. It is that the existing screen labels a
 * portal-only invoice **"Missing Purchase"**.
 *
 * That framing was right before IMS. It is now actively dangerous, because a
 * portal-only invoice means one of two opposite things:
 *
 *   1. a real bill you forgot to record        → record it, and claim the credit
 *   2. an invoice filed against your GSTIN     → REJECT it on the portal, or on
 *      that is not yours, or is wrong             the 14th it is accepted FOR you
 *
 * "Missing Purchase" pushes a shopkeeper towards (1) — towards adding the bill
 * so the numbers agree. If the invoice is not theirs, that is precisely the
 * wrong action, and it turns someone else's mistake into their own wrong return.
 *
 * So this file adds the two things the reconciliation cannot know on its own:
 * WHEN the decision expires, and WHAT each outcome now asks of the shopkeeper.
 *
 * ── THE TWO DATES, AND THEY ARE DIFFERENT ───────────────────────────────
 *
 *   14th of the following month   GSTR-2B is generated. Anything not acted on
 *                                 is deemed accepted at this point. This is the
 *                                 date that bites, because it arrives on its own.
 *
 *   filing of GSTR-3B             the hard stop. Action can still be taken after
 *                                 the 14th and 2B recomputed, but once GSTR-3B
 *                                 for the period is filed the period is closed.
 *
 * Most shopkeepers will never see the second. The first happens to them.
 *
 * NOT VERIFIED WITH A PRACTITIONER. The CA left the IMS question blank. The
 * statutory basis and the deemed-acceptance rule are well documented and I have
 * checked them; the exact recompute behaviour after the 14th is the part I am
 * least sure of, so nothing here depends on it — the countdown is to the 14th,
 * and the 3B date is described rather than computed.
 */

/** GSTR-2B generates on the 14th of the month AFTER the tax period. */
export const IMS_GENERATION_DAY = 14

/**
 * Start warning this many days out.
 *
 * Longer than the 180-day rule's 30 days would be pointless here — the whole
 * window is about six weeks — but a single day is an alarm, not a chance to
 * act. A week lets a shopkeeper ask their supplier what a strange invoice is
 * before deciding to reject it.
 */
export const IMS_WARN_WITHIN_DAYS = 7

export type ImsWindowState =
  /** The 14th has not arrived. Decisions still land the easy way. */
  | 'open'
  /** Days left are inside the warning band. */
  | 'closing'
  /** The 14th has passed: anything untouched has been deemed accepted. */
  | 'deemed-accepted'
  /** GSTR-3B filed — the period is closed regardless. */
  | 'period-closed'

export interface ImsWindow {
  state: ImsWindowState
  /** The 14th of the month after the tax period. */
  generationDate: Date
  /** Negative once past. */
  daysLeft: number
  message: string
}

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

/**
 * Where this tax period sits relative to the deemed-acceptance date.
 *
 * @param monthYear MMYYYY, the tax period — the same format Gstr2bImport uses.
 */
export function imsWindow(
  monthYear: string,
  gstr3bFiled: boolean,
  asOn: Date = new Date(),
): ImsWindow {
  const month = Number(monthYear.slice(0, 2))
  const year = Number(monthYear.slice(2))
  /* The 14th of the FOLLOWING month. `month` is 1-based from the portal, so
     passing it unchanged to a 0-based Date constructor already advances one
     month — which is the behaviour wanted here, and is why it is spelled out
     rather than left to look like an off-by-one. */
  const generationDate = new Date(year, month, IMS_GENERATION_DAY)
  const daysLeft = daysBetween(asOn, generationDate)

  /*
   * Checked FIRST. Once GSTR-3B is filed the period is closed however many days
   * the calendar suggests, and telling someone they have time to act on a
   * period they have already filed would send them to a portal screen that
   * refuses them.
   */
  if (gstr3bFiled) {
    return {
      state: 'period-closed',
      generationDate,
      daysLeft,
      message: 'You have filed GSTR-3B for this month, so this period is closed. Anything wrong here now has to be corrected in a later return.',
    }
  }

  if (daysLeft < 0) {
    return {
      state: 'deemed-accepted',
      generationDate,
      daysLeft,
      message: `The ${IMS_GENERATION_DAY}th has passed, so anything you did not act on has been accepted automatically — along with whatever the supplier said about it. You can still change it on the portal until you file GSTR-3B for this month.`,
    }
  }

  if (daysLeft <= IMS_WARN_WITHIN_DAYS) {
    return {
      state: 'closing',
      generationDate,
      daysLeft,
      message: `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left. On the ${IMS_GENERATION_DAY}th, anything you have not acted on is accepted automatically — doing nothing counts as saying yes.`,
    }
  }

  return {
    state: 'open',
    generationDate,
    daysLeft,
    message: `You have ${daysLeft} days. On the ${IMS_GENERATION_DAY}th, anything you have not acted on is accepted automatically.`,
  }
}

/**
 * What an unmatched invoice now ASKS of the shopkeeper.
 *
 * The reconciliation says what does not line up. This says what to do about it,
 * and the two portal-only cases are the point of the whole file: the same row
 * can mean "you forgot to write this down" or "somebody has billed you for
 * something that is not yours", and only the shopkeeper can tell which.
 *
 * Offering ONE action would decide that for them. So both are offered, plainly,
 * with what each one means.
 */
export interface ImsAction {
  /** Short label for the row. */
  title: string
  /** What it means and what happens if they do nothing. */
  detail: string
  /** The two ways out, in the shopkeeper's words. */
  options: string[]
}

export const IMS_ACTIONS: Record<'twoBOnly' | 'booksOnly' | 'matched', ImsAction> = {
  twoBOnly: {
    title: 'Your supplier filed this. It is not in your books.',
    detail:
      'Either you have not recorded this bill yet, or somebody has filed an invoice against your GSTIN that is not yours. If you do nothing, it is accepted automatically and its tax goes into your return as if you had agreed to it.',
    options: [
      'It is a real bill I forgot to enter — record it, then the credit is yours',
      'It is not mine, or the amount is wrong — reject it on the portal before the 14th',
    ],
  },
  booksOnly: {
    title: 'You recorded this. Your supplier has not filed it.',
    detail:
      'The credit is not available until they file it. Nothing is deemed accepted here — there is nothing on the portal to accept — so the action is with your supplier, not with you.',
    options: [
      'Chase the supplier to file it — the credit becomes claimable next month',
      'Check the GSTIN and bill number on your copy in case it was filed against a different one',
    ],
  },
  matched: {
    title: 'This one agrees.',
    detail: 'Your books and the portal say the same thing, so accepting it is safe and the credit is yours.',
    options: [],
  },
}
