/**
 * Every app component file must be imported by something in src.
 *
 * 🐛 12 Nov 2026. GstTaxPage.tsx was deleted as dead code in a912fbb6 (V22-5),
 * then came back in 8e0e13fa and sat unmounted for months. Nothing imported
 * it, so nothing caught it — and it carried its own GST_TOOLS list that
 * ignored NAV_REGISTRY's gstNeeds rule. Mounted again, it would have shown
 * GSTR-1/3B and Supplier bills to a composition shop: two lists for one thing
 * (CLAUDE.md Cause 2). A dead file is not harmless; it is a second copy of a
 * rule waiting to be wired back in.
 *
 * This reads import specifiers as text and resolves them to files, so it
 * needs no bundler. `src/components/ui/` is excluded: those are the stock
 * component library, kept whole on purpose.
 *
 * KNOWN_ORPHANS is the list as found on 12 Nov (tasklog). It may only
 * shrink: a file on it that is imported again, or deleted, fails the test
 * until it is taken off. A NEW unused file fails at once.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, dirname, resolve, relative } from 'path'
import { stripComments } from '@/test-support/read-source'

const root = process.cwd()
const src = join(root, 'src')

const KNOWN_ORPHANS = [
  'components/auth/PasswordReset.tsx',
  'components/common/AnnouncementBanner.tsx',
  'components/common/card-artwork.tsx',
  'components/common/DraftRestoreBanner.tsx',
  'components/common/FloatingActionButton.tsx',
  'components/common/PartySelect.tsx',
  'components/common/SessionTimeoutWarning.tsx',
  'components/common/SuccessAnimation.tsx',
  'components/reports/MoneyBankingPage.tsx',
  'components/reports/ReportShell.tsx',
  'components/scanner/CameraPreviewModal.tsx',
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p)
    return /\.(tsx?|jsx?|mjs)$/.test(name) ? [p] : []
  })
}

const posix = (p: string) => relative(src, p).replace(/\\/g, '/')

/** Resolve an import specifier the way TypeScript does for this repo. */
function resolveSpec(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(src, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null
  for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
    const p = base + ext
    if (existsSync(p) && statSync(p).isFile()) return posix(p)
  }
  return null
}

const SPEC = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g

function importedFiles(): Set<string> {
  const seen = new Set<string>()
  for (const file of walk(src)) {
    const text = stripComments(readFileSync(file, 'utf8'))
    for (const m of text.matchAll(SPEC)) {
      const hit = resolveSpec(file, m[1])
      if (hit && hit !== posix(file)) seen.add(hit)
    }
  }
  return seen
}

function orphans(): string[] {
  const imported = importedFiles()
  return walk(join(src, 'components'))
    .map(posix)
    .filter(f => !f.startsWith('components/ui/'))
    .filter(f => !imported.has(f))
    .sort()
}

describe('no unused component files', () => {
  const found = orphans()

  test('the scan sees real imports (not passing on nothing)', () => {
    const imported = importedFiles()
    expect(imported.has('components/layout/Sidebar.tsx')).toBe(true)
    expect(imported.size).toBeGreaterThan(100)
  })

  test('no new unused component file', () => {
    expect(found.filter(f => !KNOWN_ORPHANS.includes(f))).toEqual([])
  })

  test('KNOWN_ORPHANS only shrinks — take a file off once it is used or deleted', () => {
    expect(KNOWN_ORPHANS.filter(f => !found.includes(f))).toEqual([])
  })
})
