/**
 * What actually gets printed on a shopkeeper's business card.
 *
 * 🐛 The email case is the reason this file exists. The card was reading
 * `session.user.email` — the address you SIGN IN with — while Settings has had
 * its own Email field all along, so a shopkeeper who signs in with a personal
 * Gmail printed that personal address on every card they shared. Nothing owned
 * the question of where a card field comes from, so each caller answered it
 * differently. These tests pin the answer down.
 */

import {
  resolveCardValues,
  resolveCardData,
  resolveCardLogo,
  cardShowsMonogram,
  profileCardValues,
  cardColumn,
  CARD_FIELDS,
} from '@/lib/card-details'

const PROFILE = {
  shopName: 'Sharma Kirana Store',
  ownerName: 'Rahul Sharma',
  phone: '+91 90000 00001',
  email: 'shop@sharmakirana.in',
  address: 'Indore, MP - 452001',
  gstin: '23ABCDE1234F1Z5',
}

describe('the email the card prints', () => {
  it('uses the shop email from Settings, not the sign-in address', () => {
    const v = resolveCardValues(PROFILE, 'rahul.personal@gmail.com')
    expect(v.email).toBe('shop@sharmakirana.in')
  })

  it('falls back to the sign-in address only when Settings has none', () => {
    const v = resolveCardValues({ ...PROFILE, email: null }, 'rahul.personal@gmail.com')
    expect(v.email).toBe('rahul.personal@gmail.com')
  })

  it('treats a whitespace-only Settings email as unset', () => {
    // A field the shopkeeper cleared by selecting the text and hitting space
    // must not print a blank line where their address should be.
    const v = resolveCardValues({ ...PROFILE, email: '   ' }, 'rahul.personal@gmail.com')
    expect(v.email).toBe('rahul.personal@gmail.com')
  })

  it('prefers the card override over both', () => {
    const v = resolveCardValues(
      { ...PROFILE, cardMode: 'manual', cardEmail: 'orders@sharmakirana.in' },
      'rahul.personal@gmail.com',
    )
    expect(v.email).toBe('orders@sharmakirana.in')
  })
})

describe('profile mode', () => {
  it('ignores the card overrides entirely', () => {
    // Toggling back to "use my profile" must not need the overrides deleted —
    // they are kept so the shopkeeper can toggle back without retyping.
    const v = resolveCardValues({
      ...PROFILE,
      cardMode: 'profile',
      cardShopName: 'Sharma Superstore',
      cardPhone: '+91 90000 99999',
    })
    expect(v.shopName).toBe('Sharma Kirana Store')
    expect(v.phone).toBe('+91 90000 00001')
  })

  it('is the default for a shop that has never opened the card editor', () => {
    const v = resolveCardValues({ ...PROFILE, cardShopName: 'Should Be Ignored' })
    expect(v.shopName).toBe('Sharma Kirana Store')
  })

  it('has no tagline to inherit — the profile has no such field', () => {
    expect(profileCardValues(PROFILE).tagline).toBeNull()
  })
})

describe('manual mode', () => {
  it('takes the fields that were filled in', () => {
    const v = resolveCardValues({
      ...PROFILE,
      cardMode: 'manual',
      cardShopName: 'Sharma Superstore',
      cardTagline: 'Since 1998',
    })
    expect(v.shopName).toBe('Sharma Superstore')
    expect(v.tagline).toBe('Since 1998')
  })

  it('falls back to the profile for fields left blank', () => {
    // THE POINT OF THE FALLBACK: switching to manual to change one line must
    // not blank the other six. A shopkeeper who overrides only the shop name
    // still has a phone number on their card.
    const v = resolveCardValues({ ...PROFILE, cardMode: 'manual', cardShopName: 'Sharma Superstore' })
    expect(v.phone).toBe('+91 90000 00001')
    expect(v.address).toBe('Indore, MP - 452001')
    expect(v.ownerName).toBe('Rahul Sharma')
  })

  it('never leaves the card empty when the profile is empty too', () => {
    const v = resolveCardValues({ cardMode: 'manual' })
    // Every field null is correct — the CARD renders its own defaults. What
    // must not happen is undefined leaking into the renderer.
    for (const f of CARD_FIELDS) {
      expect(v[f] === null ? 'null' : `unexpected: ${String(v[f])}`).toBe('null')
    }
  })
})

