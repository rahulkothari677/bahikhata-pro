/**
 * Guards for the 2026-07-22 input/layout fixes (all three Rahul-reported).
 *
 * These are STRUCTURAL guards, not re-implementations: each one asserts the
 * property whose absence caused the reported bug, so a future edit that
 * reintroduces the bug fails here rather than in a customer's ledger.
 *
 * Comments are stripped before matching — a previous guard in this repo was
 * satisfied by a comment describing the old bug (see the audit protocol).
 */
import fs from 'fs'
import path from 'path'
import { formatIndianDigits } from '@/lib/pdf/theme'

const SRC = path.join(process.cwd(), 'src')

function readStripped(rel: string): string {
  const raw = fs.readFileSync(path.join(SRC, rel), 'utf8')
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('wheel guard on number inputs', () => {
  const input = readStripped('components/ui/input.tsx')

  test('the shared Input blurs a focused number field on wheel', () => {
    // The bug: scrolling the page with the cursor over a focused
    // <input type="number"> silently rewrote the amount.
    expect(input).toMatch(/onWheel/)
    expect(input).toMatch(/type === 'number'/)
    expect(input).toMatch(/blur\(\)/)
  })

  test('the guard only fires for number inputs, so text fields are untouched', () => {
    const wheelHandler = input.slice(input.indexOf('handleWheel'), input.indexOf('return ('))
    expect(wheelHandler).toMatch(/type === 'number'/)
  })

  test('a caller-supplied onWheel is still invoked', () => {
    expect(input).toMatch(/onWheel\?\.\(e\)/)
  })
})

describe('NumberField', () => {
  const nf = readStripped('components/ui/number-field.tsx')

  test('renders explicit decrease/increase controls', () => {
    expect(nf).toMatch(/aria-label="Decrease"/)
    expect(nf).toMatch(/aria-label="Increase"/)
  })

  test('hides the native spinner it replaces', () => {
    expect(nf).toMatch(/no-native-spinner/)
    const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8')
    expect(css).toMatch(/\.no-native-spinner/)
  })

  test('reads the live value on each repeat tick, not a captured one', () => {
    // Without the ref, hold-to-repeat applies the same result forever and a
    // long press steps exactly once.
    expect(nf).toMatch(/valueRef/)
    expect(nf).toMatch(/valueRef\.current/)
  })

  test('clears its timers on unmount so a dialog closed mid-hold cannot leak', () => {
    expect(nf).toMatch(/useEffect\(\(\) => clearTimers/)
  })

  test('emits strings so a cleared money field stays empty rather than becoming 0', () => {
    expect(nf).toMatch(/onValueChange: \(value: string\) => void/)
  })

  test('the controls are not rendered at all on mobile', () => {
    // v1 flanked the input with buttons, which on a 375px screen left ~26-61px
    // for the digits — the value became unreadable, which is worse than the
    // wheel bug it was solving. Phones now get the plain full-width field.
    expect(nf).toMatch(/isDesktop/)
    expect(nf).toMatch(/matchMedia\('\(min-width: 640px\)'\)/)
    // Both buttons must be behind the desktop gate.
    const gates = nf.match(/\{isDesktop && \(/g) || []
    expect(gates).toHaveLength(2)
  })

  test('on desktop the controls sit inside the box and stay hidden until hover or focus', () => {
    expect(nf).toMatch(/absolute/)
    expect(nf).toMatch(/left-1/)
    expect(nf).toMatch(/right-1/)
    expect(nf).toMatch(/revealed/)
    expect(nf).toMatch(/onPointerEnter/)
    expect(nf).toMatch(/opacity: revealed/)
  })

  test('padding for the in-box controls is reserved, not animated', () => {
    // Animating padding on hover would make the digits jump under the cursor.
    expect(nf).toMatch(/isDesktop && \(compact \? 'px-6' : 'px-7'\)/)
  })

  test('focus moving between the input and its own buttons does not hide them', () => {
    expect(nf).toMatch(/currentTarget\.contains\(e\.relatedTarget/)
  })
})

describe('money entry surfaces use the stepper', () => {
  const surfaces = [
    'components/ledger/TransactionEntry.tsx',
    'components/ledger/TransactionDetail.tsx',
    'components/inventory/ProductDialog.tsx',
    'components/income/IncomeExpense.tsx',
  ]

  test.each(surfaces)('%s imports and uses NumberField', (rel) => {
    const src = readStripped(rel)
    expect(src).toMatch(/from '@\/components\/ui\/number-field'/)
    expect(src).toMatch(/<NumberField/)
  })

  test('no bare price/qty/discount/paid input survives on the entry surfaces', () => {
    for (const rel of surfaces) {
      const src = readStripped(rel)
      // Any remaining type="number" must not be one of the money fields the
      // report named. (Percentages and counts elsewhere are fine — the shared
      // Input wheel guard still covers them.)
      const moneyIds = /id="field-(discount|paid-amount|refund-amount|sale-price|purchase-price|mrp|amount|amount-2)"[^>]*type="number"/
      expect(src).not.toMatch(moneyIds)
    }
  })
})

describe('dialog width', () => {
  const dialog = readStripped('components/ui/dialog.tsx')

  test('a caller asking for a wide dialog is not clamped to sm:max-w-lg', () => {
    // The bug: the base ended in `sm:max-w-lg`, a different tailwind-merge
    // group from a caller's plain `max-w-4xl`, so both survived and the
    // responsive one won at >=640px. Edit Sale rendered 517px wide and the
    // quantity column collapsed to 26px, reading as an empty box.
    expect(dialog).toMatch(/wantsWide/)
    expect(dialog).toMatch(/!wantsWide && "sm:max-w-lg"/)
  })

  test('the wide-detection pattern matches the sizes actually used in the app', () => {
    const match = dialog.match(/const wantsWide = (\/.+\/)\.test/)
    expect(match).toBeTruthy()
    // Rebuild the regex from source and check it classifies real call sites.
    const body = match![1]
    const re = new RegExp(body.slice(1, body.lastIndexOf('/')))
    expect(re.test('max-w-4xl max-h-[92vh] overflow-y-auto')).toBe(true)
    expect(re.test('max-w-2xl max-h-[90vh] overflow-y-auto')).toBe(true)
    // Small dialogs must keep today's exact width.
    expect(re.test('max-w-md')).toBe(false)
    expect(re.test('max-w-sm')).toBe(false)
    expect(re.test('max-w-lg max-h-[90vh] overflow-y-auto')).toBe(false)
  })
})

describe('PDF unicode font', () => {
  const theme = readStripped('lib/pdf/theme.ts')

  test('the font is registered on every document, not just the first', () => {
    // The bug: a module-level `fontRegistered` flag early-returned on every
    // later PDF, but addFont is per-document — so the 2nd+ PDF of a session
    // fell back to Helvetica and every rupee sign became a missing glyph.
    expect(theme).not.toMatch(/let fontRegistered/)
    const fn = theme.slice(theme.indexOf('export async function registerUnicodeFont'))
    expect(fn).toMatch(/addFont\(/)
    // The ONLY early return before addFont may be the fetch-failure bail.
    // A "we already did this" flag return is what broke every PDF after the
    // first, so any other early exit here must fail this test.
    const beforeAddFont = fn.slice(0, fn.indexOf('addFont('))
    const returns = beforeAddFont.match(/\breturn\b/g) || []
    expect(returns).toHaveLength(1)
    expect(beforeAddFont).toMatch(/if \(!data\)[\s\S]*?return/)
  })

  test('only the downloaded bytes are cached, and a failure does not poison the cache', () => {
    expect(theme).toMatch(/fontDataPromise/)
    expect(theme).toMatch(/if \(v === null\) fontDataPromise = null/)
  })
})

describe('formatIndianDigits', () => {
  test('groups in the Indian system, not the western one', () => {
    expect(formatIndianDigits(1234567)).toBe('12,34,567.00')
    expect(formatIndianDigits(100000)).toBe('1,00,000.00')
  })

  test('handles small, fractional and negative amounts', () => {
    expect(formatIndianDigits(0)).toBe('0.00')
    expect(formatIndianDigits(1551.5)).toBe('1,551.50')
    expect(formatIndianDigits(999)).toBe('999.00')
    expect(formatIndianDigits(-2360.07)).toBe('-2,360.07')
  })
})
