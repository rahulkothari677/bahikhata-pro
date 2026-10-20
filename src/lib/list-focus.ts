/**
 * A list opened FROM an Insights group (Phase 5e-4b, ledger model v4: "a group
 * opens Items or Khata with that group selected", shown as an extra chip with
 * ✕). One vocabulary for the screen and both list routes:
 *
 *   Items  abc:a · abc:b · abc:c · abc:none   (Insights' ABC grades, over its period)
 *          unsold                             (in stock, not sold in the period)
 *   Khata  group:new · group:regular · group:occasional · group:quiet · group:inactive
 *          age:d15 · age:d30 · age:d60 · age:over · age:opening   (as of today)
 *
 * The SERVER works out who is in the group with Insights' own rules
 * (lib/insights.ts, lib/insights-queries.ts) — never a list of ids from the
 * phone, so a group of 5,000 items costs one short parameter.
 */
import { AGE_BANDS, CUSTOMER_GROUPS, type AgeBand, type CustomerGroup } from './insights'

export const ABC_IDS = ['a', 'b', 'c', 'none'] as const
export type AbcId = (typeof ABC_IDS)[number]

export type ItemsFocus = { kind: 'abc'; id: AbcId } | { kind: 'unsold' }
export type KhataFocus = { kind: 'group'; id: CustomerGroup } | { kind: 'age'; id: AgeBand }

/** Parse an Items focus; anything unknown is no focus (never a guess). */
export function parseItemsFocus(raw: string | null | undefined): ItemsFocus | null {
  if (raw === 'unsold') return { kind: 'unsold' }
  const m = /^abc:(\w+)$/.exec(raw ?? '')
  return m && (ABC_IDS as readonly string[]).includes(m[1]) ? { kind: 'abc', id: m[1] as AbcId } : null
}

export function parseKhataFocus(raw: string | null | undefined): KhataFocus | null {
  const m = /^(group|age):(\w+)$/.exec(raw ?? '')
  if (!m) return null
  if (m[1] === 'group') return (CUSTOMER_GROUPS as readonly string[]).includes(m[2]) ? { kind: 'group', id: m[2] as CustomerGroup } : null
  return (AGE_BANDS as readonly string[]).includes(m[2]) ? { kind: 'age', id: m[2] as AgeBand } : null
}

export function focusParam(f: ItemsFocus | KhataFocus): string {
  return f.kind === 'unsold' ? 'unsold' : `${f.kind}:${f.id}`
}

/** What Insights hands a list: the focus, the period it was counted over, and the chip's words. */
export interface ListFocus {
  screen: 'items' | 'khata'
  /** A focus the server narrows by, or one of the list's own chips to select. */
  focus: string
  /** ISO instants of Insights' period (ABC, unsold, customer groups); none for "as of today". */
  from?: string
  to?: string
  label: string
}
