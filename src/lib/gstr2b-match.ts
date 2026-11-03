/**
 * 9a-2 (3 Nov 2026): every GSTR-2B line sorted into one group, with its reason —
 * the one rule behind the supplier-bills screen AND the GSTR-3B claim.
 *
 * Plan 9a (approved 3 Nov): "Matched, nothing to do" / "Needs your decision" (amount
 * differs by ₹X, not in your books, same bill?, supplier's note, no credit) / "Waiting
 * for suppliers". On the portal a bill nobody acts on is deemed accepted (s.38 as
 * substituted, Notification 16/2025-CT), so "matched" asks nothing of the shop.
 *
 * HOW A 2B BILL FINDS ITS PURCHASE, in this order (each purchase is used once):
 *   1. "not mine" stored by the shop       → notMine (handled; kept out of the lists)
 *   2. "same bill" stored by the shop      → that purchase
 *   3. same supplier GSTIN + same number   → that purchase (the key GSTR-3B claims by)
 *   4. a corrected bill (b2ba) whose ORIGINAL number is in the books → that purchase.
 *      2B itself names the number it replaces, so this is a fact, not a guess.
 *   5. same supplier, number equal once "/", "-", spaces and leading zeros are
 *      ignored ("RO/0012" ~ "RO-12") → sameBill: OFFERED, never matched. The shop
 *      answers once ("Same bill" / "Different bills") and the answer is stored.
 *   6. otherwise                          → notInBooks
 * A paired bill is then: noCredit (2B: itcavl N), amountDiffers (> ₹0.05), or matched.
 * Every candidate purchase left unpaired is waiting (not in this 2B yet).
 */
import { itcMatchKey } from '@/lib/itc-claim'
import { roundMoney } from '@/lib/money'

/** The tolerance the matcher has always used (float drift on a rupee total). */
export const AMOUNT_TOLERANCE = 0.05

export interface MatchLine {
  id: string
  docType: string
  supplierGstin: string
  invoiceNumber: string
  originalNumber: string | null
  invoiceDate: string | null
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
  totalAmount: number
  itcAvailable: boolean
  itcReason: string | null
  isReverseCharge: boolean
}

export interface MatchPurchase {
  id: string
  gstin: string | null
  invoiceNo: string | null
  totalAmount: number
  cgst: number
  sgst: number
  igst: number
  date: Date | string
  supplier: string | null
  /** The supplier's phone, for a WhatsApp reminder (9a-3). */
  phone?: string | null
  /** Taxable value (subtotal less discount), for the CSV export. */
  taxable?: number
}

export type DecisionKind = 'same-bill' | 'different-bills' | 'not-mine'
export const DECISION_KINDS: DecisionKind[] = ['same-bill', 'different-bills', 'not-mine']

export interface StoredDecision {
  supplierGstin: string
  docType: string
  documentNumber: string
  decision: DecisionKind
  /** The purchase a "same bill" / "different bills" answer is about; '' for "not mine". */
  purchaseId: string
}

export type PairVia = 'number' | 'corrected' | 'confirmed'
export interface Pair { line: MatchLine; purchase: MatchPurchase; via: PairVia }

export interface TwoBSort {
  matched: Pair[]
  amountDiffers: Array<Pair & { difference: number }>
  noCredit: Pair[]
  sameBill: Array<{ line: MatchLine; candidates: MatchPurchase[] }>
  notInBooks: MatchLine[]
  notMine: MatchLine[]
  waiting: MatchPurchase[]
  /** Suppliers' credit notes in this 2B (all of them; the three lists below split them). */
  notes: MatchLine[]
  /** 9a-4: credit notes paired with the shop's return-to-supplier entry by its stored answer. */
  notesRecorded: Pair[]
  /** 9a-4: credit notes with exactly-the-same-amount return entries from that supplier — offered, never assumed. */
  notesOffered: Array<{ line: MatchLine; candidates: MatchPurchase[] }>
  /** 9a-4: credit notes not in the books — the portal will cut credit by their GST; "Record it". */
  notesToRecord: MatchLine[]
  /**
   * 2B line id → the purchase's own number, for every pairing the claim's key would
   * miss (corrected and confirmed). GSTR-3B claims through this, so the screen and
   * the return can never disagree about which bill a 2B line is.
   */
  claimNumber: Map<string, string>
}

/** "RO/0012", "ro-12", "RO 12" → "RO12": only separators, case and leading zeros dropped. */
export function normBillNo(s: string | null | undefined): string {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/\d+/g, (d) => String(Number(d)))
}

/** A stored answer belongs to one document: its type plus the one match key. */
const decisionKey = (gstin: string, docType: string, no: string) => `${docType}#${itcMatchKey(gstin, no)}`

/** The 2B document types that are bills for matching and credit — IMS treats "Inv/DN" alike. */
const BILL_DOCS = ['invoice', 'debit-note']
export const isBillDoc = (docType: string) => BILL_DOCS.includes(docType)

