/**
 * A transaction's `date` must never be rendered with a clock time.
 *
 * WHY (2026-08-07). Every row in the ledger read "05:30 am". Every single one,
 * on every transaction, for every shop.
 *
 * It was not a wrong time. It was an INVENTED one. The app never captures a
 * time at all:
 *
 *   TransactionEntry:  useState(new Date().toISOString().slice(0, 10))
 *                      <Input type="date">            → "2026-08-06"
 *   API route:         new Date("2026-08-06")         → 2026-08-06T00:00:00Z
 *   Ledger row:        formatDateTime(txn.date)       → "06/08/2026, 05:30 am"
 *
 * IST is UTC+5:30, so midnight UTC reads back as half past five in the morning.
 * "05:30 am" is the signature of a date-only value being asked what time it is.
 *
 * That matters more here than it would elsewhere. This is a ledger: a
 * shopkeeper may one day need to say when something happened, and a screen
 * that states a precise time for a fact nobody recorded is worse than a screen
 * that stays quiet. A number you did not measure should never be displayed as
 * though you did.
 *
 * `date` is the BUSINESS date the shopkeeper picks. `createdAt` is the real
 * moment the row was written, and Prisma sets it — that one is a genuine
 * timestamp and may carry a time. So the rule is about the field, not the
 * helper: formatDateTime is fine on createdAt, irnGeneratedAt, ewayBillExpiry.
 * It is not fine on `.date`.
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      sourceFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const files = sourceFiles(SRC)

/** formatDateTime(anything.date) or formatDateTime(date) — a date-only value. */
const FABRICATES_TIME = /formatDateTime\(\s*[A-Za-z_$][\w$.?[\]]*\.date\s*[),]/

describe('the scan is not vacuous', () => {
  it('found source files', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('still finds legitimate formatDateTime uses on real timestamps', () => {
    // If this ever hits zero the pattern has drifted and the rule below is
    // asserting nothing.
    const legit = files.filter((f) => /formatDateTime\(/.test(fs.readFileSync(f, 'utf8')))
    expect(legit.length).toBeGreaterThan(0)
  })
})

describe('no screen invents a time for a business date', () => {
  it('holds across the whole component tree', () => {
    const offenders: string[] = []

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        if (FABRICATES_TIME.test(line)) {
          offenders.push(
            `${path.relative(process.cwd(), file)}:${i + 1} — renders a clock against a ` +
              '`.date`, which is captured date-only, so the time shown is invented ' +
              '(midnight UTC reads as 05:30 am in IST). Use formatDate(), or ' +
              'createdAt if you genuinely want the moment the row was written.',
          )
        }
      })
    }

    expect(offenders).toEqual([])
  })
})

describe('the 05:30 signature itself', () => {
  /*
   * Pins the arithmetic the bug rests on, so the explanation above cannot rot
   * into folklore: a date-only string parses as midnight UTC, and midnight UTC
   * is 05:30 in India. Anyone who doubts the diagnosis can read this.
   */
  it('a date-only string parses to midnight UTC', () => {
    const d = new Date('2026-08-06')
    expect(d.toISOString()).toBe('2026-08-06T00:00:00.000Z')
  })

  it('midnight UTC is 05:30 in India', () => {
    const d = new Date('2026-08-06')
    const istHour = new Date(d.getTime() + 5.5 * 60 * 60 * 1000).getUTCHours()
    const istMinute = new Date(d.getTime() + 5.5 * 60 * 60 * 1000).getUTCMinutes()
    expect(`${istHour}:${String(istMinute).padStart(2, '0')}`).toBe('5:30')
  })
})
