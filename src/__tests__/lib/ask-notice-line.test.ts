/**
 * 🔒 The moat's own sentence — the one that had never rendered.
 *
 * Master plan §2: Rule 88C is the moat. GSTR-1 tax exceeding GSTR-3B by more
 * than 20% AND more than ₹25 lakh triggers DRC-01B automatically — 7 days to
 * respond, then the next GSTR-1 is blocked, which stops the shop's B2B
 * customers claiming input credit from them. Vyapar sells a separate product
 * for this; we compute it in-app.
 *
 * A1 put that into the GST answer, and Gate 3 could only verify the CLEAR
 * path: this shop's GSTR-1 and 3B both report ₹174.50, because our 3B derives
 * from the same books as our GSTR-1 and they agree BY CONSTRUCTION. That is
 * the product working — and it meant the notice wording could not be reached
 * without ₹1.4 crore of fabricated sales.
 *
 * So the wording moved out of the route into a pure function, and these tests
 * are what "A1b" actually is: the highest-stakes sentence in the app, checked.
 */

import { describe, test, expect } from '@jest/globals'
import { buildNoticeLine } from '@/lib/ask-notice-line'
import { RESPONSE_DAYS } from '@/lib/notice-risk'

describe('notice — both limits crossed', () => {
  const r = buildNoticeLine({
    overall: 'notice',
    rule: {
      headline: 'GSTR-1 declares ₹31,00,000 more tax than GSTR-3B — 34% above.',
      consequence: 'The portal issues DRC-01B automatically.',
    },
  })

  test('leads with a warning, not a figure', () => {
    expect(r.line).toMatch(/^⚠️/)
  })

  test('carries the real numbers from the assessment, not generic text', () => {
    /*
     * THE BUG THIS PINS. I first read `c88.summary`, which is not a field on
     * RuleAssessment — so every notice would have shown generic wording with
     * NO excess, NO percentage and NO indication of which limit was crossed,
     * on the one answer where the numbers are the entire point. It read
     * perfectly well, which is why nothing caught it.
     */
    expect(r.line).toContain('31,00,000')
    expect(r.line).toContain('34%')
  })

  test('offers the way to fix it before filing', () => {
    expect(r.action).toEqual({ kind: 'open-screen', label: 'Fix before filing', destinationId: 'gstr-3b' })
  })

  test('falls back to a sentence that still says what happens', () => {
    // If the assessment ever arrives without its composed text, the fallback
    // must still name the deadline and the consequence — never a bare "risk".
    const bare = buildNoticeLine({ overall: 'notice', rule: null })
    expect(bare.line).toContain('DRC-01B')
    expect(bare.line).toContain(String(RESPONSE_DAYS))
    expect(bare.line).toMatch(/blocked/)
    expect(bare.line).toMatch(/input credit/)
    expect(bare.action).not.toBeNull()
  })
})

describe('difference — under the threshold is NOT "safe"', () => {
  const r = buildNoticeLine({
    overall: 'difference',
    rule: { headline: 'GSTR-1 declares ₹4,000 more tax than GSTR-3B.', consequence: null },
  })

  test('never says safe, clear, fine or no risk', () => {
    /*
     * The one lie this feature cannot afford. A shortfall below the limit is
     * still a shortfall — the Notice Risk panel follows the same rule, and the
     * answer must not be more reassuring than the panel.
     */
    expect(r.line!.toLowerCase()).not.toMatch(/\b(safe|no risk|you're fine|all clear)\b/)
  })

  test('says it is below the notice level AND that differences cause notices', () => {
    expect(r.line).toMatch(/below the level/i)
    expect(r.line).toMatch(/commonest reason/i)
  })

  test('offers to show the difference', () => {
    expect(r.action?.label).toBe('See the difference')
  })
})

describe('clear — §4.2 "calm when fine"', () => {
  const r = buildNoticeLine({
    overall: 'clear',
    rule: { headline: 'Your GSTR-1 and GSTR-3B declare the same tax.', consequence: null },
  })

  test('one line', () => {
    expect(r.line!.split('\n')).toHaveLength(1)
  })

  test('NO button — nothing to fix', () => {
    // An app that offers an action every month teaches people to ignore the
    // months when there is one.
    expect(r.action).toBeNull()
  })

  test('no warning symbol on a clean month', () => {
    expect(r.line).not.toContain('⚠️')
  })
})

describe('unassessed — silence, never reassurance', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
  ])('%s produces no line and no action', (_label, input) => {
    /*
     * This is what a failed fetch produces. A tax figure with no risk note is
     * honest; inventing "nothing triggers a notice" from a lookup that never
     * succeeded would be the worst possible failure of this feature.
     */
    const r = buildNoticeLine(input as never)
    expect(r).toEqual({ line: null, action: null })
  })

  test('an unrecognised verdict is treated as clear, not as a notice', () => {
    // Defensive: a future level name must not silently become a warning.
    const r = buildNoticeLine({ overall: 'something-new', rule: null })
    expect(r.line).not.toContain('⚠️')
    expect(r.action).toBeNull()
  })
})
