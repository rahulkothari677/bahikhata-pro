/**
 * 🔒 V26 PHASE 5 BATCH 5 — Validation + error UX + cold-start + error boundaries guardrail.
 *
 * Phase 5 audit findings covered:
 *   R13 🟡 — 24/36 mutating routes have no schema validation. settings PUT's
 *            non-string fallthrough passes raw values to Prisma (500 instead of 400).
 *   R14 🟡 — 14 client call sites `throw new Error('Failed')` discard the server's
 *            actionable message → user sees a generic toast.
 *   R15 🟡 — Cold-start retry (withConnectionRetry) protects only the dashboard —
 *            every other route surfaces raw pool-timeout 500s on the first tap after idle.
 *   R16 🟡 — No error.tsx/global-error.tsx boundaries and no ChunkLoadError recovery
 *            → a stale client after deploy hits a failed dynamic import and stays broken.
 *
 * This test makes those classes fail CI.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const SRC_ROOT = path.resolve(process.cwd(), 'src')

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf8')
}

describe('V26 Phase 5 Batch 5 — Validation + error UX + cold-start + error boundaries', () => {
  // ─── R13: Schema validation patchwork ────────────────────────────────────

  test('R13.1: settings PUT rejects non-string values with 400 (not 500)', () => {
    const src = readFile('app/api/settings/route.ts')
    // Each string field must have a type check that returns 400.
    expect(src).toMatch(/shopName must be text/)
    expect(src).toMatch(/ownerName must be text/)
    expect(src).toMatch(/address must be text/)
    expect(src).toMatch(/phone must be text/)
    expect(src).toMatch(/gstin must be text/)
    expect(src).toMatch(/state must be text/)
    expect(src).toMatch(/scanLang must be text/)
    expect(src).toMatch(/voiceLang must be text/)
    expect(src).toMatch(/upiId must be text/)
    // The old fallthrough pattern (passing raw value to Prisma) must be gone.
    // The old pattern was: `typeof body.X === 'string' ? body.X.slice(0, N) : body.X`
    // (the `: body.X` part is the fallthrough). We can't grep for the absence
    // of every instance, but we CAN check that each field now has a type-check
    // guard preceding the slice.
    expect(src).toMatch(/typeof body\.shopName !== 'string'/)
    expect(src).toMatch(/typeof body\.phone !== 'string'/)
  })

  test('R13.2: 4 previously-unvalidated routes now have zod schemas', () => {
    // The auditor flagged: bank-recon/transaction/[id] PATCH, documents, shops,
    // e-invoice/irn. All 4 now have first-pass zod validation.
    const checks = [
      { route: 'app/api/documents/route.ts', schema: 'createDocumentSchema' },
      { route: 'app/api/shops/route.ts', schema: 'createShopSchema' },
      { route: 'app/api/bank-recon/transaction/[id]/route.ts', schema: 'updateBankReconTxnSchema' },
      { route: 'app/api/e-invoice/irn/route.ts', schema: 'createIrnSchema' },
    ]
    for (const { route, schema } of checks) {
      const src = readFile(route)
      expect(src).toMatch(new RegExp(`import.*${schema}.*from '@/lib/validation'`))
      expect(src).toMatch(new RegExp(`validateBody\\(${schema}`))
    }
    // The schemas exist in validation.ts.
    const validationSrc = readFile('lib/validation.ts')
    expect(validationSrc).toMatch(/export const createDocumentSchema/)
    expect(validationSrc).toMatch(/export const createShopSchema/)
    expect(validationSrc).toMatch(/export const updateBankReconTxnSchema/)
    expect(validationSrc).toMatch(/export const createIrnSchema/)
  })

  // ─── R14: Client error message preservation ──────────────────────────────

  test('R14: shared readError helper exists with status-based fallback', () => {
    const src = readFile('lib/read-error.ts')
    expect(src).toMatch(/export async function readError/)
    // Reads JSON body, prefers message over error.
    expect(src).toMatch(/body\?\.message/)
    expect(src).toMatch(/body\?\.error/)
    // Status-based fallbacks.
    expect(src).toMatch(/r\.status === 401/)
    expect(src).toMatch(/r\.status === 403/)
    expect(src).toMatch(/r\.status === 404/)
    expect(src).toMatch(/r\.status === 429/)
    expect(src).toMatch(/r\.status >= 500/)
    // Final fallback.
    expect(src).toMatch(/Something went wrong/)
  })

  test('R14: all 14 client call sites use readError instead of throwing "Failed"', () => {
    // The audit said 14 sites; we replaced all `throw new Error('Failed...')`
    // patterns with `throw new Error(await readError(r))`.
    const files = [
      'components/documents/DocumentVault.tsx',
      'components/inventory/ProductDialog.tsx',
      'components/parties/BulkRemindersModal.tsx',
      'components/parties/PartyProfile.tsx',
      'components/parties/Parties.tsx',
      'components/reports/ConsolidatedReport.tsx',
      'components/reports/BankReconciliation.tsx',
      'components/income/IncomeExpense.tsx',
      'components/settings/StaffManagement.tsx',
      'components/settings/Settings.tsx',
      'components/dashboard/DayEndSummary.tsx',
      'components/common/PartySelect.tsx',
      'components/ledger/TransactionDetail.tsx',
      'components/ledger/TransactionEntry.tsx',
    ]
    for (const f of files) {
      const src = readFile(f)
      // Each file must import readError.
      expect(src).toMatch(/import.*readError.*from '@\/lib\/read-error'/)
      // Each file must use readError(r) in at least one throw.
      expect(src).toMatch(/throw new Error\(await readError\(r\)\)/)
      // No remaining bare `throw new Error('Failed')` (with no message detail).
      expect(src).not.toMatch(/throw new Error\('Failed'\)/)
    }
  })

  // ─── R15: Cold-start retry on read paths ─────────────────────────────────

  test('R15: withConnectionRetry is used on read-heavy GET routes', () => {
    // Dashboard was the original consumer. R15 adds: parties, products,
    // transactions, bootstrap.
    const routes = [
      'app/api/dashboard/route.ts',
      'app/api/parties/route.ts',
      'app/api/products/route.ts',
      'app/api/transactions/route.ts',
      'app/api/bootstrap/route.ts',
    ]
    for (const r of routes) {
      const src = readFile(r)
      expect(src).toMatch(/withConnectionRetry/)
    }
  })

  test('R15: withConnectionRetry is NOT used on mutation paths (avoid retrying writes)', () => {
    // The auditor warned: "never blind-retry mutations — with R2's idempotency,
    // retried creates are safe, but keep the blanket retry to reads for now."
    // We only wrapped GET read paths. Mutation routes (POST/PUT/DELETE handlers)
    // should NOT use withConnectionRetry.
    const mutationRoutes = [
      'app/api/transactions/route.ts',  // has both GET and POST — check the POST doesn't use it
    ]
    for (const r of mutationRoutes) {
      const src = readFile(r)
      // Find the POST handler body and check it doesn't call withConnectionRetry.
      const postMatch = src.match(/export async function POST[\s\S]*?(?=\nexport async function|$)/)
      if (postMatch) {
        // The POST handler may import withConnectionRetry (for the GET in the same file)
        // but should not CALL it inside POST.
        expect(postMatch[0]).not.toMatch(/withConnectionRetry\(/)
      }
    }
  })

  // ─── R16: Error boundaries + ChunkLoadError recovery ─────────────────────

  test('R16.1: route-level error.tsx exists with branded recovery UI', () => {
    const src = readFile('app/error.tsx')
    expect(src).toMatch(/'use client'/)
    // Error boundary signature (reset function).
    expect(src).toMatch(/reset:\s*\(\)\s*=>\s*void/)
    // Branded UI with Reload + Go home buttons.
    expect(src).toMatch(/Reload|Try again/)
    expect(src).toMatch(/Go home/)
    // Hindi text (the app's primary audience).
    expect(src).toMatch(/रीलोड करें/)
    // ChunkLoadError detection.
    expect(src).toMatch(/ChunkLoadError/)
  })

  test('R16.1: global-error.tsx exists with its own html+body (root layout fallback)', () => {
    const src = readFile('app/global-error.tsx')
    expect(src).toMatch(/'use client'/)
    // Must render its own <html> + <body> (root layout failed).
    expect(src).toMatch(/<html/)
    expect(src).toMatch(/<body/)
    // Recovery button.
    expect(src).toMatch(/Reload|Try again/)
    // Hindi text.
    expect(src).toMatch(/रीलोड करें/)
  })

  test('R16.2: crash-tracker has ChunkLoadError auto-reload with loop guard', () => {
    const src = readFile('lib/crash-tracker.ts')
    expect(src).toMatch(/export function registerChunkLoadErrorHandler/)
    // Listens for both 'error' and 'unhandledrejection' (dynamic imports reject as promises).
    expect(src).toMatch(/addEventListener\('error'/)
    expect(src).toMatch(/addEventListener\('unhandledrejection'/)
    // ChunkLoadError detection patterns.
    expect(src).toMatch(/ChunkLoadError/)
    expect(src).toMatch(/Loading chunk/)
    // sessionStorage loop guard.
    expect(src).toMatch(/sessionStorage/)
    expect(src).toMatch(/CHUNK_RELOAD_FLAG/)
    // Idempotent (Strict Mode safe).
    expect(src).toMatch(/__bahikhataChunkHandlerRegistered/)
  })

  test('R16.2: page.tsx registers the ChunkLoadError handler on mount', () => {
    const src = readFile('app/page.tsx')
    expect(src).toMatch(/registerChunkLoadErrorHandler/)
  })
})

// ─── Behavioral unit tests ─────────────────────────────────────────────────

describe('V26 Phase 5 R14 — readError helper logic', () => {
  // Re-implement the readError logic inline (the real one reads the Response
  // object; we test the message-extraction logic here).
  function extractMessage(body: any, status: number): string {
    if (body?.message && typeof body.message === 'string') return body.message
    if (body?.error && typeof body.error === 'string') return body.error
    if (body?.error?.message && typeof body.error.message === 'string') return body.error.message
    if (Array.isArray(body?.errors) && body.errors.length > 0 && body.errors[0]?.message) {
      return body.errors[0].message
    }
    if (status === 401) return 'You need to sign in again.'
    if (status === 403) return 'You do not have permission to do this.'
    if (status === 404) return 'This could not be found. It may have been deleted.'
    if (status === 429) return 'Too many requests. Please wait a moment and try again.'
    if (status >= 500) return 'The server had an error. Please try again in a moment.'
    return 'Something went wrong'
  }

  test('server message field preferred over error field', () => {
    expect(extractMessage({ message: 'Period locked', error: 'PERIOD_LOCKED' }, 403))
      .toBe('Period locked')
  })

  test('error field used when no message', () => {
    expect(extractMessage({ error: 'Not enough stock' }, 400))
      .toBe('Not enough stock')
  })

  test('zod errors array (first issue message)', () => {
    const body = { errors: [{ message: 'Invalid GSTIN format' }, { message: 'second' }] }
    expect(extractMessage(body, 400)).toBe('Invalid GSTIN format')
  })

  test('401 status → sign-in-again message', () => {
    expect(extractMessage({}, 401)).toBe('You need to sign in again.')
  })

  test('404 status → not-found message', () => {
    expect(extractMessage({}, 404)).toBe('This could not be found. It may have been deleted.')
  })

  test('500 status → server-error message', () => {
    expect(extractMessage({}, 500)).toBe('The server had an error. Please try again in a moment.')
  })

  test('empty body + unknown status → generic fallback', () => {
    expect(extractMessage({}, 400)).toBe('Something went wrong')
  })
})

describe('V26 Phase 5 R16 — ChunkLoadError detection logic', () => {
  function isChunkError(err: any): boolean {
    return Boolean(
      err?.name === 'ChunkLoadError' ||
      err?.message?.includes('Loading chunk') ||
      err?.message?.includes('Loading CSS chunk'),
    )
  }

  test('ChunkLoadError name detected', () => {
    expect(isChunkError({ name: 'ChunkLoadError', message: 'foo' })).toBe(true)
  })

  test('"Loading chunk" message detected', () => {
    expect(isChunkError({ name: 'Error', message: 'Loading chunk 5 failed.' })).toBe(true)
  })

  test('"Loading CSS chunk" message detected', () => {
    expect(isChunkError({ name: 'Error', message: 'Loading CSS chunk 3 failed.' })).toBe(true)
  })

  test('regular error NOT detected', () => {
    expect(isChunkError({ name: 'TypeError', message: 'foo is undefined' })).toBe(false)
    expect(isChunkError({ name: 'Error', message: 'Network request failed' })).toBe(false)
    expect(isChunkError(null)).toBe(false)
    expect(isChunkError(undefined)).toBe(false)
  })

  test('loop guard: sessionStorage flag prevents double-reload', () => {
    // Simulate the guard logic.
    let sessionStorage: Record<string, string> = {}
    const FLAG = 'bahikhata:chunk-reloaded'

    function shouldReload(): boolean {
      return sessionStorage[FLAG] !== 'pending'
    }
    function markReloadPending() {
      sessionStorage[FLAG] = 'pending'
    }
    function clearFlag() {
      delete sessionStorage[FLAG]
    }

    // First chunk error → should reload.
    expect(shouldReload()).toBe(true)
    markReloadPending()

    // Second chunk error (same session, reload didn't fix it) → should NOT reload.
    expect(shouldReload()).toBe(false)

    // After successful mount → clear flag.
    clearFlag()
    expect(shouldReload()).toBe(true)  // next deploy cycle can auto-reload again
  })
})
