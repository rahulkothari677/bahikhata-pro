/**
 * A "last seen trigger" ref must start at the CURRENT counter, never at 0.
 *
 * WHY (2026-08-07). Reported: "voice entry in sales is by default open".
 *
 * The store holds monotonic counters — triggerNewEntry, triggerVoiceOpen,
 * triggerBarcodeOpen, triggerDayEnd, triggerBulkReminders — and a component
 * opens its panel when the counter rises above what it last saw:
 *
 *     const lastVoiceTriggerRef = useRef(0)          // ← the bug
 *     useEffect(() => {
 *       if (triggerVoiceOpen > lastVoiceTriggerRef.current) {
 *         lastVoiceTriggerRef.current = triggerVoiceOpen
 *         setShowVoiceEntry(true)
 *       }
 *     }, [triggerVoiceOpen])
 *
 * The counter lives in the store and SURVIVES unmounting. The ref does not —
 * it is recreated at 0 every time the screen mounts. So after the mic has been
 * pressed even once, the counter is ≥ 1 forever, and every later visit to New
 * Sale satisfies `1 > 0` and opens the panel unbidden.
 *
 * It reads as correct because the comparison is right and the reset is right.
 * The only wrong part is the starting value, and it is wrong only on the
 * SECOND mount — which no first look at the screen will ever show you.
 *
 * All EIGHT sites in the codebase had it. The worst opened the camera:
 * triggerBarcodeOpen did the same thing with the barcode scanner, so a user
 * who had once scanned a barcode got a live camera every time they started a
 * sale.
 *
 * The fix is one word — useRef(triggerVoiceOpen) — because on the first render
 * the ref takes the counter as it stands, and only genuine increases after
 * that count as a new press.
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

/** `const somethingTriggerSomething = useRef(0)` — any casing around "trigger". */
const STALE_TRIGGER_REF = /const\s+\w*[Tt]rigger\w*\s*=\s*useRef(?:<[^>]*>)?\(\s*0\s*\)/

describe('the scan is not vacuous', () => {
  it('found source files', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('still finds trigger refs to check', () => {
    const withTriggerRefs = files.filter((f) =>
      /const\s+\w*[Tt]rigger\w*\s*=\s*useRef/.test(fs.readFileSync(f, 'utf8')),
    )
    // If this ever hits zero the pattern has been renamed and the rule below
    // is asserting nothing at all.
    expect(withTriggerRefs.length).toBeGreaterThan(3)
  })
})

describe('no trigger ref starts at zero', () => {
  it('holds across the whole component tree', () => {
    const offenders: string[] = []

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        if (STALE_TRIGGER_REF.test(line)) {
          offenders.push(
            `${path.relative(process.cwd(), file)}:${i + 1} — a trigger ref initialised to 0. ` +
              'Store trigger counters outlive the component, so this fires on every ' +
              'remount after the first press. Initialise it to the counter itself, ' +
              'e.g. useRef(triggerVoiceOpen).',
          )
        }
      })
    }

    expect(offenders).toEqual([])
  })
})

describe('the arithmetic the bug rests on', () => {
  /*
   * Pinned so the explanation above cannot decay into folklore: this is the
   * whole mechanism, in the small.
   */
  it('a ref that restarts at 0 re-fires against a counter that does not', () => {
    let counter = 0
    const mountAndCheck = (refStart: number) => {
      const ref = { current: refStart }
      return counter > ref.current // would the panel open on mount?
    }

    expect(mountAndCheck(0)).toBe(false) // first ever mount: nothing pressed yet
    counter++ // the user presses the mic once
    expect(mountAndCheck(0)).toBe(true) // BUG: every later mount opens it
    expect(mountAndCheck(counter)).toBe(false) // FIX: start from the live counter
  })
})
