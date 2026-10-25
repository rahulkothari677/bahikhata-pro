/**
 * Phase 6d — the Counter's Pay sheet and what follows a save (#230, #145), and
 * the stock-warning save that left its draft behind (#292).
 */
import { describe, test, expect } from '@jest/globals'
import { quickCashNotes, changeFor } from '@/lib/quick-cash'
import { payChoice } from '@/components/ledger/PaySheet'
import { readCode } from '@/test-support/read-source'

describe('#230: quick cash notes', () => {
  test('the plan\'s examples', () => {
    expect(quickCashNotes(282)).toEqual([290, 300, 500])
    expect(quickCashNotes(16092)).toEqual([16100, 16500, 18000])
  })
  test('strictly above the bill (Exact covers equal); topped up when steps collapse', () => {
    expect(quickCashNotes(500)).toEqual([1000, 2000])
    expect(quickCashNotes(48)).toEqual([50, 100, 500])
    expect(quickCashNotes(11.8)).toEqual([20, 100, 500])
    expect(quickCashNotes(0)).toEqual([])
    expect(quickCashNotes(-5)).toEqual([])
  })
  test('change to the paisa: positive to return, negative still owed', () => {
    expect(changeFor(282, 500)).toBe(218)
    expect(changeFor(11.8, 20)).toBe(8.2)
    expect(changeFor(282, 200)).toBe(-82)
  })
})

describe('what a Pay choice saves', () => {
  test('udhaar pays nothing; UPI and card pay in full', () => {
    expect(payChoice('credit', 282, null)).toEqual({ paymentMode: 'credit', paidAmount: '0' })
    expect(payChoice('upi', 282, null)).toEqual({ paymentMode: 'upi', paidAmount: '' })
    expect(payChoice('card', 282, 100)).toEqual({ paymentMode: 'card', paidAmount: '' })
  })
  test('cash: more than the bill pays the bill (the rest is change); less pays that much', () => {
    expect(payChoice('cash', 282, 500)).toEqual({ paymentMode: 'cash', paidAmount: '' })
    expect(payChoice('cash', 282, null)).toEqual({ paymentMode: 'cash', paidAmount: '' })
    expect(payChoice('cash', 282, 200)).toEqual({ paymentMode: 'cash', paidAmount: '200' })
  })
})

describe('the sale screen with Pay', () => {
  const code = readCode('src/components/ledger/TransactionEntry.tsx')
  const at = (s: string) => { const i = code.indexOf(s); expect({ s, found: i >= 0 }).toEqual({ s, found: true }); return i }
  const save = code.slice(at('const handleSave = async (payOpts?'), at('const resetBill = () =>'))

  test('the save uses the Pay sheet\'s choice, never the state it has not had time to set', () => {
    expect(save.length).toBeGreaterThan(2000)
    expect(save).toContain('const pm = payOpts?.paymentMode ?? paymentMode')
    expect(save).toContain("paymentMode: estimateMode ? 'cash' : pm,")
    expect(save).toContain("(pa === '' ? undefined : Number(pa))")
    expect(save).not.toMatch(/paymentMode: estimateMode \? 'cash' : paymentMode/)
  })
  test('#145: on the Counter a save opens the Saved sheet instead of leaving, after the draft is cleared', () => {
    const counterReturn = save.indexOf('setSavedBill(savedInfo)')
    expect(counterReturn).toBeGreaterThan(0)
    expect(save.indexOf('clearActive()')).toBeLessThan(counterReturn)
    expect(save.indexOf('await invalidateMoneyCaches(queryClient)')).toBeLessThan(counterReturn)
    // ...and it STOPS there: nothing between the Saved sheet and the old screens' "leave" may fall through.
    const counterBranch = save.slice(counterReturn, save.indexOf('const leave = () =>'))
    expect(counterBranch.length).toBeGreaterThan(0)
    expect(counterBranch).toMatch(/\breturn\b/)
  })
  test('#292: a stock warning no longer skips clearing the saved sale\'s draft', () => {
    const warn = save.slice(save.indexOf('data.stockWarnings.length > 0'), save.indexOf('data.priceWarnings'))
    expect(warn.length).toBeGreaterThan(100)
    expect(warn).not.toMatch(/\breturn\b/)
    expect(warn).toContain('leaveAfterMs = 2500')
  })
  test('#224: on the Counter payment is chosen in one place — Details has no payment fields', () => {
    expect(code).toContain('{!estimateMode && !counterMode && (')
    expect(code).toContain(') : !estimateMode && !counterMode ? (')
    // The folded Details names the payment only off the Counter (7g: the fold is a list joined by " · ").
    expect(code).toContain('!counterMode && paymentMode.charAt(0).toUpperCase() + paymentMode.slice(1),')
    expect(code).not.toMatch(/[^!]counterMode && paymentMode\.charAt/)
  })

  test('the Counter\'s bars open Pay; the other forms still Save', () => {
    expect(code.split('onClick={() => setPaySheetOpen(true)}').length - 1).toBe(2)
    // The sale screen itself (the add-customer dialog below it has its own handleSave).
    const screen = code.slice(0, at('function AddPartyInline'))
    expect(screen).not.toMatch(/onClick=\{handleSave\}/)
  })
})

describe('one way to send a bill, one way to print it', () => {
  test('the bill screen and the Counter both use lib/share-bill-flow', () => {
    expect(readCode('src/components/ledger/TransactionDetail.tsx')).toContain('shareBillOnWhatsApp(txn as never, setting, override)')
    expect(readCode('src/components/ledger/TransactionEntry.tsx')).toContain('shareBillOnWhatsApp(d.transaction, settingData?.setting)')
    expect(readCode('src/components/ledger/TransactionDetail.tsx')).not.toMatch(/sendBill\(/)
  })
  test('Print opens the bill with a print request, which the bill screen runs once loaded', () => {
    expect(readCode('src/components/ledger/TransactionEntry.tsx')).toContain("st.requestOnArrival('transaction-detail', 'print')")
    const detail = readCode('src/components/ledger/TransactionDetail.tsx')
    expect(detail).toContain("useArrivalRequest('transaction-detail', 'print', () => setPrintOnLoad(true))")
    expect(detail).toContain('if (!printOnLoad || !txn) return')
  })
})
