/**
 * 🔒 GUARD: every way INTO Settle is a way back OUT of Settle.
 *
 * WHAT HAPPENED. PartySettle decides where Back and Cancel go from an
 * allowlist:
 *
 *     previousView === 'transaction-detail' || previousView === 'party-bills'
 *       ? previousView
 *       : 'party-profile'
 *
 * Ask your books then grew a "Record payment" button. It set previousView to
 * 'ask' exactly like every other caller does — and Cancel dropped the
 * shopkeeper on the party profile, a screen they had never been on. Nothing
 * failed, nothing warned; the allowlist just quietly did not contain the new
 * arrival.
 *
 * The comment above that allowlist already warns about precisely this kind of
 * stranding ("would strand anyone who arrived from a bill on a screen they did
 * not come from"). The allowlist is the same bug one level up: it strands
 * anyone who arrives from a screen nobody has remembered to add.
 *
 * SO THE GUARD READS THE CALL SITES RATHER THAN A LIST I MAINTAIN. It finds
 * every setView('party-settle') in the app, takes the setPreviousView(...)
 * that arms it, and requires that value to appear in the allowlist. A new
 * entry point added next month fails here instead of stranding someone.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const SRC = path.resolve(process.cwd(), 'src')
const SETTLE = path.join(SRC, 'components/parties/PartySettle.tsx')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

/** The literal view names PartySettle will hand back to. */
function allowedReturnViews(): Set<string> {
  const src = fs.readFileSync(SETTLE, 'utf8')
  const block = /const returnView =([\s\S]*?)'party-profile'/.exec(src)
  expect(block).not.toBeNull()
  return new Set([...block![1].matchAll(/previousView === '([a-z-]+)'/g)].map(m => m[1]))
}

/**
 * The fallback. A caller that arms 'party-profile' is not stranded — that is
 * exactly where the fallback sends them.
 */
const FALLBACK = 'party-profile'

/**
 * Call sites that arm previousView with a VARIABLE rather than a literal, so
 * no static read can resolve it. Listed rather than ignored, because "we could
 * not check this one" is a fact the next person deserves to see.
 *
 * AskAnswer passes `useAppStore.getState().currentView`, which on this screen
 * is 'ask' — and the first test pins 'ask' in the allowlist, so the pair is
 * covered even though neither half can prove it alone.
 */
const DYNAMIC_BUT_REVIEWED = new Set(['components/ask/AskAnswer.tsx'])

/**
 * Every previousView armed before a jump to Settle.
 *
 * The window is a dozen lines, which covers all current call sites. A caller
 * that arms previousView further away than that is invisible here, and the
 * test reports it as unchecked rather than passing it quietly.
 */
function entryPoints(): { file: string; view: string; dynamic: boolean }[] {
  const found: { file: string; view: string; dynamic: boolean }[] = []
  for (const file of walk(SRC)) {
    // Skip Settle itself and every test — this file quotes the call in its own
    // documentation, and a guard that fails on its own prose is just noise.
    if (file === SETTLE || file.includes('__tests__')) continue
    const src = fs.readFileSync(file, 'utf8')
    if (!src.includes("setView('party-settle')")) continue
    const rel = path.relative(SRC, file).split(path.sep).join('/')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (!line.includes("setView('party-settle')")) return
      for (let j = i; j >= Math.max(0, i - 12); j--) {
        const literal = /setPreviousView\('([a-z-]+)'\)/.exec(lines[j])
        if (literal) { found.push({ file: rel, view: literal[1], dynamic: false }); return }
        if (/setPreviousView\(/.test(lines[j])) {
          found.push({ file: rel, view: '', dynamic: true }); return
        }
      }
      found.push({ file: rel, view: '', dynamic: false })
    })
  }
  return found
}

describe('Settle returns you where you came from', () => {
  test('the allowlist still exists and is read from the component, not duplicated here', () => {
    const allowed = allowedReturnViews()
    expect(allowed.size).toBeGreaterThan(0)
    // Pin the one that was missing, so removing it fails loudly.
    expect(allowed.has('ask')).toBe(true)
  })

  test('every screen that opens Settle is a screen Settle can return to', () => {
    const allowed = allowedReturnViews()
    const points = entryPoints()

    // If this is zero the test has stopped testing anything — most likely the
    // navigation was refactored and this guard needs rewriting, not deleting.
    expect(points.length).toBeGreaterThan(0)

    const stranded = points.filter(p => {
      if (p.dynamic) return !DYNAMIC_BUT_REVIEWED.has(p.file)
      if (p.view === '') return true                 // nothing armed at all
      return p.view !== FALLBACK && !allowed.has(p.view)
    })

    if (stranded.length) {
      throw new Error(
        `\n\n🔒 SETTLE RETURN GUARD FAILED.\n\n` +
        `These screens open Settle, but Settle will not hand the shopkeeper\n` +
        `back to them — Cancel and Back will drop them on the party profile,\n` +
        `a screen they were never on. This is what happened to Ask.\n\n` +
        `Fix: add the view to the returnView allowlist in PartySettle.tsx.\n` +
        `If previousView is set from a variable, add the file to\n` +
        `DYNAMIC_BUT_REVIEWED here and say in a comment what it resolves to.\n\n` +
        stranded.map(p =>
          `  ${p.file} — previousView: ${p.dynamic ? '(set from a variable, unreviewed)' : p.view || '(none armed nearby)'}`,
        ).join('\n') + `\n`,
      )
    }
  })
})
