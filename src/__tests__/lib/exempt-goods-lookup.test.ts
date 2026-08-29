/**
 * The exemption table, and the entries it must never lose again.
 *
 * Notification 10/2025-CT(R) supersedes 2/2017. The list this replaced was 21
 * hand-written HSN prefixes whose own comment cited 2/2017 — so the app was
 * classifying stock against a dead statute, carefully.
 *
 * Most of what follows guards the PARSER rather than the lookup, because the
 * parser is where this data can go wrong silently. A dropped entry raises no
 * error: the code answers "not listed", which reads exactly like a legitimate
 * answer.
 */

import {
  lookupExemption,
  UNKEYED_EXEMPTIONS,
  EXEMPT_TABLE_INFO,
  CONDITION_QUESTION,
} from '@/lib/exempt-goods-lookup'
import { CONDITION_TEXT } from '@/lib/hsn-rate-lookup'
import { readCode } from '@/test-support/read-source'

describe('the condition that decides half the kirana', () => {
  test('loose curd is a question, not an answer', () => {
    // 0403 — "other than pre-packaged and labelled".
    const r = lookupExemption('0403')
    expect(r.outcome).toBe('needs-confirmation')
    expect(r.rules[0].conditions).toContain('pre-packaged-and-labelled')
  })

  test('paneer is exempt either way, and is NOT asked about', () => {
    /*
     * 0406 — "WHETHER OR NOT pre-packaged and labelled". It shares almost
     * every word with 0403 and means the opposite. A substring match on
     * "pre-packaged and labelled" gets this wrong, and a needless question is
     * not harmless: asked something with no bearing on the answer, a
     * shopkeeper learns to dismiss the question, including when it decides a
     * rate.
     */
    const r = lookupExemption('0406')
    expect(r.outcome).toBe('exempt')
    expect(r.rules[0].conditions).toEqual([])
  })
})

describe('the entries a broken separator silently dropped', () => {
  /*
   * THE BUG THIS PINS, written twice in this repo now.
   *
   * The first HSN-cell pattern here was /^[\d\s,]+$/ — comma-separated only.
   * The gazette also uses "or", "/" and "to", so sixteen entries fell through
   * into the description, ended up with no code, and were skipped. No error,
   * no warning: staples of the exact shops this app serves would have answered
   * "not listed" forever.
   *
   * The identical mistake dropped 44 rows from the RATE parser earlier this
   * month ("1701 or1702"), caught then only because a histogram looked odd.
   * Twice is a class, so it gets a test naming the actual goods.
   */
  test.each([
    ['1701', 'jaggery / gur', '1701 or 1702'],
    ['1702', 'khandsari sugar, rab', '1701 or 1702'],
    ['1905', 'bread, roti, chapathi, paratha', '1905 or 2106'],
    ['2106', 'Indian breads by any name', '1905 or 2106'],
    ['4802', 'judicial stamp papers', '4802 / 4907'],
    ['96190010', 'sanitary napkins', '9619 00 10 or 9619 00 20'],
    ['50', 'khadi fabric (range 50 to 55)', '50 to 55'],
    ['55', 'khadi fabric (range end)', '50 to 55'],
  ])('%s (%s) is present — source cell wrote it as "%s"', (hsn) => {
    expect(lookupExemption(hsn).outcome).not.toBe('not-listed')
  })

  test('a spaced tariff item is read as ONE code, not three', () => {
    /*
     * "9619 00 10" is a single 8-digit item. Splitting on whitespace would
     * yield 9619, 00 and 10 — and "10" is Chapter 10, cereals. That would
     * exempt cereals off the back of a sanitary-napkin row.
     */
    expect(lookupExemption('96190010').matchedOn).toBe('96190010')
    const chapter10 = lookupExemption('1006')
    expect(chapter10.matchedOn).toBe('1006')   // its own rice entry, not '10'
  })
})

