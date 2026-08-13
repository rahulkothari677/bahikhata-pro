/**
 * @jest-environment node
 *
 * The dashboard quick-action row holds exactly five cards, and Scan Bill is
 * not one of them.
 *
 * WHY (Rahul, 13 Aug 2026): "remove scan bill from the small cards (where ask,
 * add product and other things are). i just want 5 cards."
 *
 * Scanning itself is NOT removed — it stays on the hero card directly above
 * this row, and in More. What left is a duplicate, for the same reason 'New
 * Sale' was removed from this row in UI/UX Phase 3: a shortcut that repeats
 * something already one tap away costs attention and buys nothing.
 *
 * WHY A TEST AND NOT JUST THE EDIT: this row has now been changed twice by two
 * different people. Without a guard the sixth card comes back, and nobody
 * notices until Rahul opens the app.
 *
 * HOW IT AVOIDS THE GUARD MISTAKES ALREADY MADE IN THIS REPO (CLAUDE.md,
 * Cause 7): it does not read a fixed window of characters near a marker, and
 * it does not match its own explanatory comments. It finds the array by
 * balancing brackets, and strips comments before counting — the comment above
 * the removal names 'Scan Bill', so a naive grep would fail on the fixed code.
 */
import fs from 'fs'
import path from 'path'

const SRC = fs.readFileSync(
  path.join(process.cwd(), 'src/components/dashboard/Dashboard.tsx'),
  'utf8',
)

/** Remove /* *\/ and // comments so the guard cannot read its own prose. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * The quick-action array, found by balancing brackets back from the `.map(`
 * that renders it — not by slicing a guessed number of characters.
 */
function quickActionArray(): string {
  const mapAt = SRC.indexOf('].map((action)')
  expect(mapAt).toBeGreaterThan(-1) // the row must still be rendered this way
  let depth = 0
  for (let i = mapAt; i >= 0; i--) {
    if (SRC[i] === ']') depth++
    else if (SRC[i] === '[') {
      depth--
      if (depth === 0) return SRC.slice(i, mapAt + 1)
    }
  }
  throw new Error('could not find the opening bracket of the quick-action array')
}

const ARRAY = stripComments(quickActionArray())
const LABELS = [...ARRAY.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1])

describe('the guard reads the real array', () => {
  it('found labels, so the assertions below are not vacuous', () => {
    expect(LABELS.length).toBeGreaterThan(0)
  })

  it('found the row that contains Ask, which is how we know it is the right one', () => {
    expect(LABELS).toContain('Ask')
  })
})

describe('exactly five cards', () => {
  it('has five, not six', () => {
    expect(LABELS).toHaveLength(5)
  })

  it('is the set Rahul asked for', () => {
    expect(LABELS).toEqual(['Ask', 'Add Product', 'Add Party', 'Reports', 'Income'])
  })

  it('does not offer Scan Bill here', () => {
    expect(LABELS).not.toContain('Scan Bill')
  })
})

describe('scanning is still reachable', () => {
  it('the hero card still opens the scanner', () => {
    // The claim that justified removing the card. If this ever stops being
    // true, removing the shortcut DID remove the feature, and this must fail.
    expect(SRC).toMatch(/Scan a Bill/)
    expect(SRC).toMatch(/setView\('scanner'\)/)
  })
})
