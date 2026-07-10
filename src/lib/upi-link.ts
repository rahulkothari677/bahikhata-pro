/**
 * V17-Ext §5.4: UPI deep-link generator for udhaar collection.
 *
 * Generates `upi://pay?...` deep-links that open the customer's UPI app
 * (PhonePe, Google Pay, Paytm, BHIM, etc.) with the payment amount
 * pre-filled. When the customer taps the link in WhatsApp, their UPI app
 * opens and they can pay with one tap.
 *
 * UPI deep-link spec (NPCI):
 *   upi://pay?pa=<VPA>&pn=<payee-name>&am=<amount>&tn=<note>&cu=INR
 *
 * Parameters:
 *   pa = Payee Address (VPA, e.g. shop@paytm)
 *   pn = Payee Name (shop name, shown in the UPI app)
 *   am = Amount (e.g. 1500.00)
 *   tn = Transaction Note (shown in the UPI app's payment screen)
 *   cu = Currency (always INR)
 *
 * All values are URL-encoded. The amount is formatted to 2 decimal places.
 *
 * The shopkeeper's VPA is stored on Setting.upiId. If not set, the reminder
 * sends without a pay link (the customer is asked to pay in person).
 */

/**
 * Validate a UPI VPA (Virtual Payment Address).
 * Format: name@bank (e.g. shop@paytm, 9876543210@ybl, john@oksbi)
 * - Must contain exactly one @
 * - Left part: alphanumeric + dots + hyphens + underscores
 * - Right part: alphanumeric (2-10 chars)
 */
export function isValidUpiId(vpa: string): boolean {
  if (!vpa || typeof vpa !== 'string') return false
  const trimmed = vpa.trim()
  if (!trimmed.includes('@')) return false
  const [left, right, ...rest] = trimmed.split('@')
  if (!left || !right || rest.length > 0) return false // exactly one @
  if (left.length === 0 || left.length > 100) return false
  if (right.length < 2 || right.length > 10) return false
  if (!/^[a-zA-Z0-9.\-_]+$/.test(left)) return false
  if (!/^[a-zA-Z0-9]+$/.test(right)) return false
  return true
}

/**
 * Generate a UPI deep-link for payment collection.
 *
 * @param vpa       - Shopkeeper's UPI VPA (e.g. 'shop@paytm')
 * @param payeeName - Shop name (shown in the UPI app)
 * @param amount    - Amount to collect (e.g. 1500.00)
 * @param note      - Optional transaction note (e.g. 'Payment for INV-0001')
 * @returns The `upi://pay?...` URL, or null if the VPA is invalid.
 */
export function generateUpiLink(
  vpa: string,
  payeeName: string,
  amount: number,
  note?: string,
): string | null {
  if (!isValidUpiId(vpa)) return null

  const params = new URLSearchParams()
  params.set('pa', vpa.trim())
  params.set('pn', (payeeName || 'Shop').slice(0, 99)) // NPCI limit: 99 chars
  params.set('am', amount.toFixed(2))
  params.set('cu', 'INR')
  if (note) {
    // Transaction note — keep it short (NPCI limit: ~50 chars in practice)
    params.set('tn', note.slice(0, 50))
  }

  return `upi://pay?${params.toString()}`
}

/**
 * Generate a human-readable payment instruction line for WhatsApp messages.
 * If a UPI link is available, includes both the link and the amount.
 * If not, just includes the amount with a request to pay.
 *
 * Example with UPI:
 *   "💰 Pay ₹1,500.00 via UPI: upi://pay?pa=shop@paytm&am=1500.00&..."
 *
 * Example without UPI:
 *   "💰 Amount due: ₹1,500.00"
 */
export function formatPaymentLine(
  amount: number,
  upiLink: string | null,
): string {
  const formatted = amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  if (upiLink) {
    return `Tap to pay via UPI: ${upiLink}`
  }
  return `Amount due: Rs. ${formatted}`
}
