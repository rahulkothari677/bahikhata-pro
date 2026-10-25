/**
 * Phase 7c-2 (from 6e) — scanner and keyboard on every bill: a barcode gun
 * works from anywhere, quantity first, F-keys, price check on a sale, and an
 * unknown barcode asks "New item?".
 */
import { describe, test, expect } from '@jest/globals'
import { createScanBuffer, MAX_GAP_MS, MIN_LENGTH } from '@/lib/scanner-burst'
import { readCode } from '@/test-support/read-source'

const feed = (keys: string[], gapMs: number, start = 1000) => {
  const b = createScanBuffer()
  let out: string | null = null
  keys.forEach((k, i) => { const r = b.push(k, start + i * gapMs); if (r) out = r })
  return out
}

describe('telling a barcode gun from a person', () => {
  test('a fast burst ending in Enter is a scan', () => {
    expect(feed([...'8901063010178', 'Enter'], 8)).toBe('8901063010178')
  })
  test('a person typing (slower than the gap) never becomes a scan', () => {
    expect(feed([...'8901063010178', 'Enter'], MAX_GAP_MS + 40)).toBeNull()
  })
  test(`too short (under ${MIN_LENGTH}) is not a code; Enter alone is not a code`, () => {
    expect(feed([...'123', 'Enter'], 8)).toBeNull()
    expect(feed(['Enter'], 8)).toBeNull()
  })
  test('a slow key starts a new burst; a non-character key clears it', () => {
    const b = createScanBuffer()
    b.push('9', 0); b.push('9', 5)
    b.push('1', 500)
    ;[...'2345'].forEach((k, i) => b.push(k, 505 + i * 5))
    expect(b.push('Enter', 530)).toBe('12345')
    b.push('1', 1000); b.push('Shift', 1005); b.push('2', 1010); b.push('3', 1015); b.push('4', 1020)
    expect(b.push('Enter', 1025)).toBeNull()
  })
})

