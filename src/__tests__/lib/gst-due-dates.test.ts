/**
 * 9b-1: every GST return date from one place (lib/gst-due-dates.ts). Each case is
 * a date from the verified law report, read by hand.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  filingFrequency, returnsDue, gstr3bDue, twoBGenerationDate, nextPeriod, pendingDeadline,
  isQuarterEnd, quarterEndOf, quarterMonths,
} from '@/lib/gst-due-dates'

const day = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null)
const forms = (fp: string, f: 'monthly' | 'quarterly', state: string) => returnsDue(fp, f, state).map((d) => `${d.form} ${day(d.date)}`)

describe('#102: the GSTR-1A window gets the shop’s stored frequency', () => {
  it('the GSTR-1 route passes it — it used to pass null ("frequency is not stored anywhere yet")', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/api/gstr-1/route.ts'), 'utf8')
    const call = src.slice(src.indexOf('gstr1aWindow({'), src.indexOf('gstr1aWindow({') + 300)
    expect(call).toMatch(/^gstr1aWindow\(\{/)
    expect(call).toContain('filingFrequency: filingFrequency(freqRow)')
    expect(call).not.toContain('filingFrequency: null')
  })
})

describe('which frequency', () => {
  it('not answered reads as monthly — what every shop saw before', () => {
    expect(filingFrequency(null)).toBe('monthly')
    expect(filingFrequency({ gstFilingFrequency: null })).toBe('monthly')
    expect(filingFrequency({ gstFilingFrequency: 'quarterly' })).toBe('quarterly')
  })
})

describe('the returns due for a period', () => {
  it('monthly: GSTR-1 on the 11th, GSTR-3B on the 20th of the next month', () => {
    expect(forms('102026', 'monthly', '08')).toEqual(['GSTR-1 2026-11-11', 'GSTR-3B 2026-11-20'])
    expect(forms('122026', 'monthly', '08')).toEqual(['GSTR-1 2027-01-11', 'GSTR-3B 2027-01-20']) // across the year
  })

  it('quarterly, months 1 and 2: optional IFF on the 13th, PMT-06 payment on the 25th', () => {
    expect(forms('102026', 'quarterly', '08')).toEqual(['IFF 2026-11-13', 'PMT-06 2026-11-25'])
  })

  it('quarterly, the quarter’s last month: GSTR-1 on the 13th; GSTR-3B 22nd (Group A) or 24th (Group B)', () => {
    expect(forms('122026', 'quarterly', '27')).toEqual(['GSTR-1 2027-01-13', 'GSTR-3B 2027-01-22']) // Maharashtra, A
    expect(forms('122026', 'quarterly', '08')).toEqual(['GSTR-1 2027-01-13', 'GSTR-3B 2027-01-24']) // Rajasthan, B
    expect(forms('122026', 'quarterly', '07')).toEqual(['GSTR-1 2027-01-13', 'GSTR-3B 2027-01-24']) // Delhi, B
    expect(day(gstr3bDue('102026', 'quarterly', '08'))).toBeNull() // no 3B in month 1
  })
})

describe('quarters', () => {
  it('June, September, December, March end a quarter', () => {
    expect(['032027', '062026', '092026', '122026'].every(isQuarterEnd)).toBe(true)
    expect(isQuarterEnd('112026')).toBe(false)
    expect(quarterEndOf('112026')).toBe('122026')
    expect(quarterMonths('112026')).toEqual(['102026', '112026', '122026'])
    expect(quarterMonths('022027')).toEqual(['012027', '022027', '032027'])
  })
  it('the next period: next month, or the next quarter’s end', () => {
    expect(nextPeriod('122026', 'monthly')).toBe('012027')
    expect(nextPeriod('102026', 'quarterly')).toBe('032027')
    expect(nextPeriod('122026', 'quarterly')).toBe('032027')
  })
})

describe('GSTR-2B', () => {
  it('monthly: the 14th of the next month; quarterly: only after the quarter (IMS FAQ Q28)', () => {
    expect(day(twoBGenerationDate('102026', 'monthly'))).toBe('2026-11-14')
    expect(day(twoBGenerationDate('102026', 'quarterly'))).toBeNull()
    expect(day(twoBGenerationDate('122026', 'quarterly'))).toBe('2027-01-14')
  })
})

describe('how long a supplier’s credit note can stay Pending (the law report’s own examples)', () => {
  it('monthly: 2B period October 2025 → until 20 December 2025', () => {
    expect(day(pendingDeadline('102025', 'monthly', '08'))).toBe('2025-12-20')
  })
  it('quarterly: October–December 2025 → until the January–March 2026 GSTR-3B, 22 or 24 April 2026', () => {
    expect(day(pendingDeadline('122025', 'quarterly', '27'))).toBe('2026-04-22')
    expect(day(pendingDeadline('102025', 'quarterly', '08'))).toBe('2026-04-24')
  })
  it('a 2B period before October 2025 has no Pending option', () => {
    expect(pendingDeadline('092025', 'monthly', '08')).toBeNull()
  })
})
