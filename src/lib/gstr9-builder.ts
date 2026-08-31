/**
 * GSTR-9 — the annual return.
 *
 * WHAT IT IS. One return per financial year, summarising the twelve monthly
 * returns you already filed. Mandatory above ₹2 crore turnover, due 31
 * December, late fee ₹200/day capped at 0.25% of turnover.
 *
 * THE THING MOST IMPLEMENTATIONS GET WRONG. GSTR-9 is not a fresh calculation
 * from the books. Every table heading in the real form says the same words:
 * "**as declared in returns filed during the financial year**". It is a
 * summary of what you ACTUALLY FILED, not of what your books say today.
 *
 * That distinction is not pedantry. Books change after filing — an invoice is
 * corrected, a credit note is raised, a product is reclassified. If GSTR-9
 * recomputed from the current books it would disagree with the twelve returns
 * it is supposed to summarise, and the difference would look like fraud rather
 * than like an edit. So this builds from the FILED SNAPSHOTS
 * (GstReturn for GSTR-3B, Gstr1Snapshot for GSTR-1) and never from live rows.
 *
 * Corrections have their own home in the form — Tables 10 to 14, "particulars
 * for the previous FY declared in returns of April to September of current
 * FY". That is where an amendment belongs, and our amendment engine already
 * knows what changed after filing.
 *
 * A MONTH THAT WAS NEVER FILED IS THE MOST IMPORTANT THING THIS CAN SAY.
 * An annual return built from nine of twelve months is not "mostly right", it
 * is wrong — and silently so, because nothing about the total looks unusual.
 * `coverage` below reports exactly which months are present, and the UI must
 * refuse to present the return as complete when any are missing.
 *
 * @see EKBOOK-MASTER-PLAN §5.3 for the row-by-row spec, taken from a real form
 */
import { roundMoney } from '@/lib/money'
import { splitItc, type ItcSplit, type ItcSplitInput } from '@/lib/itc-category'

/** One month's filed GSTR-3B, as stored in GstReturn. */
export interface FiledMonth3b {
  monthYear: string
  filingStatus: string
  outwardTaxableValue: number
  outwardCgst: number
  outwardSgst: number
  outwardIgst: number
  nilRatedValue: number
  exemptValue: number
  nonGstValue: number
  rcmTaxableValue: number
  rcmCgst: number
  rcmSgst: number
  rcmIgst: number
  itcTaxableValue: number
  itcCgst: number
  itcSgst: number
  itcIgst: number
  creditNoteTaxableValue: number
  creditNoteCgst: number
  creditNoteSgst: number
  creditNoteIgst: number
  debitNoteTaxableValue: number
  debitNoteCgst: number
  debitNoteSgst: number
  debitNoteIgst: number
}

/** One month's filed GSTR-1, as stored in Gstr1Snapshot. */
export interface FiledMonth1 {
  monthYear: string
  filingStatus: string
  /** The stored portal JSON — the only place the B2B/B2C split survives. */
  rawJson: unknown
}

export interface TaxAmounts {
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
  cess: number
}

const ZERO: TaxAmounts = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 }

function add(a: TaxAmounts, b: Partial<TaxAmounts>): TaxAmounts {
  return {
    taxableValue: roundMoney(a.taxableValue + (b.taxableValue || 0)),
    cgst: roundMoney(a.cgst + (b.cgst || 0)),
    sgst: roundMoney(a.sgst + (b.sgst || 0)),
    igst: roundMoney(a.igst + (b.igst || 0)),
    cess: roundMoney(a.cess + (b.cess || 0)),
  }
}

function totalTax(a: TaxAmounts): number {
  return roundMoney(a.cgst + a.sgst + a.igst + a.cess)
}

/** Every month of an Indian financial year, April → March, as MMYYYY. */
export function financialYearMonths(fy: string): string[] {
  // fy is "2026-27"
  const startYear = Number(fy.split('-')[0])
  const out: string[] = []
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1            // April = 4 … March = 3
    const y = i < 9 ? startYear : startYear + 1
    out.push(`${String(m).padStart(2, '0')}${y}`)
  }
  return out
}

