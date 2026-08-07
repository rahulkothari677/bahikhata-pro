/**
 * A control on an always-dark surface must not be painted by the theme.
 *
 * WHY (2026-08-07). Reported from a real phone, with a screenshot: the barcode
 * scanner's "Switch camera" button was a white pill with white text on it. The
 * label was unreadable, so the only way to get off the wrong camera was
 * invisible.
 *
 * The markup looked careful:
 *
 *   <Button variant="outline" className="text-white border-white/30 ...">
 *
 * `text-white` is correct — the scanner is `bg-black` always, it is a camera
 * viewfinder and does not follow light/dark mode. `variant="outline"` is the
 * problem: it expands to `bg-background`, which in LIGHT mode is near-white.
 * White text on a white background. In dark mode the same line looks fine,
 * which is why it survived review and shipped.
 *
 * WHAT THIS BANS: `variant="outline"` together with a hardcoded `text-white`
 * on the same element. The pairing is self-contradicting wherever it appears —
 * one half says "the theme decides my background", the other says "my
 * foreground is fixed" — and it is only ever readable by luck of which theme
 * the viewer happens to be in.
 *
 * The fix is to state both colours, as BarcodeScanner's ON_BLACK_BUTTON does,
 * so the theme cannot reach in and repaint half of a control.
 *
 * NOT CHECKED HERE: contrast in general. A guard that tried to compute real
 * contrast ratios across Tailwind classes would be guessing, and a guard that
 * guesses gets switched off. This catches one exact contradiction, and catches
 * it every time.
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

const slash = (p: string) => p.split(path.sep).join('/')

/** This file quotes the broken pattern in order to explain it. */
const ALLOWED = new Set<string>([
  'src/__tests__/components/no-theme-variants-on-fixed-dark-surfaces.test.ts',
])

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      sourceFiles(full, out)
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * One JSX opening tag, so `variant` and `className` are only paired when they
 * sit on the SAME element. Matching across a whole file would flag a component
 * that happens to contain both an outline button and, elsewhere, white text.
 */
// No `s` flag: [^>] already spans newlines, and the flag needs an es2018
// target this project does not set.
const JSX_TAG = /<[A-Za-z][^>]*?>/g

const files = sourceFiles(SRC)

describe('the scan is not vacuous', () => {
  it('found component files to check', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('found outline buttons at all, so the pattern being checked exists', () => {
    const withOutline = files.filter((f) => /variant="outline"/.test(fs.readFileSync(f, 'utf8')))
    expect(withOutline.length).toBeGreaterThan(3)
  })
})

describe('no control leaves half its colours to the theme', () => {
  it('never pairs variant="outline" with a hardcoded text-white', () => {
    const offenders: string[] = []

    for (const file of files) {
      const rel = slash(path.relative(process.cwd(), file))
      if (ALLOWED.has(rel)) continue

      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(JSX_TAG)) {
        const tag = m[0]
        if (!/variant="outline"/.test(tag)) continue
        // `hover:text-white` alone is fine — it only applies while hovered, and
        // the outline variant changes its own background on hover too.
        if (!/(?<!hover:)(?<!dark:)\btext-white\b/.test(tag)) continue

        /*
         * An explicit base background in className makes this safe, so skip it.
         *
         * cn() is tailwind-merge (src/lib/utils.ts), and Button composes with
         * cn(buttonVariants({ variant, size, className })) — so a `bg-*` passed
         * in className REPLACES the variant's bg-background rather than merely
         * sitting next to it. The dashboard's hero buttons do exactly this:
         * `bg-white/10 text-white` over the saffron card, which is correct and
         * deliberate.
         *
         * Without this check the guard flagged all eight of them on its first
         * run. Eight false alarms is not a strict guard, it is a guard someone
         * deletes — and the real defect it exists to catch goes with it. The
         * defect is specifically "text pinned, background left to the theme",
         * which is what the scanner button had: text-white, border-white/30,
         * hover:bg-white/10, and no base background at all.
         *
         * `hover:bg-` and `dark:bg-` do not count: neither paints the default
         * state a light-mode user actually sees.
         */
        if (/(?<!hover:)(?<!dark:)(?<!focus:)(?<!active:)\bbg-[a-z]/.test(tag)) continue

        const line = src.slice(0, m.index).split('\n').length
        offenders.push(
          `${rel}:${line} — variant="outline" with text-white on the same element.\n` +
            '    outline renders bg-background, which is near-WHITE in light mode, so this ' +
            'is white-on-white for every user not in dark mode. This exact pairing made the ' +
            'scanner\'s "Switch camera" button invisible. State both colours explicitly ' +
            '(see ON_BLACK_BUTTON in BarcodeScanner) instead of letting the theme paint half of it.',
        )
      }
    }

    expect(offenders).toEqual([])
  })
})
