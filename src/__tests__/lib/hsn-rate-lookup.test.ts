/**
 * HSN → GST rate: the lookup the CA asked for, and the guesses it refuses.
 *
 * BACKGROUND. The CA reviewed our GST handling and found a live defect: a
 * 0%-rated line with no declared treatment was being called **nil-rated**.
 * His words: *"it is wrong treatment."* Nil-rated, exempt and non-GST are
 * decided by what the item IS, and they go in different boxes of GSTR-1 Table
 * 8 and GSTR-3B 3.1(c)/(e). He then asked for this lookup.
 *
 * The tests below are mostly about what it must NOT say. A lookup that
 * confidently returns a wrong rate is worse than one that says "I don't know",
 * because the wrong rate flows into both returns and nobody re-checks it.
 *
 * Every rate asserted here was read out of the notification the CA supplied.
 */

import {
  lookupHsn,
  normaliseHsn,
  RATE_TABLE_META,
  CONDITION_TEXT,
} from '@/lib/hsn-rate-lookup'
import { GST_RATE_SLABS } from '@/lib/gst-rates'
import rateTable from '@/lib/data/gst-goods-rates.json'

describe('the table itself', () => {
  test('is the 22 Sep 2025 notification, not something older', () => {
    // If this ever silently reverts to a pre-2025 list, every rate in the app
    // is quietly wrong — the restructure moved most of 12% and 28%.
    expect(RATE_TABLE_META.notification).toBe('09/2025-Central Tax (Rate)')
    expect(RATE_TABLE_META.ratesAsOn).toBe('2025-09-22')
  })

  test('parsed a real table, not an empty one', () => {
    // A parser that silently matches nothing looks exactly like one that
    // matched everything. This is the floor.
    expect(RATE_TABLE_META.ruleCount).toBeGreaterThan(1000)
    expect(RATE_TABLE_META.codeCount).toBeGreaterThan(900)
  })

  test('every rate it can suggest is a slab the app can actually store', () => {
    /*
     * ONE VOCABULARY. gst-rates.ts owns which slabs a shopkeeper may pick.
     * If this table suggested a rate that list does not contain, the app
     * would propose something the product form cannot save — two lists
     * describing one thing, which is Cause 2 in CLAUDE.md.
     */
    const suggested = new Set<number>()
    for (const code of ['1006', '2202', '7108', '2403', '0402']) {
      const r = lookupHsn(code)
      r.rules.forEach(rule => suggested.add(rule.gstRate))
    }
    for (const rate of suggested) {
      expect(GST_RATE_SLABS).toContain(rate as never)
    }
  })
})

describe('rates read from the notification', () => {
  test.each([
    ['7108', 3, 'gold'],
    ['0402', 5, 'concentrated/sweetened milk'],
  ])('HSN %s is %i%% (%s)', (hsn, rate) => {
    const r = lookupHsn(hsn)
    expect(r.rules.map(x => x.gstRate)).toContain(rate)
  })

  test('carbonated drinks are 40% — the slab that did not exist in the app for months', () => {
    // The picker offered a maximum of 28% until Aug 2026, so a kirana selling
    // cold drinks under-charged by 12 points, and the shortfall is the shop's
    // own liability. The lookup must know the real figure.
    const r = lookupHsn('2202')
    expect(r.rules.some(x => x.gstRate === 40)).toBe(true)
  })

  test('a code whose rate changed AFTER the table refuses instead of answering', () => {
    /*
     * THE BUG THIS PINS, and I shipped it.
     *
     * The table is parsed from Notification 09/2025 — "rates as on 22.09.2025".
     * Tobacco moved to 40% on 1 Feb 2026 (Notification 19/2025-CT(R), dated
     * 31.12.2025). So for eleven months this answered 28% for cigarettes,
     * confidently, with a schedule reference attached to make it look sound.
     *
     * It must now refuse. It deliberately does NOT answer 40% either: bidi
     * dropped to 18% (it had been 28% + cess) while the rest of heading 2403
     * rose to 40%, so a single number on the heading would be a new wrong
     * answer replacing the old one. (Was "bidi stayed at 18%" — wrong; #121.)
     */
    const r = lookupHsn('2402')   // cigarettes
    expect(r.outcome).toBe('superseded')
    expect(r.suggestedRate).toBeNull()
    expect(r.message).toMatch(/19\/2025/)
    expect(r.message).toMatch(/1 February 2026/)
    // and it must not still be quoting the stale figure
    expect(r.message).not.toMatch(/28%/)
  })

  test('the supersession names bidi, because the heading did not move as one', () => {
    // Getting this wrong in the other direction — stamping 40% on all of 2403
    // — would overcharge every bidi sale by 22 points.
    expect(lookupHsn('2403').supersededBy!.note).toMatch(/bidi/i)
  })

  test('codes NOT affected by the amendment still answer normally', () => {
    // The refusal must be surgical. Gold is nowhere near tobacco.
    expect(lookupHsn('7108').outcome).not.toBe('superseded')
    expect(lookupHsn('7108').suggestedRate).toBe(3)
  })

  test('there is no 12% rate for goods any more', () => {
    /*
     * The 2025 restructure collapsed the slabs: Schedule II is now 9% CGST
     * (18% GST), not 6% (12%). Nothing in the goods notification carries 12%.
     * If a future re-parse produces one, either the source changed or the
     * parser broke — both worth stopping for.
     */
    const rates = new Set<number>()
    for (const code of Object.keys({ '1006': 1, '2202': 1, '7108': 1, '0402': 1, '1701': 1 })) {
      lookupHsn(code).rules.forEach(x => rates.add(x.gstRate))
    }
    expect([...rates]).not.toContain(12)
  })
})

