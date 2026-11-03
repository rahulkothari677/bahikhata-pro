/**
 * 9a-2: one month of GSTR-2B against the books — loaded ONCE, the same way, for the
 * supplier-bills screen (/api/gstr-2b/reconcile) and the GSTR-3B claim (/api/gstr-3b).
 *
 * Before this, the screen matched only purchases dated in the month, while GSTR-3B
 * claimed every purchase still inside s.16(4) (#117) — so a September bill a supplier
 * filed late read "not in your books" on the screen and was claimed in the return.
 * Now both read this: the same candidate purchases, the same stored answers, the
 * same sorting (lib/gstr2b-match.ts).
 */
import { db } from '@/lib/db'
import { roundMoney } from '@/lib/money'
import { istMonthStartOffset } from '@/lib/timezone'
import { earliestClaimableBill, itcMatchKey } from '@/lib/itc-claim'
import { sortTwoB, isBillDoc, type MatchLine, type MatchPurchase, type StoredDecision, type DecisionKind, type TwoBSort } from '@/lib/gstr2b-match'

const periodFrom = (year: number, month: number, offset: number) => istMonthStartOffset(new Date(Date.UTC(year, month - 1, 15)), offset)

/** The periods (MMYYYY) before fp whose bills can still take credit in fp: s.16(4)'s window, at most ~19. */
export function earlierPeriods(fp: string): string[] {
  const out: string[] = []
  const e = earliestClaimableBill(fp)
  let y = e.year
  let m = e.month
  const end = Number(fp.slice(2)) * 12 + Number(fp.slice(0, 2))
  while (y * 12 + m < end) {
    out.push(String(m).padStart(2, '0') + String(y))
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

/** The purchases that can still take credit in period fp (MMYYYY) — what GSTR-3B claims from. */
export async function claimCandidates(userId: string, fp: string) {
  const month = Number(fp.slice(0, 2))
  const year = Number(fp.slice(2))
  const earliest = earliestClaimableBill(fp)
  return db.transaction.findMany({
    where: {
      userId, type: 'purchase', deletedAt: null, isReverseCharge: false,
      // Bounded by s.16(4): nothing older than last April (April–October) or this April can still be claimed.
      date: { gte: periodFrom(earliest.year, earliest.month, 0), lt: periodFrom(year, month, 1) },
      // Section 17(5): credit on these is blocked outright, so they never enter the claim.
      itcBlockedReason: null,
      // Not claimed by another period's filed 3B (#117).
      OR: [{ itcClaimedIn: null }, { itcClaimedIn: fp }],
    },
    select: {
      id: true, date: true, subtotal: true, discountAmount: true, totalAmount: true,
      cgst: true, sgst: true, igst: true, invoiceNo: true, itcClaimedIn: true,
      party: { select: { id: true, gstin: true, name: true, phone: true } },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  })
}

export type ClaimCandidate = Awaited<ReturnType<typeof claimCandidates>>[number]

export interface TwoBMonth {
  importRow: { id: string; importedAt: Date; invoiceCount: number; taxableTotal: number; igstTotal: number; cgstTotal: number; sgstTotal: number }
  lines: MatchLine[]
  purchases: ClaimCandidate[]
  sort: TwoBSort
  /** Bills an earlier month's 2B marked "no credit" (itcMatchKey). */
  noCreditKeys: Set<string>
  /** GSTIN (upper case) → the shop's own party for that supplier, for suppliers in this file. */
  suppliers: Map<string, { id: string; name: string }>
}

/** This month's 2B against the books, or null when no 2B is imported for fp. */
export async function loadTwoBMonth(userId: string, fp: string): Promise<TwoBMonth | null> {
  const importRow = await db.gstr2bImport.findUnique({
    where: { userId_monthYear: { userId, monthYear: fp } },
    include: { invoices: { orderBy: [{ supplierGstin: 'asc' }, { invoiceNumber: 'asc' }] } },
  })
  if (!importRow) return null
  const docNumbers = [...new Set(importRow.invoices.map((i) => i.invoiceNumber))]
  const fileGstins = [...new Set(importRow.invoices.map((i) => i.supplierGstin))]
  const month = Number(fp.slice(0, 2))
  const year = Number(fp.slice(2))
  const earliest = earliestClaimableBill(fp)
  const [purchases, decisions, earlierNoCredit, knownSuppliers, ownNoteRows] = await Promise.all([
    claimCandidates(userId, fp),
    // Answers about THIS 2B's documents only — bounded by the file.
    db.gstr2bDecision.findMany({
      where: { userId, documentNumber: { in: docNumbers } },
      select: { supplierGstin: true, docType: true, documentNumber: true, decision: true, purchaseId: true },
    }),
    // "No credit" bills from earlier 2Bs whose bills can still be claimed (the s.16(4) window).
    db.gstr2bInvoice.findMany({
      where: { userId, docType: { in: ['invoice', 'debit-note'] }, itcAvailable: false, gstr2bImport: { monthYear: { in: earlierPeriods(fp) } } },
      select: { supplierGstin: true, invoiceNumber: true },
    }),
    // 9a-3: the shop's own name for each supplier in the file, so a row reads "Sharma Traders", not a GSTIN.
    db.party.findMany({
      where: { userId, deletedAt: null, gstin: { in: fileGstins } },
      select: { id: true, gstin: true, name: true },
    }),
    // 9a-4: the shop's own return-to-supplier entries (debit notes) from these suppliers, in the same
    // s.16(4) window — what a supplier's credit note in 2B pairs with.
    db.transaction.findMany({
      where: {
        userId, type: 'debit-note', deletedAt: null,
        date: { gte: periodFrom(earliest.year, earliest.month, 0), lt: periodFrom(year, month, 1) },
        party: { gstin: { in: fileGstins } },
      },
      select: { id: true, date: true, totalAmount: true, cgst: true, sgst: true, igst: true, invoiceNo: true, party: { select: { gstin: true, name: true } } },
    }),
  ])
  const lines: MatchLine[] = importRow.invoices.map((i) => ({
    id: i.id, docType: i.docType, supplierGstin: i.supplierGstin, invoiceNumber: i.invoiceNumber,
    originalNumber: i.originalNumber, invoiceDate: i.invoiceDate, taxableValue: i.taxableValue,
    cgst: i.cgst, sgst: i.sgst, igst: i.igst, totalAmount: i.totalAmount,
    itcAvailable: i.itcAvailable, itcReason: i.itcReason, isReverseCharge: i.isReverseCharge,
  }))
  const forMatch: MatchPurchase[] = purchases.map((p) => ({
    id: p.id, gstin: p.party?.gstin ?? null, invoiceNo: p.invoiceNo, totalAmount: p.totalAmount,
    cgst: p.cgst || 0, sgst: p.sgst || 0, igst: p.igst || 0, date: p.date, supplier: p.party?.name ?? null,
    phone: p.party?.phone ?? null,
    taxable: roundMoney((p.subtotal || 0) - (p.discountAmount || 0)),
  }))
  const ownNotes: MatchPurchase[] = ownNoteRows.map((n) => ({
    id: n.id, gstin: n.party?.gstin ?? null, invoiceNo: n.invoiceNo, totalAmount: n.totalAmount,
    cgst: n.cgst || 0, sgst: n.sgst || 0, igst: n.igst || 0, date: n.date, supplier: n.party?.name ?? null,
  }))
  const sort = sortTwoB(lines, forMatch, decisions.map((d) => ({ ...d, decision: d.decision as DecisionKind }) as StoredDecision), ownNotes)
  return {
    importRow: {
      id: importRow.id, importedAt: importRow.importedAt, invoiceCount: importRow.invoiceCount,
      taxableTotal: importRow.taxableTotal, igstTotal: importRow.igstTotal, cgstTotal: importRow.cgstTotal, sgstTotal: importRow.sgstTotal,
    },
    lines, purchases, sort,
    noCreditKeys: new Set(earlierNoCredit.map((r) => itcMatchKey(r.supplierGstin, r.invoiceNumber))),
    suppliers: new Map(knownSuppliers.filter((p) => p.gstin).map((p) => [p.gstin!.trim().toUpperCase(), { id: p.id, name: p.name }])),
  }
}

/**
 * The 2B bill lines GSTR-3B claims against: a bill paired by its corrected number or
 * by the shop's "same bill" answer carries the purchase's own number, so the claim's
 * key finds it — the screen and the return agree on every pairing.
 */
export function claimLines(month: TwoBMonth) {
  return month.lines
    // Bills and suppliers' debit notes carry credit (IMS: "Inv/DN"); credit notes reduce it through the shop's own return entry.
    .filter((l) => isBillDoc(l.docType))
    .map((l) => ({
      supplierGstin: l.supplierGstin,
      invoiceNumber: month.sort.claimNumber.get(l.id) ?? l.invoiceNumber,
      taxableValue: l.taxableValue, cgst: l.cgst, sgst: l.sgst, igst: l.igst, itcAvailable: l.itcAvailable,
    }))
}
