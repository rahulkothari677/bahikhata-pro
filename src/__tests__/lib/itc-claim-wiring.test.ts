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

/*
 * #132 (8e): a 0% purchase line is exempt inward (Table 5), never credit
 * (Table 4). Live 1 Oct: ₹6,000 of 0% toor dal sat inside 4(a) on a mixed
 * bill, and Table 5 read ₹0 because it counted only all-0% bills.
 * Local 1 Nov after the fix: ₹1,000 at 5% + ₹600 at 0% → Table 4 ₹1,000, Table 5 ₹600.
 */
test('#132: Table 5 sums 0% lines; Table 4 and the 2B claim use taxed lines only', () => {
  // Table 5: line level, not "bills with no taxed line".
  expect(threeB).toMatch(/FROM "TransactionItem" ti\s+JOIN "Transaction" t[\s\S]{0,300}AND ti\."gstRate" = 0/)
  expect(threeB).not.toMatch(/NOT EXISTS \(SELECT 1 FROM "TransactionItem" ti WHERE ti\."transactionId" = t\.id AND ti\."gstRate" > 0\)/)
  // Table 4: the taxed lines, per purchase — books and 2B claim alike.
  expect(threeB).toMatch(/AND ti\."gstRate" > 0\s+GROUP BY ti\."transactionId"/)
  expect(threeB).toContain('taxable: roundMoney(taxedById.get(p.id) || 0)')
  expect(threeB).not.toMatch(/const bookItcTaxable = roundMoney\(\(itcPurchasesAgg\._sum\.subtotal/)
})
