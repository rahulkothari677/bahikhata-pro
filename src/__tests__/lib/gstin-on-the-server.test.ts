/**
 * #355 — a GSTIN is checked on the server, not only on the form.
 */
import { createPartySchema, updatePartySchema, createShopSchema } from '@/lib/validation'
import { checkGstin } from '@/lib/gst-states'

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, body: object) => schema.safeParse(body).success

describe('party and shop GSTINs (#355)', () => {
  it('refuses a GSTIN of the wrong length, format or state code', () => {
    for (const bad of ['08ZZTSTAAAA1Z5', '08AAJFG2468H1Z7X', 'ABCDEFGHIJKLMNO', '99AAJFG2468H1Z7']) {
      expect({ bad, party: ok(createPartySchema, { name: 'X', gstin: bad }) }).toEqual({ bad, party: false })
      expect({ bad, edit: ok(updatePartySchema, { gstin: bad }) }).toEqual({ bad, edit: false })
      expect({ bad, shop: ok(createShopSchema, { name: 'X', gstin: bad }) }).toEqual({ bad, shop: false })
    }
  })

  it('accepts a real one, an empty one (clears it) and none', () => {
    expect(ok(createPartySchema, { name: 'X', gstin: '08AAJFG2468H1Z7' })).toBe(true) // the e2e seed's shop
    expect(ok(updatePartySchema, { gstin: '' })).toBe(true)
    expect(ok(updatePartySchema, { gstin: null })).toBe(true)
    expect(ok(createPartySchema, { name: 'X' })).toBe(true)
  })

  it('a wrong check character stays a warning, as on the form (old records carry them)', () => {
    const real = '08AAJFG2468H1Z7'
    const wrongCheck = real.slice(0, 14) + (real[14] === 'A' ? 'B' : 'A')
    expect(checkGstin(wrongCheck)).toMatchObject({ ok: true, checksumOk: false })
    expect(ok(createPartySchema, { name: 'X', gstin: wrongCheck })).toBe(true)
  })
})
