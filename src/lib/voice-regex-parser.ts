/**
 * Local regex parser for simple voice entries.
 *
 * Catches the ~20% of voice commands that are so simple they don't need an LLM.
 * Saves ~₹0.01 per matched entry (Gemini 2.5 Flash cost) + ~500ms latency.
 *
 * Supported patterns (Hindi + English + Hinglish):
 *   1. "cash 500" / "nagad 500" / "500 cash"
 *   2. "upi 1000" / "1000 upi"
 *   3. "ram ko 500 diya" / "500 ram ko diya"
 *   4. "shyam se 1000 liya" / "1000 shyam se received"
 *   5. "credit 200" / "udhaar 200" / "baad mein 200"
 *
 * If the regex matches, returns a parsed transaction WITHOUT calling the LLM.
 * If it doesn't match, the caller falls back to the LLM.
 */

export interface ParsedTransaction {
  type: 'sale' | 'purchase'
  partyName: string | null
  items: Array<{
    name: string
    quantity: number
    unit: string
    unitPrice: number
  }>
  paymentMode: 'cash' | 'upi' | 'card' | 'bank' | 'credit'
  totalAmount: number
  _source: 'regex' | 'llm'  // for analytics — track how often regex hits
}

/**
 * Hindi number word → digit conversion.
 * Covers the most common ones shopkeepers use in voice commands.
 */
const HINDI_NUMBERS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, paanch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10,
  gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16,
  bees: 20, tees: 30, chalis: 40, pachaas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
  sau: 100, pachas: 50,
  // Common variants
  pachees: 25,hatta: 26, // less common but used
  so: 100, // "so" sometimes means 100 in Hinglish
}

/**
 * Converts a number word (Hindi or English) to a digit.
 * Returns null if not a recognized number word.
 */
function parseHindiNumber(word: string): number | null {
  const lower = word.toLowerCase().trim()
  if (HINDI_NUMBERS[lower] !== undefined) return HINDI_NUMBERS[lower]
  return null
}

/**
 * Extracts all numbers from a string, handling Hindi number words too.
 * Examples:
 *   "500" → [500]
 *   "pachas" → [50]
 *   "2 kg sugar 50 rupaye" → [2, 50]
 *   "ram ko sau diya" → [100]
 */
function extractNumbers(text: string): number[] {
  const numbers: number[] = []
  const words = text.toLowerCase().split(/\s+/)

  for (const word of words) {
    // Try digit first
    const digit = parseInt(word.replace(/[^\d]/g, ''), 10)
    if (!isNaN(digit) && digit > 0) {
      numbers.push(digit)
      continue
    }
    // Try Hindi number word
    const hindi = parseHindiNumber(word)
    if (hindi !== null) {
      numbers.push(hindi)
    }
  }

  return numbers
}

/**
 * Detects payment mode from the transcript.
 * Returns null if no payment mode is mentioned.
 */
function detectPaymentMode(text: string): 'cash' | 'upi' | 'card' | 'bank' | 'credit' | null {
  const lower = text.toLowerCase()
  if (/\b(udhaar|udhar|credit|baad\s+mein|baad\s+me|later)\b/.test(lower)) return 'credit'
  if (/\b(upi|qr|phonepe|gpay|paytm|google\s*pay|bhim)\b/.test(lower)) return 'upi'
  if (/\b(card|debit|credit\s*card)\b/.test(lower)) return 'card'
  if (/\b(bank|neft|rtgs|imps|transfer)\b/.test(lower)) return 'bank'
  if (/\b(cash|nagad|rokkad)\b/.test(lower)) return 'cash'
  return null
}

/**
 * Detects transaction type (sale vs purchase).
 * Defaults to 'sale' unless purchase keywords are present.
 */
function detectType(text: string): 'sale' | 'purchase' {
  const lower = text.toLowerCase()
  if (/\b(bought|buy|khareeda|khareed|purchase|kharidi|manga|liya\s+from|received\s+from\s+supplier)\b/.test(lower)) {
    return 'purchase'
  }
  return 'sale'
}

/**
 * Extracts a person's name from the transcript.
 * Looks for patterns like "ram ko", "ramesh ne", "seeta se", "to ramesh", "from shyam".
 */
function extractPartyName(text: string): string | null {
  const lower = text.toLowerCase()

  // "ram ko" / "ram ne" / "ram se" (Hindi)
  const hindiMatch = lower.match(/(?:^|\s)([a-z]{2,15})\s+(?:ko|ne|se|ke|ka)\b/)
  if (hindiMatch) {
    const name = hindiMatch[1]
    // Filter out common non-name words
    if (!['ko', 'ne', 'se', 'ke', 'ka', 'aur', 'ya', 'ek', 'do', 'teen', 'char', 'paanch'].includes(name)) {
      return name.charAt(0).toUpperCase() + name.slice(1)
    }
  }

  // "to ramesh" / "from shyam" (English)
  const engMatch = lower.match(/(?:to|from|by)\s+([a-z]{2,15})/)
  if (engMatch) {
    const name = engMatch[1]
    if (!['the', 'a', 'an', 'me', 'him', 'her', 'us', 'them'].includes(name)) {
      return name.charAt(0).toUpperCase() + name.slice(1)
    }
  }

  return null
}

/**
 * Main entry point — tries to parse the transcript locally with regex.
 * Returns a ParsedTransaction if successful, null if the LLM is needed.
 *
 * We only match SIMPLE entries — single amount, no itemized products.
 * Complex entries like "2 kg sugar and 3 oil for 500" still go to the LLM.
 */
export function tryParseLocally(transcript: string): ParsedTransaction | null {
  const text = transcript.trim()
  if (!text || text.length < 3) return null

  // Extract all numbers from the transcript
  const numbers = extractNumbers(text)

  // We only handle entries with exactly ONE number (the amount).
  // If there are 2+ numbers, it's probably an itemized entry → needs LLM.
  if (numbers.length !== 1) return null

  const amount = numbers[0]

  // Reject obviously wrong amounts (< ₹1 or > ₹10,00,000)
  if (amount < 1 || amount > 1000000) return null

  // Detect type, payment mode, party name
  const type = detectType(text)
  const paymentMode = detectPaymentMode(text) ?? (type === 'sale' ? 'cash' : 'credit')
  const partyName = extractPartyName(text)

  // Build a generic "amount only" transaction. No items since we couldn't parse them.
  // The user can add items manually in the UI after applying.
  const result: ParsedTransaction = {
    type,
    partyName,
    items: [{
      name: type === 'sale' ? 'Sale' : 'Purchase',
      quantity: 1,
      unit: 'pcs',
      unitPrice: amount,
    }],
    paymentMode,
    totalAmount: amount,
    _source: 'regex',
  }

  // Sanity check: only return if we found at least an amount AND a payment mode or party name.
  // This prevents matching random sentences that happen to contain a number.
  if (!partyName && paymentMode === 'cash' && !/\b(cash|nagad|rokkad|rupaye|rs|₹|rupee)\b/i.test(text)) {
    // No party name, default payment mode, and no explicit money keyword → probably not a transaction
    return null
  }

  return result
}
