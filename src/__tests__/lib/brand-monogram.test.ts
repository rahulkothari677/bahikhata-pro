import { deriveMonogram, monogramHue } from '@/lib/brand-monogram'

/**
 * WHY (2026-07-29): every card design has a logo slot and most shopkeepers will
 * never upload a file. A dashed placeholder is fine while editing and
 * embarrassing once the card is shared, so the slot is never empty — a monogram
 * is derived from names the user has already entered.
 *
 * These cases are the ones that decide whether it looks considered or automatic.
 */

describe('the shop name wins, because that is what is on the signboard', () => {
  it('takes both initials from a two-word shop name', () => {
    expect(deriveMonogram('RK Enterprises', 'Rahul Kothari')).toBe('RK')
  })

  it('drops trade words so a three-word shop still gives TWO letters', () => {
    // "Sharma Kirana Store" -> SKS would be wrong. Nobody writes three letters
    // on a card, and "Store" is not the distinctive part of the name.
    expect(deriveMonogram('Sharma Kirana Store', 'Rahul Kothari')).toBe('SK')
    expect(deriveMonogram('Gupta General Store', null)).toBe('GG')
  })

  it('keeps a trade word when dropping it would leave nothing', () => {
    // "Kirana Store" is entirely trade words — returning empty would be worse
    // than returning KS.
    expect(deriveMonogram('Kirana Store', null)).toBe('KS')
  })

  it('does not treat a distinctive word as a trade word', () => {
    expect(deriveMonogram('Kumar Medical', null)).toBe('KM')
  })
})

describe('falling back to the owner', () => {
  it('uses the owner when the shop yields only one initial', () => {
    expect(deriveMonogram('Bakery', 'Rahul Kothari')).toBe('RK')
  })

  it('ignores honorifics', () => {
    // "Mr Rahul Kothari" must not become MR.
    expect(deriveMonogram(null, 'Mr Rahul Kothari')).toBe('RK')
    expect(deriveMonogram(null, 'Dr. Anita Sharma')).toBe('AS')
    expect(deriveMonogram(null, 'Shri Ram Prasad')).toBe('RP')
  })
})

describe('it always returns something renderable', () => {
  it('takes two letters from a single-word shop with no owner', () => {
    expect(deriveMonogram('Bakery', null)).toBe('BA')
  })

  it('never returns an empty string', () => {
    // The caller would have to handle a blank badge, and eventually one would
    // not — so this function refuses to produce one.
    for (const [shop, owner] of [[null, null], ['', ''], ['   ', '  '], ['!!!', '???']] as const) {
      expect(deriveMonogram(shop, owner).length).toBeGreaterThan(0)
    }
  })

  it('handles punctuation-heavy names', () => {
    expect(deriveMonogram('S.K. Traders', null)).toBe('SK')
    expect(deriveMonogram('Ram & Shyam', null)).toBe('RS')
    expect(deriveMonogram('Verma-Kothari', null)).toBe('VK')
  })

  it('handles Devanagari without emitting a stray diacritic', () => {
    // A shop named in Hindi must still produce a letter, not a combining mark.
    const m = deriveMonogram('शर्मा किराना', null)
    expect(m.length).toBeGreaterThan(0)
    expect(m).not.toMatch(/[̀-ͯ]/)
  })
})

describe('the badge colour is stable', () => {
  it('returns the same hue for the same name every time', () => {
    // A monogram that changes shade on reload reads as a rendering bug.
    expect(monogramHue('Sharma Kirana')).toBe(monogramHue('Sharma Kirana'))
  })

  it('separates different shops', () => {
    expect(monogramHue('Sharma Kirana')).not.toBe(monogramHue('Gupta Medical'))
  })

  it('stays inside the hue circle', () => {
    for (const s of ['A', 'Sharma Kirana Store', 'RK', '']) {
      const h = monogramHue(s)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(360)
    }
  })
})
