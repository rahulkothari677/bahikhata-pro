/**
 * 🔒 GUARD: Customise Home never hides Home by accident (Phase 5b-6).
 * Stored choices are untrusted: bad JSON, old ids or blocked storage mean
 * "show everything"; the Today card is never a choice.
 */
import { describe, test, expect } from '@jest/globals'
import { HOME_SECTIONS, parseHidden } from '@/lib/home-sections'
import { translations } from '@/lib/i18n'
import { readCode } from '@/test-support/read-source'

describe('parseHidden', () => {
  test('good and bad stored values', () => {
    expect(parseHidden('["trends","top"]')).toEqual(['trends', 'top'])
    expect(parseHidden('["trends","trends","nope",3]')).toEqual(['trends'])
    expect(parseHidden('not json')).toEqual([])
    expect(parseHidden('{"a":1}')).toEqual([])
    expect(parseHidden(null)).toEqual([])
  })
})

describe('sections', () => {
  test('the Today card is not switchable; every section has words in English and Hindi', () => {
    expect(HOME_SECTIONS.map((s) => s.id)).not.toContain('today')
    const en = translations.en as unknown as Record<string, string>
    const hi = translations.hi as unknown as Record<string, string>
    expect(HOME_SECTIONS.filter((s) => !en[s.key] || !hi[s.key]).map((s) => s.id)).toEqual([])
  })
  test('Home honours every switch', () => {
    const code = readCode('src/components/dashboard/Dashboard.tsx')
    for (const s of HOME_SECTIONS) {
      expect({ id: s.id, used: code.includes(`home.shown('${s.id}')`) }).toEqual({ id: s.id, used: true })
    }
    expect(code).toMatch(/<CustomiseHome home=\{home\} \/>/)
  })
})
