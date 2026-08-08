/**
 * @jest-environment jsdom
 *
 * Closing the privacy dialog must record an answer, and that answer is never
 * "yes" unless the shopkeeper said yes.
 *
 * WHY (2026-08-08, found in the browser during an end-to-end pass). The dialog
 * can be closed four ways — the two footer buttons, the X, Escape, and a click
 * on the overlay — but only the buttons wrote anything. The other three routed
 * to `onOpenChange` and merely hid it, leaving the stored value null, and the
 * mount effect reopens the dialog two seconds after every mount while it is
 * null. So pressing Escape asked again on the next screen, and the next.
 *
 * Verified live before the fix: after dismissing, `bahikhata-analytics-consent`
 * was still null and the dialog came back.
 *
 * Two properties are being protected here and they pull in opposite directions,
 * which is why both are tested:
 *
 *   1. A dismissal must be RECORDED, or the nag returns forever.
 *   2. A dismissal must be recorded as NO. Silence is not agreement, and a bug
 *      that turned a dismissal into consent would be far worse than the nag.
 */
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const KEY = 'bahikhata-analytics-consent'

jest.mock('@/lib/analytics', () => ({
  setAnalyticsConsent: (c: boolean) => window.localStorage.setItem(KEY, c ? 'true' : 'false'),
  initAnalytics: jest.fn(),
  track: jest.fn(),
  EVENTS: { ONBOARDING_COMPLETED: 'onboarding_completed' },
}))

import { ConsentModal } from '@/components/common/ConsentModal'

/** The dialog only appears two seconds after mount. */
async function showDialog() {
  render(<ConsentModal />)
  act(() => { jest.advanceTimersByTime(2500) })
  await screen.findByText('Your Privacy Matters')
}

beforeEach(() => {
  jest.useFakeTimers()
  window.localStorage.clear()
})
afterEach(() => { jest.useRealTimers() })

describe('the privacy dialog records exactly one answer', () => {
  it('records a decline when dismissed with Escape', async () => {
    await showDialog()

    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape', code: 'Escape' })

    // The nag is over: an answer exists, so the mount effect will not reopen it.
    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('false'))
  })

  it('records a decline, never consent, when dismissed with the X', async () => {
    await showDialog()

    fireEvent.click(screen.getByRole('button', { name: /close/i }))

    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('false'))
    expect(window.localStorage.getItem(KEY)).not.toBe('true')
  })

  it('records consent only when the shopkeeper actually agrees', async () => {
    await showDialog()

    fireEvent.click(screen.getByRole('button', { name: /Allow anonymous tracking/i }))

    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('true'))
  })

  it('records a decline when "No thanks" is pressed', async () => {
    await showDialog()

    fireEvent.click(screen.getByRole('button', { name: /No thanks/i }))

    await waitFor(() => expect(window.localStorage.getItem(KEY)).toBe('false'))
  })

  it('does not overwrite consent when the close that follows the button fires', async () => {
    // Pressing Allow closes the dialog, which also triggers onOpenChange(false).
    // If that path recorded a decline, agreeing would immediately undo itself.
    await showDialog()

    fireEvent.click(screen.getByRole('button', { name: /Allow anonymous tracking/i }))
    act(() => { jest.advanceTimersByTime(1000) })

    expect(window.localStorage.getItem(KEY)).toBe('true')
  })

  it('stays closed on a later mount once an answer exists', async () => {
    window.localStorage.setItem(KEY, 'false')

    render(<ConsentModal />)
    act(() => { jest.advanceTimersByTime(5000) })

    expect(screen.queryByText('Your Privacy Matters')).not.toBeInTheDocument()
  })
})
