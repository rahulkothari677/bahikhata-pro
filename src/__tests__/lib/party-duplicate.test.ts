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
import { normalizePartyName, normalizePartyPhone, duplicatePartyMessage, duplicatePartyFieldError } from '@/lib/party-duplicate'

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

/**
 * 🔒 The duplicate message belongs UNDER the field, not in a toast.
 *
 * Rahul, 2026-08-03: "the name or number already exits should be written in
 * below name or number and not with popup."
 *
 * He is right, and for a concrete reason: a toast appears away from the input,
 * covers other content, and disappears on its own — so the shopkeeper is told
 * which field is wrong somewhere other than where they must fix it, and the
 * message is gone by the time they look back.
 */
describe('duplicate errors render inline, under the offending field', () => {
  const forms = ['src/components/common/PartySelect.tsx', 'src/components/parties/Parties.tsx']

  test('both add-party forms were found', () => {
    for (const f of forms) expect(fs.existsSync(path.join(process.cwd(), f))).toBe(true)
  })

  for (const f of forms) {
    describe(f, () => {
      const src = read(f)

      test('a 409 sets field state instead of throwing to the toast', () => {
        expect(src).toMatch(/if \(r\.status === 409\)/)
        expect(src).toMatch(/setDupError\(\{ field: body\.field/)
        // It must RETURN, or execution falls through to the generic throw and
        // the toast reappears alongside the inline message.
        //
        // The end anchor is searched FROM the 409 block, not from the start of
        // the file: these components have more than one fetch handler, so a
        // plain indexOf found an earlier `if (!r.ok) throw` and produced an
        // empty slice that matched nothing and passed vacuously.
        const start = src.indexOf('if (r.status === 409)')
        expect(start).toBeGreaterThan(-1)
        const end = src.indexOf('if (!r.ok) throw', start)
        expect(end).toBeGreaterThan(start)
        const block = src.slice(start, end)
        expect(block.length).toBeGreaterThan(50)
        expect(block).toMatch(/return/)
      })

      test('the message renders under the name and phone inputs', () => {
        expect(src).toMatch(/dupError\?\.field === 'name' && \(\s*<p/)
        expect(src).toMatch(/dupError\?\.field === 'phone' && \(\s*<p/)
      })

      test('the offending input is marked invalid, not just annotated', () => {
        expect(src).toMatch(/aria-invalid=\{dupError\?\.field === 'name'\}/)
        expect(src).toMatch(/border-rose-500/)
      })

      test('editing the field clears the message', () => {
        // The text describes the value that was rejected; leaving it over a
        // changed value would be wrong.
        expect(src).toMatch(/setDupError\(null\); setForm\(\{ \.\.\.form, name:/)
        expect(src).toMatch(/setDupError\(null\); setForm\(\{ \.\.\.form, phone:/)
      })
    })
  }

  test('the inline text is short and says what to do', () => {
    const nameMsg = duplicatePartyFieldError({
      field: 'name', party: { id: 'x', name: 'A', phone: null, type: 'customer' },
    })
    expect(nameMsg).toBe('This name already exists — try a different name.')
    expect(nameMsg.length).toBeLessThan(60)
  })
})
