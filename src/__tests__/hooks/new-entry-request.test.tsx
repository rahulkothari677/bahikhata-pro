/**
 * @jest-environment jsdom
 *
 * 🔒 GUARD: "do this when you arrive" survives the screen not existing yet
 * (Phase 5a-3, widened in 5b-2).
 *
 * Shortcuts navigated and bumped a counter in the same tick. The target screen
 * mounted afterwards, took the bumped counter as its baseline, and nothing
 * happened — only the screen opened. Found for the add forms (#214), then in
 * 5b-2 for Close day and Reminders from More, and Speak / Barcode.
 *
 * The fix is a request that waits in the store until the right screen takes
 * it. Tested here the way the bug happened: request FIRST, screen mounts AFTER.
 * And the class: the shared opener may not bump a counter and navigate.
 */
import React from 'react'
import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { render, act } from '@testing-library/react'
import * as fs from 'fs'
import * as path from 'path'

jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }))

import { useAppStore, type ArrivalAction, type ViewType } from '@/store/app-store'
import { useArrivalRequest } from '@/hooks/use-new-entry-request'
import { handleNavAction } from '@/lib/handle-nav-action'
import { NAV_REGISTRY, getById } from '@/lib/nav-registry'
import { readCode } from '@/test-support/read-source'

function Screen({ view, action, onRun }: { view: ViewType; action: ArrivalAction; onRun: () => void }) {
  useArrivalRequest(view, action, onRun)
  return null
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const pending = () => useAppStore.getState().pendingArrival

beforeEach(() => { useAppStore.getState().clearArrival() })

describe('the request reaches the screen (good and bad cases)', () => {
  test('requested before the screen mounts: it still runs, once, and the request is used up', async () => {
    useAppStore.getState().requestOnArrival('inventory', 'new-entry')
    const onRun = jest.fn()
    render(<Screen view="inventory" action="new-entry" onRun={onRun} />)
    await flush()
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(pending()).toBeNull()
  })

  test('requested while the screen is already open: it runs too', async () => {
    const onRun = jest.fn()
    render(<Screen view="parties" action="bulk-reminders" onRun={onRun} />)
    await act(async () => { useAppStore.getState().requestOnArrival('parties', 'bulk-reminders') })
    await flush()
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  test('a request for another screen, or another action on this screen, is left alone', async () => {
    const onRun = jest.fn()
    useAppStore.getState().requestOnArrival('income-expense', 'new-entry')
    render(<Screen view="inventory" action="new-entry" onRun={onRun} />)
    await flush()
    expect(onRun).not.toHaveBeenCalled()
    useAppStore.getState().requestOnArrival('new-sale', 'barcode')
    render(<Screen view="new-sale" action="voice" onRun={onRun} />)
    await flush()
    expect(onRun).not.toHaveBeenCalled()
    expect(pending()).toEqual({ view: 'new-sale', action: 'barcode' })
  })
})

describe('every shortcut in the app arrives as a request', () => {
  test('add forms: fireTriggerNewEntry becomes a request for the target screen', () => {
    const asking = NAV_REGISTRY.filter((d) => d.actionParams?.fireTriggerNewEntry)
    for (const d of asking) {
      useAppStore.getState().clearArrival()
      handleNavAction(d)
      expect(pending()).toEqual({ view: d.view, action: 'new-entry' })
    }
    expect(asking.map((d) => d.id)).toEqual(expect.arrayContaining(['add-product', 'add-party', 'new-income-expense']))
  })

  test('Close day, Reminders, Speak and Barcode (5b-2)', () => {
    const cases: [string, ViewType, ArrivalAction][] = [
      ['day-end-summary', 'dashboard', 'day-end'],
      ['whatsapp-reminders', 'parties', 'bulk-reminders'],
      ['voice-entry', 'new-sale', 'voice'],
      ['barcode-scanner', 'new-sale', 'barcode'],
    ]
    for (const [id, view, action] of cases) {
      useAppStore.getState().clearArrival()
      handleNavAction(getById(id)!)
      expect({ id, req: pending(), now: useAppStore.getState().currentView }).toEqual({ id, req: { view, action }, now: view })
    }
  })

  /** Calls in the opener that bump a counter for a screen it is about to open. */
  function bumpsThenNavigates(code: string): string[] {
    return [...code.matchAll(/store\.(fireTrigger\w+)\(\)/g)].map((m) => m[1])
      .filter((name) => name !== 'fireTriggerNewEntry') // only reached when there is no target view
  }
  test('the class rule works on good and bad input', () => {
    expect(bumpsThenNavigates("store.requestOnArrival('parties', 'bulk-reminders'); store.setView('parties')")).toEqual([])
    expect(bumpsThenNavigates("store.fireTriggerDayEnd(); store.setView('dashboard')")).toEqual(['fireTriggerDayEnd'])
  })
  test('the shared opener bumps no counter before opening a screen', () => {
    // The whole file: balancedBlock from the function name stopped at the
    // `opts?: { … }` type in its signature and read no body at all — caught
    // by the break-test (one failure where two were due).
    const code = readCode('src/lib/handle-nav-action.ts')
    expect(code).toMatch(/case 'navigate-bulk':/) // reading the real opener
    expect(bumpsThenNavigates(code)).toEqual([])
  })

  test('each target screen consumes its request', () => {
    const src = path.resolve(process.cwd(), 'src/components')
    const files: string[] = []
    const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full); else if (e.name.endsWith('.tsx')) files.push(fs.readFileSync(full, 'utf8'))
    })
    walk(src)
    const wanted = [
      ...new Set(NAV_REGISTRY.filter((d) => d.actionParams?.fireTriggerNewEntry).map((d) => `useNewEntryRequest('${d.view}'`)),
      "useArrivalRequest('dashboard', 'day-end'",
      "useArrivalRequest('parties', 'bulk-reminders'",
      "useArrivalRequest(entryView, 'voice'",
      "useArrivalRequest(entryView, 'barcode'",
    ]
    for (const w of wanted) expect({ w, consumer: files.some((code) => code.includes(w)) }).toEqual({ w, consumer: true })
  })
})
