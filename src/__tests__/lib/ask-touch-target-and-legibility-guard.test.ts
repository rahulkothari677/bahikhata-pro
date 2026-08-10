/**
 * 🔒 GUARD: the Ask surface stays at platform sizing.
 *
 * WHAT WENT WRONG, so the guard has something concrete to hold.
 *
 * Ask your books shipped with icons at 16px, icon buttons at 36-40px, body
 * text at 10-11px, and — because it renders through `AppShell` with
 * `header="never" mobileBottomNav={false}`, and AppShell renders `{children}`
 * untouched (AppShell.tsx:182) — with NO horizontal screen margin at all. The
 * back button, the drawer button and the text field all touched the glass.
 *
 * Every one of those is below the floor of the platform this ships on:
 *
 *   Material Design 3   touch target 48dp minimum, app-bar icons 24dp,
 *                       screen margin 16dp, body 14-16sp
 *   iOS HIG             touch target 44x44pt, body 17pt
 *   WhatsApp/Instagram  24dp nav icons, 16dp side padding
 *
 * WHY A GUARD AND NOT JUST A FIX. This is a class, not an incident. Any screen
 * that opts out of the shell chrome inherits no padding, and `text-2xs` /
 * `text-3xs` are always within reach — they are legitimate tokens for badges
 * and chart ticks, which is exactly why they keep landing on prose. The
 * existing microtypography guard stops `text-[10px]`; nothing stopped the
 * named token being used for a sentence, or a button being built at 36px.
 *
 * SCOPE IS DELIBERATELY THE ASK SURFACE, not all of src/. Dense report tables
 * legitimately run small. A conversation does not: every line on it is either
 * prose someone reads or money someone acts on.
 */

import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'

const ASK_DIR = path.resolve(process.cwd(), 'src/components/ask')

/** Material 3 is 48dp; iOS HIG is 44pt. 44px (w-11) is the floor we enforce. */
const MIN_TOUCH_PX = 44

function askFiles(): { name: string; text: string }[] {
  return fs
    .readdirSync(ASK_DIR)
    .filter(f => f.endsWith('.tsx'))
    .map(name => ({ name, text: fs.readFileSync(path.join(ASK_DIR, name), 'utf8') }))
}

/**
 * Blank out comments so documentation prose is never a violation — replacing
 * them with spaces rather than deleting them, so reported line numbers still
 * point at the real line in the real file.
 */
function withoutComments(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^\s*\/\/.*$/gm, blank)
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length

describe('Ask surface — platform sizing', () => {
  test('no icon button below 44px (Material 48dp / iOS HIG 44pt)', () => {
    const violations: string[] = []
    // Tailwind sizes on a 4px grid: w-10 h-10 is 40px, w-9 is 36px — both were
    // shipped and both are under the floor.
    const TOO_SMALL = /\bw-(\d+)\s+h-(\d+)\b/g

    for (const { name, text } of askFiles()) {
      const src = withoutComments(text)
      // <button> opening tags only. An avatar circle or a decorative glyph is
      // not pressed and may be any size it likes — the rule is about fingers.
      for (const tag of src.matchAll(/<button\b[\s\S]*?>/g)) {
        for (const m of tag[0].matchAll(TOO_SMALL)) {
          const w = Number(m[1]) * 4
          const h = Number(m[2]) * 4
          if (w < MIN_TOUCH_PX || h < MIN_TOUCH_PX) {
            violations.push(
              `${name}:${lineOf(src, tag.index!)}: ${w}x${h}px — ` +
              tag[0].replace(/\s+/g, ' ').slice(0, 90),
            )
          }
        }
      }
    }

    if (violations.length) {
      throw new Error(
        `\n\n🔒 ASK TOUCH-TARGET GUARD FAILED.\n\n` +
        `Material Design 3 sets a 48dp minimum; iOS HIG sets 44pt. Anything a\n` +
        `finger presses on this screen must be at least ${MIN_TOUCH_PX}px (w-11 h-11).\n` +
        `If the control must look smaller, keep the 44px box and shrink the\n` +
        `GLYPH inside it — that is what the negative margins in the top bar do.\n\n` +
        violations.map(v => `  ${v}`).join('\n') + `\n`,
      )
    }
  })

  test('no text below 12px on a surface where everything is read', () => {
    const violations: string[] = []
    for (const { name, text } of askFiles()) {
      withoutComments(text).split('\n').forEach((line, i) => {
        if (/\btext-(2xs|3xs)\b/.test(line)) {
          violations.push(`${name}:${i + 1}: ${line.trim().slice(0, 90)}`)
        }
      })
    }

    if (violations.length) {
      throw new Error(
        `\n\n🔒 ASK LEGIBILITY GUARD FAILED.\n\n` +
        `text-2xs (11px) and text-3xs (10px) are badge and chart-tick tokens.\n` +
        `Ask your books has no badges and no chart ticks — every line is prose\n` +
        `a shopkeeper reads or a figure they act on, often in daylight on a\n` +
        `mid-range phone. Floor is text-xs (12px); body is text-base (16px).\n\n` +
        violations.map(v => `  ${v}`).join('\n') + `\n`,
      )
    }
  })

  test('AskChat supplies its own screen margin, because AppShell supplies none', () => {
    const chat = fs.readFileSync(path.join(ASK_DIR, 'AskChat.tsx'), 'utf8')

    // The premise: AppShell renders {children} with no wrapper and no padding.
    // If that ever changes, this assertion fails and whoever changed it is
    // sent here to check the two screens no longer get it doubled.
    const shell = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/layout/AppShell.tsx'), 'utf8')
    expect(shell).toMatch(/^\s*\{children\}\s*$/m)

    // 16dp screen margin, and never less than the notch/cutout inset.
    expect(chat).toMatch(/paddingLeft:\s*'max\(1rem,\s*var\(--safe-left\)\)'/)
    expect(chat).toMatch(/paddingRight:\s*'max\(1rem,\s*var\(--safe-right\)\)'/)
  })
})
