/**
 * 🔒 THE DESIGN LANGUAGE AS RULES A TEST CAN RUN (Phase 4a, Oct 2026).
 *
 * The final design plan §1 sets the bar every screen must meet. Three parts of
 * it can be checked from source text, so they live here as plain functions
 * that take a string and answer: each one is exercised against a known-good
 * and a known-bad input in design-language-guard.test.ts, then swept over the
 * real code. A rule buried inside a directory walk can only be tested by
 * committing a bug (CLAUDE.md, Cause 7); a function can be called with two
 * arguments.
 *
 *   1. Nothing a shopkeeper reads is below 12px.
 *   2. Colour means one thing: screens use the roles (good / bad / check / ai),
 *      and the count of raw palette shades only ever goes down.
 *   3. The theme defines every role in light AND dark.
 */

/** 12px at the 16px phone root. text-xs is the floor. */
export const MIN_TEXT_PX = 12

/**
 * Text set below the floor, in code with its comments already removed.
 * Catches the removed 10/11px tokens, any arbitrary text-[Npx] (off-scale
 * whatever its size — V26 Phase 6 §1.2), and chart/style numbers such as
 * `fontSize: 10`. Raw CSS inside template strings (a printed statement's
 * `font-size:11px`) is paper, not screen, and is not checked.
 */
export function smallTextViolations(code: string): string[] {
  const found: string[] = []
  code.split(/\r?\n/).forEach((line, i) => {
    const at = `line ${i + 1}: ${line.trim().slice(0, 90)}`
    if (/\btext-(2xs|3xs)\b/.test(line)) found.push(at)
    else if (/\btext-\[\d+(\.\d+)?px\]/.test(line)) found.push(at)
    else {
      const m = line.match(/\bfontSize:\s*(\d+(\.\d+)?)\b/)
      if (m && Number(m[1]) < MIN_TEXT_PX) found.push(at)
    }
  })
  return found
}

/**
 * Raw palette shades that carry meaning (green for paid, red for owed...).
 * Neutrals (gray, slate, zinc...) are not counted: they are a separate,
 * later clean-up and carry no meaning a role could replace.
 */
const RAW_MEANING_COLOUR =
  /\b(?:text|bg|border|ring|from|via|to|fill|stroke|outline|divide|decoration|shadow|accent|caret)-(?:red|rose|pink|fuchsia|purple|violet|indigo|blue|sky|cyan|teal|emerald|green|lime|yellow|amber|orange)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g

export function rawMeaningColourCount(code: string): number {
  return (code.match(RAW_MEANING_COLOUR) || []).length
}

/**
 * Hand-made warning boxes (Phase 4b): one class string with a soft tinted
 * surface AND a tinted border, e.g. "border-amber-200 bg-amber-50". That is
 * the shape every screen used to draw its own warning in. New warnings use
 * <Notice>. Reads one line at a time, so a box whose classes are spread over
 * several lines escapes; the count is a ceiling to lower, not a census.
 */
const AD_HOC_BOX =
  /\bbg-(?:amber|yellow|orange|red|rose|blue|sky|emerald|green)-(?:50|100)\b[^"'`\n]*\bborder-(?:amber|yellow|orange|red|rose|blue|sky|emerald|green)-(?:100|200|300)\b|\bborder-(?:amber|yellow|orange|red|rose|blue|sky|emerald|green)-(?:100|200|300)\b[^"'`\n]*\bbg-(?:amber|yellow|orange|red|rose|blue|sky|emerald|green)-(?:50|100)\b/g

export function adHocWarningBoxCount(code: string): number {
  return (code.match(AD_HOC_BOX) || []).length
}

export const COLOUR_ROLES = ['good', 'bad', 'check', 'ai'] as const

/**
 * Roles the theme fails to define. Each role and its -soft surface must have
 * a light value, a dark value, and a Tailwind colour name pointing at it.
 */
export function missingRoleTokens(css: string): string[] {
  const missing: string[] = []
  for (const role of COLOUR_ROLES) {
    for (const name of [role, `${role}-soft`]) {
      const values = css.match(new RegExp(`^\\s*--${name}:\\s*oklch\\(`, 'gm')) || []
      if (values.length < 2) missing.push(`--${name} needs a light and a dark value (found ${values.length})`)
      if (!new RegExp(`--color-${name}:\\s*var\\(--${name}\\)`).test(css)) missing.push(`--color-${name} is not mapped`)
    }
  }
  return missing
}

/** Theme text sizes (`--text-x: 0.625rem`) below the floor. */
export function themeTextBelowFloor(css: string): string[] {
  const out: string[] = []
  for (const m of css.matchAll(/--text-([a-z0-9-]+):\s*([\d.]+)rem\s*;/g)) {
    if (m[1].endsWith('--line-height')) continue
    if (Number(m[2]) * 16 < MIN_TEXT_PX) out.push(`--text-${m[1]}: ${m[2]}rem`)
  }
  return out
}
