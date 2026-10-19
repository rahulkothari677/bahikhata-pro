/**
 * 🔒 GUARD: no invisible control characters in source files.
 *
 * Piping a regex through a shell heredoc turns `\b` into a backspace
 * (CLAUDE.md, Cause: heredocs). It happened again 19 Oct (Phase 5c): a new
 * test's `::int\b` and `100\b` became backspaces, so those checks could never
 * fail — and the sweep that caught it found an older one in Settings search,
 * `/\band\b/` stored as backspace + "and" + backspace, which never matched.
 * A tab, newline or carriage return is fine; anything else below 0x20 is not.
 */
import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

/** Files (relative paths) containing a control character other than \t \n \r. */
function filesWithControlChars(files: { rel: string; text: string }[]): string[] {
  const bad = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/
  return files.filter((f) => bad.test(f.text)).map((f) => f.rel)
}

describe('control characters', () => {
  test('the rule works on good and bad input', () => {
    expect(filesWithControlChars([{ rel: 'a.ts', text: 'const r = /\\band\\b/\n\tok\r\n' }])).toEqual([])
    expect(filesWithControlChars([{ rel: 'b.ts', text: 'const r = /\band\b/' }])).toEqual(['b.ts'])
  })

  test('sweep of src', () => {
    const files: { rel: string; text: string }[] = []
    const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.(ts|tsx|js|mjs|css)$/.test(e.name)) files.push({ rel: path.relative(process.cwd(), full), text: fs.readFileSync(full, 'utf8') })
    })
    walk(path.resolve(process.cwd(), 'src'))
    expect(files.length).toBeGreaterThan(500)
    expect(filesWithControlChars(files)).toEqual([])
  })
})
