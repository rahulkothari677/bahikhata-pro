/**
 * Where a bill's goods went, as the server stores it. (Phase 2c, #114)
 *
 * ONE function for create (POST), edit (PUT) and estimate → sale, so the
 * three cannot drift — the same reason deriveInterStateStatus exists.
 *
 *  - Only the shop's own documents carry a delivery (sale, credit note,
 *    estimate). A purchase's place of supply is the supplier's business.
 *  - A credit note against a saved bill takes THAT bill's delivery and place
 *    of supply: a return reverses the tax that was charged, so its tax head
 *    must match the bill's (a courier sale's return is IGST too).
 *  - An edit that does not send the delivery keeps what the bill saved.
 *  - A state that is not on the official list is refused with the reason;
 *    an address with no state is refused (the state decides the tax).
 */
import { isOutwardDocument } from './shop-tax'
import { normaliseDeliveryState, savedBillToShipTo, gstinStateCode, stateNameForCode, type StatePlace } from './gst-states'

export interface SavedDelivery {
  deliveryState?: string | null
  deliveryAddress?: string | null
  placeOfSupply?: string | null
}

export interface OriginalBill extends SavedDelivery {
  isInterState: boolean
  party: StatePlace | null
}

type TransactionReader = { transaction: { findFirst: (args: any) => Promise<any> } }

export type BillDelivery =
  | { ok: true; deliveryState: string | null; deliveryAddress: string | null; billToShipTo: boolean | null; original: OriginalBill | null }
  | { ok: false; error: string; message: string }

const NONE: BillDelivery = { ok: true, deliveryState: null, deliveryAddress: null, billToShipTo: null, original: null }

export async function resolveBillDelivery(
  client: TransactionReader,
  userId: string,
  input: {
    type: string
    originalTransactionId?: string | null
    deliveryState?: string | null
    deliveryAddress?: string | null
    billToShipTo?: boolean | null
    /** PUT only: the bill as saved, used when the edit does not send a delivery. */
    existing?: SavedDelivery | null
  },
): Promise<BillDelivery> {
  if (!isOutwardDocument(input.type)) return NONE

  if (input.type === 'credit-note' && input.originalTransactionId) {
    const original = await client.transaction.findFirst({
      where: { id: input.originalTransactionId, userId, deletedAt: null },
      select: {
        isInterState: true, placeOfSupply: true, deliveryState: true, deliveryAddress: true,
        party: { select: { gstin: true, state: true } },
      },
    })
    // Not found: validateNoteAgainstOriginal refuses the note later.
    if (original) {
      return {
        ok: true,
        deliveryState: original.deliveryState ?? null,
        deliveryAddress: original.deliveryAddress ?? null,
        billToShipTo: savedBillToShipTo(original),
        original,
      }
    }
  }

  if (input.deliveryState === undefined && input.existing) {
    return {
      ok: true,
      deliveryState: input.existing.deliveryState ?? null,
      deliveryAddress: input.existing.deliveryAddress ?? null,
      billToShipTo: savedBillToShipTo(input.existing),
      original: null,
    }
  }

  const norm = normaliseDeliveryState(input.deliveryState)
  if (!norm.ok) return { ok: false, error: 'Validation failed', message: norm.error }
  const address = String(input.deliveryAddress ?? '').trim() || null
  if (address && !norm.state) {
    return { ok: false, error: 'Validation failed', message: 'Choose the state the goods are going to.' }
  }
  return {
    ok: true,
    deliveryState: norm.state,
    deliveryAddress: norm.state ? address : null,
    billToShipTo: typeof input.billToShipTo === 'boolean' ? input.billToShipTo : null,
    original: null,
  }
}

/** The 400 body when a registered buyer's goods go to another state unasked. */
export function shipToChoiceRefusal(party: { name?: string | null; gstin?: string | null } | null, deliveryState: string | null) {
  const from = stateNameForCode(gstinStateCode(party?.gstin)) ?? 'another state'
  return {
    error: 'SHIP_TO_CHOICE',
    message: `${party?.name || 'This buyer'}'s GSTIN is from ${from}, but the goods go to ${deliveryState}. Choose whether they go to the buyer's own customer (bill-to-ship-to).`,
  }
}