export interface Gstr9Coverage {
  /** Every month the FY should contain. */
  expected: string[]
  /** Months with a FILED GSTR-3B. */
  filed3b: string[]
  /** Months with a FILED GSTR-1. */
  filed1: string[]
  /** Months missing at least one filed return — the ones that make this wrong. */
  missing: string[]
  /** True only when all twelve months are fully filed. */
  complete: boolean
}

export interface Gstr9Result {
  fy: string
  coverage: Gstr9Coverage
  /** Table 4 — outward supplies on which tax IS payable. */
  table4: {
    b2c: TaxAmounts
    b2b: TaxAmounts
    rcmInward: TaxAmounts
    subTotalH: TaxAmounts
    creditNotesI: TaxAmounts
    debitNotesJ: TaxAmounts
    subTotalM: TaxAmounts
    /** N = H + M. The form asserts this. */
    totalN: TaxAmounts
  }
  /** Table 5 — outward supplies on which tax is NOT payable. */
  table5: {
    exemptedD: number
    nilRatedE: number
    nonGstF: number
    subTotalG: number
    /** M = G + notes/amendments. No notes tracked here yet, so M = G. */
    totalM: number
    /** N = 4N + 5M − 4G − 4G1. The form's own formula. */
    totalTurnoverN: number
  }
  /**
   * Table 6 — ITC availed. PARTIAL, and deliberately so.
   *
   * The form splits rows B, C and D three ways — Inputs / Capital Goods /
   * Input Services — and we do not record that on a purchase. It cannot be
   * recovered afterwards, so this reports the total and flags the split as
   * unavailable rather than guessing. See task #36 and CA question Q4.1a.
   */
  table6: {
    totalItcPer3bA: TaxAmounts
    /**
     * True when NO purchase in the year carries a category — the state before
     * #36. Kept as its own flag rather than inferred from the split, because
     * "we never recorded this" and "some of it is recorded" are different
     * things to tell a CA.
     */
    splitUnavailable: boolean
    /** The three-way split, plus whatever predates the column. */
    split: ItcSplit | null
  }
  /** Table 9 — tax paid, per the filed GSTR-3B. */
  table9: {
    outputTax: TaxAmounts
    itcClaimed: TaxAmounts
  }
  /** Sanity checks the form itself asserts. Any failure is a real problem. */
  checks: { id: string; passes: boolean; detail: string }[]
}

/**
 * Sum the B2B / B2C split, and the credit notes that belong in row 4I, out of
 * a stored GSTR-1 portal JSON.
 *
 * WHY CREDIT NOTES COME FROM HERE AND NOT FROM THE GSTR-3B TOTAL — this was a
 * real bug, caught on live data before release.
 *
 * Read row 4I in the actual form: "Credit Notes issued in respect of
 * transactions specified in **(B) to (E)** above". (B) to (E) are B2B,
 * exports, SEZ and deemed exports. **4A (B2C) is deliberately excluded**,
 * because a B2C credit note is netted straight into the B2C figure rather
 * than shown separately — which is exactly what GSTR-1's own B2CS table does.
 *
 * So taking 4I from GstReturn.creditNoteTaxableValue — every credit note the
 * month contained — subtracted B2C credit notes a SECOND time, after GSTR-1
 * had already netted them off B2CS. On the test account that turned a true
 * turnover of ₹2,100 into ₹850: a 60% understatement, on the return that
 * declares a year's turnover.
 *
 * CDNR is credit notes to REGISTERED persons, which is precisely "(B) to
 * (E)". CDNUR is to unregistered persons — B2C — and stays netted where it
 * already is.
 */