describe('one add step on every bill', () => {
  const code = readCode('src/components/ledger/TransactionEntry.tsx')
  const at = (s: string) => { const i = code.indexOf(s); expect({ s, found: i >= 0 }).toEqual({ s, found: true }); return i }

  test('quantity first; price check (a sale only) adds nothing', () => {
    const add = code.slice(at('const pickAdd = (p: any) =>'), at('const handleScannedCode = (code: string) =>'))
    expect(add).toContain('if (priceCheck && isSale) { setCheckedProduct(p); return }')
    // Step 2c: a waiting Qty carries its unit (× 23, 400 g, ₹50) and goes on by lib/loose-entry.ts nextQtyFor.
    expect(add).toContain('if (next) { addWithNext(p); return }')
    expect(add).toContain('handleAddProduct(p, 1)')
    expect(add).toContain("const r = nextQtyFor(next, p.unit, features?.billGramsRule !== false, (rupees) => kbQtyForRupees(p, rupees))")
    expect(code).toContain('quantity: i.quantity + qty')
    expect(code).toContain('quantity: qty,')
  })
  test('the picker, Enter and the camera all use it', () => {
    expect(code).toContain('onAdd={(p) => pickAdd(p)}')
    expect(code).toContain('pickAdd(match)')
    expect(code).toMatch(/onScan=\{\(code\) => \{\s*setBarcodeOpen\(false\)[\s\S]{0,300}handleScannedCode\(code\)/)
  })
  test('an unknown barcode asks "New item?" (from a scan or a typed code), and the new item goes on the bill', () => {
    const scan = code.slice(at('const handleScannedCode = (code: string) =>'), at('const scanBufferRef = useRef(createScanBuffer())'))
    expect(scan).toContain('else setUnknownCode(code)')
    expect(code).toContain('setUnknownCode(productSearch.trim())')
    // C12: the same form also takes a typed line's name (a card's "Add it as a new item").
    expect(code).toContain('initial={{ barcode: newItemCode ?? undefined, name: newItemFor?.name || undefined }}')
    expect(code).toContain('if (saved) handleAddProduct(saved, 1)')
  })
  test('keys on every bill, never under a sheet; the gun only where no box has the cursor; F10 = the bar\'s button', () => {
    const keys = code.slice(at('const onKey = (e: KeyboardEvent) =>'), at("window.addEventListener('keydown', onKey)"))
    expect(keys).toContain("if (!sheetOpen && /^F(2|3|4|6|10)$/.test(e.key)) {")
    // F6 = price check on a sale only. Since C12 (25 Oct) it also obeys the Price check switch;
    // the sale-only rule now sits in priceCheckOn, which is asserted to start with isSale.
    expect(keys).toContain("else if (e.key === 'F6' && switchesRef.current.priceCheckOn) setPriceCheck((v) => !v)")
    expect(code).toContain('const priceCheckOn = isSale && ')
    expect(keys).toContain("if (typing || sheetOpen || e.ctrlKey || e.metaKey || e.altKey) { scanBufferRef.current.reset(); return }")
    expect(keys).toContain('scanBufferRef.current.push(e.key, e.timeStamp)')
    expect(code).not.toContain('if (!counterMode) return\n    const onKey')
    const finish = code.slice(at('finishRef.current = () => {'), at('const resetBill = () => {'))
    // F10 waits on exactly what the bar's buttons wait on (7e: stock AND above-MRP — saveBlocked).
    expect(finish).toContain('if (saving || saveBlocked) return')
    expect(code).toMatch(/onClick=\{\(\) => setPaySheetOpen\(true\)\} disabled=\{saving \|\| saveBlocked \|\| items\.length === 0\}/)
    expect(finish).toContain('if (counterMode) setPaySheetOpen(true)')
    expect(finish).toContain('else handleSave()')
  })
})

describe('Esc never throws the shopkeeper out of a bill', () => {
  test('with a bill open, Esc is handled first (capture) and clears — the app\'s "go back" then skips it', () => {
    const code = readCode('src/components/ledger/TransactionEntry.tsx')
    const esc = code.slice(code.indexOf('const onEscape = (e: KeyboardEvent) =>'), code.indexOf("window.addEventListener('keydown', onKey)"))
    expect(esc.length).toBeGreaterThan(100)
    expect(esc).toContain("if (e.key !== 'Escape' || document.querySelector('[role=dialog]') || itemCountRef.current === 0) return")
    expect(esc).toContain('e.preventDefault()')
    expect(code).toContain("window.addEventListener('keydown', onEscape, true)")
    expect(readCode('src/components/common/KeyboardShortcuts.tsx')).toContain("if (e.key === 'Escape' && !escapeIsOurs(e)) return")
  })
})

describe('one-letter shortcuts stay off while a bill is being written', () => {
  test('the bill-entry screens are one list', async () => {
    const { isEntryView, ENTRY_VIEWS } = await import('@/lib/entry-views')
    expect(ENTRY_VIEWS).toEqual(['new-sale', 'new-purchase', 'new-estimate'])
    expect(isEntryView('new-sale')).toBe(true)
    expect(isEntryView('sales')).toBe(false)
    expect(isEntryView(null)).toBe(false)
  })
  test('a scanned "SNK001" can no longer leave the bill on the "S": the shortcuts return first on those screens', () => {
    const ks = readCode('src/components/common/KeyboardShortcuts.tsx')
    const guard = ks.indexOf('if (isEntryView(currentView)) return')
    expect(guard).toBeGreaterThan(0)
    for (const letter of ["e.key === 'n'", "e.key === 's'", "e.key === 'd'", "e.key === 'c'", "e.key === 'p'"]) {
      expect({ letter, after: ks.indexOf(letter) > guard }).toEqual({ letter, after: true })
    }
    expect(readCode('src/components/ledger/TransactionEntry.tsx')).not.toMatch(/ENTRY_FORMS/)
  })
})

describe('the item form starts from a scanned barcode and hands the new item back', () => {
  const pd = readCode('src/components/inventory/ProductDialog.tsx')
  test('initial barcode for a new item; the saved item passed to onSuccess', () => {
    expect(pd).toContain("barcode: initial?.barcode ?? ''")
    expect(pd).toContain('onSuccess?.(saved?.product ?? null)')
  })
})