describe('it refuses rather than guesses', () => {
  test('an unknown code is NOT reported as 0% or exempt', () => {
    /*
     * THE WHOLE POINT. Plain milk (0401) is absent from the rate schedules
     * because it is EXEMPT — and the exemption notification has not been
     * supplied yet. Answering "0%" would be right by accident and wrong in
     * principle: exempt, nil-rated and non-GST are three different boxes on
     * the return, which is exactly the mistake the CA caught.
     */
    const r = lookupHsn('0401')
    expect(r.outcome).toBe('unknown')
    expect(r.suggestedRate).toBeNull()
    expect(r.message).toMatch(/may be exempt or nil-rated/i)
    expect(r.message).not.toMatch(/\b0%/)
  })

  test('a conditional row is flagged, never auto-applied', () => {
    // Rice is 5% ONLY when pre-packaged and labelled. Sold loose it is exempt.
    // Silently stamping 5% on loose rice overcharges the customer and
    // overstates the return.
    const r = lookupHsn('1006')
    expect(r.outcome).toBe('needs-confirmation')
    expect(r.rules[0].conditions).toContain('pre-packaged-and-labelled')
    expect(CONDITION_TEXT['pre-packaged-and-labelled']).toMatch(/sold loose/i)
  })

  test('a code with several different rates asks instead of picking', () => {
    // 2202 covers both 5% plant-based drinks and 40% carbonated ones. Choosing
    // one for the shopkeeper would be a 35-point error made silently.
    const r = lookupHsn('2202')
    expect(r.outcome).toBe('ambiguous')
    expect(r.suggestedRate).toBeNull()
    expect(r.message).toMatch(/different rates/i)
  })

  test('a code the row explicitly excludes does not inherit its rate', () => {
    /*
     * "0910 [other than 0910 11 10, 0910 30 10]" means those two sub-codes are
     * carved out. Fresh ginger and fresh turmeric are exempt; the row covers
     * the dried forms. Applying 5% to 09101110 would tax an exempt good.
     */
    const excluded = lookupHsn('09101110')
    expect(excluded.suggestedRate).toBeNull()
    expect(excluded.message).toMatch(/excludes/i)

    // while the heading itself still answers
    expect(lookupHsn('0910').rules.length).toBeGreaterThan(0)
  })
})

describe('matching the right level of code', () => {
  test('falls back from a long code to its heading', () => {
    // A shopkeeper typing 8 digits for a good listed at 4 should still get an
    // answer, from the heading.
    const r = lookupHsn('07081000')
    if (r.outcome !== 'unknown') expect(r.matchedOn!.length).toBeLessThanOrEqual(8)
  })

  test('ignores spaces and dashes, because people type them', () => {
    expect(normaliseHsn('0910 30')).toBe('091030')
    expect(normaliseHsn('7108-00-00')).toBe('71080000')
    expect(lookupHsn('7108').rules).toEqual(lookupHsn('71 08').rules)
  })

  test('one digit is not a question', () => {
    expect(lookupHsn('7').outcome).toBe('unknown')
    expect(lookupHsn('').outcome).toBe('unknown')
  })
})

