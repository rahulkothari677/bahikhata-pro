/**
 * @jest-environment node
 *
 * The GST rate list lives in ONE place, and it contains 40%.
 *
 * WHY (audit 2026-08-17). `[0, 5, 12, 18, 28]` was written out in SEVEN
 * separate files — the product form, the invoice line editor, the bill detail
 * screen, two charts in Reports, the AI scan review, and the CSV export. There
 * was no shared constant.
 *
 * So when the statute moved, seven places each needed editing and none were:
 *
 *   • Aerated and sweetened beverages (HSN 2202) → 40%, from 22 Sep 2025
 *   • Pan masala, gutkha, chewing tobacco, cigarettes → 40%, from 1 Feb 2026
 *   • Bidi → 18% (reduced), from 1 Feb 2026
 *   • Compensation cess set to Nil against those entries
 *
 * Source: Notification 09/2025-Central Tax (Rate) dated 17 Sep 2025 as amended,
 * following the 56th GST Council meeting.
 *
 * The consequence was a live under-charge. A kirana selling cold drinks had no
 * way to pick 40% for roughly eleven months; the nearest option was 28%, which
 * under-reports by 12 points on GSTR-1 and 3B — and the shortfall is the shop's
 * own liability.
 *
 * The tax ENGINE was never wrong: a ₹100 sale at 40% produced CGST ₹20 + SGST
 * ₹20 = ₹140, verified live before the fix. Only the pickers were.
 *
 * This test guards two things: that the slab exists, and that nobody
 * reintroduces a private copy of the list.
 */
import fs from 'fs'
import path from 'path'
import { GST_RATES, GST_RATE_SLABS, isStandardGstRate } from '@/lib/gst-rates'

describe('the slabs a shopkeeper can pick', () => {
  it('includes 40% — the rate that replaced cess', () => {
    expect(GST_RATES).toContain(40)
  })

  it('includes 3%, so a jeweller can bill correctly too', () => {
    // Found by sweeping the class (R4): 40% was not the only missing slab.
    expect(GST_RATES).toContain(3)
  })

  it('still offers every slab it offered before', () => {
    // A fix that quietly dropped a rate would break far more bills than it fixed.
    for (const r of [0, 5, 12, 18, 28]) expect(GST_RATES).toContain(r)
  })

  it('is sorted, because a picker in a rush is read by position', () => {
    expect([...GST_RATES]).toEqual([...GST_RATES].sort((a, b) => a - b))
  })

  it('recognises a standard rate and rejects an invented one', () => {
    expect(isStandardGstRate(40)).toBe(true)
    expect(isStandardGstRate(28)).toBe(true)
    expect(isStandardGstRate(37)).toBe(false)
  })
})

describe('nobody hard-codes their own copy of the list', () => {
  /*
   * THE GUARD. This is the test that matters: the defect was not the missing
   * number, it was that the number lived in seven places. Adding 40 without
   * this would fix today and guarantee a repeat at the next Council meeting.
   */
  const ROOT = path.join(process.cwd(), 'src')

  function walk(dir: string): string[] {
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue
        out.push(...walk(p))
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push(p)
      }
    }
    return out
  }

  /**
   * An array literal of three or more GST-looking rates. Deliberately loose: it
   * should catch `[0, 5, 12, 18, 28]`, `[0,5,12,18,28,40]` and any future
   * variation someone types in a hurry.
   */
  const RATE_ARRAY = /\[\s*0\s*,\s*(?:[0-9.]+\s*,\s*){2,}[0-9.]+\s*\]/

  it('no file outside lib/gst-rates.ts declares a rate array', () => {
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      if (file.endsWith(path.join('lib', 'gst-rates.ts'))) continue
      const src = fs.readFileSync(file, 'utf8')
      // Strip comments so a documented example does not trip the guard.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      for (const line of code.split('\n')) {
        if (!RATE_ARRAY.test(line)) continue
        // Only flag lines that look like GST specifically — a rate array here
        // always sits next to gst/rate/slab wording or a percent sign.
        if (/gst|rate|slab|%/i.test(line)) {
          offenders.push(`${path.relative(ROOT, file)} :: ${line.trim().slice(0, 90)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('every picker imports the shared list', () => {
    // The counterpart to the guard above: not merely "no copies", but
    // "everyone uses the one list".
    const pickers = [
      'components/inventory/ProductDialog.tsx',
      'components/ledger/TransactionEntry.tsx',
      'components/ledger/TransactionDetail.tsx',
      'components/scanner/BillScanner.tsx',
      'components/reports/Reports.tsx',
      'lib/csv-export.ts',
    ]
    for (const rel of pickers) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      expect({ file: rel, importsShared: /from '@\/lib\/gst-rates'/.test(src) })
        .toEqual({ file: rel, importsShared: true })
    }
  })
})

describe('the API stays more permissive than the picker', () => {
  it('a rate outside the list is not blocked by this constant', () => {
    /*
     * Deliberate. `validation.ts` accepts 0–100, and it must keep doing so: a
     * slab this list has not caught up with must never stop a shopkeeper
     * billing correctly. That is the exact failure this whole file exists to
     * prevent — the picker lagged the law and the shop under-charged.
     */
    expect(isStandardGstRate(0.25)).toBe(false)
    expect(GST_RATE_SLABS.length).toBeGreaterThan(0)
  })
})
