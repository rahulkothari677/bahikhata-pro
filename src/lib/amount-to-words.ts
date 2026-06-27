/**
 * Convert a number to Indian-English words.
 * Used on invoices for "Amount in words" — required by GST invoice rules.
 *
 * Example: 125475.50 → "One Lakh Twenty-Five Thousand Four Hundred Seventy-Five Rupees and Fifty Paise Only"
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
]

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
]

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10)
  const o = n % 10
  return TENS[t] + (o ? '-' + ONES[o] : '')
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  let out = ''
  if (h > 0) out += ONES[h] + ' Hundred'
  if (r > 0) out += (out ? ' ' : '') + twoDigits(r)
  return out
}

/**
 * Convert the integer part of an amount using the Indian numbering system
 * (crore, lakh, thousand, hundred).
 */
function integerToWords(num: number): string {
  if (num === 0) return 'Zero'

  const crore = Math.floor(num / 1_00_00_000)
  num %= 1_00_00_000
  const lakh = Math.floor(num / 1_00_000)
  num %= 1_00_000
  const thousand = Math.floor(num / 1000)
  num %= 1000
  const rest = num

  const parts: string[] = []
  if (crore > 0) parts.push(twoDigits(crore) + ' Crore')
  if (lakh > 0) parts.push(twoDigits(lakh) + ' Lakh')
  if (thousand > 0) parts.push(twoDigits(thousand) + ' Thousand')
  if (rest > 0) parts.push(threeDigits(rest))

  return parts.join(' ').trim()
}

/**
 * Full amount in words with "Rupees" and "Paise" suffix.
 * Returns the GST-compliant format used on Indian invoices.
 */
export function amountToWords(amount: number): string {
  if (!isFinite(amount) || isNaN(amount)) return 'Zero Rupees Only'
  const rounded = Math.round(amount * 100) / 100
  const rupees = Math.floor(rounded)
  const paise = Math.round((rounded - rupees) * 100)

  let result = ''
  if (rupees > 0) {
    result += integerToWords(rupees) + ' Rupees'
  }
  if (paise > 0) {
    result += (result ? ' and ' : '') + integerToWords(paise) + ' Paise'
  }
  if (!result) result = 'Zero Rupees'
  return result + ' Only'
}
