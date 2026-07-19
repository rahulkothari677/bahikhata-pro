/**
 * 🔒 V26 PHASE 6 BATCH 3 GUARDRAIL: Experience investments.
 *
 * Phase 6 audit findings covered:
 *   §2.2 — SuccessAnimation had zero consumers; money-success toasts were
 *          identical to settings-change toasts. Fix: differentiate money-success
 *          toasts with amount + party.
 *   §2.3 — Dashboard hierarchy: shop name outranked today's revenue. Fix:
 *          invert the hero — revenue as text-3xl/4xl, shop name demoted.
 *   §6.2 — Party rows lacked Hindi-first balance gloss. Fix: "lene hain" /
 *          "dene hain" under the amount.
 *   §4.2 — Onboarding modal told rather than did. Fix: primary CTA is now
 *          "Record your first sale" → new-sale (activation = first transaction).
 *
 * This test makes those classes fail CI if they regress.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const SRC_ROOT = path.resolve(process.cwd(), 'src')

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf8')
}

describe('V26 Phase 6 Batch 3 — Experience investments', () => {
  // ─── §2.2: Money-success toast differentiation ───────────────────────────

  test('§2.2: TransactionEntry success toast includes amount + party', () => {
    const src = readFile('components/ledger/TransactionEntry.tsx')
    // The toast must include the amount (formatINR or toLocaleString) + party name.
    expect(src).toMatch(/sonnerToast\.success.*recorded/)
    // Must reference amount in the description.
    expect(src).toMatch(/toastDesc.*amount|amount.*toastDesc|₹.*amount/)
    // Must reference party name.
    expect(src).toMatch(/selectedParty.*name|partyName/)
  })

  // ─── §2.3: Dashboard hierarchy inversion ────────────────────────────────

  test('§2.3: Dashboard hero — today\'s revenue is the dominant element, shop name demoted', () => {
    const src = readFile('components/dashboard/Dashboard.tsx')
    // Today's revenue must be at text-3xl or text-4xl (the dominant element).
    expect(src).toMatch(/text-3xl.*lg:text-4xl.*font-bold.*tabular-nums/)
    // Shop name must NOT be at text-2xl/text-3xl font-bold (was the old hierarchy).
    // Look for the hero section — the shop name should be text-sm font-medium.
    expect(src).toMatch(/text-sm font-medium.*shopName|shopName.*text-sm font-medium/)
    // "Today's sales" label must exist above the revenue number.
    expect(src).toMatch(/Today's sales/)
  })

  // ─── §6.2: Balance-first party rows with Hindi gloss ────────────────────

  test('§6.2: Parties row has Hindi-first balance gloss (lene hain / dene hain)', () => {
    const src = readFile('components/parties/Parties.tsx')
    // Must reference the i18n keys for the gloss.
    expect(src).toMatch(/stat\.lene_hain/)
    expect(src).toMatch(/stat\.dene_hain/)
  })

  test('§6.2: i18n has lene_hain / dene_hain keys in en + hi', () => {
    const src = readFile('lib/i18n.ts')
    expect(src).toMatch(/'stat\.lene_hain':\s*'lene hain'/)
    expect(src).toMatch(/'stat\.dene_hain':\s*'dene hain'/)
    expect(src).toMatch(/'stat\.lene_hain':\s*'लेने हैं'/)
    expect(src).toMatch(/'stat\.dene_hain':\s*'देने हैं'/)
  })

  // ─── §4.2: Onboarding activation ────────────────────────────────────────

  test('§4.2: Onboarding primary CTA is "Record your first sale"', () => {
    const src = readFile('components/layout/Onboarding.tsx')
    // Must have a handleFirstSale function.
    expect(src).toMatch(/handleFirstSale/)
    // Must set view to 'new-sale'.
    expect(src).toMatch(/setView\('new-sale'\)/)
    // Must have "Record your first sale" button text.
    expect(src).toMatch(/Record your first sale/)
  })
})
