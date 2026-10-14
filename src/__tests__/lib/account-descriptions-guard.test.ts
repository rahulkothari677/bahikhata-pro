/**
 * 🔒 GUARD: Account-row descriptions fit one phone line (Phase 4 close, 14 Oct 2026).
 *
 * The 4d sweep found six settings on the Account screen whose one-line
 * description was cut mid-word at 375 px ("Bill design, how bills are sent,
 * rou…"). The line holds 39 characters at 375 px and about 36 on a 360 px
 * phone. Each sentence also lived in two places (registry fallback and i18n
 * English), which is how a shortened copy and a long copy drift apart.
 *
 * The rule is a function in test-support/design-rules.ts, tested on known-good
 * and known-bad input first, then swept over the real registry.
 */
import { describe, test, expect } from '@jest/globals'
import { NAV_REGISTRY } from '@/lib/nav-registry'
import { translations } from '@/lib/i18n'
import { accountDescriptionProblems, MAX_ROW_DESC_CHARS } from '@/test-support/design-rules'

describe('the rule catches what it claims (good and bad input)', () => {
  const en = { 'k.short': 'Short and fine', 'k.long': 'This description is far too long to fit on one phone line' }

  test('a short description that matches in both places passes', () => {
    expect(accountDescriptionProblems([{ id: 'a', description: 'Short and fine', descKey: 'k.short' }], en)).toEqual([])
  })

  test('a description longer than the line fails, from i18n or from the registry', () => {
    expect(accountDescriptionProblems([{ id: 'b', description: en['k.long'], descKey: 'k.long' }], en)).toHaveLength(1)
    expect(accountDescriptionProblems([{ id: 'c', description: 'No key, and this one is also much too long for a row' }], en)).toHaveLength(1)
  })

  test('two copies that disagree fail even when both are short', () => {
    expect(accountDescriptionProblems([{ id: 'd', description: 'Old words', descKey: 'k.short' }], en)[0]).toMatch(/registry says/)
  })

  test('the limit is the measured one, exactly at the edge', () => {
    const edge = 'x'.repeat(MAX_ROW_DESC_CHARS)
    expect(accountDescriptionProblems([{ id: 'e', description: edge }], {})).toEqual([])
    expect(accountDescriptionProblems([{ id: 'f', description: edge + 'x' }], {})).toHaveLength(1)
  })
})

describe('the Account screen', () => {
  test('every row description fits one line on a 360 px phone, and both copies agree', () => {
    const rows = NAV_REGISTRY.filter((d) => d.surfaces?.includes('account'))
    expect(rows.length).toBeGreaterThan(10)
    expect(accountDescriptionProblems(rows, translations.en as unknown as Record<string, string>)).toEqual([])
  })
})