function splitFromGstr1(raw: unknown): { b2b: TaxAmounts; b2c: TaxAmounts; creditNotesB2b: TaxAmounts } {
  let b2b = { ...ZERO }
  let b2c = { ...ZERO }
  let creditNotesB2b = { ...ZERO }
  const r = raw as Record<string, any> | null
  if (!r || typeof r !== 'object') return { b2b, b2c, creditNotesB2b }

  // CDNR — credit/debit notes against registered counterparties. Only these
  // belong in 4I; note the sign is carried by ntty ('C' credit, 'D' debit).
  for (const party of (r.cdnr || [])) {
    for (const note of (party.nt || [])) {
      if (note.ntty === 'D') continue   // debit notes are row 4J, not 4I
      for (const item of (note.itms || [])) {
        const d = item.itm_det || {}
        creditNotesB2b = add(creditNotesB2b, { taxableValue: d.txval, cgst: d.camt, sgst: d.samt, igst: d.iamt, cess: d.csamt })
      }
    }
  }

  // B2B: one entry per counterparty, each with invoices, each with items.
  for (const party of (r.b2b || [])) {
    for (const inv of (party.inv || [])) {
      for (const item of (inv.itms || [])) {
        const d = item.itm_det || {}
        b2b = add(b2b, { taxableValue: d.txval, cgst: d.camt, sgst: d.samt, igst: d.iamt, cess: d.csamt })
      }
    }
  }
  // B2CS: already rate-wise summary rows. B2CL: invoice-wise, like b2b.
  for (const row of (r.b2cs || [])) {
    b2c = add(b2c, { taxableValue: row.txval, cgst: row.camt, sgst: row.samt, igst: row.iamt, cess: row.csamt })
  }
  for (const pos of (r.b2cl || [])) {
    for (const inv of (pos.inv || [])) {
      for (const item of (inv.itms || [])) {
        const d = item.itm_det || {}
        b2c = add(b2c, { taxableValue: d.txval, cgst: d.camt, sgst: d.samt, igst: d.iamt, cess: d.csamt })
      }
    }
  }
  return { b2b, b2c, creditNotesB2b }
}

