/**
 * @jest-environment node
 *
 * Two devices editing one bill must not silently overwrite each other.
 *
 * WHY (#18, audit 2026-08-13). Editing an invoice is last-write-wins with no
 * word to anyone. The counter phone corrects a quantity, the back-office laptop
 * corrects a price, and whoever saves second erases the other's change. On a
 * bill, that is money.
 *
 * WHAT THIS TEST IS REALLY GUARDING AGAINST — and why it exists as behaviour
 * rather than as a source grep. The same feature was written for parties and
 * for products months ago, and all of it is dead:
 *
 *   - the client never sent the stamp, so the server check reads
 *     `if (null && …)` and has never once fired;
 *   - nothing anywhere reads the warning the server returns;
 *   - the only "tests" are these, in v26-phase5-timeouts-webhook-quickwins:
 *
 *         expect(src).toMatch(/conflictWarning/)
 *         expect(src).toMatch(/edited on another device/)
 *
 *     They read the route's SOURCE for those words. They would pass if the file
 *     contained nothing but a comment mentioning them. Three green ticks, no
 *     feature.
 *
 * So the decision now lives in one tested function, and these tests call it.
 */
import fs from 'fs'
import path from 'path'
import { describeEditConflict, describeSaveOutcome } from '@/lib/edit-conflict'

const OPENED_AT = new Date('2026-08-13T10:00:00.000Z')
const CHANGED_LATER = new Date('2026-08-13T10:05:00.000Z')

describe('somebody else changed it', () => {
  it('warns when the record moved on after the shopkeeper opened it', () => {
    const msg = describeEditConflict(OPENED_AT.toISOString(), CHANGED_LATER, 'bill')
    expect(msg).toMatch(/also changed on another device/i)
  })

  it('tells them their own work was kept', () => {
    // A warning that sounds like "your edit was rejected" would send a
    // shopkeeper hunting for work that is actually saved.
    const msg = describeEditConflict(OPENED_AT.toISOString(), CHANGED_LATER, 'bill')
    expect(msg).toMatch(/saved/i)
  })

  it('asks them to check, which is the only thing they can act on', () => {
    const msg = describeEditConflict(OPENED_AT.toISOString(), CHANGED_LATER, 'bill')
    expect(msg).toMatch(/check/i)
  })

  it('names the record in words a shopkeeper uses', () => {
    expect(describeEditConflict(OPENED_AT.toISOString(), CHANGED_LATER, 'bill')).toMatch(/bill/i)
    expect(describeEditConflict(OPENED_AT.toISOString(), CHANGED_LATER, 'party')).toMatch(/customer/i)
    expect(describeEditConflict(OPENED_AT.toISOString(), CHANGED_LATER, 'product')).toMatch(/product/i)
  })

  it('accepts a Date as readily as a string', () => {
    expect(describeEditConflict(OPENED_AT, CHANGED_LATER, 'bill')).not.toBeNull()
  })
})

describe('nobody else touched it — say nothing', () => {
  it('is silent when the stamps match exactly', () => {
    expect(describeEditConflict(OPENED_AT.toISOString(), OPENED_AT, 'bill')).toBeNull()
  })

  it('is silent when the client sent no stamp', () => {
    // An older app build, or an API caller. No check is the previous behaviour;
    // a warning here would fire on every save from those clients.
    expect(describeEditConflict(undefined, CHANGED_LATER, 'bill')).toBeNull()
    expect(describeEditConflict(null, CHANGED_LATER, 'bill')).toBeNull()
    expect(describeEditConflict('', CHANGED_LATER, 'bill')).toBeNull()
  })

  it('is silent when the record has no stamp of its own', () => {
    expect(describeEditConflict(OPENED_AT.toISOString(), null, 'bill')).toBeNull()
  })

  it('is silent on an unparseable stamp, rather than crying wolf', () => {
    // A malformed value is not evidence that anyone edited anything. Treating
    // it as a conflict would warn on every save from a client sending junk.
    expect(describeEditConflict('not-a-date', CHANGED_LATER, 'bill')).toBeNull()
  })
})

