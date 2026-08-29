/**
 * Every invoice setting can be SET, and every setting is USED.
 *
 * 🐛 2026-08-16. Rahul asked me to sweep the invoice settings for the defect
 * he had already found twice: something built, tested, and impossible to
 * reach. The sweep found a third, worse than either.
 *
 * `Setting.invoicePrefix` and `Setting.invoiceNextNumber` were saved by the
 * settings screen, validated by the API, and read by NOTHING. A shopkeeper
 * typed "RG/26-27/", watched the screen promise "your next bill will be
 * RG/26-27/47", and every bill still came out INV-0001.
 *
 * ── WHY MY EXISTING TEST DID NOT CATCH IT ─────────────────────────────
 *
 * invoice-content-fields.test.ts asserts the API VALIDATES invoiceNextNumber.
 * It does. That is not the same claim as "something uses it", and the gap
 * between those two sentences is where this bug lived for three days. A test
 * that checks a value is accepted, and never that it changes anything, is the
 * "guard that does not guard" pattern in CLAUDE.md wearing a settings hat.
 *
 * ── WHY THE RULE IS A LIST AND NOT A SWEEP ────────────────────────────
 *
 * A directory walk that greps for column names produces false positives —
 * the visibility toggles are rendered from a registry, so their literal names
 * appear in no component, and roundOffEnabled is read in an API route rather
 * than lib/. A sweep that cries wolf gets ignored, which is worse than none.
 *
 * So this names the consumer for each setting explicitly. Adding a setting
 * means adding a line here that says what reads it — which is the point.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { readCode } from '@/test-support/read-source'
import { formatInvoiceNo } from '@/lib/invoice-number'

describe('formatInvoiceNo — the rule itself', () => {
  it('uses the shop\'s prefix when it has one', () => {
    expect(formatInvoiceNo('RG/26-27/', 47)).toBe('RG/26-27/47')
  })

  it('leaves a shop with no prefix exactly as it was', () => {
    /*
     * Byte-identical to what this app produced before prefixes existed. An
     * invoice series that changes shape mid-year is what Rule 46(b) is about,
     * so a shop that never opens the setting must see no change at all.
     */
    expect(formatInvoiceNo(null, 1)).toBe('INV-0001')
    expect(formatInvoiceNo('', 128)).toBe('INV-0128')
    expect(formatInvoiceNo('   ', 7)).toBe('INV-0007')
  })

  it('does not pad a number the shopkeeper chose', () => {
    // They typed 47. They meant 47, not 0047.
    expect(formatInvoiceNo('RG/', 47)).toBe('RG/47')
  })

  it('keeps the purchase series separate', () => {
    expect(formatInvoiceNo(null, 3, 'PUR-')).toBe('PUR-0003')
  })
})

describe('every invoice setting has something that reads it', () => {
  /**
   * setting → the file that CONSUMES it. Not "mentions" — consumes.
   *
   * If you add a setting and cannot fill in the right-hand column, the setting
   * does nothing and should not ship.
   */
  const CONSUMERS: Record<string, string> = {
    // invoiceShopFromSetting maps most of these off the Setting row and onto
    // the document, so it is the file that genuinely READS the column.
    invoiceTheme: 'src/components/ledger/TransactionDetail.tsx',
    invoiceTerms: 'src/lib/invoice-document.ts',
    invoiceThankYou: 'src/lib/invoice-document.ts',
    invoiceDueDays: 'src/components/ledger/TransactionDetail.tsx',
    signatureUrl: 'src/lib/invoice-document.ts',
    paymentQrUrl: 'src/lib/invoice-document.ts',
    upiId: 'src/lib/invoice-document.ts',
    invoiceTemplate: 'src/components/ledger/TransactionDetail.tsx',
    invoicePaperSize: 'src/components/ledger/TransactionDetail.tsx',
    docSendFormat: 'src/components/ledger/TransactionDetail.tsx',
    roundOffEnabled: 'src/app/api/transactions/route.ts',
    // The two this sweep found dead. Named LAST because they are the reason
    // this file exists.
    invoicePrefix: 'src/app/api/transactions/route.ts',
    invoiceNextNumber: 'src/app/api/settings/route.ts',
  }

  /*
   * A setting may be read through the RESOLVER instead of by name.
   *
   * 2026-08-16: `resolveInvoiceDesign(setting)` is the one function that knows
   * an ornament needs a frame to sit on, so the download path asks it rather
   * than reading `invoiceTemplate` and `invoiceStyle` raw. That is the correct
   * architecture and this guard called it dead code, because it was matching a
   * NAME rather than asking whether the value reaches the bill.
   *
   * Kept narrow on purpose: only the two design columns, and only via a
   * function that provably reads them. Widening it to "any helper" would turn
   * a guard into a wish — the exact failure CLAUDE.md records five times.
   */
  const RESOLVED_BY: Record<string, string> = {
    invoiceTemplate: 'resolveInvoiceDesign',
    invoiceStyle: 'resolveInvoiceDesign',
  }

  it.each(Object.entries(CONSUMERS))('%s is read by %s', (setting, file) => {
    // Comments stripped, so prose describing a setting cannot satisfy this.
    const src = readCode(file)
    const viaResolver = RESOLVED_BY[setting] ? src.includes(RESOLVED_BY[setting]) : false
    expect({ setting, read: src.includes(setting) || viaResolver })
      .toEqual({ setting, read: true })
  })

  it('the resolver this guard trusts really does read both design columns', () => {
    /*
     * The escape hatch above is only honest if `resolveInvoiceDesign` reads
     * what it claims to. Checked here rather than assumed, because an escape
     * hatch nobody verifies is how a guard stops guarding.
     */
    const src = readCode('src/lib/invoice-presets.ts')
    expect({
      template: src.includes('invoiceTemplate'),
      style: src.includes('invoiceStyle'),
    }).toEqual({ template: true, style: true })
  })

  it('the numbering setting actually reaches the number', () => {
    /*
     * The specific claim that was false for three days. Not "the route
     * mentions invoicePrefix" — that the FORMATTER is what builds the sale's
     * invoice number.
     */
    const route = readCode('src/app/api/transactions/route.ts')
    expect(route).toContain('formatInvoiceNo(setting?.invoicePrefix')
    // And the old hardcoded format is gone from the SALES branch.
    expect(route).not.toContain("finalInvoiceNo = `INV-${String(invoiceSequence)")
  })

  it('setting the next number moves the counter', () => {
    // Storing the number and leaving the counter behind is the other half of
    // the same defect.
    const settings = readCode('src/app/api/settings/route.ts')
    expect(settings).toContain('db.invoiceCounter.upsert')
    expect(settings).toContain('seq: wanted - 1')
  })

  it('the counter is never rewound', () => {
    /*
     * Going backwards would re-issue numbers already printed on bills a
     * customer is holding — the precise thing a consecutive unique serial
     * exists to prevent. The shopkeeper is told instead.
     */
    const settings = readCode('src/app/api/settings/route.ts')
    expect(settings).toContain('wanted > current')
    expect(settings).toContain('invoiceNumberWarning')
  })
})

