/**
 * Phase 7h — the bill screen's ⚙ panel leaves the bill in view (#312).
 *
 * Its switches act at once, but the panel covered 85% of the phone under a 50%
 * dim, so a change (the Qty button, Price check, the mic) was seen only after
 * closing it. Now: at most 55% of the screen and a light dim.
 */
import { readCode } from '@/test-support/read-source'

describe('the ⚙ panel', () => {
  const panel = readCode('components/ledger/BillScreenSettings.tsx')
  it('takes at most 55% of the screen', () => {
    const h = panel.match(/max-h-\[(\d+)dvh\]/)
    expect(h).not.toBeNull()
    expect(Number(h![1])).toBeLessThanOrEqual(55)
    expect(panel).not.toMatch(/max-h-\[85vh\]/)
  })
  it('dims the bill behind it lightly', () => {
    const dim = panel.match(/overlayClassName="bg-black\/(\d+)"/)
    expect(dim).not.toBeNull()
    expect(Number(dim![1])).toBeLessThanOrEqual(20)
  })
  it('the shared sheet passes the dim through to its overlay', () => {
    expect(readCode('components/ui/sheet.tsx')).toContain('<SheetOverlay className={overlayClassName} />')
  })
})
