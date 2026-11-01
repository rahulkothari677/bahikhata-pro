/**
 * 🔒 GUARD (Phase 8d, #116 #117): GSTR-3B claims credit through lib/itc-claim,
 * stamps what it claimed when filed, and the 2B screens match by one key.
 */
import { readCode } from '@/test-support/read-source'

const threeB = readCode('src/app/api/gstr-3b/route.ts')
const recon = readCode('src/app/api/gstr-2b/reconcile/route.ts')

test('the 3B claim comes from claimForPeriod, over unclaimed purchases inside the s.16(4) window', () => {
  expect(threeB).toContain('itcClaim = claimForPeriod(')
  expect(threeB).toMatch(/OR: \[\{ itcClaimedIn: null \}, \{ itcClaimedIn: fp \}\]/)
  expect(threeB).toContain('earliestClaimableBill(fp)')
  // The old book-tax-on-match loop is gone.
  expect(threeB).not.toMatch(/in2b\.has\(/)
})

test('"Mark as filed" stamps the claimed purchases, never re-stamping another period\'s', () => {
  expect(threeB).toMatch(/if \(action === 'file' && claimedPurchaseIds\.length\)/)
  expect(threeB).toMatch(/where: \{ userId, id: \{ in: claimedPurchaseIds \}, itcClaimedIn: null \}/)
  expect(threeB).toContain('data: { itcClaimedIn: monthYear }')
})

test('one match key: neither route builds its own GSTIN|invoice key', () => {
  for (const [name, src] of [['3B', threeB], ['reconcile', recon]] as const) {
    expect({ name, ownKey: /toUpperCase\(\)\}\|\$\{/.test(src) }).toEqual({ name, ownKey: false })
  }
  expect(recon).toContain('itcMatchKey(p.party.gstin, p.invoiceNo)')
  expect(recon).toContain('itcMatchKey(inv.supplierGstin, inv.invoiceNumber)')
})
