/**
 * 🔒 A GUARD ON THE GUARDS.
 *
 * Ninety-eight of this repo's tests open a source file and assert on its
 * text. That is the right tool for the bugs they catch — the defects live in
 * the SHAPE of a query or the ORDER of a check, not in a function anyone can
 * call. But source files here are mostly prose, and the comments quote the
 * very thing being asserted, because a comment explaining a fix names the
 * thing it fixed.
 *
 * So a guard reading raw text can be reading an argument ABOUT the code as
 * though it were the code.
 *
 * ───────────────────────── THE PROOF, 15 AUG ─────────────────────────
 *
 * A sweep of all 226 test files found nothing passing on prose alone that
 * day, but five assertions that would keep passing if the code they protect
 * were deleted. One was demonstrated rather than argued:
 *
 *   The import and every call to `computePartyBalance` were removed from
 *   app/api/parties/[id]/route.ts, leaving only the comments that mention
 *   it. `balance-reconciliation.test.ts` — written to stop "three screens,
 *   three balances" — passed 9 of 9.
 *
 * ──────────────────── WHAT THIS TEST ACTUALLY CHECKS ────────────────────
 *
 * NOT "does this guard read raw text". Forty-five files do, and for most of
 * them it is harmless: the string they require never appears in a comment,
 * so there is nothing to confuse. Failing all forty-five would be a wall of
 * red that someone eventually deletes — which is how a guard dies.
 *
 * It checks the condition that is ACTUALLY a defect: a guard requires a
 * literal, and that literal appears in a COMMENT of the exact file it reads.
 * Then the assertion can be satisfied by prose, and the guard has a hole
 * whether or not anyone has fallen through it yet.
 *
 * That is narrow enough to stay green and honest enough to mean something.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { stripComments } from '@/test-support/read-source'

const ROOT = process.cwd()
const TESTS = join(ROOT, 'src/__tests__')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

const rel = (p: string) => p.slice(ROOT.length + 1).split('\\').join('/')

/** Just the comments of a source file — the mirror of stripComments. */
function commentsOf(source: string): string {
  const blocks: string[] = source.match(/\/\*[\s\S]*?\*\//g) ?? []
  const lineComments: string[] = source.match(/^[ \t]*\/\/[^\n]*$/gm) ?? []
  return [...blocks, ...lineComments].join('\n')
}

const CANDIDATE_ROOTS = ['', 'src/', 'src/app/', 'src/lib/', 'src/components/', 'src/hooks/']

function resolveTarget(relPath: string): string | null {
  const p = relPath.split('\\').join('/')
  for (const root of CANDIDATE_ROOTS) {
    const full = join(ROOT, p.startsWith('src/') ? p : root + p)
    if (existsSync(full)) return full
  }
  return null
}

/**
 * Pair each `expect(<var>).toContain('X')` with the read that assigned
 * `<var>`, by scanning the file in order. Crude but exact enough: a guard
 * that reassigns the same variable from two files in one block would confuse
 * it, and none do.
 */
const ASSIGN = /(?:const|let)\s+(\w+)\s*(?::\s*string\s*)?=\s*(?:await\s+)?\w*[rR]ead\w*\(\s*['"]([^'"]+)['"]/
const REQUIRE = /expect\(\s*(\w+)\s*\)\s*\.\s*toContain\(\s*['"]([^'"]{4,80})['"]/

interface Hole { guard: string; target: string; literal: string; alsoInCode: boolean }

function holesIn(testFile: string): Hole[] {
  /*
   * 🐛 CAUGHT BY ITS OWN PROOF, minutes after being written.
   *
   * This read the test file RAW and skipped any that mentioned `readCode` or
   * `stripComments`. Then the money guard was reverted to raw reads to check
   * that this detector would fire — and it stayed silent, because the
   * comment left behind still contained the word `readCode`.
   *
   * A guard on guards, fooled by a comment, while looking for guards fooled
   * by comments. The subject of every check below is CODE, so the test file
   * is stripped before anything is read out of it.
   */
  const src = stripComments(readFileSync(testFile, 'utf8'))
  if (!/readFileSync\s*\(/.test(src)) return []
  // A guard that already strips comments cannot have this hole.
  if (/stripComments|readCode/.test(src)) return []

  const holes: Hole[] = []
  const varToFile: Record<string, string> = {}
  const combined = new RegExp(`${ASSIGN.source}|${REQUIRE.source}`, 'g')

  for (const m of src.matchAll(combined)) {
    const [, assignVar, assignPath, expectVar, literal] = m
    if (assignVar && assignPath) {
      varToFile[assignVar] = assignPath
      continue
    }
    if (!expectVar || !literal) continue
    const relTarget = varToFile[expectVar]
    if (!relTarget) continue
    const target = resolveTarget(relTarget)
    if (!target) continue

    const targetSrc = readFileSync(target, 'utf8')
    const inComment = commentsOf(targetSrc).includes(literal)
    if (!inComment) continue
    holes.push({
      guard: rel(testFile),
      target: rel(target),
      literal,
      alsoInCode: stripComments(targetSrc).includes(literal),
    })
  }
  return holes
}

describe('a guard must read the code, not the prose around it', () => {
  test('no guard requires a string that its target only has in a comment', () => {
    const holes = walk(TESTS).flatMap(holesIn)

    if (holes.length > 0) {
      throw new Error(
        '\n\n🔒 THESE ASSERTIONS CAN BE SATISFIED BY A COMMENT.\n\n' +
        holes.map(h =>
          `  ${h.guard}\n` +
          `    reads   ${h.target}\n` +
          `    requires ${JSON.stringify(h.literal)}\n` +
          `    which appears in that file's COMMENTS` +
          (h.alsoInCode
            ? ' as well as its code — so deleting the code would NOT fail this test.\n'
            : ' and NOWHERE in its code — so this test is passing on prose right now.\n'),
        ).join('\n') +
        '\nOn 15 Aug this was demonstrated, not argued: removing every real call\n' +
        'to computePartyBalance from the party route left balance-reconciliation\n' +
        'passing 9 of 9.\n\n' +
        'Fix: read through `readCode` from "@/test-support/read-source", or wrap\n' +
        'the existing read in `stripComments()`.\n',
      )
    }
  })

  test('the detector separates prose from code on a planted example', () => {
    /*
     * The rule that earned this whole task: a guard nobody can run against a
     * known-bad input is a comment with a green tick next to it. So the two
     * halves of the detector are run against a fixture built to have the
     * exact defect — the required name present ONLY as prose.
     *
     * A fixture rather than this file: my first version read this very file
     * and asserted its code did not contain the name, which is impossible,
     * because the assertion itself has to write the name down. A test that
     * cannot pass is no better than one that cannot fail.
     */
    const brokenSource = [
      '/**',
      ' * Balances used to be computed inline here. Now computePartyBalance()',
      ' * is the single source of truth — see V15.',
      ' */',
      'export async function GET() {',
      '  const balance = openingBalance + salesOutstanding',
      '  return balance',
      '}',
    ].join('\n')

    // The name is in the prose…
    expect(commentsOf(brokenSource)).toContain('computePartyBalance')
    // …and nowhere in the code, which is exactly the hole.
    expect(stripComments(brokenSource)).not.toContain('computePartyBalance')

    const fixedSource = brokenSource.replace(
      'const balance = openingBalance + salesOutstanding',
      'const balance = await computePartyBalance(userId, id)',
    )
    expect(stripComments(fixedSource)).toContain('computePartyBalance')
  })

  test('stripComments survives Windows line endings', () => {
    // #76: `.` does not match a carriage return, so a stripper written with a
    // `$` anchor removed nothing at all on a Windows checkout.
    const crlf = '// gone\r\nconst kept = 1\r\n/* also gone */\r\n'
    const out = stripComments(crlf)
    expect(out).toContain('const kept = 1')
    expect(out).not.toContain('gone')
  })
})