describe('column naming', () => {
  it('maps every field to its card column', () => {
    // A rename that broke this pairing would silently stop reading overrides —
    // the card would keep working, on the wrong values.
    expect(cardColumn('shopName')).toBe('cardShopName')
    expect(cardColumn('gstin')).toBe('cardGstin')
    expect(CARD_FIELDS.map(cardColumn)).toEqual([
      'cardShopName',
      'cardOwnerName',
      'cardTagline',
      'cardPhone',
      'cardEmail',
      'cardAddress',
      'cardGstin',
    ])
  })
})

describe('the mark on the card: logo or initials', () => {
  const LOGO = 'https://res.cloudinary.com/x/shop-logo.png'

  it('prints the logo when there is one and nothing was chosen', () => {
    // Uploading a logo is enough. A shopkeeper should not have to find a second
    // setting to make the thing they just uploaded appear.
    expect(resolveCardLogo({ logoUrl: LOGO })).toBe(LOGO)
    expect(cardShowsMonogram({ logoUrl: LOGO })).toBe(false)
  })

  it('prints the initials when no logo has been uploaded', () => {
    expect(resolveCardLogo({ logoUrl: null })).toBeNull()
    expect(cardShowsMonogram({})).toBe(true)
  })

  it('prints the initials when the shopkeeper asked for them', () => {
    expect(resolveCardLogo({ logoUrl: LOGO, cardMark: 'monogram' })).toBeNull()
    expect(cardShowsMonogram({ logoUrl: LOGO, cardMark: 'monogram' })).toBe(true)
  })

  it('KEEPS THE UPLOADED LOGO when the card is set to initials', () => {
    // The whole reason this is a card-only setting. Setting.logoUrl is shared
    // with the invoice PDF, where the logo prints in the brand band. If
    // choosing "Letters" on a visiting card silently stripped the logo from
    // every invoice the shop issues, that would be the app destroying the
    // user's data to satisfy a cosmetic preference.
    const setting = { logoUrl: LOGO, cardMark: 'monogram' }
    expect(resolveCardLogo(setting)).toBeNull()
    expect(setting.logoUrl).toBe(LOGO)
  })

  it('falls back to the initials when "logo" is chosen but none exists', () => {
    // Possible if the logo is removed while the preference stays behind. The
    // card must never render an empty mark.
    expect(resolveCardLogo({ logoUrl: null, cardMark: 'logo' })).toBeNull()
    expect(cardShowsMonogram({ logoUrl: null, cardMark: 'logo' })).toBe(true)
  })

  it('ignores a mark value it does not recognise', () => {
    // An older client, or a hand-edited row. Anything unknown behaves as
    // 'auto' rather than blanking the mark.
    expect(resolveCardLogo({ logoUrl: LOGO, cardMark: 'something-else' })).toBe(LOGO)
  })

  it('carries the decision into the data the renderers receive', () => {
    expect(resolveCardData({ logoUrl: LOGO }).logoUrl).toBe(LOGO)
    expect(resolveCardData({ logoUrl: LOGO, cardMark: 'monogram' }).logoUrl).toBeNull()
  })
})

describe('resolveCardData', () => {
  it('carries the logo and the chosen typeface through', () => {
    const d = resolveCardData({
      ...PROFILE,
      logoUrl: 'https://cdn.example/logo.png',
      cardFontId: 'great-vibes',
    })
    expect(d.logoUrl).toBe('https://cdn.example/logo.png')
    expect(d.monogramFontId).toBe('great-vibes')
  })

  it('gives the renderer null rather than undefined for missing values', () => {
    // TemplateCard filters contact rows on truthiness; undefined would work by
    // accident today and break the moment a row is rendered unconditionally.
    const d = resolveCardData({})
    expect(d.logoUrl).toBeNull()
    expect(d.monogramFontId).toBeNull()
    expect(d.phone).toBeNull()
  })
})