describe('every invoice setting has a screen that can set it', () => {
  /*
   * The other direction, and the one Rahul hit twice: a field nothing can
   * write. The four visibility toggles are rendered from VISIBILITY_TOGGLES
   * rather than by name, so they are checked through the registry.
   */
  const SETTINGS_UI = [
    'src/components/settings/Settings.tsx',
    'src/components/settings/CustomFieldsCard.tsx',
    'src/components/settings/PaymentQrField.tsx',
    'src/components/settings/SignatureField.tsx',
  ].map(f => readCode(f)).join('\n')

  it.each([
    'invoicePrefix', 'invoiceNextNumber', 'invoiceTerms', 'invoiceThankYou',
    'invoiceDueDays', 'bankIfsc', 'upiId', 'paymentQrUrl', 'signatureUrl',
    /*
     * #42, 29 Aug 2026. These two were the worst instance of this defect yet,
     * because the screen that needed them TOLD the shopkeeper where to go and
     * the place did not exist: CompositionReturns said "Account → Feature
     * Toggles", which has never contained the composition scheme. So the whole
     * CMP-08 / GSTR-4 engine could only be switched on by calling the API by
     * hand, and compositionTo — the field that stops a shop being taxed twice
     * after it crosses the turnover limit — could not be entered at all.
     *
     * That is the same shape as invoicePrefix: built, validated, tested, and
     * unreachable. It is on this list so it cannot happen a third time.
     */
    'compositionCategory', 'compositionTo',
  ])('%s can be set from a screen', setting => {
    expect({ setting, settable: SETTINGS_UI.includes(setting) })
      .toEqual({ setting, settable: true })
  })

  it('the composition scheme is not sent to a screen that does not have it', () => {
    /*
     * The pointer, not the control. A correct control plus a sentence naming
     * the wrong screen still leaves the shopkeeper looking in the wrong place
     * and concluding the app cannot do it — which is exactly what happened
     * here for three weeks.
     *
     * Feature Toggles is real (profile icon → Features), so this is not about
     * a missing screen. It holds display switches; the composition scheme
     * changes the tax rate and which returns exist, and it lives with
     * e-invoicing in the tax settings.
     *
     * `readCode` strips comments, so this asserts on what the component
     * RENDERS, not on the note above explaining why. Writing it as a windowed
     * regex over the raw file was my first attempt and it is Cause 7 exactly:
     * the explanation quotes the banned phrase, so the guard would have been
     * measuring my own comment.
     */
    const rendered = readCode('src/components/reports/CompositionReturns.tsx')
    expect(rendered).not.toContain('Feature Toggles')
    expect(rendered).toContain('Invoice')
  })

  it('the visibility toggles render from the registry', () => {
    const settings = readCode('src/components/settings/Settings.tsx')
    expect(settings).toContain('VISIBILITY_TOGGLES')
  })

  it('docShareLink is settable by NOTHING, deliberately', () => {
    /*
     * The one intended dead setting. The shareable link was withdrawn; the
     * column stays so no shop's row is rewritten, but nothing may write it
     * again. This asserts the absence on purpose, so a future "restore the
     * link" has to come here and read why it went.
     */
    expect(SETTINGS_UI).not.toContain('docShareLink')
    expect(readCode('src/app/api/settings/route.ts')).not.toContain('sanitized.docShareLink')
  })
})

describe('nothing else in the schema is silently orphaned', () => {
  it('every setting listed above still exists as a column', () => {
    // A renamed column would make the checks above pass against a setting
    // nobody can reach — the failure mode this whole file is about.
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    for (const setting of ['invoicePrefix', 'invoiceNextNumber', 'paymentQrUrl', 'docSendFormat']) {
      expect({ setting, inSchema: schema.includes(setting) }).toEqual({ setting, inSchema: true })
    }
  })
})
