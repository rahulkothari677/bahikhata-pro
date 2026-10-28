/**
 * @jest-environment jsdom
 *
 * Phase 7h — a customer's page is never blank while it loads (#285), and neither is
 * any other screen.
 *
 * Every screen is loaded on first open (next/dynamic). Only the bill screen gave a
 * fallback, so the rest — a customer's page among them — showed the header and
 * nothing else while their code downloaded (live, 21 Oct: 11.8 s), then two grey
 * blocks while the data came. Now every screen has an outline, and a customer's page
 * shows its own shape (top card with the balance, then the bahi rows).
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { readCode } from '@/test-support/read-source'
import { PartyPageSkeleton, ScreenSkeleton } from '@/components/common/Skeletons'

/** The dynamic() screens in a file that have no `loading:` fallback. */
function screensWithoutLoading(code: string): string[] {
  const out: string[] = []
  const re = /const (\w+) = dynamic\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    // the call runs to the end of its own statement: the next "\nconst " or end of file
    const end = code.indexOf('\nconst ', m.index + 1)
    const call = code.slice(m.index, end === -1 ? code.length : end)
    if (!/loading:/.test(call)) out.push(m[1])
  }
  return out
}

describe('no screen is blank while its code loads', () => {
  const page = readCode('app/page.tsx')
  it('every dynamic screen in page.tsx has a loading fallback', () => {
    expect((page.match(/= dynamic\(/g) ?? []).length).toBeGreaterThanOrEqual(15)
    expect(screensWithoutLoading(page)).toEqual([])
  })
  it('a customer\'s page loads in its own outline', () => {
    expect(page).toMatch(/const PartyProfile = dynamic\([^\n]*loading: partyLoading/)
  })
  it('the check finds a screen without one', () => {
    expect(screensWithoutLoading("const A = dynamic(() => import('a'), { ssr: false })\nconst B = dynamic(() => import('b'), { ssr: false, loading: x })\n")).toEqual(['A'])
  })
})

describe('the customer page outline', () => {
  it('the page uses it while its data loads, not two grey blocks', () => {
    const profile = readCode('components/parties/PartyProfile.tsx')
    expect(profile).toContain('if (isLoading || !data) return <PartyPageSkeleton />')
  })
  it('draws the top card and the rows, and says it is loading', () => {
    const { container } = render(<PartyPageSkeleton />)
    expect(screen.getByLabelText('Loading').getAttribute('aria-busy')).toBe('true')
    // avatar, name, phone, balance, three actions, then five rows
    expect(container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThanOrEqual(10)
  })
  it('the general outline also says it is loading', () => {
    render(<ScreenSkeleton />)
    expect(screen.getByLabelText('Loading')).toBeTruthy()
  })
})
