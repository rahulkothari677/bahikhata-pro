/**
 * @jest-environment node
 *
 * A customer's details can be corrected.
 *
 * WHY (#31, audit 2026-08-13). `PUT /api/parties/[id]` existed, was validated,
 * was tested, and worked — I called it against production and got 200. And
 * NOTHING in the app called it. There was no party edit screen at all, so a
 * customer's phone number, address or GSTIN could be typed once and never
 * corrected.
 *
 * The GSTIN is the one that does damage. deriveInterStateStatus reads it to
 * decide IGST versus CGST+SGST, so a GSTIN entered wrong at creation puts the
 * wrong tax on every future bill to that customer — and the only workaround was
 * to create a second party, splitting that customer's ledger in half.
 *
 * Found while doing #29: I went to wire the concurrent-edit warning into
 * parties and discovered there was nothing to warn about, because nothing could
 * edit a party.
 *
 * Structural, and said so plainly: rendering this screen needs the store, the
 * query client and a dozen dialogs. The behaviour on either side is covered —
 * the route by its own tests, the wording by edit-conflict.test.ts. What these
 * pin is that the screen and the route are joined at all, which is the exact
 * thing that was missing.
 */
import fs from 'fs'
import path from 'path'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), 'src', p), 'utf8')
const PARTIES = read('components/parties/Parties.tsx')

/** Just the save handler, so a neighbouring function cannot satisfy a check. */
const HANDLE_SAVE = (() => {
  const start = PARTIES.indexOf('const handleSave = async () => {')
  expect(start).toBeGreaterThan(-1)
  const end = PARTIES.indexOf('return (', start)
  expect(end).toBeGreaterThan(start)
  return PARTIES.slice(start, end)
})()

describe('there is a way in', () => {
  it('offers an edit control in BOTH layouts, not just one', () => {
    /*
     * Counting, not just matching, and this test learned that the hard way.
     *
     * The first version asserted the string appeared AT ALL. It passed — and
     * browser verification then showed no edit button anywhere, because the
     * control had gone into the TABLE only and this screen renders CARDS by
     * default (partiesViewMode === 'grid'). The test read the markup that the
     * shopkeeper never sees.
     *
     * This repo has had precisely this bug before: "Selection worked in one
     * layout and was a dead end in the other." Two layouts rendering one list
     * will diverge unless something counts them.
     */
    const controls = PARTIES.match(/aria-label=\{`Edit \$\{p\.name\}`\}/g) ?? []
    expect(controls.length).toBeGreaterThanOrEqual(2)
  })

  it('the table layout has one', () => {
    // Anchored to the table, so a card-only fix cannot satisfy it.
    const table = PARTIES.slice(PARTIES.indexOf('<tbody>'), PARTIES.indexOf('</tbody>'))
    expect(table).toMatch(/aria-label=\{`Edit \$\{p\.name\}`\}/)
  })

  it('editing does not open the profile instead', () => {
    // The whole row is clickable and opens the party profile. Without
    // stopPropagation the Edit button would open the profile — the same
    // nested-click mistake the bank-statement delete had to fix.
    expect(PARTIES).toMatch(/e\.stopPropagation\(\)[\s\S]{0,60}setEditingParty\(p\)/)
  })

  it('adding a party still starts blank', () => {
    // Without clearing it, "Add Party" after an edit would silently reopen the
    // last customer and overwrite them.
    expect(PARTIES).toMatch(/setEditingParty\(null\); setDialogOpen\(true\)/)
  })

  it('closing the dialog forgets what was being edited', () => {
    expect(PARTIES).toMatch(/if \(!v\) setEditingParty\(null\)/)
  })
})

describe('the save actually updates instead of creating', () => {
  it('uses PUT with the party id when editing', () => {
    expect(HANDLE_SAVE).toMatch(/method: isEdit \? 'PUT' : 'POST'/)
    expect(HANDLE_SAVE).toMatch(/isEdit \? `\/api\/parties\/\$\{party!\.id\}` : '\/api\/parties'/)
  })

  it('sends the concurrent-edit stamp on an edit only', () => {
    // A create has nothing to have conflicted with.
    expect(HANDLE_SAVE).toMatch(/isEdit \? \{ updatedAt: party!\.updatedAt/)
  })

  it('reports the outcome through the shared decision', () => {
    expect(HANDLE_SAVE).toMatch(/describeSaveOutcome\(/)
    expect(HANDLE_SAVE).toContain("subject: 'party'")
  })
})

describe("a supplier's opening balance survives a round trip", () => {
  it('shows it unsigned, because the save path re-applies the sign', () => {
    /*
     * This is the trap in editing a form that normalises on save. A supplier's
     * opening balance is STORED negative — "they owe us" is positive, so a
     * supplier you owe ₹7,410 is -7410. The save path negates whatever is
     * typed.
     *
     * So loading -7410 back into the box would show a negative under a label
     * reading "how much do you owe them?", and saving unchanged would negate it
     * again — turning a debt into a credit, silently, just by opening the form
     * and pressing save.
     *
     * Math.abs on load is what makes the round trip a no-op.
     */
    expect(PARTIES).toMatch(/openingBalance: party\.openingBalance != null \? String\(Math\.abs\(party\.openingBalance\)\)/)
  })

  it('still negates on save, which is the behaviour that made the sign matter', () => {
    expect(HANDLE_SAVE).toMatch(/type === 'supplier' \? -Math\.abs\(rawOpening\)/)
  })
})
