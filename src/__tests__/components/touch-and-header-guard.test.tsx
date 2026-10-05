/**
 * 🔒 GUARD: 48px touch targets, a header whose title reads in full, a splash
 * that gets out of the way, and a delete that means what it says (Phase 4c).
 *
 * WHAT IT HOLDS
 *  - No raw <button> anywhere on a screen is drawn below 48px by an explicit
 *    size (#182's 22px ✕, #233's 14px bin, 33 of them before 4c). Absolute:
 *    zero allowed, not a ceiling.
 *  - The shared <Button> gives every size a 48px floor; only a large screen
 *    with a MOUSE (lg:pointer-fine) gets compact heights, so a touch tablet
 *    at the counter keeps 48px.
 *  - ⓘ is 48px. Compact number fields and the bill-line pickers are 48px on
 *    touch screens.
 *  - The phone header carries no language switch (it is in Settings) and its
 *    title wraps instead of ending in "Purchase Led…" (#140, #192).
 *  - The splash times from page start, never holds longer than 3s, exits in
 *    200ms, and swallows a tap that began on it (#183).
 *  - A confirm that says "Type DELETE" has a box to type DELETE into (#234).
 *
 * Rules are functions tested on good and bad input first (CLAUDE.md, Cause 7).
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useEffect } from 'react'
import { smallButtons, buttonTags } from '@/test-support/design-rules'
import { stripComments } from '@/test-support/read-source'
import { splashMayExit, isGhostTap, SPLASH_TIMING } from '@/components/common/SplashScreen'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'

const SRC = path.resolve(process.cwd(), 'src')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')
const blankComments = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/^[ \t]*\/\/[^\n]*$/gm, (m) => ' '.repeat(m.length))

/**
 * The stock shadcn sidebar (a 16px drag rail) is imported by nothing; it is
 * exempt only while that stays true — the last test below checks it.
 */
const EXEMPT = ['components/ui/sidebar.tsx']

