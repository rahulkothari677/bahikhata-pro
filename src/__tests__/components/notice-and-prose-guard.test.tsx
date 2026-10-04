/**
 * 🔒 GUARD: one warning box, and a prose budget (Phase 4b, #177).
 *
 * WHAT IT HOLDS
 *  - <Notice> is the one warning box: four levels (stop / act / note / clear),
 *    a short title, at most one line, the explanation behind ⓘ, the fix on
 *    the box. <NoticeStack> shows the worst first and folds the rest.
 *  - The shared warnings use it, so they cannot drift back to their own look.
 *  - Hand-made tinted warning boxes may only go DOWN (76 after 4b, from 88).
 *  - Prose on working screens may only go DOWN (2,347 words after 4b, from
 *    3,230). Terms, Privacy and the landing page are legal or marketing text
 *    and are not counted. When a later phase removes prose, lower the
 *    ceiling in the same commit; the "within 50" check makes that happen.
 *  - No menu or screen lists tax slabs as text ("5/12/18/28%"): rates change
 *    (GST 2.0, 22 Sep 2025) and a hard-coded list goes stale (#149).
 *
 * Every rule is a function tested on good and bad input first (CLAUDE.md,
 * Cause 7), then swept over the code.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { render, screen, fireEvent } from '@testing-library/react'
import { Notice, NoticeStack, sortNotices, splitNotices } from '@/components/ui/notice'
import { proseRuns, proseWords } from '@/test-support/prose-rules'
import { adHocWarningBoxCount } from '@/test-support/design-rules'
import { stripComments } from '@/test-support/read-source'

const SRC = path.resolve(process.cwd(), 'src')
const PROSE_CEILING = 2347
const BOX_CEILING = 76
/** Legal and marketing pages: long text is their job. */
const NOT_SCREENS = ['app/terms', 'app/privacy', 'app/landing', 'app/dev']

function files(): { rel: string; raw: string }[] {
  const out: { rel: string; raw: string }[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'test-support') walk(full) }
      else if (/\.tsx?$/.test(e.name)) out.push({ rel: path.relative(SRC, full).split(path.sep).join('/'), raw: fs.readFileSync(full, 'utf8') })
    }
  }
  walk(SRC)
  return out
}

describe('the rules catch what they claim (good and bad input)', () => {
  test('notices sort worst first and keep the given order within a level', () => {
    const sorted = sortNotices([
      { id: 'n', level: 'note' as const }, { id: 'a1', level: 'act' as const },
      { id: 's', level: 'stop' as const }, { id: 'a2', level: 'act' as const },
    ])
    expect(sorted.map((n) => n.id)).toEqual(['s', 'a1', 'a2', 'n'])
  })

  test('only the first stop and the first act stay open; with neither, the first notice does', () => {
    const { shown, folded } = splitNotices([
      { id: 's1', level: 'stop' as const }, { id: 's2', level: 'stop' as const },
      { id: 'a1', level: 'act' as const }, { id: 'n', level: 'note' as const },
    ])
    expect(shown.map((n) => n.id)).toEqual(['s1', 'a1'])
    expect(folded.map((n) => n.id)).toEqual(['s2', 'n'])
    expect(splitNotices([{ id: 'n1', level: 'note' as const }, { id: 'n2', level: 'note' as const }]).shown.map((n) => n.id)).toEqual(['n1'])
  })

  test('prose: a long paragraph counts; a label, a {value} row and a comment do not', () => {
    const para = '<p>Once you file GST for a period, lock it so no one can edit, delete or create bills.</p>'
    expect(proseRuns(para)).toHaveLength(1)
    expect(proseWords(para)).toBe(18)
    expect(proseRuns('<p>Lock until the last day of the month you filed GST for</p>')).toEqual([]) // 12 words
    expect(proseRuns('<div>{a}{b}{c}{d}{e}{f}{g}{h}{i}{j}{k}{l}{m}{n}{o}</div>')).toEqual([])
    expect(proseRuns('<div>{/* a long explanation of why this card exists, written for the next developer to read */}</div>')).toEqual([])
    expect(proseRuns('const x = 1 > 2 ? "a" : "b"')).toEqual([])
  })

  test('hand-made box count sees a tinted surface with a tinted border, in either order', () => {
    expect(adHocWarningBoxCount('className="rounded border border-amber-200 bg-amber-50 p-3"')).toBe(1)
    expect(adHocWarningBoxCount('className="bg-rose-50 p-3 border-rose-200"')).toBe(1)
    expect(adHocWarningBoxCount('className="bg-check-soft border-check/35"')).toBe(0)
    expect(adHocWarningBoxCount('className="text-amber-600 bg-amber-50 rounded-full"')).toBe(0) // a chip, no border
  })
})

