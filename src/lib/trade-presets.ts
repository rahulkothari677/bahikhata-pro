import type { CustomFieldEntity, CustomFieldType } from './custom-fields'

/**
 * "What do you sell?" — and the fields that trade actually needs.
 *
 * 📄 Phase 6 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * ── WHY THIS IS §0 WORK AND NOT A SHORTCUT ────────────────────────────
 *
 * Phase 5 lets a shopkeeper add a batch number. It does not tell them they
 * are REQUIRED to record one. A chemist who does not know the rule does not
 * go looking for the setting, and finds out from a Drug Inspector instead.
 *
 * So every field here carries `basis`: whether it exists because the LAW says
 * so — with the law named — or because the trade does it that way. The app
 * states which, in the shopkeeper's own language, at the moment they choose
 * their trade.
 *
 * That is the difference between a register and a compliance engine, and it
 * is the reason this file is not simply a list of nice defaults. Every
 * competitor offers "industry suggested fields" as a convenience. None of
 * them says which ones you can be penalised for missing.
 *
 * ── HONESTY ABOUT WHAT IS ACTUALLY LAW ────────────────────────────────
 *
 * Only claims I could substantiate are marked `law`. Batch and expiry for
 * medicines are the Drugs and Cosmetics Rules, and Drug Inspectors check
 * billing records against them. Everything else here is `practice` — real,
 * useful, widely done, and NOT a legal requirement.
 *
 * In particular HUID is `practice`: hallmarking jewellery is mandatory, but
 * putting the HUID on the INVOICE is voluntary at present. I assumed
 * otherwise, checked, and was wrong — so the app does not repeat my mistake
 * to a jeweller who would believe it.
 */

export type FieldBasis = 'law' | 'practice'

export interface PresetField {
  entity: CustomFieldEntity
  label: string
  type: CustomFieldType
  required: boolean
  showOnInvoice: boolean
  basis: FieldBasis
  /** Why it exists, in one line a shopkeeper reads. Names the law when there is one. */
  why: string
}

export interface TradePreset {
  id: string
  /** What the shopkeeper calls their shop, not an industry code. */
  label: string
  /** Shown under the label. Concrete, so they recognise themselves in it. */
  examples: string
  fields: PresetField[]
}

export const TRADE_PRESETS: readonly TradePreset[] = [
  {
    id: 'pharmacy',
    label: 'Medicines',
    examples: 'Chemist, medical store, pharmacy',
    fields: [
      {
        entity: 'item', label: 'Batch No.', type: 'text',
        // The only REQUIRED field in this whole file, and it earns it.
        required: true, showOnInvoice: true, basis: 'law',
        why: 'The Drugs and Cosmetics Rules require the batch of every medicine you sell to be on the record. Drug Inspectors check bills against it.',
      },
      {
        entity: 'item', label: 'Expiry', type: 'date',
        required: true, showOnInvoice: true, basis: 'law',
        why: 'The Drugs and Cosmetics Rules require the expiry alongside the batch. Stored as a date, so it sorts and cannot be written in a form nobody can read later.',
      },
      {
        entity: 'item', label: 'MRP', type: 'money',
        required: false, showOnInvoice: true, basis: 'practice',
        why: 'Not required by law. Customers expect to see it on a medicine bill, and it settles arguments at the counter.',
      },
    ],
  },
  {
    id: 'jewellery',
    label: 'Jewellery',
    examples: 'Gold, silver, ornaments',
    fields: [
      {
        entity: 'item', label: 'HUID', type: 'text',
        required: false, showOnInvoice: true, basis: 'practice',
        // Checked, and it corrected me. See the header.
        why: 'Hallmarking is mandatory; printing the HUID on the bill is NOT — it is voluntary at present. Most jewellers print it anyway, because a customer reselling later will be asked for it.',
      },
      {
        entity: 'item', label: 'Purity', type: 'text',
        required: false, showOnInvoice: true, basis: 'practice',
        why: '22K, 18K, 916. What the customer is actually paying for.',
      },
      {
        entity: 'item', label: 'Net Weight', type: 'number',
        required: false, showOnInvoice: true, basis: 'practice',
        why: 'The metal weight without stones. The figure the price is calculated from.',
      },
    ],
  },
  {
    id: 'textile',
    label: 'Cloth & clothing',
    examples: 'Readymade, saree shop, tailor',
    fields: [
      {
        entity: 'item', label: 'Size', type: 'text',
        required: false, showOnInvoice: true, basis: 'practice',
        why: 'Not a legal field. It is the one thing an exchange argument turns on.',
      },
      {
        entity: 'item', label: 'Design No.', type: 'text',
        required: false, showOnInvoice: true, basis: 'practice',
        why: 'How you and your supplier both refer to the same piece when reordering.',
      },
    ],
  },
  {
    id: 'electronics',
    label: 'Electronics',
    examples: 'Mobiles, appliances, computers',
    fields: [
      {
        entity: 'item', label: 'Serial / IMEI', type: 'text',
        required: false, showOnInvoice: true, basis: 'practice',
        why: 'Not required by law. It is what a warranty claim or a police complaint needs, and the bill is where anyone looks for it.',
      },
      {
        entity: 'item', label: 'Warranty Until', type: 'date',
        required: false, showOnInvoice: true, basis: 'practice',
        why: 'A date on the bill ends the "when did I buy this" conversation.',
      },
    ],
  },
  {
    id: 'transport',
    label: 'Delivery & transport',
    examples: 'Goods sent by truck or tempo',
    fields: [
      {
        entity: 'invoice', label: 'Vehicle Number', type: 'text',
        required: false, showOnInvoice: true, basis: 'practice',
        why: 'Not required on the invoice itself. You need it to raise an e-way bill, and having it on the bill saves finding it twice.',
      },
      {
        entity: 'invoice', label: 'LR / Docket No.', type: 'text',
        required: false, showOnInvoice: true, basis: 'practice',
        why: 'The transporter\'s own reference, for tracing a consignment that has not arrived.',
      },
    ],
  },
  {
    id: 'wholesale',
    label: 'Wholesale & supply',
    examples: 'Supplying shops or businesses',
    fields: [
      {
        entity: 'invoice', label: 'PO Number', type: 'text',
        required: false, showOnInvoice: true, basis: 'practice',
        why: 'Your buyer\'s purchase order number. Their accounts department may not pay a bill they cannot match to one.',
      },
    ],
  },
] as const

export function getTradePreset(id: string | null | undefined): TradePreset | null {
  return TRADE_PRESETS.find(p => p.id === id) ?? null
}

/**
 * Does this preset carry anything the law requires?
 *
 * Exported as a plain function over a plain preset so a test can run it
 * against one that does and one that does not — rather than only by rendering
 * a screen. CLAUDE.md, Cause 7.
 */
export function hasLegalFields(preset: TradePreset): boolean {
  return preset.fields.some(f => f.basis === 'law')
}