describe('what must NOT be exempt', () => {
  /*
   * The gazette prints a page number on every page, and a bare "27" is
   * indistinguishable in shape from Chapter 27 — mineral fuels. If page
   * furniture reached the parser, the table would exempt petrol, and the app
   * would tell a fuel seller their sales carry no tax.
   */
  test.each([
    ['2710', 'petrol, diesel'],
    ['2709', 'crude'],
    ['2203', 'beer'],
    ['2208', 'spirits'],
    ['27', 'the whole mineral-fuels chapter'],
  ])('%s (%s) is not in the exemption table', (hsn) => {
    expect(lookupExemption(hsn).outcome).toBe('not-listed')
  })
})

describe('"not listed" is not "taxable"', () => {
  test('the message refuses to draw the further conclusion', () => {
    /*
     * This table answers one question: does 10/2025 exempt the code. A good
     * that is not exempt may still be nil-rated or outside GST — other
     * tables' questions. Answering "taxable" here is this file replying to
     * something it was not asked, which is how a lookup starts producing
     * confident wrong returns.
     */
    const r = lookupExemption('8471')     // computers
    expect(r.outcome).toBe('not-listed')
    expect(r.message).toMatch(/does not by itself make it taxable/)
  })
})

describe('longest match wins', () => {
  test('a specific entry beats the chapter it sits in', () => {
    // Chapter 03 is exempt for fish seeds; 0302 has its own entry.
    expect(lookupExemption('0302').matchedOn).toBe('0302')
  })

  test('an 8-digit product code falls back to its heading', () => {
    expect(lookupExemption('04070010').matchedOn).toBe('0407')
  })
})

describe('exemptions with no HSN are kept, not dropped', () => {
  test('rakhi and puja samagri survive', () => {
    /*
     * Six entries are keyed "Any Chapter" or a bare dash. They cannot be
     * looked up — and they are not obscure: a rakhi sold at 0% would fall to
     * the residual "nil-rated" and land in the wrong GSTR-1 box. Carried so a
     * screen can offer them as a checklist, rather than quietly lost.
     */
    const text = UNKEYED_EXEMPTIONS.map(u => u.description).join(' | ').toLowerCase()
    expect(text).toContain('rakhi')
    expect(text).toContain('puja samagri')
    expect(UNKEYED_EXEMPTIONS.length).toBeGreaterThanOrEqual(6)
  })
})

describe('every condition the data emits has words for a shopkeeper', () => {
  test('no rule carries a condition code with no explanation', () => {
    /*
     * A condition with no entry in CONDITION_TEXT reaches the screen as a raw
     * slug like "seller-specific". The guard is the join between the parser
     * and the UI: adding a condition in the parser and forgetting the wording
     * is silent, and shows up only as jargon on a shopkeeper's screen.
     */
    const seen = new Set<string>()
    for (let ch = 1; ch <= 99; ch++) {
      const r = lookupExemption(String(ch).padStart(2, '0'))
      r.rules.forEach(rule => rule.conditions.forEach(c => seen.add(c)))
    }
    UNKEYED_EXEMPTIONS.forEach(u => u.conditions.forEach(c => seen.add(c)))
    const missing = [...seen].filter(c => !CONDITION_TEXT[c])
    expect({ missing }).toEqual({ missing: [] })
  })
})

describe('the table says where it came from', () => {
  test('it cites the notification it was built from, and the one it replaced', () => {
    // §0: every figure shows receipts that open the real record.
    expect(EXEMPT_TABLE_INFO.notification).toBe('10/2025-Central Tax (Rate)')
    expect(EXEMPT_TABLE_INFO.gazette).toBe('G.S.R. 660(E)')
    expect(EXEMPT_TABLE_INFO.supersedes).toBe('02/2017-Central Tax (Rate)')
  })

  test('the table is the whole schedule, not a fragment of it', () => {
    /*
     * A parser that silently stops early looks identical to one that finished.
     * The source Schedule has 172 numbered entries; anything materially below
     * that means the walk ended somewhere it should not have.
     */
    expect(EXEMPT_TABLE_INFO.entryCount).toBe(172)
    expect(EXEMPT_TABLE_INFO.codeCount).toBeGreaterThanOrEqual(180)
  })
})

