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

  test('scan-bill uses a documented control', () => {
    // reasoning_effort for 2.5, extra_body.google.thinking_config for 3.x.
    expect(scan).toMatch(/reasoning_effort: 'none'/)
    expect(scan).toMatch(/thinking_config: \{ thinking_level: 'minimal' \}/)
  })

  test('voice-parse has a control at all', () => {
    expect(voice).toMatch(/thinking_level: 'minimal'|reasoning_effort: 'none'/)
  })

  test('3.x models get minimal rather than none', () => {
    // Google: reasoning "cannot be turned off for Gemini 2.5 Pro or 3 models".
    // Sending none to a 3.x model is not a valid request.
    expect(scan).toMatch(/\/gemini-3\/\.test\(provider\.model\)/)
    expect(voice).toMatch(/\/gemini-3\/\.test\(GEMINI_VOICE_MODEL\)/)
  })
})

describe('extraction runs on the fast tier', () => {
  test('scan-bill defaults to a -lite model and stays overridable', () => {
    expect(scan).toMatch(/GEMINI_SCAN_MODEL \|\| 'gemini-3\.5-flash-lite'/)
  })

  test('voice-parse defaults to a -lite model', () => {
    expect(voice).toMatch(/GEMINI_VOICE_MODEL = process\.env\.GEMINI_VOICE_MODEL \|\| 'gemini-3\.5-flash-lite'/)
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

describe('a silent provider fallback cannot hide again', () => {
  test('missing provider keys are logged', () => {
    // The Gemini "upgrade" appeared live while every scan ran on the legacy
    // fallback; the only symptom was a model name on screen that nobody
    // cross-checked against the code.
    expect(scan).toMatch(/function missingProviderKeys/)
    expect(scan).toMatch(/Skipping providers with no key/)
  })
})
