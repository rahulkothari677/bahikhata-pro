/**
 * Finding a customer or supplier by what the shopkeeper types — name or phone.
 * Client-safe (no database import), so the bill screen and the server share
 * one idea of what a phone number is.
 *
 * Phase 6c-2 (final design plan §5: "Type a 10-digit phone number to pick the
 * customer, or add a new one in the same step"). The bill's customer search
 * compared the typed text with the stored phone character by character, so
 * "98290 11223" never found 9829011223, and "+91 98290…" never found anyone.
 */
import { isValidPhone } from './utils'

/**
 * Digits only, so "98765 43210", "+91 98765 43210" and "9876543210" are
 * recognised as one number. Compares the last 10 digits: an Indian mobile is
 * 10 digits, and the same phone is routinely stored with and without +91.
 */
export function normalizePartyPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  if (!digits) return null
  return digits.length > 10 ? digits.slice(-10) : digits
}

/** Does this party match what was typed? Name contains the text, or the phone contains its digits (4 or more). */
export function partyMatchesSearch(p: { name?: string | null; phone?: string | null }, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  if ((p.name || '').toLowerCase().includes(q.toLowerCase())) return true
  const digits = q.replace(/\D/g, '')
  if (digits.length >= 4 && /^[\d\s+()-]+$/.test(q)) {
    const phone = normalizePartyPhone(p.phone)
    return !!phone && phone.includes(digits.length > 10 ? digits.slice(-10) : digits)
  }
  return false
}

/**
 * What "Add new" should start with, from the text that found nobody: a valid
 * Indian mobile goes into Phone (formatted 98290 11223), anything else into Name.
 */
export function partyPrefillFromSearch(query: string): { name: string; phone: string } {
  const q = query.trim()
  const phone = normalizePartyPhone(q)
  if (phone && /^[\d\s+()-]+$/.test(q) && isValidPhone(phone)) {
    return { name: '', phone: `${phone.slice(0, 5)} ${phone.slice(5)}` }
  }
  return { name: q, phone: '' }
}
