/**
 * 2 Oct 2026 — Escape that closes a popover must not also leave the screen.
 *
 * Seen first-hand on New Purchase: Escape to close the "Rates include GST" ⓘ
 * also ran the global "Escape → go back" shortcut, and the bill was gone.
 * Radix dismisses on a capture listener and calls preventDefault(); the
 * shortcut listens later, on window, and now honours that.
 */
import fs from 'fs'
import path from 'path'
import { escapeIsOurs } from '@/components/common/KeyboardShortcuts'

describe('escapeIsOurs()', () => {
  test('a plain Escape is ours', () => {
    expect(escapeIsOurs({ key: 'Escape', defaultPrevented: false })).toBe(true)
  })
  test('an Escape a popover/select/dialog already used is not', () => {
    expect(escapeIsOurs({ key: 'Escape', defaultPrevented: true })).toBe(false)
  })
  test('other keys are not Escape', () => {
    expect(escapeIsOurs({ key: 'Enter', defaultPrevented: false })).toBe(false)
  })
  test('the shortcut handler asks it before going back', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'common', 'KeyboardShortcuts.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/[^\n]*/gm, '$1')
    const handler = src.slice(src.indexOf('const handler'))
    const ask = handler.indexOf('escapeIsOurs(e)')
    const goBack = handler.indexOf("setView(previousView || 'dashboard')")
    expect(ask).toBeGreaterThan(-1)
    expect(goBack).toBeGreaterThan(ask)
  })
})