export function sortTwoB(
  lines: MatchLine[],
  purchases: MatchPurchase[],
  decisions: StoredDecision[],
  /** 9a-4: the shop's own return-to-supplier entries (debit notes) that can take a supplier's credit note. */
  ownNotes: MatchPurchase[] = [],
): TwoBSort {
  const out: TwoBSort = {
    matched: [], amountDiffers: [], noCredit: [], sameBill: [], notInBooks: [], notMine: [], waiting: [],
    notes: [], notesRecorded: [], notesOffered: [], notesToRecord: [], claimNumber: new Map(),
  }
  const byKey = new Map<string, MatchPurchase>()
  const byId = new Map<string, MatchPurchase>()
  for (const p of purchases) {
    byId.set(p.id, p)
    if (p.gstin && p.invoiceNo && !byKey.has(itcMatchKey(p.gstin, p.invoiceNo))) byKey.set(itcMatchKey(p.gstin, p.invoiceNo), p)
  }
  const decided = new Map<string, StoredDecision[]>()
  for (const d of decisions) {
    const k = decisionKey(d.supplierGstin, d.docType, d.documentNumber)
    decided.set(k, [...(decided.get(k) ?? []), d])
  }
  const used = new Set<string>()
  const place = (line: MatchLine, purchase: MatchPurchase, via: PairVia) => {
    used.add(purchase.id)
    if (via !== 'number' && purchase.invoiceNo) out.claimNumber.set(line.id, purchase.invoiceNo)
    const pair = { line, purchase, via }
    if (!line.itcAvailable) { out.noCredit.push(pair); return }
    const difference = roundMoney(Math.abs(roundMoney(purchase.totalAmount) - roundMoney(line.totalAmount)))
    if (difference > AMOUNT_TOLERANCE) out.amountDiffers.push({ ...pair, difference })
    else out.matched.push(pair)
  }

  const bills: MatchLine[] = []
  for (const line of lines) {
    if (!BILL_DOCS.includes(line.docType)) { out.notes.push(line); continue }
    bills.push(line)
  }

  // Pass 1 — certain pairings: the shop's own answers, the number itself, the corrected number.
  const open: MatchLine[] = []
  for (const line of bills) {
    const mine = decided.get(decisionKey(line.supplierGstin, line.docType, line.invoiceNumber)) ?? []
    if (mine.some((d) => d.decision === 'not-mine')) { out.notMine.push(line); continue }
    const confirmed = mine.find((d) => d.decision === 'same-bill' && byId.has(d.purchaseId) && !used.has(d.purchaseId))
    if (confirmed) { place(line, byId.get(confirmed.purchaseId)!, 'confirmed'); continue }
    const exact = byKey.get(itcMatchKey(line.supplierGstin, line.invoiceNumber))
    if (exact && !used.has(exact.id)) { place(line, exact, 'number'); continue }
    const original = line.originalNumber ? byKey.get(itcMatchKey(line.supplierGstin, line.originalNumber)) : undefined
    if (original && !used.has(original.id)) { place(line, original, 'corrected'); continue }
    open.push(line)
  }

  // Pass 2 — offered, never assumed: same supplier, number written differently.
  for (const line of open) {
    const rejected = new Set((decided.get(decisionKey(line.supplierGstin, line.docType, line.invoiceNumber)) ?? [])
      .filter((d) => d.decision === 'different-bills').map((d) => d.purchaseId))
    const want = normBillNo(line.invoiceNumber)
    const candidates = purchases.filter((p) => !used.has(p.id) && !rejected.has(p.id)
      && (p.gstin ?? '').trim().toUpperCase() === line.supplierGstin.trim().toUpperCase()
      && !!want && normBillNo(p.invoiceNo) === want)
    if (candidates.length) out.sameBill.push({ line, candidates })
    else out.notInBooks.push(line)
  }

  // A purchase offered as "same bill?" is not also listed as waiting — it is being asked about.
  const offered = new Set(out.sameBill.flatMap((s) => s.candidates.map((c) => c.id)))
  out.waiting = purchases.filter((p) => p.gstin && p.invoiceNo && !used.has(p.id) && !offered.has(p.id))

  /*
   * 9a-4 — a supplier's credit note against the shop's return-to-supplier entry.
   * The shop numbers its own entry (DN-…), so the supplier's number never matches;
   * the link is the shop's stored answer. An entry from the same supplier for the
   * same amount is OFFERED ("Recorded as DN-0003?"), never assumed.
   */
  const noteIds = new Map(ownNotes.map((n) => [n.id, n]))
  const usedNotes = new Set<string>()
  const pending: MatchLine[] = []
  for (const line of out.notes) {
    const mine = decided.get(decisionKey(line.supplierGstin, line.docType, line.invoiceNumber)) ?? []
    const confirmed = mine.find((d) => d.decision === 'same-bill' && noteIds.has(d.purchaseId) && !usedNotes.has(d.purchaseId))
    if (confirmed) {
      usedNotes.add(confirmed.purchaseId)
      out.notesRecorded.push({ line, purchase: noteIds.get(confirmed.purchaseId)!, via: 'confirmed' })
    } else pending.push(line)
  }
  for (const line of pending) {
    const rejected = new Set((decided.get(decisionKey(line.supplierGstin, line.docType, line.invoiceNumber)) ?? [])
      .filter((d) => d.decision === 'different-bills').map((d) => d.purchaseId))
    const candidates = ownNotes.filter((n) => !usedNotes.has(n.id) && !rejected.has(n.id)
      && (n.gstin ?? '').trim().toUpperCase() === line.supplierGstin.trim().toUpperCase()
      && Math.abs(roundMoney(n.totalAmount) - roundMoney(line.totalAmount)) <= AMOUNT_TOLERANCE)
    if (candidates.length) out.notesOffered.push({ line, candidates })
    else out.notesToRecord.push(line)
  }
  return out
}