describe('a stamp from the future is handled honestly', () => {
  it('still warns, but does not quote a nonsense time', () => {
    // Clock skew, or a replayed request. "Someone changed it at <a moment in
    // your past>" reads as a bug, so the wording drops the timestamp.
    const msg = describeEditConflict(CHANGED_LATER.toISOString(), OPENED_AT, 'bill')
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/may have been edited/i)
    expect(msg).not.toMatch(/on another device at/i)
  })
})

describe('the routes and the screen are actually wired to it', () => {
  // The logic being right is half of it. The reason parties and products are
  // dead is that nothing CALLS the check and nothing SHOWS the answer.
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

  it('the invoice edit route asks the question', () => {
    expect(read('app/api/transactions/[id]/route.ts')).toMatch(/describeEditConflict\(/)
  })

  it('the invoice edit route allows the field through its unknown-field guard', () => {
    // This route rejects any field it does not recognise. Sending the stamp
    // without declaring it would 400 EVERY invoice edit — a warning feature
    // turned into an outage.
    expect(read('app/api/transactions/[id]/route.ts')).toMatch(/'expectedUpdatedAt'/)
  })

  it('the edit screen SENDS the stamp', () => {
    expect(read('components/ledger/TransactionDetail.tsx')).toMatch(/expectedUpdatedAt:/)
  })

  it('the edit screen renders whatever describeSaveOutcome returns', () => {
    // Structural only. The BEHAVIOUR is covered by the describeSaveOutcome
    // tests below, which is the point: an earlier version of this guard was a
    // string grep and passed when the condition was replaced with if (false).
    const src = read('components/ledger/TransactionDetail.tsx')
    expect(src).toMatch(/describeSaveOutcome\(/)
    expect(src).toContain("outcome.kind === 'warning'")
  })
})

describe('what the screen is told to show', () => {
  /*
   * These are the tests the string-grep version could not be.
   *
   * The first attempt at guarding the screen was:
   *     expect(src).toMatch(/conflictWarning/)
   *     expect(src).toMatch(/sonnerToast\.warning\(/)
   * Break-testing it — replacing the condition with `if (false)` — left both
   * strings in place and the test passed on dead code. Exactly the mistake the
   * parties/products guards make, committed by me one file away from the
   * comment criticising it. So the decision became a function, and this is it
   * being called.
   */
  it('shows a WARNING when the server reports a conflict', () => {
    const out = describeSaveOutcome({ conflictWarning: 'someone else changed it' }, { queuedOffline: false })
    expect(out.kind).toBe('warning')
    expect(out.description).toBe('someone else changed it')
  })

  it('leaves the warning up long enough to read and act on', () => {
    const out = describeSaveOutcome({ conflictWarning: 'x' }, { queuedOffline: false })
    // It asks the shopkeeper to go and check a bill. A 4-second toast is not
    // an instruction, it is a flicker.
    expect(out.durationMs).toBeGreaterThanOrEqual(10000)
  })

  it('shows a plain success when nothing conflicted', () => {
    expect(describeSaveOutcome({ conflictWarning: null }, { queuedOffline: false }).kind).toBe('success')
    expect(describeSaveOutcome({}, { queuedOffline: false }).kind).toBe('success')
    expect(describeSaveOutcome(null, { queuedOffline: false }).kind).toBe('success')
  })

  it('says "saved offline" when the edit was queued, and does not claim a conflict', () => {
    // Offline, there is no server answer to read — inventing a conflict from a
    // missing response would be a lie in the frightening direction.
    const out = describeSaveOutcome(null, { queuedOffline: true })
    expect(out.kind).toBe('success')
    expect(out.title).toMatch(/offline/i)
  })
})
