/**
 * 🔒 Asking for the LEAST must never be answered with the MOST.
 *
 * Rahul asked, on 12 August, whether the app can only answer what we have
 * explicitly built. Testing it produced two wrong answers, and both read
 * perfectly on screen:
 *
 *   "sabse kam kya bika"           → "₹0.00 of sales today"
 *   "which product is not selling" → "Shirt Stitching sold MOST all time"
 *
 * TWO DIFFERENT CAUSES, one refusal:
 *
 *   1. The local sales pattern claimed the first, because NAMES_SALES contains
 *      `bika` and nothing was watching for "sabse kam".
 *   2. The model answered the second. It must choose the nearest of the twelve
 *      capabilities, and the nearest thing to "least sold" is "most sold" — so
 *      it returned the exact inverse, labelled "read by AI".
 *
 * There is no least-sold capability. A shopkeeper told "I can't do that yet"
 * asks differently; a shopkeeper shown the BEST seller when they asked for the
 * worst restocks the wrong thing and never learns why.
 */

import { describe, test, expect } from '@jest/globals'
import { mustRefuse, parseAsk } from '@/lib/ask-patterns'

describe('the least / worst / not-selling family is refused', () => {
  test.each([
    'sabse kam kya bika',
    'sab se kam kya bika',
    'which product is not selling',
    'least selling product',
    'lowest selling item',
    'worst selling product',
    'slowest moving stock',
    'dead stock kya hai',
    'kaunsa saman nahi bik raha',
  ])('%s', (q) => {
    expect(mustRefuse(q)).toBe('not_built')
  })

  test('refused BEFORE the parser, so the model never sees it', () => {
    /*
     * THE PLACEMENT, which I have got wrong three times. `parseAsk` returning
     * null means "no rule matched" — the same signal as an unusual phrasing —
     * so a refusal that lives in the parser is not a refusal at all. This one
     * is checked by the caller, beside the other refusals.
     */
    expect(mustRefuse('which product is not selling')).toBe('not_built')
  })

  test('nothing downstream refuses it, which is why this must', () => {
    /*
     * I first asserted here that the parser claims it as `sales_period`,
     * because that is what the LIVE app answered — "₹0.00 of sales today".
     * The parser returns null in this build, so the live answer came from the
     * model, not the pattern. Corrected rather than deleted, because the
     * distinction is the whole point:
     *
     * **null from the parser is not a refusal.** It is the signal that hands
     * the question to a model, which then picks the nearest of twelve
     * capabilities — and the nearest thing to "least sold" is "most sold".
     * That is exactly how "which product is not selling" came back as
     * "Shirt Stitching sold MOST all time".
     */
    expect(parseAsk('sabse kam kya bika')).toBeNull()
  })
})

describe('what must still work', () => {
  test.each([
    'sabse zyada kya bika',
    'kitna maal bika',
    'is mahine ki sale kitni hui',
    'kitna kharcha hua',
    'kitna GST bharna hai',
    'Anil ka kitna baaki hai',
  ])('%s is not refused', (q) => {
    // The refusal must be narrow. Swallowing ordinary questions would be a
    // worse bug than the one it fixes.
    expect(mustRefuse(q)).toBeNull()
  })

  test('"kam" on its own does not trigger it', () => {
    // "sabse kam" is the trigger, not the word "kam" — which appears in
    // ordinary questions about amounts going down.
    expect(mustRefuse('kitna kam hua')).toBeNull()
  })
})