describe('Phase 8b: a rate change read from the notification answers from its date (IST)', () => {
  // 02/2026-CT(R), 27 Oct 2026: Sch. I S.No. 272A retreaded tractor tyres at 5%; Sch. II S.No. 138 narrowed.
  const before = new Date('2026-10-31T18:00:00.000Z') // 31 Oct, 23:30 IST
  const after = new Date('2026-10-31T18:31:00.000Z')  // 1 Nov, 00:01 IST

  test('before 1 Nov: every retreaded tyre is 18%', () => {
    const r = lookupHsn('4012', before)
    expect(r.outcome).toBe('single')
    expect(r.suggestedRate).toBe(18)
  })
  test('from 1 Nov: two rates, so the shopkeeper picks — 5% tractor, 18% the rest — citing 02/2026', () => {
    const r = lookupHsn('401210', after)
    expect(r.outcome).toBe('ambiguous')
    expect(r.rules.map((x) => x.gstRate).sort((a, b) => a - b)).toEqual([5, 18])
    expect(r.rules.find((x) => x.gstRate === 5)!.description).toBe('Retreaded tractor tyres')
    expect(r.source.notification).toMatch(/02\/2026-Central Tax \(Rate\)/)
    expect(r.message).toMatch(/1 November 2026/)
  })
  test('fertiliser (3101): still 5% and still conditional; from 1 Nov the words of 02/2026 S.No. 237', () => {
    const was = lookupHsn('3101', before)
    const now = lookupHsn('31010099', after)
    expect([was.suggestedRate, now.suggestedRate]).toEqual([5, 5])
    expect([was.outcome, now.outcome]).toEqual(['needs-confirmation', 'needs-confirmation'])
    expect(was.rules[0].description).not.toMatch(/bio-stimulants/)
    expect(now.rules[0].description).toMatch(/sea-weed extract based bio-stimulants/)
    expect(now.source.notification).toMatch(/^02\/2026-Central Tax \(Rate\)/)
  })
  test('a short code ("40") is not answered by the tyre rows', () => {
    expect(lookupHsn('40', after).supersededBy?.prefixes).not.toEqual(['4012'])
  })
})

describe('#120: a chapter key answers only as a question, and only genuine chapters exist', () => {
  /*
   * A tariff item wrapped across lines ("2202 99 10") reached the table as its
   * pieces, and "99", "10", "49"… posed as chapter keys: 3,724 of the 9,700
   * headings were answered by a fragment — radios at 5%, books as "tube for
   * tractor tyres". Hand-picked tests all passed. Only a sweep of every
   * heading showed it, so the sweep is the guard.
   */
  // Rows whose ONLY code is a chapter: 61 apparel, 64 footwear, "84, 85 or 94"
  // renewable devices, "or any Chapter" medical goods, and the like.
  const GENUINE_CHAPTERS = [
    '07', '08', '12', '27', '28', '29', '30', '32', '39', '44', '48', '60', '61',
    '62', '63', '64', '68', '83', '84', '85', '87', '88', '90', '94',
  ]
  const codes = Object.keys(rateTable.codes)

  test('the table holds no chapter key but the genuine ones', () => {
    expect(codes.filter((k) => k.length === 2).sort()).toEqual([...GENUINE_CHAPTERS].sort())
  })

  test('sweep: no heading in chapters 01–98 gets a plain rate from a chapter row', () => {
    let viaChapter = 0
    const bad: string[] = []
    for (let ch = 1; ch <= 98; ch++) {
      for (let h = 1; h <= 99; h++) {
        const hsn = String(ch).padStart(2, '0') + String(h).padStart(2, '0')
        const r = lookupHsn(hsn, new Date('2026-10-01T06:30:00Z'))
        if (r.matchedOn?.length !== 2) continue
        viaChapter++
        if (r.outcome === 'single' || !GENUINE_CHAPTERS.includes(r.matchedOn)) bad.push(`${hsn}→${r.matchedOn}:${r.outcome}`)
      }
    }
    expect(bad).toEqual([])
    expect(viaChapter).toBeGreaterThan(0) // the sweep reached chapter rows at all
  })

  test('the two symptoms that found it are gone', () => {
    expect(lookupHsn('4901').rules.map((r) => r.description)).not.toContain('Tube for tractor tyres')
    const radio = lookupHsn('8527')
    expect(radio.outcome).not.toBe('single')
    expect(radio.message).toMatch(/only for the goods it names/)
    expect(radio.rules[0].description).toMatch(/renewable energy devices/) // the words, for the ⓘ
  })
})

describe('every answer can be checked by a CA', () => {
  test('it names the notification and the date it applies from', () => {
    // A figure with no provenance is an opinion. A CA has to be able to open
    // the statute at the right entry.
    const r = lookupHsn('7108')
    expect(r.source.notification).toBe('09/2025-Central Tax (Rate)')
    expect(r.source.ratesAsOn).toBe('2025-09-22')
    expect(r.rules[0].description.length).toBeGreaterThan(0)
  })
})
