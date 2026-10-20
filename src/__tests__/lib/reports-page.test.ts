/**
 * 🔒 GUARD: the one Reports page (Phase 5f-2, ledger model v4 §9) — Money,
 * Customers & suppliers, Stock, GST; every report once; GST only for a shop
 * that files it; no sentence under the title, no tip at the foot.
 */
import { describe, test, expect } from '@jest/globals'
import fs from 'fs'
import { NAV_REGISTRY, REPORT_GROUPS } from '@/lib/nav-registry'
import { reportSections } from '@/components/reports/ReportsHub'
import { translations } from '@/lib/i18n'
import { readCode } from '@/test-support/read-source'

const reports = NAV_REGISTRY.filter((d) => d.surfaces?.includes('reports-hub'))
const ids = (s: ReturnType<typeof reportSections>) => Object.fromEntries(s.map((x) => [x.group, x.reports.map((d) => d.id)]))

describe('every report has a section', () => {
  test('no report without one (it would vanish from the page)', () => {
    expect(reports.length).toBeGreaterThan(15)
    expect(reports.filter((d) => !d.reportGroup || !(REPORT_GROUPS as readonly string[]).includes(d.reportGroup)).map((d) => d.id)).toEqual([])
  })
  test('the model\'s sections', () => {
    const all = ids(reportSections(NAV_REGISTRY, undefined))
    expect(all.people).toEqual(expect.arrayContaining(['party-statement', 'debt-aging']))
    expect(all.stock).toEqual(expect.arrayContaining(['stock-report', 'inventory-aging']))
    expect(all.money).toEqual(expect.arrayContaining(['pl', 'bill-profit', 'item-profit', 'trial-balance', 'cashflow']))
    expect(all.gst).toEqual(expect.arrayContaining(['gstr-1', 'gstr-3b', 'hsn-summary']))
  })
})

describe('by the shop\'s GST status', () => {
  test('a not-registered shop sees no GST section at all', () => {
    const s = reportSections(NAV_REGISTRY, 'unregistered')
    expect(s.map((x) => x.group)).toEqual(['money', 'people', 'stock'])
  })
  test('a regular GST shop sees its returns; a composition shop only CMP-08 & GSTR-4', () => {
    expect(ids(reportSections(NAV_REGISTRY, 'regular')).gst).toEqual(expect.arrayContaining(['gstr-1', 'gstr-3b', 'gstr-9']))
    expect(ids(reportSections(NAV_REGISTRY, 'regular')).gst).not.toContain('composition-returns')
    expect(ids(reportSections(NAV_REGISTRY, 'composition')).gst).toEqual(['composition-returns'])
  })
  test('the order a shopkeeper reads: profit first, bank matching last; statement before ageing', () => {
    const s = ids(reportSections(NAV_REGISTRY, 'unregistered'))
    expect(s.money).toEqual(['pl', 'bill-profit', 'item-profit', 'trial-balance', 'cashflow', 'consolidated', 'bank-reconciliation'])
    expect(s.people).toEqual(['party-statement', 'debt-aging'])
    expect(s.stock).toEqual(['stock-report', 'inventory-aging'])
  })
  test('each report once, none lost', () => {
    const flat = reportSections(NAV_REGISTRY, undefined).flatMap((x) => x.reports.map((d) => d.id))
    expect(new Set(flat).size).toBe(flat.length)
    expect(flat.sort()).toEqual(reports.map((d) => d.id).sort())
  })
})

/** #274: a line that shows the server's short code before its sentence ("Shop state not set" over "Add your GSTIN…"). */
export function codeBeforeSentence(code: string): number[] {
  return code.split(/\r?\n/).flatMap((l, i) => (/\b(\w+)\.error \|\| \1\.message\b/.test(l) ? [i + 1] : []))
}

describe('#274 a report error says what to do', () => {
  test('the rule, on good and bad input', () => {
    expect(codeBeforeSentence("throw new Error(json.message || json.error || 'x')\nawait readError(r)")).toEqual([])
    expect(codeBeforeSentence("ok\nthrow new Error(errBody.error || errBody.message || 'x')")).toEqual([2])
  })
  test('no report screen puts the code first; GSTR-1 shows the sentence in a Notice, not a migration note', () => {
    const dir = 'src/components/reports'
    const bad = (fs.readdirSync(dir) as string[]).filter((f) => f.endsWith('.tsx')).flatMap((f) => codeBeforeSentence(readCode(`${dir}/${f}`)).map((n) => `${f}:${n}`))
    expect(bad).toEqual([])
    const g1 = readCode('src/components/reports/Gstr1Report.tsx')
    expect(g1).toMatch(/if \(!r\.ok\) throw new Error\(await readError\(r\)\)/)
    expect(g1).not.toMatch(/database migration hasn't run/)
    expect(g1).toMatch(/<Notice\s+level="act"\s+title="Couldn't load GSTR-1"/)
  })
})

describe('the page', () => {
  const hub = readCode('src/components/reports/ReportsHub.tsx')
  test('an app, not a notebook: the title and the rows, no sentence under the title or tip at the foot', () => {
    expect(hub).not.toMatch(/Pick a report/)
    expect(hub).not.toMatch(/Tip: use the date picker/)
    expect(hub).toMatch(/reportSections\(NAV_REGISTRY, shopGst\)/)
  })
  test('section names exist in English and Hindi', () => {
    const en = translations.en as unknown as Record<string, string>, hi = translations.hi as unknown as Record<string, string>
    for (const g of REPORT_GROUPS) {
      expect(en[`reports.group.${g}`]).toBeTruthy()
      expect(hi[`reports.group.${g}`]).toBeTruthy()
    }
  })
})
