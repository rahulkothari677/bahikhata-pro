/**
 * Correcting an invoice after the return has been filed.
 *
 * WHY THIS EXISTS (2026-08-09). Once GSTR-1 is filed, an invoice in it cannot
 * simply be edited. A wrong GSTIN, value or date is corrected by declaring an
 * AMENDMENT in a later period's return — tables 9A (B2B/B2CL) and 9C — which
 * carry the ORIGINAL invoice number and date alongside the corrected details,
 * so the portal can find what is being replaced.
 *
 * The app had none of this. Editing an old bill silently changed what the next
 * return said, so the figures no longer matched what had actually been filed,
 * and nothing anywhere recorded that a correction had happened. For a buyer
 * this is not cosmetic: their input credit comes from the seller's filed
 * invoice, so a correction that never reaches the portal leaves them unable to
 * claim.
 *
 * WHAT COUNTS AS AN AMENDMENT, and why it is a comparison rather than a flag:
 * the honest question is "does this invoice still say what we told the
 * department it said?". A flag set on edit would miss every other route by
 * which a total can move — a line deleted, a product's price corrected, a
 * discount applied later. So the filed return is compared against the books as
 * they stand, and any invoice whose declared figures have moved is amended.
 *
 * ONLY FILED PERIODS PRODUCE AMENDMENTS. A draft can still be corrected in
 * place, and amending something never filed would declare a correction to a
 * return the department has never seen.
 */
import { roundMoney } from '@/lib/money'

/** An invoice as a filed return recorded it. */
export interface FiledInvoice {
  section: 'b2b' | 'b2cl'
  /** Counterparty GSTIN — B2B only. */
  ctin?: string
  inum: string
  idt: string
  val: number
  pos: string
  /** Filing period the invoice was declared in (MMYYYY). */
  fp: string
}

/** The same invoice as the books hold it today. */
export interface CurrentInvoice {
  inum: string
  idt: string
  val: number
  pos: string
  ctin?: string
  /** Absent means the invoice no longer exists — cancelled after filing. */
  exists: boolean
}

export interface AmendedInvoice {
  /** Original invoice number, as filed. The portal matches on this. */
  oinum: string
  /** Original invoice date, as filed. */
  oidt: string
  inum: string
  idt: string
  val: number
  pos: string
  /** What actually changed, for the shopkeeper and their CA to read. */
  changes: string[]
}

export interface AmendmentTables {
  /** Table 9A — amended B2B invoices, grouped by counterparty GSTIN. */
  b2ba: Array<{ ctin: string; inv: AmendedInvoice[] }>
  /** Table 9A — amended large inter-state B2C invoices, grouped by POS. */
  b2cla: Array<{ pos: string; inv: AmendedInvoice[] }>
}

/**
 * A rupee is the unit both returns are filed in, so anything smaller cannot be
 * declared and is not a difference worth amending for.
 */
const MATERIAL = 1

/**
 * Compare what was filed against what the books now say.
 *
 * @param filed   invoices from FILED returns of earlier periods
 * @param current the same invoices as they stand today, keyed by invoice number
 */
export function buildAmendments(
  filed: FiledInvoice[],
  current: Map<string, CurrentInvoice>,
): AmendmentTables {
  const b2ba = new Map<string, AmendedInvoice[]>()
  const b2cla = new Map<string, AmendedInvoice[]>()

  for (const f of filed) {
    const now = current.get(f.inum)

    /*
     * An invoice that no longer exists was cancelled after filing. That is a
     * real amendment — the portal must be told the value is now nil, or the
     * buyer keeps claiming credit on a bill that no longer exists — but the app
     * cannot invent the corrected figures, so it declares the value as zero and
     * says so plainly.
     */
    if (!now || !now.exists) {
      const amended: AmendedInvoice = {
        oinum: f.inum, oidt: f.idt,
        inum: f.inum, idt: f.idt,
        val: 0, pos: f.pos,
        changes: ['This invoice was cancelled after the return was filed'],
      }
      if (f.section === 'b2b' && f.ctin) push(b2ba, f.ctin, amended)
      else push(b2cla, f.pos, amended)
      continue
    }

    const changes: string[] = []
    if (Math.abs(roundMoney(now.val) - roundMoney(f.val)) >= MATERIAL) {
      changes.push(`Value changed from ₹${roundMoney(f.val)} to ₹${roundMoney(now.val)}`)
    }
    if (now.idt !== f.idt) changes.push(`Date changed from ${f.idt} to ${now.idt}`)
    if (now.pos !== f.pos) changes.push(`Place of supply changed from ${f.pos} to ${now.pos}`)
    /*
     * A changed GSTIN is the most consequential of the three: the credit went to
     * the wrong buyer entirely, and neither the right one nor the wrong one can
     * fix it from their side.
     */
    if (f.section === 'b2b' && now.ctin && f.ctin && now.ctin !== f.ctin) {
      changes.push(`Customer GSTIN changed from ${f.ctin} to ${now.ctin}`)
    }

    if (changes.length === 0) continue

    const amended: AmendedInvoice = {
      oinum: f.inum, oidt: f.idt,
      inum: now.inum, idt: now.idt,
      val: roundMoney(now.val), pos: now.pos,
      changes,
    }
    /*
     * Grouped under the GSTIN it was FILED against, not the corrected one. The
     * portal has to find the original entry before it can replace it, and it
     * looks under the counterparty it was told about.
     */
    if (f.section === 'b2b' && f.ctin) push(b2ba, f.ctin, amended)
    else push(b2cla, f.pos, amended)
  }

  return {
    b2ba: [...b2ba.entries()].map(([ctin, inv]) => ({ ctin, inv })),
    b2cla: [...b2cla.entries()].map(([pos, inv]) => ({ pos, inv })),
  }
}

function push<T>(m: Map<string, T[]>, key: string, v: T) {
  if (!m.has(key)) m.set(key, [])
  m.get(key)!.push(v)
}

/** Pull the invoices a filed return declared, out of its stored JSON. */
export function filedInvoicesFrom(rawJson: unknown, fp: string): FiledInvoice[] {
  const g = rawJson as any
  if (!g || typeof g !== 'object') return []
  const out: FiledInvoice[] = []

  for (const party of g.b2b || []) {
    for (const inv of party.inv || []) {
      out.push({ section: 'b2b', ctin: party.ctin, inum: String(inv.inum), idt: inv.idt, val: Number(inv.val) || 0, pos: inv.pos, fp })
    }
  }
  for (const group of g.b2cl || []) {
    for (const inv of group.inv || []) {
      out.push({ section: 'b2cl', inum: String(inv.inum), idt: inv.idt, val: Number(inv.val) || 0, pos: group.pos, fp })
    }
  }
  return out
}
