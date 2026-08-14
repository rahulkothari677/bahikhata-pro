/**
 * Operations that partially fail must SAY SO to the shopkeeper (2026-07-26).
 *
 * A recurring theme in this codebase: a failure is counted or logged
 * server-side, and the user is shown a success message anyway. Server logs help
 * whoever is debugging; they do nothing for the person holding the phone.
 *
 * Three cases fixed here, all found in the Phase 1-8 audit:
 *
 *   RESTORE — the server counts payments.skipped and (since P6-6) logs the
 *   reason, but the UI reported only products and transactions. A restore that
 *   drops payments showed "Restore complete!" while every affected party then
 *   appeared to owe MORE than they really do. The shopkeeper chases customers
 *   for money already paid. This is the worst of the three: it is wrong money,
 *   presented as success.
 *
 *   INVOICE SHARE — the PDF downloads and announces itself, then the WhatsApp
 *   step silently does nothing on a server rejection. The user believes the
 *   invoice was sent.
 *
 *   BULK REMINDERS — a collections run. Parties the server refused were dropped
 *   from the list without a word, so "N reminders ready" covered fewer
 *   customers than were selected, and the rest were never chased.
 */
import fs from 'fs'
import path from 'path'
import { describeRestoreOutcome } from '@/lib/restore-outcome'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('restore reports dropped rows', () => {
  const ui = stripComments(read('components/settings/Settings.tsx'))
  const route = stripComments(read('app/api/import/restore/route.ts'))

  test('the server still counts skipped payments', () => {
    // The assertions below are meaningless if the field disappears.
    expect(route).toMatch(/results\.payments\.skipped\+\+/)
    /*
     * 🔒 2026-08-03: was pinned to the exact literal
     * `payments: { imported: 0, skipped: 0 }`. The shape gained `skipReasons`
     * when restore started naming WHY a payment was dropped — a strengthening
     * of this test's own intent, not a weakening — so it is matched on the
     * fields that matter rather than on the whole literal.
     *
     * 🔒 2026-08-14: the literal broke again when the shape gained the
     * allocation counters and went multi-line. Matched field by field now, so
     * it tracks the intent (these counters exist and are incremented) instead
     * of the formatting.
     */
    expect(route).toMatch(/payments: \{/)
    expect(route).toMatch(/skipped: 0,/)
    expect(route).toMatch(/skipReasons/)
  })

  /*
   * 🔒 2026-08-14: THE DECISION MOVED, AND THE TEST FOLLOWED IT.
   *
   * These three used to grep Settings.tsx for the wording. The toast decision
   * now lives in lib/restore-outcome.ts, because grepping a component proved it
   * contained a string — not that a shopkeeper would ever see it. It is called
   * here instead, which is the stronger claim, plus one wiring check that the
   * screen really uses it.
   *
   * The move was itself prompted by a failure of exactly this kind: the screen
   * composed its own toast and never rendered the server's `message`, so two
   * warnings added during the audit were written, returned, and dropped.
   */
  test('a restore that drops payments warns, and says what it means', () => {
    const out = describeRestoreOutcome({
      results: { products: { imported: 1 }, transactions: { imported: 1 }, payments: { imported: 20, skipped: 5 } },
    })
    expect(out.kind).toBe('warning')
    expect(out.title).toMatch(/payment\(s\) NOT imported/)
    // "3 payments skipped" means nothing to a shopkeeper. "Those parties will
    // show a higher balance than they owe" tells them what to do next.
    expect(out.description).toMatch(/HIGHER balance than they really owe/)
  })

  test('the success path cannot claim a clean run while rows were skipped', () => {
    const out = describeRestoreOutcome({
      results: { products: { imported: 1, skipped: 2 }, transactions: { imported: 1 }, payments: { imported: 1 } },
    })
    expect(out.title).toMatch(/row\(s\) skipped/)
  })

  test('the restore screen renders that decision rather than its own', () => {
    expect(ui).toMatch(/describeRestoreOutcome\(result\)/)
    expect(ui).toMatch(/description: outcome\.description/)
  })

  test('a warning the server sends is never dropped by the screen', () => {
    // The general form of the bug: the server said the right thing and the user
    // saw "Restore complete!". Covered in depth in restore-outcome.test.ts.
    const out = describeRestoreOutcome({
      results: { products: { imported: 1 }, transactions: { imported: 1 }, payments: { imported: 1 } },
      warnings: ['Something the shopkeeper must read.'],
    })
    expect(out.kind).toBe('warning')
    expect(out.description).toContain('Something the shopkeeper must read.')
  })
})

describe('invoice WhatsApp share reports failure', () => {
  const src = stripComments(read('components/ledger/TransactionDetail.tsx'))

  test('it checks r.ok before treating the share as done', () => {
    // offlineFetch resolves on 4xx/5xx, so `if (data.whatsappUrl)` alone
    // silently did nothing when the server refused.
    expect(src).toMatch(/if \(r\.ok && data\.whatsappUrl\)/)
  })

  test('the user is told the PDF is saved but WhatsApp did not open', () => {
    expect(src).toMatch(/WhatsApp could not be opened/)
  })
})

describe('bulk reminders report who was missed', () => {
  const src = stripComments(read('components/parties/BulkRemindersModal.tsx'))

  test('refused parties are tracked, not dropped', () => {
    expect(src).toMatch(/skippedNames\.push\(party\.name\)/)
    expect(src).toMatch(/if \(r\.ok && result\.whatsappUrl\)/)
  })

  test('both the rejection and network paths record the name', () => {
    // Two ways to miss a party; a partial summary is its own trap.
    const pushes = src.match(/skippedNames\.push\(/g) || []
    expect(pushes.length).toBe(2)
  })

  test('the missed parties are named so they can be chased another way', () => {
    expect(src).toMatch(/could not be messaged/)
    expect(src).toMatch(/Contact them separately/)
  })
})
