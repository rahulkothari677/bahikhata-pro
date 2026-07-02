/**
 * Unit tests for the local voice regex parser.
 *
 * These tests verify that simple voice entries (cash/upi/credit with single
 * amounts) are parsed correctly WITHOUT calling the LLM.
 *
 * The goal: ~20% of voice entries should hit the regex and save LLM cost.
 * If these tests break, we'd silently fall back to the LLM for everything,
 * losing the cost optimization.
 */

import { tryParseLocally } from '@/lib/voice-regex-parser'

describe('tryParseLocally — simple cash entries', () => {
  test('parses "cash 500" as a sale with cash payment', () => {
    const result = tryParseLocally('cash 500')
    expect(result).not.toBeNull()
    expect(result!.type).toBe('sale')
    expect(result!.paymentMode).toBe('cash')
    expect(result!.totalAmount).toBe(500)
    expect(result!._source).toBe('regex')
  })

  test('parses "500 cash" (amount before mode)', () => {
    const result = tryParseLocally('500 cash')
    expect(result).not.toBeNull()
    expect(result!.totalAmount).toBe(500)
    expect(result!.paymentMode).toBe('cash')
  })

  test('parses "nagad 1000" (Hindi for cash)', () => {
    const result = tryParseLocally('nagad 1000')
    expect(result).not.toBeNull()
    expect(result!.paymentMode).toBe('cash')
    expect(result!.totalAmount).toBe(1000)
  })
})

describe('tryParseLocally — UPI entries', () => {
  test('parses "upi 1500" as UPI payment', () => {
    const result = tryParseLocally('upi 1500')
    expect(result).not.toBeNull()
    expect(result!.paymentMode).toBe('upi')
    expect(result!.totalAmount).toBe(1500)
  })

  test('parses "phonepe 200" as UPI', () => {
    const result = tryParseLocally('phonepe 200')
    expect(result).not.toBeNull()
    expect(result!.paymentMode).toBe('upi')
  })

  test('parses "gpay 3000" as UPI', () => {
    const result = tryParseLocally('gpay 3000')
    expect(result).not.toBeNull()
    expect(result!.paymentMode).toBe('upi')
  })
})

describe('tryParseLocally — credit/udhaar entries', () => {
  test('parses "udhaar 500" as credit', () => {
    const result = tryParseLocally('udhaar 500')
    expect(result).not.toBeNull()
    expect(result!.paymentMode).toBe('credit')
    expect(result!.totalAmount).toBe(500)
  })

  test('parses "baad mein 1000" as credit', () => {
    const result = tryParseLocally('baad mein 1000')
    expect(result).not.toBeNull()
    expect(result!.paymentMode).toBe('credit')
  })
})

describe('tryParseLocally — party name extraction', () => {
  test('parses "ram ko 500 diya" with party name Ram', () => {
    const result = tryParseLocally('ram ko 500 diya')
    expect(result).not.toBeNull()
    expect(result!.partyName).toBe('Ram')
    expect(result!.totalAmount).toBe(500)
  })

  test('parses "ramesh ne 1000 liya" with party name Ramesh', () => {
    const result = tryParseLocally('ramesh ne 1000 liya')
    expect(result).not.toBeNull()
    expect(result!.partyName).toBe('Ramesh')
  })

  test('parses "to shyam 200 cash" with party name Shyam', () => {
    const result = tryParseLocally('to shyam 200 cash')
    expect(result).not.toBeNull()
    expect(result!.partyName).toBe('Shyam')
  })
})

describe('tryParseLocally — Hindi number words', () => {
  test('parses "sau rupaye cash" as 100 cash', () => {
    const result = tryParseLocally('sau rupaye cash')
    expect(result).not.toBeNull()
    expect(result!.totalAmount).toBe(100)
    expect(result!.paymentMode).toBe('cash')
  })

  test('parses "pachaas upi" as 50 UPI', () => {
    const result = tryParseLocally('pachaas upi')
    expect(result).not.toBeNull()
    expect(result!.totalAmount).toBe(50)
  })
})

describe('tryParseLocally — should NOT match (falls back to LLM)', () => {
  test('returns null for itemized entries with 2+ numbers', () => {
    // "2 kg sugar 50" has two numbers — needs LLM to parse items
    const result = tryParseLocally('2 kg sugar 50 rupaye')
    expect(result).toBeNull()
  })

  test('returns null for complex multi-item entries', () => {
    const result = tryParseLocally('2 oil and 3 sugar total 500 cash')
    expect(result).toBeNull()
  })

  test('returns null for empty string', () => {
    const result = tryParseLocally('')
    expect(result).toBeNull()
  })

  test('returns null for very short input', () => {
    const result = tryParseLocally('hi')
    expect(result).toBeNull()
  })

  test('returns null for random sentence with a number but no transaction context', () => {
    // "I have 2 dogs" — has a number but no payment/party keywords
    const result = tryParseLocally('I have 2 dogs')
    expect(result).toBeNull()
  })

  test('returns null for absurdly large amounts', () => {
    const result = tryParseLocally('cash 10000000')
    expect(result).toBeNull()
  })
})

describe('tryParseLocally — transaction type detection', () => {
  test('defaults to sale', () => {
    const result = tryParseLocally('cash 500')
    expect(result!.type).toBe('sale')
  })

  test('detects purchase when "bought" keyword present', () => {
    const result = tryParseLocally('bought for 500 cash')
    expect(result!.type).toBe('purchase')
  })

  test('detects purchase when "khareeda" keyword present', () => {
    const result = tryParseLocally('khareeda 1000 upi')
    expect(result!.type).toBe('purchase')
  })
})
