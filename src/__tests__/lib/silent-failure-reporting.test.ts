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
    // The UI assertion below is meaningless if the field disappears.
    expect(route).toMatch(/results\.payments\.skipped\+\+/)
    // 🔒 2026-08-03: was pinned to the exact literal
    // `payments: { imported: 0, skipped: 0 }`. The shape gained `skipReasons`
    // when restore started naming WHY a payment was dropped — a strengthening
    // of this test's own intent, not a weakening — so it is matched on the
    // fields that matter rather than on the whole literal.
    expect(route).toMatch(/payments: \{ imported: 0, skipped: 0/)
    expect(route).toMatch(/skipReasons/)
  })

  test('the UI reads payments.skipped and warns on it', () => {
    expect(ui).toMatch(/result\.results\.payments\?\.skipped/)
    expect(ui).toMatch(/payment\(s\) NOT imported/)
  })

  test('the warning explains the balance consequence, not just the count', () => {
    // "3 payments skipped" means nothing to a shopkeeper. "Those parties will
    // show a higher balance than they owe" tells them what to do next.
    expect(ui).toMatch(/HIGHER balance than they really owe/)
  })

  test('the success path cannot claim a clean run while rows were skipped', () => {
    expect(ui).toMatch(/skippedTotal > 0 \? `Restore complete — \$\{skippedTotal\} row\(s\) skipped`/)
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
