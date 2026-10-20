/**
 * 🔒 GUARD: the Khata screen counts on the server, over every party
 * (Phase 5e-1, ledger model v4: "a count from the database, never from the
 * rows on screen").
 */
import { describe, test, expect } from '@jest/globals'
import { translations } from '@/lib/i18n'
import { readCode } from '@/test-support/read-source'

describe('Khata', () => {
  const screen = readCode('src/components/parties/Parties.tsx')
  const route = readCode('src/app/api/parties/list/route.ts')
  test('the screen pages the server list and sums nothing itself', () => {
    expect(screen).toMatch(/offlineFetch\(`\/api\/parties\/list\?\$\{qp\}`\)/)
    expect(screen).not.toMatch(/\.reduce\(/)
    expect(screen).not.toMatch(/offlineFetch\('\/api\/parties'\)/)
    expect(screen).toMatch(/getNextPageParam: \(last: any\) => \(last\.hasMore/)
  })
  test('the route uses the shared balance, the shared "still due" rule and the tested list logic', () => {
    expect(route).toMatch(/getReceivablePayable\(userId\)/)
    expect(route).toMatch(/oldestDueSaleSql\(userId\)/)
    expect(route).toMatch(/khataList\(rows, \{ side, chip, search, sort, offset, focusIds \}\)/)
  })
  test('#261: Home and Insights take "to collect / to pay" from khataSides — the rule Khata\'s cards use — never from the sign', () => {
    const dash = readCode('src/app/api/dashboard/route.ts')
    const ins = readCode('src/app/api/insights/route.ts')
    expect(dash).toMatch(/const sides = khataSides\(\[\.\.\.receivablePayable\.partyBalances\.values\(\)\]\)/)
    expect(dash).toMatch(/const totalReceivable = sides\.collect\.amount/)
    expect(dash).toMatch(/const receivableCount = sides\.collect\.count/)
    expect(dash).not.toMatch(/\{\s*totalReceivable,\s*totalPayable\s*\}\s*=\s*receivablePayable/)
    expect(dash).not.toMatch(/receivableCount\+\+|payableCount\+\+/)
    expect(ins).toMatch(/const sides = khataSides\(balances\)/)
    expect(ins).toMatch(/toCollect: sides\.collect\.amount/)
    expect(ins).toMatch(/total: sides\.pay\.amount/)
    expect(ins).toMatch(/udhaarAge\(owing, now\)/)
    expect(ins).not.toMatch(/rp\.totalReceivable|rp\.totalPayable/)
  })
  test('#267: the counter-returns khata gets its own row, never a reminder', () => {
    expect(screen).toMatch(/data\?\.counter && \(/)
    expect(screen).toMatch(/handleViewParty\(data\.counter\.id\)/)
  })
  test('5e-6: a customer\'s page is a bahi page — the balance in words, the main actions, then the bahi as ruled rows', () => {
    const page = readCode('src/components/parties/PartyProfile.tsx')
    const at = (s: string) => { const i = page.indexOf(s); expect({ s, found: i >= 0 }).toEqual({ s, found: true }); return i }
    // The order: balance → actions → the bahi → the smaller things → figures and chart → leave / delete.
    expect(at('{balanceWords}')).toBeLessThan(at('{settleLabel}'))
    expect(at('{settleLabel}')).toBeLessThan(at('id="bahi-title"'))
    expect(at('id="bahi-title"')).toBeLessThan(at('<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">'))
    expect(at("onClick={() => setView('parties')}")).toBeGreaterThan(at('id="bahi-title"'))
    // No chat bubbles, no box that scrolls inside the page, no bare + / − on a balance.
    expect(page).not.toMatch(/max-h-\[500px\] overflow-y-auto/)
    expect(page).not.toMatch(/rounded-br-md|rounded-bl-md/)
    expect(page).not.toMatch(/Bal: \{entry\.runningBalance >= 0 \? '\+' : ''\}/)
    expect(page).toMatch(/\{balWords\(entry\.runningBalance\)\}/)
    // 60 lines, then "Show 60 more" — the lists' rule, not a page 500 lines long.
    expect(page).toMatch(/statement\.slice\(0, bahiShown\)\.map/)
    expect(page).toMatch(/setBahiShown\(\(n\) => n \+ 60\)/)
    // Who owes whom from the party's type (#261), in words.
    expect(page).toMatch(/t\(party\.type === 'supplier' \? 'bahi\.owe_back' : 'stat\.they_owe'\)/)
    expect(page).toMatch(/t\(party\.type === 'customer' \? 'bahi\.advance' : 'stat\.you_owe'\)/)
    // The cap warning is a Notice with the reason behind ⓘ, not a hand-drawn amber box.
    expect(page).toMatch(/<Notice level="note"[^>]*title=\{t\('bahi\.truncated'\)/)
    expect(page).not.toMatch(/border-amber-300 bg-amber-50/)
  })
  test('#269: the toolbar has one padding, and a phone gets the cards with no toggle row (as Items)', () => {
    expect(screen).toMatch(/<Card className="shadow-card border-border\/60 py-0">\s*<CardContent className="p-3 lg:p-4">/)
    expect(screen).toMatch(/\{!isMobile && <ViewModeToggle/)
    expect(screen).toMatch(/\(isMobile \? 'grid' : partiesViewMode\) === 'grid'/)
    expect(readCode('src/components/inventory/Inventory.tsx')).toMatch(/<Card className="shadow-card border-border\/60 py-0">\s*<CardContent className="p-3 lg:p-4 space-y-3">/)
  })
  test('every Khata word exists in English and Hindi', () => {
    const en = translations.en as unknown as Record<string, string>, hi = translations.hi as unknown as Record<string, string>
    const keys = Object.keys(en).filter((k) => k.startsWith('khata.') || k.startsWith('bahi.') || k === 'list.clear_focus')
    expect(keys.filter((k) => k.startsWith('bahi.')).length).toBeGreaterThanOrEqual(20)
    expect(keys.length).toBeGreaterThanOrEqual(24)
    expect(keys.filter((k) => !hi[k])).toEqual([])
  })
})
