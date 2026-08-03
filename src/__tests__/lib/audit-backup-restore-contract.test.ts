/**
 * 🔒 THE BACKUP MUST CONTAIN WHAT THE RESTORE READS.
 *
 * Found 2026-08-03 while auditing task #6, and confirmed against a real
 * 273-transaction backup from the live app.
 *
 * The export stripped `id` from parties and shipped a raw `partyId` on
 * transactions and payments — an id that cannot resolve after a restore,
 * because the parties are recreated with new ones. So restore looked rows up
 * by NAME:
 *
 *     txn.partyName || txn.party?.name          // transactions
 *     payment.partyName                          // payments
 *
 * Neither field existed. Not in the export, and not on the model — `Transaction`
 * and `Payment` have `partyId`, never `partyName`, and the export did not
 * include the `party` relation.
 *
 * Measured on the live backup:
 *     payment_hasPartyName        false
 *     firstTxn_hasPartyName       false
 *     firstTxn_hasPartyRelation   false
 *     party_hasId                 false      ← so partyId can never resolve
 *
 * Restoring it would have skipped all 26 payments and restored all 273
 * transactions with no party. Every customer balance collapses to its opening
 * balance: the entire udhaar book destroyed, by the one feature whose only job
 * is to preserve it — and discovered only when someone actually needed it,
 * after losing their phone.
 *
 * These tests pin the contract in both directions. It is a CONTRACT, not an
 * implementation detail: the two files are written years apart by people who
 * cannot see each other's assumptions, which is exactly how it broke.
 */
import fs from 'fs'
import path from 'path'

const read = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

const exportSrc = read('src/app/api/export/full/route.ts')
const restoreSrc = read('src/app/api/import/restore/route.ts')
const schema = read('prisma/schema.prisma')

describe('the model has no partyName — so the export must derive it', () => {
  test('Transaction stores partyId, not partyName', () => {
    const model = schema.slice(schema.indexOf('model Transaction '), schema.indexOf('model Transaction ') + 3000)
    expect(model).toMatch(/partyId\s+String\?/)
    expect(model).not.toMatch(/^\s*partyName\s/m)
  })

  test('Payment stores partyId, not partyName', () => {
    const model = schema.slice(schema.indexOf('model Payment '), schema.indexOf('model Payment ') + 2000)
    expect(model).toMatch(/partyId\s+String/)
    expect(model).not.toMatch(/^\s*partyName\s/m)
  })
})

describe('the export carries the party NAME with every row', () => {
  test('transactions include the party relation', () => {
    expect(exportSrc).toMatch(/include: \{ items: true, party: \{ select: \{ name: true \} \} \}/)
  })

  test('payments include the party relation', () => {
    const block = exportSrc.slice(exportSrc.indexOf('db.payment.findMany'), exportSrc.indexOf('db.payment.findMany') + 300)
    expect(block).toMatch(/party: \{ select: \{ name: true \} \}/)
  })

  test('both project partyName into the file', () => {
    expect(exportSrc).toMatch(/partyName: t\.party\?\.name/)
    expect(exportSrc).toMatch(/partyName: p\.party\?\.name/)
  })

  test('the unusable raw partyId is dropped, not shipped', () => {
    // Party ids are stripped from the export, so a partyId on a row can never
    // resolve — keeping it only invites a future reader to trust it.
    expect(exportSrc).toMatch(/partyId: undefined/)
  })
})

describe('the restore reads exactly those fields', () => {
  test('transactions resolve via partyName', () => {
    expect(restoreSrc).toMatch(/txn\.partyName \|\| txn\.party\?\.name/)
  })

  test('payments resolve via partyName', () => {
    expect(restoreSrc).toMatch(/resolvePartyId\(payment\.partyName\)/)
  })
})

describe('an ambiguous name is skipped, never guessed', () => {
  test('duplicate names are recorded while building the map', () => {
    // Was `map.set(name, id)` alone: with two parties sharing a name the
    // second overwrote the first, and every row belonging to the first was
    // silently re-attached to the second.
    expect(restoreSrc).toMatch(/ambiguousPartyNames/)
    expect(restoreSrc).toMatch(/if \(partyIdByName\.has\(p\.name\)\) ambiguousPartyNames\.add\(p\.name\)/)
  })

  test('the resolver refuses an ambiguous name', () => {
    const fn = restoreSrc.slice(restoreSrc.indexOf('const resolvePartyId'), restoreSrc.indexOf('const resolvePartyId') + 400)
    expect(fn).toMatch(/ambiguousPartyNames\.has\(name\)/)
    expect(fn).toMatch(/return null/)
  })

  test('the map is read in exactly ONE place — inside the resolver', () => {
    /*
     * A direct `partyIdByName.get()` anywhere else bypasses the ambiguity
     * check and reinstates the silent mis-attribution.
     *
     * The resolver's own lookup is the one legitimate use, so the assertion is
     * "exactly one occurrence, and it is inside the resolver" — not "none
     * after the resolver", which my first version said and which failed
     * against the resolver itself.
     */
    const uses = restoreSrc.match(/partyIdByName\.get\(/g) || []
    expect(uses.length).toBe(1)

    const fnStart = restoreSrc.indexOf('const resolvePartyId')
    const fnEnd = restoreSrc.indexOf('\n    }', fnStart)
    const only = restoreSrc.indexOf('partyIdByName.get(')
    expect(only).toBeGreaterThan(fnStart)
    expect(only).toBeLessThan(fnEnd)
  })
})

describe('a payment that cannot be restored says why', () => {
  test('skipped payments carry reasons, not just a count', () => {
    expect(restoreSrc).toMatch(/skipReasons: \[\] as string\[\]/)
    expect(restoreSrc).toMatch(/results\.payments\.skipReasons\.push/)
  })

  test('the three distinct causes are told apart', () => {
    const block = restoreSrc.slice(restoreSrc.indexOf('results.payments.skipReasons.push'))
    const first = block.slice(0, 900)
    expect(first).toMatch(/no party name/)          // old backup, no partyName
    expect(first).toMatch(/more than one party/)    // ambiguous
    expect(first).toMatch(/no party with that name/) // missing
  })
})
