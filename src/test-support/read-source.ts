/**
 * 🔒 READING SOURCE CODE AS TEXT, WITHOUT READING ITS PROSE.
 *
 * Ninety-eight of this repo's tests open a source file and assert something
 * about the text. That is deliberate and often the only option — the bugs
 * they catch live in the SHAPE of a query or the ORDER of a check, not in a
 * function anyone can call.
 *
 * The catch is that source files are mostly prose. This codebase comments
 * heavily, and the comments quote the very thing being asserted, because a
 * comment explaining a fix names the thing it fixed. So a guard that reads
 * raw text is reading an argument about the code as if it were the code.
 *
 * ─────────────────────── WHY THIS FILE EXISTS ───────────────────────
 *
 * 15 Aug, a sweep of all 226 test files. Nothing was passing on prose alone
 * that day — but FIVE guards would have kept passing if the code they
 * protect were deleted, because the string they require also appears in a
 * comment in the same file. That was proved, not guessed:
 *
 *   The import and every call to `computePartyBalance` were removed from
 *   app/api/parties/[id]/route.ts, leaving only comments that mention it.
 *   `balance-reconciliation.test.ts` — the guard written to prevent "three
 *   screens, three balances" — passed 9/9.
 *
 * A guard that cannot fail is a green tick over an unchecked claim, and
 * those ticks get reported as evidence.
 *
 * This is the same family as CLAUDE.md's Cause 7, which now has six entries:
 * a 900-character window an added comment pushed the target out of; a
 * 700-character window that let a neighbour's userId satisfy a tenant check;
 * a 1,600-character window; a migration comment read as destructive SQL; a
 * guard pinning an API name instead of the behaviour; and this.
 *
 * Use `readCode` wherever an assertion means "the code does X".
 * Use `readRaw` only when the comment IS the subject — an audit marker, a
 * TODO sweep, a licence header.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Strip block and line comments.
 *
 * Deliberately simple, and it must stay simple to stay trustworthy. Two
 * things it does NOT do, because both would cost more than they buy:
 *
 *  - it does not parse strings, so a `//` inside a string literal is treated
 *    as a comment. In this repo that is safe: URLs in code are written as
 *    'https:' + '//' or live in config, and the guards that matter assert on
 *    identifiers and call shapes, not on URLs.
 *  - it does not handle regex literals containing a slash-star sequence.
 *    There are none.
 *
 * `\r?\n` handling comes free: the line-comment pattern is anchored per line
 * with the `m` flag and `.` does not cross a newline, so a carriage return is
 * simply left in place rather than swallowing the line. That is the #76
 * failure, which came from `.` NOT matching `\r` while the pattern expected
 * to reach the end of the line.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
}

/** Split on both line endings. Windows checkouts keep a carriage return. */
export function lines(source: string): string[] {
  return source.split(/\r?\n/)
}

/**
 * Read a source file with its comments removed.
 *
 * @param relPath from the repo root ("src/lib/x.ts") or from src ("lib/x.ts").
 */
export function readCode(relPath: string): string {
  return stripComments(readRaw(relPath))
}

/** Read a source file exactly as written. Only when the comment is the subject. */
export function readRaw(relPath: string): string {
  const rel = relPath.startsWith('src/') ? relPath : join('src', relPath)
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

/**
 * The body of one `case 'name':` in a switch, cut where it ACTUALLY ends —
 * at the next `case '` label — not after a guessed number of characters.
 *
 * Fixed-width windows are the most repeated defect in this repo's guards:
 * 900, 700 and 1,600 characters, each of which either passed on broken code
 * or failed on correct code, and each of which looked fine when written.
 */
export function caseBlock(source: string, name: string): string {
  const start = source.indexOf(`case '${name}'`)
  if (start === -1) throw new Error(`case '${name}' not found — renamed?`)
  const next = source.indexOf("case '", start + 6)
  return source.slice(start, next === -1 ? source.length : next)
}

/**
 * The body that follows `marker`, cut at its matching closing brace.
 *
 * The replacement for `src.slice(i, i + 700)`. Counts braces from the first
 * `{` after the marker, so the block ends where the code says it ends however
 * long it grows.
 */
export function balancedBlock(source: string, marker: string | RegExp): string {
  const at = typeof marker === 'string'
    ? source.indexOf(marker)
    : source.search(marker)
  if (at === -1) throw new Error(`marker not found: ${marker}`)
  const open = source.indexOf('{', at)
  if (open === -1) return source.slice(at)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(at, i + 1)
    }
  }
  return source.slice(at)
}
