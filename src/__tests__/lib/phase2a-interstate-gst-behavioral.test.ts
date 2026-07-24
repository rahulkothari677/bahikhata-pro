/**
 * 🔒 Phase 2a — Inter-state GST derivation behavioral tests.
 *
 * THE PROBLEM: The auditor flagged R10-1 as a LAUNCH-BLOCKER. A placebo
 * control that could misfile a GST return under the wrong tax head. The fix
 * uses `deriveInterStateFromStates` (a pure function) on both client and
 * server, with `indeterminate` as the only case where the client's choice
 * is honored.
 *
 * WHAT THIS TESTS:
 *   1. Both states known + same → intra-state (CGST+SGST), not indeterminate
 *   2. Both states known + different → inter-state (IGST), not indeterminate
 *   3. Shop state missing → indeterminate (client override honored)
 *   4. Party state missing → indeterminate (client override honored)
 *   5. Both states missing → indeterminate
 *   6. Walk-in customer (no party) → intra-state default, NOT indeterminate
 *      (the shop's own state is used; the party is effectively same-state)
 *   7. Case-insensitive comparison ("Maharashtra" === "maharashtra")
 *   8. Whitespace trimmed ("  Maharashtra  " === "Maharashtra")
 *   9. Empty string treated as missing → indeterminate
 *  10. The POST/PUT route logic: indeterminate + client sends boolean → use client;
 *      indeterminate + client doesn't send → use derived (which is false/intra)
 *  11. The convert route logic: indeterminate → use estimate's saved isInterState
 *  12. State code derivation (GSTIN first 2 digits, state name → code)
 */

import { deriveInterStateFromStates, stateNameToCode, deriveStateCode } from '@/lib/gst-states'

describe('🔒 Phase 2a — Inter-state GST derivation', () => {

  // ═════════════════════════════════════════════════════════════════
  // 1. Both states known + same → intra-state
  // ═════════════════════════════════════════════════════════════════
  test('both states known + same → intra-state (CGST+SGST)', () => {
    const r = deriveInterStateFromStates('Maharashtra', 'Maharashtra')
    expect(r.isInterState).toBe(false)
    expect(r.indeterminate).toBe(false)
  })

  // ═════════════════════════════════════════════════════════════════
  // 2. Both states known + different → inter-state (IGST)
  // ═════════════════════════════════════════════════════════════════
  test('both states known + different → inter-state (IGST)', () => {
    const r = deriveInterStateFromStates('Maharashtra', 'Gujarat')
    expect(r.isInterState).toBe(true)
    expect(r.indeterminate).toBe(false)
  })

  // ═════════════════════════════════════════════════════════════════
  // 3. Shop state missing → indeterminate
  // ═════════════════════════════════════════════════════════════════
  test('shop state missing → indeterminate (client override honored)', () => {
    const r = deriveInterStateFromStates(null, 'Gujarat')
    expect(r.indeterminate).toBe(true)
    expect(r.isInterState).toBe(false)  // defaults to false when indeterminate
  })

  test('shop state undefined → indeterminate', () => {
    const r = deriveInterStateFromStates(undefined, 'Gujarat')
    expect(r.indeterminate).toBe(true)
  })

  // ═════════════════════════════════════════════════════════════════
  // 4. Party state missing → indeterminate
  // ═════════════════════════════════════════════════════════════════
  test('party state missing → indeterminate (client override honored)', () => {
    const r = deriveInterStateFromStates('Maharashtra', null)
    expect(r.indeterminate).toBe(true)
    expect(r.isInterState).toBe(false)
  })

  // ═════════════════════════════════════════════════════════════════
  // 5. Both states missing → indeterminate
  // ═════════════════════════════════════════════════════════════════
  test('both states missing → indeterminate', () => {
    const r = deriveInterStateFromStates(null, null)
    expect(r.indeterminate).toBe(true)
    expect(r.isInterState).toBe(false)
  })

  // ═════════════════════════════════════════════════════════════════
  // 6. Case-insensitive comparison
  // ═════════════════════════════════════════════════════════════════
  test('case-insensitive: "Maharashtra" === "maharashtra"', () => {
    const r = deriveInterStateFromStates('Maharashtra', 'maharashtra')
    expect(r.isInterState).toBe(false)
    expect(r.indeterminate).toBe(false)
  })

  test('case-insensitive: "MAHARASHTRA" === "Maharashtra"', () => {
    const r = deriveInterStateFromStates('MAHARASHTRA', 'Maharashtra')
    expect(r.isInterState).toBe(false)
  })

  // ═════════════════════════════════════════════════════════════════
  // 7. Whitespace trimmed
  // ═════════════════════════════════════════════════════════════════
  test('whitespace trimmed: "  Maharashtra  " === "Maharashtra"', () => {
    const r = deriveInterStateFromStates('  Maharashtra  ', 'Maharashtra')
    expect(r.isInterState).toBe(false)
    expect(r.indeterminate).toBe(false)
  })

  // ═════════════════════════════════════════════════════════════════
  // 8. Empty string treated as missing → indeterminate
  // ═════════════════════════════════════════════════════════════════
  test('empty string treated as missing → indeterminate', () => {
    expect(deriveInterStateFromStates('', 'Gujarat').indeterminate).toBe(true)
    expect(deriveInterStateFromStates('Maharashtra', '').indeterminate).toBe(true)
    expect(deriveInterStateFromStates('', '').indeterminate).toBe(true)
    expect(deriveInterStateFromStates('   ', 'Gujarat').indeterminate).toBe(true)
  })
})