describe('the item screen ASKS when the answer is conditional (#93)', () => {
  const ui = readCode('src/components/inventory/ProductDialog.tsx')

  test('a conditional exemption renders a question, not a default', () => {
    /*
     * THE GAP THIS CLOSES, which I created earlier the same day.
     *
     * Replacing the hand-written exempt list stopped the app answering
     * "exempt" for loose rice — correctly, because 1006 is exempt only "other
     * than pre-packaged and labelled". But nothing then asked, so a 0% rice
     * landed on the schema default of 'taxable'. Verified live: HSN 1006 at 0%
     * came back gstTreatment 'taxable'. One silent wrong answer for another.
     */
    expect(ui).toContain("exemption?.outcome === 'needs-confirmation'")
    expect(ui).toContain('CONDITION_QUESTION')
  })

  test('the question comes from the condition, never hard-coded', () => {
    /*
     * MY SECOND BUG HERE, shipped and then caught while starting #94.
     *
     * The first version asked "Is this sold loose, or pre-packaged and
     * labelled?" for EVERY conditional entry. Only 41 of 99 conditional rules
     * are about packaging; 26 turn on fresh-or-chilled, 13 on who sells it,
     * 11 on seed quality. So a potato seller was asked about packaging when
     * the notification asks about freshness, and their answer set a treatment
     * on a question the law never posed.
     *
     * The literal string must NOT appear in the rendered component — the
     * wording now lives in CONDITION_QUESTION, keyed by condition.
     */
    expect(ui).not.toContain('Is this sold loose, or pre-packaged and labelled?')
    expect(ui).toContain('q.question')
    expect(ui).toContain('q.exemptLabel')
    expect(ui).toContain('q.taxableLabel')
  })

  test('every condition the data emits has a question with both answers', () => {
    /*
     * The join between parser and screen. A condition added to the parser and
     * not given wording renders as nothing at all — the buttons simply do not
     * appear, and the shopkeeper sees a panel with no way to answer it.
     */
    const seen = new Set<string>()
    for (let ch = 1; ch <= 99; ch++) {
      lookupExemption(String(ch).padStart(2, '0'))
        .rules.forEach(r => r.conditions.forEach(c => seen.add(c)))
    }
    const missing = [...seen].filter(c => {
      const q = CONDITION_QUESTION[c]
      return !q?.question || !q?.exemptLabel || !q?.taxableLabel
    })
    expect({ missing }).toEqual({ missing: [] })
  })

  test('the mirrored condition is not asked backwards', () => {
    /*
     * "other than fresh or chilled" EXEMPTS the frozen/processed form, while
     * "fresh or chilled" exempts the fresh one. A single shared yes/no would
     * invert one of them, silently, on 26 + 17 rules.
     */
    expect(CONDITION_QUESTION['fresh-or-chilled-only'].exemptLabel).toBe('Fresh or chilled')
    expect(CONDITION_QUESTION['not-fresh-or-chilled'].exemptLabel).toBe('Frozen or processed')
  })

  test('a rule with two conditions needs BOTH answered the exempt way', () => {
    /*
     * 17 rules read "other than fresh or chilled, other than pre-packaged and
     * labelled" — two tests, cumulative. Answering one and defaulting the
     * other would grant an exemption on half the evidence.
     */
    expect(ui).toContain("requiredConditions.every(c => conditionAnswers[c] === 'exempt')")
    expect(ui).toContain('requiredConditions.every(c => conditionAnswers[c])')
  })

  test('answers do not carry over to the next item', () => {
    // The dialog instance is reused. An inherited "sold loose" would silently
    // exempt the next product the shopkeeper adds.
    expect(ui).toContain('setConditionAnswers({})')
  })

  test('the question cites the notification it came from', () => {
    // §0 — every figure shows receipts that open the real record.
    expect(ui).toContain('exemption.source')
    expect(ui).toContain('exemption.rules[0].serial')
  })

  test('a rate above zero settles it, and nothing is asked', () => {
    expect(ui).toMatch(/if \(rate > 0\) return null/)
  })
})
