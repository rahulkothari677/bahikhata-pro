/**
 * @jest-environment node
 *
 * The privacy policy must describe what the code actually does.
 *
 * WHY (audit 2026-08-04). Three statements on the policy page were untrue:
 *
 *  1. It named Groq as the AI processor. The chain is Google Gemini FIRST, then
 *     OpenAI, then Groq — so the provider receiving almost every bill was
 *     undisclosed, as was OpenAI. Those photos carry a third party's name,
 *     GSTIN, phone and amounts.
 *  2. "images deleted after processing" — deleteBillImage() was called from one
 *     place, the shop-logo route. Never after OCR, never on transaction delete.
 *  3. Account deletion promised to remove "All bill images from Cloudinary".
 *     The implementation said, in its own comment, "currently a no-op".
 *
 * A policy that misdescribes practice is the violation, regardless of how good
 * the engineering behind it is — and it is the easiest thing for a regulator or
 * a Play reviewer to check.
 *
 * The fix removed the cause: scanned bills are no longer uploaded at all. This
 * test pins the two halves together so they cannot drift apart again.
 */
import fs from 'fs'
import path from 'path'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8')

/*
 * JSX wraps prose across lines, so a phrase can be split by a newline and
 * indentation in the source while rendering as one sentence. Collapse runs of
 * whitespace before matching, or these assertions test the formatter rather
 * than the policy.
 */
const collapse = (s: string) => s.replace(/\s+/g, ' ')

const policy = collapse(read('app/privacy/page.tsx'))
const scanRoute = read('app/api/scan-bill/route.ts')

describe('every AI provider that receives a bill is disclosed', () => {
  // Derived from the route, not hardcoded, so adding a fourth provider without
  // disclosing it fails here.
  const hosts: Array<[string, RegExp, RegExp]> = [
    ['Google Gemini', /generativelanguage\.googleapis\.com/, /Google|Gemini/],
    ['OpenAI', /api\.openai\.com/, /OpenAI/],
    ['Groq', /api\.groq\.com/, /Groq/],
  ]

  it.each(hosts)('%s is used by the scan route AND named in the policy', (_label, hostRe, policyRe) => {
    expect(scanRoute).toMatch(hostRe)      // still used
    expect(policy).toMatch(policyRe)       // and disclosed
  })

  it('does not present Groq as the only AI processor', () => {
    // The exact wording that was wrong: "sent to Groq for OCR".
    expect(policy).not.toMatch(/sent to Groq for OCR/)
  })
})

describe('the policy does not promise deletion the code cannot perform', () => {
  it('does not claim scanned images are deleted after processing', () => {
    // There is nothing to delete now — they are never stored. Claiming a
    // deletion step would be a new untrue statement, in the other direction.
    expect(policy).not.toMatch(/images deleted after processing/)
  })

  it('states that scanned bill photos are not stored', () => {
    expect(policy).toMatch(/not\s*<\/b>\s*stored|not saved|Never stored/i)
  })

  it('matches the code: the scanner performs no upload', () => {
    const scanner = read('components/scanner/BillScanner.tsx')
    expect(scanner).not.toMatch(/upload-bill/)
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/api/upload-bill/route.ts'))).toBe(false)
  })
})

describe('DPDP requirements the policy must carry', () => {
  it('names a grievance mechanism, not just a generic mailbox', () => {
    expect(policy).toMatch(/Grievance Officer/)
  })

  it('gives the grievance contact an address that is published elsewhere too', () => {
    // A grievance channel that bounces is worse than none, so it must not be a
    // freshly invented address nobody monitors.
    const grievanceBlock = policy.slice(policy.indexOf('Grievance Officer'))
    const emails = [...grievanceBlock.matchAll(/mailto:([^"']+)/g)].map(m => m[1])
    expect(emails.length).toBeGreaterThan(0)
    for (const e of emails) {
      // The same address appears in the rights section above.
      expect(policy.indexOf(`mailto:${e}`)).toBeLessThan(policy.indexOf('Grievance Officer'))
    }
  })

  it('points at the Data Protection Board as the escalation route', () => {
    expect(policy).toMatch(/Data Protection Board/)
  })

  it('discloses that some processing happens outside India', () => {
    expect(policy).toMatch(/outside India/)
  })
})