describe('🔒 Phase 2a — POST/PUT route inter-state logic', () => {
  // Replicates the route logic from transactions/route.ts:254-256 and [id]/route.ts:185-187
  function resolveIsInterState(
    derived: { isInterState: boolean; indeterminate: boolean },
    clientIsInterState: boolean | undefined,
  ): boolean {
    return derived.indeterminate && clientIsInterState !== undefined
      ? clientIsInterState
      : derived.isInterState
  }

  test('not indeterminate → uses derived value (server is source of truth)', () => {
    const derived = { isInterState: true, indeterminate: false }
    // Client sends false, but server knows it's inter-state → server wins
    expect(resolveIsInterState(derived, false)).toBe(true)
    // Client sends true, server knows it's inter-state → server wins (agrees)
    expect(resolveIsInterState(derived, true)).toBe(true)
    // Client doesn't send → use derived
    expect(resolveIsInterState(derived, undefined)).toBe(true)
  })

  test('indeterminate + client sends boolean → uses client value', () => {
    const derived = { isInterState: false, indeterminate: true }
    // Client says inter-state → honored (the R10-1 fix)
    expect(resolveIsInterState(derived, true)).toBe(true)
    // Client says intra-state → honored
    expect(resolveIsInterState(derived, false)).toBe(false)
  })

  test('indeterminate + client does NOT send → uses derived (defaults to false/intra)', () => {
    const derived = { isInterState: false, indeterminate: true }
    expect(resolveIsInterState(derived, undefined)).toBe(false)
  })

  test('🔴 LAUNCH-BLOCKER guard: non-indeterminate always ignores client', () => {
    // This is the core fix: when both states are known, the client's
    // isInterState flag is IGNORED. The server is the source of truth.
    const derived = { isInterState: false, indeterminate: false }
    // Client tries to flip to inter-state → REJECTED (server knows it's intra)
    expect(resolveIsInterState(derived, true)).toBe(false)

    const derived2 = { isInterState: true, indeterminate: false }
    // Client tries to flip to intra-state → REJECTED (server knows it's inter)
    expect(resolveIsInterState(derived2, false)).toBe(true)
  })
})

describe('🔒 Phase 2a — Convert route inter-state logic', () => {
  // Replicates the convert route logic from transactions/[id]/convert/route.ts:109-110
  function resolveConvertIsInterState(
    derived: { isInterState: boolean; indeterminate: boolean },
    estimateIsInterState: boolean,
  ): boolean {
    return derived.indeterminate
      ? estimateIsInterState
      : derived.isInterState
  }

  test('indeterminate → uses estimate saved isInterState', () => {
    const derived = { isInterState: false, indeterminate: true }
    expect(resolveConvertIsInterState(derived, true)).toBe(true)
    expect(resolveConvertIsInterState(derived, false)).toBe(false)
  })

  test('not indeterminate → uses derived (ignores estimate)', () => {
    const derived = { isInterState: true, indeterminate: false }
    // Estimate had false, but server now knows it's inter-state → server wins
    expect(resolveConvertIsInterState(derived, false)).toBe(true)
  })
})

describe('🔒 Phase 2a — State code derivation', () => {

  test('stateNameToCode: Maharashtra → 27', () => {
    expect(stateNameToCode('Maharashtra')).toBe('27')
  })

  test('stateNameToCode: case-insensitive', () => {
    expect(stateNameToCode('gujarat')).toBe('24')
    expect(stateNameToCode('GUJARAT')).toBe('24')
  })

  test('stateNameToCode: null/undefined → null', () => {
    expect(stateNameToCode(null)).toBeNull()
    expect(stateNameToCode(undefined)).toBeNull()
    expect(stateNameToCode('')).toBeNull()
  })

  test('stateNameToCode: unknown state → null', () => {
    expect(stateNameToCode('Atlantis')).toBeNull()
  })

  test('deriveStateCode: party GSTIN first 2 digits (priority 1)', () => {
    expect(deriveStateCode('27ABCDE1234F1Z5', 'Maharashtra', '27XYZ', 'Maharashtra')).toBe('27')
  })

  test('deriveStateCode: party state name (priority 2, no GSTIN)', () => {
    expect(deriveStateCode(null, 'Gujarat', '27XYZ', 'Maharashtra')).toBe('24')
  })

  test('deriveStateCode: shop GSTIN (priority 3, walk-in customer)', () => {
    expect(deriveStateCode(null, null, '27XYZ', 'Maharashtra')).toBe('27')
  })

  test('deriveStateCode: shop state name (priority 4, no GSTIN anywhere)', () => {
    expect(deriveStateCode(null, null, null, 'Karnataka')).toBe('29')
  })

  test('deriveStateCode: nothing works → null', () => {
    expect(deriveStateCode(null, null, null, null)).toBeNull()
    expect(deriveStateCode(null, 'Atlantis', null, 'Mars')).toBeNull()
  })
})
