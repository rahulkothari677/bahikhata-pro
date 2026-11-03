/**
 * A WhatsApp link that opens a chat with the message typed in — the shopkeeper
 * presses send, EkBook never sends anything itself.
 *
 * One rule for the number (it was written inline in the reminder route): digits
 * only, and a 10-digit Indian mobile gets 91 in front. No number opens WhatsApp's
 * contact picker with the message ready.
 */
export function whatsAppUrl(phone: string | null | undefined, text: string): string {
  const message = encodeURIComponent(text)
  let digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length === 10) digits = '91' + digits
  return digits ? `https://wa.me/${digits}?text=${message}` : `https://wa.me/?text=${message}`
}
