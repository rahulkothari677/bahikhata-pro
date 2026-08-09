/**
 * Tax on money taken before the bill exists.
 *
 * WHY THIS EXISTS (2026-08-09). GST treats advances for goods and services
 * differently, and the app handled neither:
 *
 *   GOODS    — no GST on the advance. Notification 66/2017-Central Tax removed
 *              it for every registered person except composition dealers.
 *   SERVICES — GST is due the MOMENT the money is received, before any invoice
 *              exists. It is declared in GSTR-1 Table 11A, and released in
 *              Table 11B when the invoice is finally raised.
 *
 * A kirana never meets this. A salon taking a booking deposit, a tailor taking
 * half up front, a photographer, a repair shop or a tuition class meets it every
 * week — and this app is for every kind of shop, not just kirana.
 *
 * THE ADVANCE IS TREATED AS TAX-INCLUSIVE. When a customer hands over ₹1,180 for
 * an 18% service, they have paid ₹1,000 plus ₹180, not ₹1,180 plus tax. Rule 35
 * gives exactly this back-calculation for a value that is inclusive of tax:
 *
 *     tax = value × rate / (100 + rate)
 *
 * Getting this backwards would overstate the liability by the tax on the tax,
 * which the shopkeeper would pay out of their own pocket.
 *
 * BOTH RETURNS USE THIS ONE FUNCTION, for the same reason GSTR-1 and GSTR-3B now
 * share `classifySupplyLine`: an advance appears in Table 11A of GSTR-1 and
 * inside 3.1(a) of GSTR-3B, and if the two computed it separately they would
 * eventually disagree.
 */
import { roundMoney } from '@/lib/money'
import { splitGstPaise, toPaise, fromPaise } from '@/lib/money'

export interface AdvanceTax {
  /** Taxable value of the advance — the money less the tax inside it. */
  adAmt: number
  cgst: number
  sgst: number
  igst: number
  /** Total tax, whichever heads it fell under. */
  tax: number
}

/**
 * Split an advance receipt into taxable value and tax.
 *
 * @param amountReceived  what the customer actually handed over, in rupees,
 *                        inclusive of tax (Rule 35)
 * @param rate            GST rate as a percentage
 * @param isInterState    IGST if true, otherwise an even CGST/SGST split
 */
export function advanceTax(amountReceived: number, rate: number, isInterState: boolean): AdvanceTax {
  const r = Number(rate) || 0
  const amount = Number(amountReceived) || 0
  if (r <= 0 || amount <= 0) {
    return { adAmt: roundMoney(Math.max(amount, 0)), cgst: 0, sgst: 0, igst: 0, tax: 0 }
  }

  /*
   * Worked in paise so the halves of an odd tax amount are not each rounded up.
   * ₹1,180 at 18% is ₹180.00 of tax — but an amount whose tax is ₹0.77 must
   * split 0.39/0.38, not 0.39/0.39, or the invoice total stops adding up. This
   * is the same allocation rule the sale lines use.
   */
  const amountPaise = toPaise(amount)
  const taxPaise = Math.round((amountPaise * r) / (100 + r))
  const adAmtPaise = amountPaise - taxPaise

  if (isInterState) {
    return {
      adAmt: fromPaise(adAmtPaise),
      cgst: 0,
      sgst: 0,
      igst: fromPaise(taxPaise),
      tax: fromPaise(taxPaise),
    }
  }

  const { cgst, sgst } = splitGstPaise(taxPaise)
  return {
    adAmt: fromPaise(adAmtPaise),
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: 0,
    tax: fromPaise(taxPaise),
  }
}

/** A receipt as the return builders need to see it. */
export interface AdvanceReceipt {
  id: string
  /** Rupees actually received. */
  amount: number
  date: Date
  /** NULL means this advance carries no GST — goods, or an ordinary receipt. */
  advanceGstRate: number | null
  isInterState: boolean
  /** Two-digit state code of the place of supply. */
  pos: string
  /**
   * Rupees of this receipt that had been settled against bills by a given
   * moment — supplied by the caller, which knows the period boundaries.
   */
  adjustedByPeriodEnd: number
  /** Rupees settled against bills DURING the period being reported. */
  adjustedInPeriod: number
}

/** Does this receipt carry a GST liability at all? */
export function isTaxableAdvance(r: AdvanceReceipt): boolean {
  return typeof r.advanceGstRate === 'number' && r.advanceGstRate > 0
}