describe('the rules catch what they claim (good and bad input)', () => {
  test('a small icon button fails; a 48px one, or one with a 48px floor, passes', () => {
    expect(smallButtons('<button className="p-1 w-7 h-7 rounded">x</button>')).toHaveLength(1)
    expect(smallButtons('<button className="w-11 h-11">x</button>')).toHaveLength(1) // 44px: under the floor
    expect(smallButtons('<button className="min-h-[36px] px-2">Sync</button>')).toHaveLength(1)
    expect(smallButtons('<button className="w-12 h-12 -m-2">x</button>')).toEqual([])
    expect(smallButtons('<button className="h-9 min-h-12 px-3">Go</button>')).toEqual([])
    expect(smallButtons('<button className="px-4 py-3">Text button</button>')).toEqual([]) // a text button: not judged here
  })

  test('an icon-only button sized by small padding fails (the original #182 ✕)', () => {
    expect(smallButtons('<button className="p-1 rounded text-muted-foreground" onClick={() => remove(i)}>\n  <X className="w-3.5 h-3.5" />\n</button>')).toHaveLength(1)
    expect(smallButtons('<button className="min-h-12 min-w-12 inline-flex items-center justify-center p-1 rounded"><X className="w-4 h-4" /></button>')).toEqual([])
    expect(smallButtons('<button className="p-1.5 rounded">Undo</button>')).toEqual([]) // has text: not an icon button
    // a bare glyph, even one that switches between two icons (the 16px eye)
    expect(smallButtons('<button type="button" onClick={() => toggle()} className="absolute right-3">\n  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}\n</button>')).toHaveLength(1)
    expect(smallButtons('<button className="p-4 rounded-full"><X className="w-4 h-4" /></button>')).toEqual([]) // 16 + 2×16 = 48
    // an inline <svg> icon is still an icon (the insight card's ✕ hid this way)
    expect(smallButtons('<button className="-mt-1 p-1" aria-label="Dismiss"><svg width="16" height="16"><line x1="1" /></svg></button>')).toHaveLength(1)
    // hit-48 gives a small-looking pill a 48px finger target
    expect(smallButtons('<button className="hit-48 rounded-full px-3 py-1.5 text-xs"><X className="w-3 h-3" /></button>')).toEqual([])
  })

  test('switches, dialog and sheet close buttons, and native dropdowns meet the floor', () => {
    // Every on/off switch in the app was 32x18 px; it keeps its look and gets a 48px target.
    expect(stripComments(read('components/ui/switch.tsx'))).toMatch(/"hit-48 peer /)
    // The shared dialog/sheet ✕ was 15px.
    for (const f of ['components/ui/dialog.tsx', 'components/ui/sheet.tsx']) {
      expect(stripComments(read(f))).toMatch(/absolute top-0 right-0 size-12 /)
    }
    // Native <select>s were 42-44px; on a touch screen none is shorter than 48.
    expect(read('app/globals.css')).toMatch(/@media \(pointer: coarse\)\s*\{\s*select\s*\{\s*min-height:\s*48px;/)
  })

  test('hit-48 really is at least 48px each way in the theme', () => {
    const css = read('app/globals.css')
    expect(css).toMatch(/\.hit-48::after\s*\{[^}]*width:\s*max\(100%,\s*48px\)[^}]*height:\s*max\(100%,\s*48px\)/)
  })

  test('an arrow function inside the tag does not end it early', () => {
    const src = '<button onClick={() => n > 1 && go()} className="w-6 h-6">x</button>'
    expect(buttonTags(src)[0].text).toContain('w-6 h-6')
    expect(smallButtons(src)).toHaveLength(1)
  })

  test('splash timing: counted from page start, capped at 3s', () => {
    expect(splashMayExit({ elapsedMs: 500, ready: true, warm: false })).toBe(false) // brand moment on a first open
    expect(splashMayExit({ elapsedMs: 1300, ready: true, warm: false })).toBe(true)
    expect(splashMayExit({ elapsedMs: 450, ready: true, warm: true })).toBe(true) // a reload: 0.4s
    expect(splashMayExit({ elapsedMs: 2500, ready: false, warm: false })).toBe(false) // still loading
    expect(splashMayExit({ elapsedMs: 3000, ready: false, warm: false })).toBe(true) // never longer than 3s
    expect(SPLASH_TIMING.exitMs).toBeLessThanOrEqual(220) // motion budget
  })

  test('a click right after a tap on the splash is a ghost; a later one is not', () => {
    expect(isGhostTap(1_000_300, 1_000_000)).toBe(true)
    expect(isGhostTap(1_002_000, 1_000_000)).toBe(false)
    expect(isGhostTap(5_000, 0)).toBe(false) // nobody touched the splash
  })
})

describe('the app keeps the 48px floor', () => {
  test('no raw button on any screen is drawn below 48px', () => {
    const violations: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        const rel = path.relative(SRC, full).split(path.sep).join('/')
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'test-support') walk(full) }
        else if (rel.endsWith('.tsx') && !EXEMPT.includes(rel)) smallButtons(blankComments(fs.readFileSync(full, 'utf8'))).forEach((v) => violations.push(`${rel} ${v}`))
      }
    }
    walk(SRC)
    if (violations.length) {
      throw new Error(`\n\n🔒 48px TOUCH FLOOR (§4). Keep a 48px box (w-12 h-12, or min-h-12) and shrink the GLYPH inside it:\n\n${violations.map((v) => `  ${v}`).join('\n')}\n`)
    }
  })

  test('every shared Button size has a 48px floor; compact heights only for a mouse', () => {
    const code = stripComments(read('components/ui/button.tsx'))
    const sizes = code.slice(code.indexOf('size: {'), code.indexOf('defaultVariants'))
    const entries = [...sizes.matchAll(/(\w+):\s*"([^"]+)"/g)]
    expect(entries.map((m) => m[1])).toEqual(['default', 'sm', 'lg', 'icon', 'touch', 'iconTouch'])
    for (const [, name, cls] of entries) {
      expect([name, /\b(?:min-h-12|size-12|h-12)\b/.test(cls)]).toEqual([name, true])
      // and a 48px minimum WIDTH: a Button given `w-8` (Parties' pencil) was 32px wide
      expect([name, /\b(?:min-w-12|size-12)\b/.test(cls)]).toEqual([name, true])
      expect([name, /(?<!pointer-fine:)\blg:min-[hw]-/.test(cls)]).toEqual([name, false])
    }
  })

  test('ⓘ, compact number fields and the bill-line pickers are 48px on touch', () => {
    expect(stripComments(read('components/common/InfoHint.tsx'))).toMatch(/\bw-12 h-12\b/)
    expect(stripComments(read('components/ui/number-field.tsx'))).toMatch(/compact && 'h-12 text-base lg:pointer-fine:h-8/)
    const entry = stripComments(read('components/ledger/TransactionEntry.tsx'))
    expect(entry.match(/SelectTrigger className="w-1[46] h-12 lg:pointer-fine:h-8/g)).toHaveLength(2)
    expect(entry).toMatch(/aria-label=\{`Remove \$\{item\.productName\}`\}/)
  })
})

describe('the header reads in full on a phone (#140, #192)', () => {
  const header = stripComments(read('components/layout/Header.tsx'))

  test('the language switch is desktop-only (Settings has the picker)', () => {
    // lg:contents, not lg:block: a block wrapper dropped the switch BELOW the bell
    // and made the desktop header 82px (caught by measuring, 5 Oct).
    expect(header).toMatch(/<div className="hidden lg:contents">\s*<LanguageToggle \/>/)
    expect(stripComments(read('components/settings/Settings.tsx'))).toMatch(/setLanguage\(/)
  })

  test('the page title wraps instead of truncating', () => {
    const title = header.slice(header.indexOf('{info.title}') - 160, header.indexOf('{info.title}'))
    expect(title).toMatch(/line-clamp-2/)
    expect(title).not.toMatch(/\btruncate\b/)
  })
})

function TypedConfirmHarness({ onResult }: { onResult: (v: boolean) => void }) {
  const { confirmDialog, dialog } = useConfirmDialog()
  useEffect(() => {
    confirmDialog('Last chance.', { title: 'Type DELETE to Confirm', confirmLabel: 'Erase', requireText: 'DELETE' }).then(onResult)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <>{dialog}</>
}

describe('a typed confirmation really asks for the word (#234)', () => {
  test('the button stays off until DELETE is typed, then confirms', async () => {
    const onResult = jest.fn()
    render(<TypedConfirmHarness onResult={onResult} />)
    const erase = await screen.findByRole('button', { name: 'Erase' })
    expect((erase as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'delete' } })
    expect((erase as HTMLButtonElement).disabled).toBe(true) // the exact word, not a near miss
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
    expect((erase as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { fireEvent.click(erase) })
    expect(onResult).toHaveBeenCalledWith(true)
  })

  test('the account deletion uses it', () => {
    expect(stripComments(read('components/settings/Settings.tsx'))).toMatch(/title: 'Type DELETE to Confirm'[^}]*requireText: 'DELETE'/)
  })
})

describe('exemptions stay honest', () => {
  test('every data-mouse-only button sits in a file that renders it for a fine pointer only', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'test-support') walk(full) }
        else if (/\.tsx$/.test(e.name)) {
          const code = stripComments(fs.readFileSync(full, 'utf8'))
          if (/\bdata-mouse-only\b/.test(code) && !/matchMedia\(\s*['"`][^'"`]*pointer:\s*fine/.test(code)) offenders.push(full)
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })

  test('the exempt stock sidebar is still imported by nothing', () => {
    const users: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(e.name) && /from ['"]@\/components\/ui\/sidebar['"]/.test(fs.readFileSync(full, 'utf8'))) users.push(full)
      }
    }
    walk(SRC)
    expect(users).toEqual([])
  })
})
