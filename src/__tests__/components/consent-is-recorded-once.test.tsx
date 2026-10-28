/**
 * @jest-environment jsdom
 *
 * The privacy question is asked once, at sign-up, and its answer is never "yes"
 * unless the shopkeeper said yes.
 *
 * #188 (Phase 7h, 28 Oct 2026): the question used to be a sheet that opened two
 * seconds after any screen loaded once the first-run tour was done — so it landed
 * over Home in the middle of work. It is now a switch on the first-run welcome
 * (components/layout/Onboarding.tsx), off unless turned on, and recorded on the
 * way out whichever way the welcome is left.
 *
 * The two properties the old sheet's tests protected still hold, and still pull
 * in opposite directions, which is why both are tested (2026-08-08: a dismissal
 * by Escape left the answer unset and the sheet came back on every screen):
 *
 *   1. Leaving must RECORD an answer, so nothing asks again later.
 *   2. Leaving without turning the switch on records NO. Silence is not agreement.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { readCode } from '@/test-support/read-source'

const KEY = 'bahikhata-analytics-consent'

jest.mock('@/lib/analytics', () => ({
  setAnalyticsConsent: (c: boolean) => window.localStorage.setItem(KEY, c ? 'true' : 'false'),
  hasAnalyticsConsent: () => window.localStorage.getItem(KEY) === 'true',
  initAnalytics: jest.fn(),
  track: jest.fn(),
  EVENTS: { ONBOARDING_COMPLETED: 'onboarding_completed' },
}))
jest.mock('@/lib/offline-fetch', () => ({ offlineFetch: jest.fn(async () => ({ ok: true, json: async () => ({}) })) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }))

import { Onboarding } from '@/components/layout/Onboarding'

function showWelcome() {
  const onDone = jest.fn()
  render(<Onboarding open onDone={onDone} />)
  return onDone
}
const explore = () => fireEvent.click(screen.getByRole('button', { name: 'Explore first' }))

beforeEach(() => window.localStorage.clear())

describe('the welcome screen records exactly one privacy answer', () => {
  it('asks with a switch that starts off', () => {
    showWelcome()
    const sw = screen.getByRole('switch', { name: /Share anonymous usage/ })
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })

  it('records NO when the welcome is left without turning it on', async () => {
    const onDone = showWelcome()
    explore()
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('false'))
    expect(onDone).toHaveBeenCalled()
  })

  it('records NO, never yes, when the welcome is closed with Escape', async () => {
    showWelcome()
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('false'))
  })

  it('records YES only when the shopkeeper turns it on', async () => {
    showWelcome()
    fireEvent.click(screen.getByRole('switch', { name: /Share anonymous usage/ }))
    explore()
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('true'))
  })

  it('a close that follows the answer does not overwrite it', async () => {
    showWelcome()
    fireEvent.click(screen.getByRole('switch', { name: /Share anonymous usage/ }))
    explore()
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('true'))
  })

  it('a welcome seen again starts from the earlier yes, so leaving keeps it', async () => {
    window.localStorage.setItem(KEY, 'true')
    showWelcome()
    await waitFor(() => expect(screen.getByRole('switch', { name: /Share anonymous usage/ }).getAttribute('aria-checked')).toBe('true'))
    explore()
    expect(window.localStorage.getItem(KEY)).toBe('true')
  })
})

describe('nothing asks over Home', () => {
  it('the app shell mounts no privacy sheet; the old sheet is gone', () => {
    const shell = readCode('components/layout/AppShell.tsx')
    expect(shell).not.toMatch(/Consent/)
    expect(() => readCode('components/common/ConsentModal.tsx')).toThrow()
  })
})
