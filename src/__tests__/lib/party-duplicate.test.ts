/**
 * 🔒 DUPLICATE PARTIES — task #14, 2026-08-03.
 *
 * Rahul spotted two distinct parties both named "RAHUL KOTHARI" (₹492.50 and
 * ₹50) in the live party report, and asked what established ledger software
 * does about it.
 *
 * Answer: a hard block. Tally requires unique ledger names; QuickBooks
 * requires a unique display name across customers, vendors and employees;
 * Zoho Books and Xero both require unique contact names; Vyapar enforces
 * unique party names per business. None of them settle for a warning.
 *
 * The reason is the one Rahul identified: reports group by partyId, so two
 * ledgers for one person split their dues. The outstanding shown is only part
 * of what is owed, a payment settles bills on one ledger while the other keeps
 * chasing, and the picker shows two identical rows. It never surfaces as an
 * error — it surfaces as a customer being asked for money they already paid.
 */
import fs from 'fs'
import path from 'path'
import { normalizePartyName, normalizePartyPhone, duplicatePartyMessage } from '@/lib/party-duplicate'

const read = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

describe('name comparison ignores case and spacing, nothing else', () => {
  test('the reported case: same name, different capitalisation', () => {
    expect(normalizePartyName('RAHUL KOTHARI')).toBe(normalizePartyName('Rahul Kothari'))
    expect(normalizePartyName('rahul kothari ')).toBe(normalizePartyName('  RAHUL  KOTHARI'))
  })

  test('genuinely different names stay different', () => {
    expect(normalizePartyName('Ramesh Kumar')).not.toBe(normalizePartyName('Ramesh Verma'))
    // Distinguishing two real same-name customers must still be possible —
    // that is the escape hatch every app in the list above relies on.
    expect(normalizePartyName('Ramesh Kumar')).not.toBe(normalizePartyName('Ramesh Kumar (Market)'))
  })
})

describe('phone comparison sees through Indian formatting', () => {
  test('+91, spaces and dashes are the same number', () => {
    const canonical = normalizePartyPhone('9876543210')
    expect(normalizePartyPhone('+91 98765 43210')).toBe(canonical)
    expect(normalizePartyPhone('098765-43210')).toBe(canonical)
    expect(normalizePartyPhone('919876543210')).toBe(canonical)
  })

  test('different numbers stay different', () => {
    expect(normalizePartyPhone('9876543210')).not.toBe(normalizePartyPhone('9876543211'))
  })

  test('missing or junk phone is not a match key', () => {
    // Otherwise every party without a phone would collide with every other.
    expect(normalizePartyPhone(null)).toBeNull()
    expect(normalizePartyPhone('')).toBeNull()
    expect(normalizePartyPhone('---')).toBeNull()
  })
})

describe('the message tells the shopkeeper what to do', () => {
  test('a name clash names the existing party and both options', () => {
    const msg = duplicatePartyMessage({
      field: 'name',
      party: { id: 'p1', name: 'RAHUL KOTHARI', phone: '9876543210', type: 'customer' },
    })
    expect(msg).toContain('RAHUL KOTHARI')
    expect(msg).toContain('9876543210')
    // Both routes forward, and the reason.
    expect(msg).toMatch(/Use that customer instead/)
    expect(msg).toMatch(/different name/)
    expect(msg).toMatch(/split their dues/)
  })

  test('a phone clash says it is the phone', () => {
    const msg = duplicatePartyMessage({
      field: 'phone',
      party: { id: 'p1', name: 'Ramesh', phone: '9876543210', type: 'supplier' },
    })
    expect(msg).toMatch(/already uses this phone number/)
  })
})

describe('both write paths are blocked, not just create', () => {
  const post = read('src/app/api/parties/route.ts')
  const put = read('src/app/api/parties/[id]/route.ts')

  test('create checks for a duplicate before writing', () => {
    const idx = post.indexOf('findDuplicateParty')
    const createIdx = post.indexOf('db.party.create')
    expect(idx).toBeGreaterThan(-1)
    expect(idx).toBeLessThan(createIdx)
  })

  test('create returns 409 with the existing party attached', () => {
    const block = post.slice(post.indexOf('const duplicate = await findDuplicateParty'), post.indexOf('db.party.create'))
    expect(block).toMatch(/status: 409/)
    expect(block).toMatch(/code: 'DUPLICATE_PARTY'/)
    expect(block).toMatch(/existingParty: duplicate\.party/)
  })

  test('rename is blocked too — otherwise the create-block is a back door', () => {
    // Add "Ramesh K", rename to "Ramesh Kumar", and you have the split ledger
    // the create-block exists to prevent.
    const idx = put.indexOf('findDuplicateParty')
    const updateIdx = put.indexOf('db.party.update')
    expect(idx).toBeGreaterThan(-1)
    expect(idx).toBeLessThan(updateIdx)
  })

  test('a rename excludes the party itself', () => {
    // Saving a form without touching the name must not fail against itself.
    const block = put.slice(put.indexOf('findDuplicateParty'), put.indexOf('db.party.update'))
    expect(block).toMatch(/excludeId: id/)
  })

  test('the check is scoped to the signed-in user', () => {
    const lib = read('src/lib/party-duplicate.ts')
    // A cross-tenant lookup would leak the existence and phone number of
    // another shop's customers through the error message.
    expect(lib).toMatch(/where: \{\s*userId,/)
    expect(lib).toMatch(/deletedAt: null/)
  })
})