export function buildGstr9(input: {
  fy: string
  months3b: FiledMonth3b[]
  months1: FiledMonth1[]
  /*
   * Purchases of the year, for Table 6's three-way split (#36). Optional so
   * every existing caller and test keeps working — absent means the split is
   * unavailable, which is exactly what it meant before this column existed.
   */
  purchases?: ItcSplitInput[]
}): Gstr9Result {
  const expected = financialYearMonths(input.fy)

  const filed3bRows = input.months3b.filter(m => m.filingStatus === 'filed')
  const filed1Rows = input.months1.filter(m => m.filingStatus === 'filed')
  const filed3b = filed3bRows.map(m => m.monthYear)
  const filed1 = filed1Rows.map(m => m.monthYear)
  const missing = expected.filter(m => !filed3b.includes(m) || !filed1.includes(m))

  // ── Table 4 ────────────────────────────────────────────────────────────
  let b2b = { ...ZERO }
  let b2c = { ...ZERO }
  let creditNotes = { ...ZERO }   // row 4I — B2B/export notes ONLY, from CDNR
  for (const m of filed1Rows) {
    const s = splitFromGstr1(m.rawJson)
    b2b = add(b2b, s.b2b)
    b2c = add(b2c, s.b2c)
    creditNotes = add(creditNotes, s.creditNotesB2b)
  }

  let rcmInward = { ...ZERO }
  let debitNotes = { ...ZERO }
  /* Every credit note the month contained, per GSTR-3B. NOT row 4I (see
     splitFromGstr1) — used only to put the 3B on a net basis for the
     cross-check below. */
  let creditNotes3b = { ...ZERO }
  let outputTax = { ...ZERO }
  let itcClaimed = { ...ZERO }
  let exempted = 0, nilRated = 0, nonGst = 0

  for (const m of filed3bRows) {
    rcmInward = add(rcmInward, { taxableValue: m.rcmTaxableValue, cgst: m.rcmCgst, sgst: m.rcmSgst, igst: m.rcmIgst })
    creditNotes3b = add(creditNotes3b, { taxableValue: m.creditNoteTaxableValue, cgst: m.creditNoteCgst, sgst: m.creditNoteSgst, igst: m.creditNoteIgst })
    debitNotes = add(debitNotes, { taxableValue: m.debitNoteTaxableValue, cgst: m.debitNoteCgst, sgst: m.debitNoteSgst, igst: m.debitNoteIgst })
    outputTax = add(outputTax, { taxableValue: m.outwardTaxableValue, cgst: m.outwardCgst, sgst: m.outwardSgst, igst: m.outwardIgst })
    itcClaimed = add(itcClaimed, { taxableValue: m.itcTaxableValue, cgst: m.itcCgst, sgst: m.itcSgst, igst: m.itcIgst })
    exempted = roundMoney(exempted + m.exemptValue)
    nilRated = roundMoney(nilRated + m.nilRatedValue)
    nonGst = roundMoney(nonGst + m.nonGstValue)
  }

  const subTotalH = add(add(b2c, b2b), rcmInward)
  // I is credit notes (−), J debit notes (+). M is their net.
  const subTotalM: TaxAmounts = {
    taxableValue: roundMoney(debitNotes.taxableValue - creditNotes.taxableValue),
    cgst: roundMoney(debitNotes.cgst - creditNotes.cgst),
    sgst: roundMoney(debitNotes.sgst - creditNotes.sgst),
    igst: roundMoney(debitNotes.igst - creditNotes.igst),
    cess: roundMoney(debitNotes.cess - creditNotes.cess),
  }
  const totalN = add(subTotalH, subTotalM)

  // ── Table 5 ────────────────────────────────────────────────────────────
  const subTotalG = roundMoney(exempted + nilRated + nonGst)
  const totalM5 = subTotalG
  // N = 4N + 5M − 4G (RCM inward is not YOUR turnover, so it comes out again)
  const totalTurnoverN = roundMoney(totalN.taxableValue + totalM5 - rcmInward.taxableValue)

  // ── Checks the form itself asserts ─────────────────────────────────────
  const checks = [
    {
      id: '4N = 4H + 4M',
      passes: Math.abs(totalN.taxableValue - (subTotalH.taxableValue + subTotalM.taxableValue)) < 1,
      detail: `${totalN.taxableValue} vs ${roundMoney(subTotalH.taxableValue + subTotalM.taxableValue)}`,
    },
    {
      id: 'Table 4 outward tax agrees with the filed GSTR-3B',
      /*
       * COMPARE NET WITH NET. This check first compared GSTR-1's figure —
       * which is already net of credit notes, because B2CS nets them — against
       * GSTR-3B's outward tax, which is GROSS and carries its credit notes in
       * a separate field. Net against gross always "fails", and a check that
       * cries wolf every month is worse than no check at all.
       *
       * Same class of mistake as the ₹25 gap: two figures on different bases
       * compared as though they were the same thing.
       */
      passes: Math.abs(totalTax(add(b2b, b2c)) - (totalTax(outputTax) - totalTax(creditNotes3b))) < 1,
      detail: `GSTR-1 ${totalTax(add(b2b, b2c))} vs GSTR-3B net ${roundMoney(totalTax(outputTax) - totalTax(creditNotes3b))}`,
    },
    {
      id: 'All twelve months filed',
      passes: missing.length === 0,
      detail: missing.length === 0 ? 'complete' : `missing: ${missing.join(', ')}`,
    },
  ]

  return {
    fy: input.fy,
    coverage: { expected, filed3b, filed1, missing, complete: missing.length === 0 },
    table4: { b2c, b2b, rcmInward, subTotalH, creditNotesI: creditNotes, debitNotesJ: debitNotes, subTotalM, totalN },
    table5: { exemptedD: exempted, nilRatedE: nilRated, nonGstF: nonGst, subTotalG, totalM: totalM5, totalTurnoverN },
    table6: (() => {
      /*
       * The split is only offered when something is actually recorded.
       * Returning three zeroes and an "unclassified" bucket holding the whole
       * year would be technically true and read as a broken report.
       */
      const rows = input.purchases ?? []
      if (rows.length === 0) return { totalItcPer3bA: itcClaimed, splitUnavailable: true, split: null }
      const split = splitItc(rows)
      const recorded = split.inputs.cgst + split.inputs.sgst + split.inputs.igst
        + split.capitalGoods.cgst + split.capitalGoods.sgst + split.capitalGoods.igst
        + split.services.cgst + split.services.sgst + split.services.igst
      return {
        totalItcPer3bA: itcClaimed,
        splitUnavailable: recorded === 0,
        split: recorded === 0 ? null : split,
      }
    })(),
    table9: { outputTax, itcClaimed },
    checks,
  }
}