describe('<Notice> and <NoticeStack> behave as specified', () => {
  test('a stop is announced, carries its level, and its close button is 48px', () => {
    const onDismiss = jest.fn()
    render(<Notice level="stop" title="Bill is wrong" info="Why it is wrong." onDismiss={onDismiss}>Fix the GSTIN.</Notice>)
    const box = screen.getByRole('alert')
    expect(box.getAttribute('data-notice-level')).toBe('stop')
    expect(screen.getByRole('button', { name: /about bill is wrong/i })).toBeTruthy()
    const close = screen.getByRole('button', { name: 'Dismiss' })
    expect(close.className).toMatch(/\bw-12\b/)
    expect(close.className).toMatch(/\bh-12\b/)
    fireEvent.click(close)
    expect(onDismiss).toHaveBeenCalled()
  })

  test('note and clear are quiet: no alert role', () => {
    render(<><Notice level="note" title="FYI" /><Notice level="clear" title="All good" /></>)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('a stack shows the worst first and folds the rest behind "N more"', () => {
    render(<NoticeStack notices={[
      { id: 'n', level: 'note', title: 'Note one' },
      { id: 'a1', level: 'act', title: 'Act one' },
      { id: 's', level: 'stop', title: 'Stop one' },
      { id: 'a2', level: 'act', title: 'Act two' },
    ]} />)
    const titles = Array.from(document.querySelectorAll('[data-notice-level]')).map((el) => el.getAttribute('data-notice-level'))
    expect(titles).toEqual(['stop', 'act'])
    fireEvent.click(screen.getByRole('button', { name: /2 more/ }))
    expect(screen.getByText('Act two')).toBeTruthy()
    expect(screen.getByText('Note one')).toBeTruthy()
  })
})

describe('the app keeps one box and a prose budget', () => {
  const all = files()

  test.each([
    'components/ledger/BillOfSupplyNotice.tsx',
    'components/ledger/EwayBillNotice.tsx',
    'components/reports/ItcReversalWarning.tsx',
    'components/common/DraftRestoreBanner.tsx',
    'components/common/AnnouncementBanner.tsx',
  ])('%s draws its warning with <Notice>', (rel) => {
    const code = stripComments(all.find((f) => f.rel === rel)!.raw)
    expect(code).toMatch(/<Notice\b/)
    expect(adHocWarningBoxCount(code)).toBe(0)
  })

  test('hand-made warning boxes never grow', () => {
    const count = all.reduce((n, f) => n + adHocWarningBoxCount(stripComments(f.raw)), 0)
    expect(count).toBeLessThanOrEqual(BOX_CEILING)
    expect(BOX_CEILING - count).toBeLessThan(10) // lower the ceiling when boxes go
  })

  test('prose on working screens never grows', () => {
    const counted = all.filter((f) => f.rel.endsWith('.tsx') && !NOT_SCREENS.some((p) => f.rel.startsWith(p)))
    const total = counted.reduce((n, f) => n + proseWords(f.raw, f.rel), 0)
    if (total > PROSE_CEILING) {
      const worst = counted.map((f) => [f.rel, proseWords(f.raw, f.rel)] as const).sort((a, b) => b[1] - a[1]).slice(0, 8)
      throw new Error(
        `\n\n🔒 PROSE BUDGET (#177). ${total} words of prose on screens > ${PROSE_CEILING}.\n` +
        `On screen: the label, the number, the action, at most one short line.\n` +
        `Longer text goes behind ⓘ (InfoHint, or <Notice info=…>).\n\n` +
        worst.map(([f, w]) => `  ${w}  ${f}`).join('\n') + '\n',
      )
    }
    expect(PROSE_CEILING - total).toBeLessThan(50) // lower the ceiling when prose goes
  })

  test('no screen or menu lists tax slabs as text (#149)', () => {
    const hits = all.filter((f) => /5\s*\/\s*12\s*\/\s*18\s*\/\s*28/.test(stripComments(f.raw))).map((f) => f.rel)
    expect(hits).toEqual([])
  })
})
