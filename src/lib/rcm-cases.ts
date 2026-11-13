/**
 * 9c-2 (#126): the reverse-charge cases a shop actually meets — one list.
 *
 * From the verified law report (Downloads\reports\GST law verified September
 * 2026.md, "Reverse charge for shops"); entries of Notification 13/2017-CT(Rate):
 *   Freight paid to a goods transport agency   5%, credit claimable (GTA)
 *   Fees of an advocate                         18%
 *   Shop or godown rent, landlord not registered  18% — entry 5AB, 09/2024-CT(Rate),
 *     from 10 Oct 2024; composition shops excluded from 16 Jan 2025 (07/2025-CT(Rate))
 *   Security guards from an agency that is not a company  18% — 29/2018-CT(Rate),
 *     from 1 Jan 2019; composition shops excluded
 *
 * Buying GOODS from an unregistered seller is NOT reverse charge for a shop:
 * s.9(4) is notified only for real-estate promoters (07/2019-CT(Rate)). The
 * app must never suggest it. (The scrap / used-oil entries from 1 Nov 2026,
 * 04/2026-CT(Rate), are a goods case with their own rates; not offered here.)
 */
import type { GstStatus } from '@/lib/shop-tax'

export interface RcmCase {
  id: 'gta' | 'advocate' | 'rent' | 'security'
  /** The chip. */
  label: string
  /** The bill line it adds when the bill is empty. */
  lineName: string
  rate: number
  /** May a composition shop use it? */
  forComposition: boolean
  basis: string
}

export const RCM_CASES: readonly RcmCase[] = [
  { id: 'gta', label: 'Freight (transporter)', lineName: 'Freight', rate: 5, forComposition: true, basis: 'Notification 13/2017-CT(Rate), GTA — 5%, credit can be claimed' },
  { id: 'advocate', label: 'Advocate fees', lineName: 'Legal fees', rate: 18, forComposition: true, basis: 'Notification 13/2017-CT(Rate), legal services by an advocate' },
  { id: 'rent', label: 'Rent (landlord not registered)', lineName: 'Shop rent', rate: 18, forComposition: false, basis: 'Entry 5AB, Notification 09/2024-CT(Rate), from 10 Oct 2024; not for composition (07/2025-CT(Rate))' },
  { id: 'security', label: 'Security agency', lineName: 'Security services', rate: 18, forComposition: false, basis: 'Notification 29/2018-CT(Rate), from 1 Jan 2019; not for composition' },
]

/** The cases this shop may meet. A not-registered shop has none. */
export function rcmCasesFor(status: GstStatus): RcmCase[] {
  if (status === 'unregistered') return []
  return RCM_CASES.filter((c) => status === 'regular' || c.forComposition)
}

/** Rule 47A (20/2024-CT, from 1 Nov 2024): the self-invoice is due within 30 days. */
export const SELF_INVOICE_DAYS = 30

/**
 * When the self-invoice for a reverse-charge purchase from an unregistered
 * supplier is due — 30 days from receiving it. Null when the supplier is
 * registered (they issue the invoice) or no date is known.
 */
export function selfInvoiceDue(receivedOn: string | Date | null | undefined, supplierGstin: string | null | undefined): Date | null {
  if (supplierGstin && supplierGstin.trim()) return null
  if (!receivedOn) return null
  const d = typeof receivedOn === 'string' ? new Date(`${receivedOn.slice(0, 10)}T00:00:00`) : new Date(receivedOn)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + SELF_INVOICE_DAYS)
}
