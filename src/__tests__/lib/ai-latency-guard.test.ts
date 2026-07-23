/**
 * Bill scanning took ~13 seconds and voice entry was no better (2026-07-23).
 *
 * Three causes, none of which a code review would have caught by reading the
 * diff — the comments all claimed the right thing:
 *
 * 1. The "disable thinking" line was written in ANTHROPIC's parameter shape:
 *      ...(provider.name === 'gemini' ? { thinking: { type: 'disabled' } } : {})
 *    Google's OpenAI-compatibility layer documents no top-level `thinking`
 *    field, so it was silently ignored. Every scan ran with thinking ON while
 *    the comment above it promised "1-3s vs 3-8s".
 *
 * 2. Voice parsing had no thinking control at all.
 *
 * 3. Both used gemini-3.5-flash — the tier Google describes as "most
 *    intelligent ... agentic and coding tasks". Reading a grocery bill is OCR
 *    plus arithmetic. The -lite tier is "our fastest ... for high-throughput
 *    execution" and costs a fifth as much.
 */
import fs from 'fs'
import path from 'path'
import { calculateCostInr } from '@/lib/ai-pricing'

function readStripped(rel: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const scan = readStripped('app/api/scan-bill/route.ts')
const voice = readStripped('app/api/voice-parse/route.ts')

describe('thinking is actually suppressed, in Google\'s parameter shape', () => {
  test('the Anthropic-shaped field is gone from both routes', () => {
    for (const src of [scan, voice]) {
      expect(src).not.toMatch(/thinking:\s*\{\s*type:\s*'disabled'/)
    }
  })

  test('neither route uses extra_body, which raw fetch cannot deliver', () => {
    // `extra_body` is an OpenAI SDK convenience — the SDK unwraps it before
    // sending. These routes call the endpoint with raw fetch, so the field
    // reaches the server verbatim and is ignored. I shipped this mistake
    // myself while fixing the Anthropic-shaped one; it is the same trap.
    for (const src of [scan, voice]) {
      expect(src).not.toMatch(/extra_body/)
    }
  })

  test('both routes set the top-level reasoning_effort', () => {
    expect(scan).toMatch(/reasoning_effort: \/gemini-3\/\.test\(provider\.model\) \? 'low' : 'none'/)
    expect(voice).toMatch(/reasoning_effort: \/gemini-3\/\.test\(GEMINI_VOICE_MODEL\) \? 'low' : 'none'/)
  })

  test("3.x gets 'low', not 'none'", () => {
    // Google: reasoning "cannot be turned off for Gemini 2.5 Pro or 3 models",
    // so 'none' is not a valid request there.
    for (const src of [scan, voice]) {
      expect(src).toMatch(/\? 'low' : 'none'/)
    }
  })
})

describe('extraction runs on the fast tier', () => {
  test('scan-bill defaults to the cost-effective tier and stays overridable', () => {
    expect(scan).toMatch(/GEMINI_SCAN_MODEL \|\| 'gemini-2\.5-flash-lite'/)
  })

  test('voice-parse defaults to the cost-effective tier', () => {
    expect(voice).toMatch(/GEMINI_VOICE_MODEL = process\.env\.GEMINI_VOICE_MODEL \|\| 'gemini-2\.5-flash-lite'/)
  })

  test('the default is not a tier that costs the same as the old model', () => {
    // "Lite" is cheap WITHIN a generation, not across them:
    // gemini-3.5-flash-lite is $0.30/$2.50 — identical to the gemini-2.5-flash
    // this app started on. The rename hid that, and a scan cost ~Rs 0.19
    // either way. Whatever the default becomes, it must be cheaper per scan
    // than that baseline.
    const perScan = (m: string) => calculateCostInr('gemini', m, 2500, 590)
    const m = scan.match(/GEMINI_SCAN_MODEL \|\| '([^']+)'/)
    expect(m).toBeTruthy()
    expect(perScan(m![1])).toBeLessThan(perScan('gemini-2.5-flash'))
  })

  test('every selectable model has a price, so the cost shown is never zero', () => {
    for (const m of [
      'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite',
      'gemini-2.5-flash', 'gemini-2.5-flash-lite',
      'gemini-2.0-flash', 'gemini-2.0-flash-lite',
    ]) {
      expect(calculateCostInr('gemini', m, 1000, 1000)).toBeGreaterThan(0)
    }
  })

  test('voice-parse names its model once, not five times', () => {
    // Five string literals meant the model REPORTED in the usage log could
    // drift from the model actually called.
    const literals = voice.match(/'gemini-3\.5-flash'/g) || []
    expect(literals).toHaveLength(0)
  })
})

describe('cost reporting matches what Google charges', () => {
  test('gemini-3.5-flash is not priced as the lite tier', () => {
    // It was listed at 0.30/2.50 — the lite tier's price — so every figure
    // shown to the user was understated five-fold.
    const oneMillionIn = calculateCostInr('gemini', 'gemini-3.5-flash', 1_000_000, 0)
    const liteIn = calculateCostInr('gemini', 'gemini-3.5-flash-lite', 1_000_000, 0)
    expect(oneMillionIn).toBeGreaterThan(liteIn)
    // 1.50 vs 0.30 per 1M input.
    expect(oneMillionIn / liteIn).toBeCloseTo(5, 1)
  })

  test('the model actually used has a pricing entry', () => {
    // An unpriced model silently reports a cost of zero.
    expect(calculateCostInr('gemini', 'gemini-3.5-flash-lite', 1000, 1000)).toBeGreaterThan(0)
  })
})

describe('the upload is off the critical path', () => {
  const scanner = readStripped('components/scanner/BillScanner.tsx')

  test('upload and scan are issued together, not one after the other', () => {
    // They ran in sequence: 2.7s upload THEN 8.1s scan, and the shopkeeper
    // waited for the sum while holding a phone over a bill.
    expect(scanner).toMatch(/Promise\.all\(\[uploadPromise, scanPromise\]\)/)
  })

  test('a failed upload no longer aborts the scan', () => {
    // Storing the photo is a nicety; capturing the bill is the point.
    expect(scanner).toMatch(/scan continued without a stored copy/)
  })

  test('the scan is given base64 directly rather than awaiting a URL', () => {
    expect(scanner).toMatch(/body: JSON\.stringify\(\{ imageBase64: base64, billType, scanLang \}\)/)
  })
})

describe('the response says where the time went', () => {
  test('scan-bill reports a timing breakdown', () => {
    // Until now the only number was total AI time, so "model, image work or
    // network?" could not be answered without a debugger.
    expect(scan).toMatch(/timings: \{/)
    expect(scan).toMatch(/preprocessMs/)
    expect(scan).toMatch(/aiMs: aiDurationMs/)
    expect(scan).toMatch(/otherMs/)
  })
})

describe('a silent provider fallback cannot hide again', () => {
  test('the response says WHY a backup model answered', () => {
    // Setting GEMINI_SCAN_MODEL to a model Google had shut down rerouted every
    // scan to a tier costing 4.6x more. The only symptom was a model name on
    // the badge, which reads perfectly normal unless you know what you set.
    expect(scan).toMatch(/fallbackReason/)
    expect(scan).toMatch(/provider\.model !== primaryModel/)
  })

  test('the reason carries no raw provider error', () => {
    // Provider errors can contain key fragments; only the HTTP status is safe.
    expect(scan).toMatch(/result\.error\?\.match\(\/HTTP /)
    expect(scan).not.toMatch(/fallbackReason = `\$\{result\.error\}/)
  })

  test('the scanner shows the warning to the user', () => {
    const scanner = readStripped('components/scanner/BillScanner.tsx')
    expect(scanner).toMatch(/scanned\.fallbackReason/)
    expect(scanner).toMatch(/Used a backup model/)
  })

  test('missing provider keys are logged', () => {
    // The Gemini "upgrade" appeared live while every scan ran on the legacy
    // fallback; the only symptom was a model name on screen that nobody
    // cross-checked against the code.
    expect(scan).toMatch(/function missingProviderKeys/)
    expect(scan).toMatch(/Skipping providers with no key/)
  })
})
