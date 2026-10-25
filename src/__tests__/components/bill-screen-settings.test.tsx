/**
 * @jest-environment jsdom
 *
 * Phase 7c, change C12 (#310) — the bill screen's switches.
 *
 * Rahul, 25 Oct: "settings to change all these on new sale page so the user can
 * instantly change according to their comfort". Three things are protected:
 *
 *   1. ONE LIST. ⚙ on New Sale and Settings → Features both draw
 *      lib/bill-screen-settings.ts, so they can never show different switches.
 *   2. EVERY SWITCH DOES SOMETHING. The invoice settings once had a prefix that
 *      was saved, validated and read by nothing (settings-are-reachable-and-
 *      used.test.ts). Here each switch names the code that obeys it; a switch
 *      with no consumer, or a consumer with no switch, fails.
 *   3. INSTANT, AND ON BY DEFAULT. Flipping a switch changes the store at once
 *      (no Save), and a shop that never opens ⚙ sees New Sale as it was.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { readCode } from '@/test-support/read-source'
import { BILL_SCREEN_SETTINGS, billSettingsFor, startsOn } from '@/lib/bill-screen-settings'
import { useAppStore } from '@/store/app-store'
import { BillScreenSettings } from '@/components/ledger/BillScreenSettings'

const ENTRY = 'src/components/ledger/TransactionEntry.tsx'
const PICKER = 'src/components/ledger/ItemPicker.tsx'
const HEADER = 'src/components/layout/Header.tsx'
const NAV = 'src/lib/nav-registry.ts'
const KEYPAD = 'src/components/ledger/KeypadBar.tsx'

/** switch → [file, the code in it that obeys the switch]. Comments are stripped before matching. */
const CONSUMERS: Record<string, [string, RegExp][]> = {
  voiceEntry: [
    [ENTRY, /const voiceOn = features\?\.voiceEntry !== false/],
    [ENTRY, /\{voiceOn && \(/],
    [HEADER, /features\?\.voiceEntry !== false &&/],
    [NAV, /featureFlag: 'voiceEntry'/],
  ],
  aiScanner: [
    [ENTRY, /const scanBillOn = features\?\.aiScanner !== false/],
    [ENTRY, /!estimateMode && scanBillOn &&/],
    [HEADER, /features\?\.aiScanner !== false &&/],
    // the desktop top bar's Scan Bill, on every screen
    [HEADER, /isFlagEnabled\('ai_scanner'\) && features\?\.aiScanner !== false &&/],
  ],
  barcodeScanner: [[ENTRY, /scanButton=\{features\?\.barcodeScanner \?/]],
  billSideView: [
    [ENTRY, /sideView=\{features\?\.billSideView === true\}/],
    [PICKER, /const side = !!p\.sideView/],
  ],
  billTypedAmounts: [
    [ENTRY, /const typedOn = features\?\.billTypedAmounts !== false/],
    [ENTRY, /if \(!typedOn \|\| !line\.name/],
  ],
  billListEntry: [
    [ENTRY, /const listOn = features\?\.billListEntry !== false/],
    [PICKER, /if \(!listPaste \|\| !\/\\n\/\.test\(text\)\) return/],
  ],
  billLearnPicks: [
    [ENTRY, /const learnOn = features\?\.billLearnPicks !== false/],
    [ENTRY, /learned: learnOn \? \(k\) => learnedId\(learnedPicks, k\) : undefined/],
  ],
  billNotInList: [
    [ENTRY, /const notInListOn = features\?\.billNotInList !== false/],
    [ENTRY, /notFound=\{notInListOn \?/],
  ],
  billPencil: [
    [ENTRY, /const pencilOn = features\?\.billPencil !== false/],
    [ENTRY, /onPencil=\{pencilOn \? \(row\) => \{ setQtyOpen\(false\); setKb\(row\) \} : undefined\}/],
    [PICKER, /const pencil = p\.onPencil \?/],
  ],
  billWeightButtons: [
    [ENTRY, /weightButtons=\{features\?\.billWeightButtons !== false\}/],
    [PICKER, /p\.weightButtons !== false \? weightButtons\(/],
  ],
  billBigPad: [
    [ENTRY, /big=\{features\?\.billBigPad === true\}/],
    [KEYPAD, /if \(!big\) return <Pad/],
  ],
  billGramsRule: [
    [ENTRY, /gramsRule=\{features\?\.billGramsRule !== false\}/],
    [KEYPAD, /typedQuantity\(t, tab === 'packs' \? 'auto' : u, unit, gramsRule\)/],
  ],
  billCheckAmounts: [
    [ENTRY, /checkAmounts=\{features\?\.billCheckAmounts !== false\}/],
    [KEYPAD, /checkAmounts && q \? unusualAmount\(/],
  ],
  billQtyButton: [
    [ENTRY, /const qtyButtonOn = features\?\.billQtyButton !== false/],
    [ENTRY, /\{qtyButtonOn && \(/],
    [ENTRY, /\{qtyOpen && qtyButtonOn && !kb && \(/],
  ],
  billPriceCheck: [
    [ENTRY, /const priceCheckOn = isSale && features\?\.billPriceCheck !== false/],
    [ENTRY, /\{priceCheckOn && \(/],
  ],
  billOftenList: [[ENTRY, /oftenIds=\{features\?\.billOftenList !== false \? oftenIds : \[\]\}/]],
  billUsualList: [[ENTRY, /usualIds=\{features\?\.billUsualList !== false \? usualIds : \[\]\}/]],
  billSizeStock: [
    [ENTRY, /sizeStock=\{features\?\.billSizeStock !== false\}/],
    [PICKER, /const out = showOut &&/],
  ],
  billSizeMark: [
    [ENTRY, /sizeMark=\{features\?\.billSizeMark !== false\}/],
    [PICKER, /top=\{p\.sizeMark !== false &&/],
  ],
}

describe('the list', () => {
  it('names each switch once', () => {
    const keys = BILL_SCREEN_SETTINGS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('starts every tool ON, the look as the List and the pad as the bar, so an untouched shop gets everything', () => {
    window.localStorage.clear()
    const f = useAppStore.getState().features
    for (const s of BILL_SCREEN_SETTINGS) expect([s.key, f[s.key]]).toEqual([s.key, startsOn(s)])
    expect(BILL_SCREEN_SETTINGS.filter((s) => !startsOn(s)).map((s) => s.key)).toEqual(['billSideView', 'billBigPad'])
  })

  it('shows price check on a sale only', () => {
    expect(billSettingsFor(true).map((s) => s.key)).toContain('billPriceCheck')
    expect(billSettingsFor(false).map((s) => s.key)).not.toContain('billPriceCheck')
  })
})

describe('every switch is obeyed by the screen', () => {
  it('has a consumer for every switch, and a switch for every consumer', () => {
    expect(Object.keys(CONSUMERS).sort()).toEqual(BILL_SCREEN_SETTINGS.map((s) => s.key).sort())
  })

  for (const [key, uses] of Object.entries(CONSUMERS)) {
    it(`${key} is read where it acts`, () => {
      for (const [file, pattern] of uses) expect([file, pattern.test(readCode(file))]).toEqual([file, true])
    })
  }
})

describe('"Scan a bill (AI)" off means off on every screen', () => {
  /*
   * Found while building C12: the old "AI Bill Scanner" switch hid the menu
   * entries and nothing else — New Sale's buttons, the phone's top bar, Home's
   * card, the Sales list and the A key all still opened the scanner. A sweep,
   * not a list, so a scan button added next month cannot skip the switch.
   */
  it('every component that opens the scanner reads the switch', () => {
    const { readdirSync, statSync } = jest.requireActual('fs') as typeof import('fs')
    const { join } = jest.requireActual('path') as typeof import('path')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : []
    })
    const openers = walk('src/components').map((p) => p.replace(/\\/g, '/')).filter((p) => readCode(p).includes("setView('scanner')"))
    expect(openers.length).toBeGreaterThanOrEqual(5)
    for (const p of openers) expect([p, readCode(p).includes('aiScanner !== false')]).toEqual([p, true])
  })
})

describe('a typed line never goes missing (C12)', () => {
  it('Save waits while a card is open, and the bar says how many', () => {
    const code = readCode(ENTRY)
    expect(code).toMatch(/const saveBlocked = hasStockBlock \|\| hasMrpBlock \|\| hasChecks/)
    expect(code).toMatch(/\{checks\.length\} to check/)
    expect(code).toMatch(/const resetBill = \(\) => \{\s*setItems\(\[\]\)\s*setChecks\(\[\]\)/)
  })
})

describe('"Bill it once" never makes a line the GST return cannot place (C11 Not in list)', () => {
  it('a one-off line only for a shop that charges no GST; a GST shop adds the item (HSN and rate)', () => {
    const code = readCode(ENTRY)
    expect(code).toMatch(/const oneOffOn = notInListOn && !shopChargesGst/)
    expect(code).toMatch(/notFound=\{notInListOn \? \(oneOffOn/)
    expect(code).toMatch(/onOneOff=\{oneOffOn \?/)
    expect(code).toMatch(/productId: '', productName: l\.name, quantity: l\.qty, unitPrice: l\.price, gstRate: 0/)
  })
})

describe('two doors, one list', () => {
  it('New Sale opens the settings from its own header — the top bar on a phone, the bill header on a desktop', () => {
    const code = readCode(ENTRY)
    expect(code).toMatch(/<BillScreenSettings open=\{billSettingsOpen\}/)
    expect(code).toMatch(/onClick=\{\(\) => setBillSettingsOpen\(true\)\}/)
    // The phone hides the bill header (hidden lg:flex); its ⚙ is in the app's top bar.
    expect(readCode(HEADER)).toMatch(/useAppStore\.getState\(\)\.setBillSettingsOpen\(true\)/)
  })

  it('Settings → Features draws the same list', () => {
    expect(readCode('src/components/settings/Settings.tsx')).toMatch(/features: BILL_SCREEN_SETTINGS\.map\(/)
  })
})

describe('the sheet on New Sale', () => {
  beforeEach(() => { window.localStorage.clear(); useAppStore.getState().resetFeatures() })

  it('changes a switch at once, with no Save, and goes back to the defaults', () => {
    render(<BillScreenSettings open onClose={() => {}} isSale shopGst="unregistered" />)
    fireEvent.click(screen.getByRole('switch', { name: 'Qty button' }))
    expect(useAppStore.getState().features.billQtyButton).toBe(false)
    expect(window.localStorage.getItem('bahikhata:feature:billQtyButton')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Back to the defaults' }))
    expect(useAppStore.getState().features.billQtyButton).toBe(true)
  })

  it('shows the shop\'s GST type and never offers it as a switch', () => {
    render(<BillScreenSettings open onClose={() => {}} isSale shopGst="composition" />)
    expect(screen.getByText('Composition: bill of supply')).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: /gst/i })).toBeNull()
  })

  it('leaves price check off a purchase', () => {
    render(<BillScreenSettings open onClose={() => {}} isSale={false} shopGst="regular" />)
    expect(screen.queryByRole('switch', { name: 'Price check' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Voice' })).toBeInTheDocument()
  })
})
