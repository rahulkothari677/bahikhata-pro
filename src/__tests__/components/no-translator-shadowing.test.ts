/**
 * A callback parameter must never be named `t` in a component that also
 * destructures `t` from useTranslation().
 *
 * WHY (2026-08-07). The Sales ledger crashed the entire app — error boundary,
 * "Something went wrong" — the moment anyone switched to the card layout:
 *
 *     const { t } = useTranslation()          // the translator
 *     ...
 *     {sorted.map((t) => (                    // now `t` is a TRANSACTION
 *        ...
 *        <Badge>{t('stat.paid')}</Badge>      // calling a transaction
 *     ))}
 *
 *     TypeError: t is not a function
 *
 * Nothing about either line is wrong on its own, which is exactly why review
 * did not catch it: you have to hold both in your head at once and notice they
 * share a name. Types did not catch it either — `t` really is a value, and
 * calling it is only a runtime error.
 *
 * It also hid well. The crashing branch renders only when the layout toggle is
 * on AND a fully paid entry is on screen, so the default view was fine and the
 * bug waited for a user to change one setting.
 *
 * The detailed list in the same file bound `t` the same way and happened not to
 * call the translator inside it — one added label away from the same crash.
 * So the rule is the name, not the crash: if a file uses the translator, `t`
 * belongs to the translator everywhere in it.
 */
import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

/** Every .tsx/.ts file under src/, recursively. */
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

describe('the scan is not vacuous', () => {
  it('found a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('finds files that use the translator', () => {
    const users = files.filter((f) => /const\s*\{[^}]*\bt\b[^}]*\}\s*=\s*useTranslation\(\)/.test(fs.readFileSync(f, 'utf8')))
    expect(users.length).toBeGreaterThan(10)
  })
})

describe('a file that uses the translator never rebinds `t`', () => {
  /*
   * Matches a single-parameter arrow callback named exactly `t`:
   *   .map((t) =>      .filter((t) =>      .forEach((t) =>      ((t) =>
   * and the un-parenthesised form `.map(t =>`.
   *
   * Deliberately narrow. It is looking for one specific, cheap-to-avoid
   * mistake, not auditing every possible shadow — a rule that fires on
   * innocent code gets switched off.
   */
  const REBINDS_T = /(?:\.\s*(?:map|filter|forEach|find|some|every|reduce|flatMap|sort)\s*\(\s*)\(?\s*t\s*\)?\s*=>/

  const usesTranslator = (src: string) =>
    /const\s*\{[^}]*\bt\b[^}]*\}\s*=\s*useTranslation\(\)/.test(src)

  it('holds across the whole component tree', () => {
    const offenders: string[] = []

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      if (!usesTranslator(src)) continue
      if (!REBINDS_T.test(src)) continue

      const line = src.split('\n').findIndex((l) => REBINDS_T.test(l)) + 1
      offenders.push(
        `${path.relative(process.cwd(), file)}:${line} — binds a callback parameter named \`t\`, ` +
          'which shadows the translator from useTranslation() in the same file. ' +
          'Name it for what it holds (txn, item, row) instead.',
      )
    }

    expect(offenders).toEqual([])
  })
})
