/**
 * @jest-environment jsdom
 *
 * A sideways swipe must never become a refresh.
 *
 * WHY (BUG-072, reported by Rahul from the Android build, 13 Aug 2026):
 * "when i swipe a bit of other than horizontal the page get refreshed in the
 * dashboard page means a small touch can refreshed the page."
 *
 * The dashboard's quick-action row is `overflow-x-auto` — it EXISTS to be
 * swiped sideways. Nobody swipes a perfectly horizontal line, so every one of
 * those swipes carried a few pixels of downward drift.
 *
 * usePullToRefresh only ever looked at deltaY. Any drift greater than zero
 * counted as a pull, so it called preventDefault() — killing the sideways
 * scroll the shopkeeper actually wanted — and translated the whole page down.
 *
 * Two independent faults, and a test for each, because fixing one alone still
 * leaves the reported symptom:
 *
 *   1. NO DEADBAND — one pixel of movement started a pull. That is the "small
 *      touch" in the report.
 *   2. NO DIRECTION — a mostly-sideways swipe was handled as a pull.
 *
 * These are driven through the real hook with real touch events rather than by
 * reading the source, because the bug is in the arithmetic, and source-reading
 * tests pass on arithmetic that is wrong.
 */
import React from 'react'
import { render, act } from '@testing-library/react'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'

jest.mock('@/lib/haptic', () => ({
  haptic: { medium: jest.fn(), success: jest.fn(), error: jest.fn() },
}))

/**
 * jsdom has no Touch/TouchEvent constructor, so build the shape the handler
 * reads: e.touches[0].clientX/clientY, plus a preventDefault we can observe.
 */
function touch(type: string, x: number, y: number) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: { clientX: number; clientY: number }[]
  }
  Object.defineProperty(e, 'touches', { value: [{ clientX: x, clientY: y }], writable: false })
  return e
}

let prevented = 0
/** Dispatch on window and record whether the handler blocked the gesture. */
function fire(type: string, x: number, y: number) {
  const e = touch(type, x, y)
  const originalPreventDefault = e.preventDefault.bind(e)
  e.preventDefault = () => {
    prevented++
    originalPreventDefault()
  }
  act(() => {
    window.dispatchEvent(e)
  })
}

const onRefresh = jest.fn(async () => {})

function Harness() {
  const { pullDistance, isRefreshing } = usePullToRefresh({ onRefresh })
  return (
    <div>
      <span data-testid="pull">{pullDistance}</span>
      <span data-testid="refreshing">{String(isRefreshing)}</span>
    </div>
  )
}

const pull = (r: ReturnType<typeof render>) => Number(r.getByTestId('pull').textContent)

beforeEach(() => {
  jest.clearAllMocks()
  prevented = 0
  Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true })
})

describe('a sideways swipe is left alone', () => {
  it('does not move the page when the finger goes mostly sideways', () => {
    // The exact reported gesture: swiping the quick-action row, with the few
    // pixels of downward drift any real thumb produces.
    const r = render(<Harness />)
    fire('touchstart', 200, 300)
    fire('touchmove', 140, 306) // 60px across, 6px down
    fire('touchmove', 80, 312)  // 120px across, 12px down
    expect(pull(r)).toBe(0)
  })

  it('does not block the sideways scroll', () => {
    // preventDefault() here is what stopped the row from scrolling at all.
    render(<Harness />)
    fire('touchstart', 200, 300)
    fire('touchmove', 140, 306)
    fire('touchmove', 80, 312)
    expect(prevented).toBe(0)
  })

  it('never refreshes, even if the swipe drifts a long way down', () => {
    // Once ruled sideways, it must STAY sideways. Re-deciding mid-gesture is
    // how a swipe gets stolen halfway through.
    const r = render(<Harness />)
    fire('touchstart', 300, 300)
    fire('touchmove', 200, 305) // decided: sideways
    fire('touchmove', 190, 500) // now a big downward drift
    fire('touchend', 190, 500)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(pull(r)).toBe(0)
  })
})

describe('a small touch does nothing at all', () => {
  it('ignores movement below the activation distance', () => {
    // The deadband. A tap that wobbles a few pixels is not a gesture.
    const r = render(<Harness />)
    fire('touchstart', 200, 300)
    fire('touchmove', 200, 304) // 4px down — under ACTIVATION
    expect(pull(r)).toBe(0)
    expect(prevented).toBe(0)
  })

  it('does not refresh on a short deliberate pull', () => {
    const r = render(<Harness />)
    fire('touchstart', 200, 300)
    fire('touchmove', 200, 330)
    fire('touchend', 200, 330)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(pull(r)).toBe(0)
  })
})

describe('a real downward pull still works', () => {
  // The whole feature must survive the fix. A guard that only proves the new
  // restriction would happily pass on a hook that refuses everything.
  it('moves the page when the finger goes straight down', () => {
    const r = render(<Harness />)
    fire('touchstart', 200, 100)
    fire('touchmove', 202, 160) // 60px down, 2px across
    expect(pull(r)).toBeGreaterThan(0)
  })

  it('blocks the browser native pull, as it must', () => {
    render(<Harness />)
    fire('touchstart', 200, 100)
    fire('touchmove', 202, 160)
    expect(prevented).toBeGreaterThan(0)
  })

  it('refreshes when pulled past the threshold and released', async () => {
    render(<Harness />)
    fire('touchstart', 200, 100)
    fire('touchmove', 200, 260) // 160px down -> 80px damped, over the 70 threshold
    await act(async () => {
      window.dispatchEvent(touch('touchend', 200, 260))
    })
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh when the page is already scrolled down', () => {
    // Pre-existing behaviour, pinned so the axis work does not regress it.
    Object.defineProperty(window, 'scrollY', { value: 500, writable: true, configurable: true })
    const r = render(<Harness />)
    fire('touchstart', 200, 100)
    fire('touchmove', 200, 260)
    expect(pull(r)).toBe(0)
  })
})
