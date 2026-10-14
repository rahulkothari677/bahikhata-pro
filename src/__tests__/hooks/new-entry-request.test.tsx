/**
 * @jest-environment jsdom
 *
 * 🔒 GUARD: "open the add form" survives the screen not existing yet (Phase 5a-3).
 *
 * "Add Product", "Add Customer/Supplier" and the + sheet's "New item",
 * "New customer" and "Income / Expense" navigated and bumped a counter in the
 * same tick. The target screen mounted afterwards, took the bumped counter as
 * its baseline, and the form never opened — only the list did (likely #214).
 *
 * The fix is a request that waits in the store until the right screen takes it.
 * Tested here the way the bug happened: request FIRST, screen mounts AFTER.
 */
import React from 'react'
import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { render, act } from '@testing-library/react'
import * as fs from 'fs'
import * as path from 'path'

jest.mock('sonner', () => ({ toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() } }))

import { useAppStore, type ViewType } from '@/store/app-store'
import { useNewEntryRequest } from '@/hooks/use-new-entry-request'
import { handleNavAction } from '@/lib/handle-nav-action'
import { NAV_REGISTRY } from '@/lib/nav-registry'

function Screen({ view, onOpen }: { view: ViewType; onOpen: () => void }) {
  useNewEntryRequest(view, onOpen)
  return null
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => { useAppStore.getState().clearNewEntryRequest() })

describe('the request reaches the screen (good and bad cases)', () => {
  test('requested before the screen mounts: the form still opens, once, and the request is used up', async () => {
    useAppStore.getState().requestNewEntry('inventory')
    const onOpen = jest.fn()
    render(<Screen view="inventory" onOpen={onOpen} />)
    await flush()
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().pendingNewEntryView).toBeNull()
  })

  test('requested while the screen is already open: it opens too', async () => {
    const onOpen = jest.fn()
    render(<Screen view="parties" onOpen={onOpen} />)
    await act(async () => { useAppStore.getState().requestNewEntry('parties') })
    await flush()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('a request for another screen is left alone', async () => {
    useAppStore.getState().requestNewEntry('income-expense')
    const onOpen = jest.fn()
    render(<Screen view="inventory" onOpen={onOpen} />)
    await flush()
    expect(onOpen).not.toHaveBeenCalled()
    expect(useAppStore.getState().pendingNewEntryView).toBe('income-expense')
  })
})

describe('every "add" shortcut in the app uses the request', () => {
  const asking = NAV_REGISTRY.filter((d) => d.actionParams?.fireTriggerNewEntry)

  test('the shared handler turns fireTriggerNewEntry into a request for the target screen', () => {
    for (const d of asking) {
      useAppStore.getState().clearNewEntryRequest()
      handleNavAction(d)
      expect(useAppStore.getState().pendingNewEntryView).toBe(d.view)
    }
    expect(asking.map((d) => d.id)).toEqual(expect.arrayContaining(['add-product', 'add-party', 'new-income-expense']))
  })

  test('each target screen consumes the request for its own view', () => {
    const src = path.resolve(process.cwd(), 'src/components')
    const files: string[] = []
    const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full); else if (e.name.endsWith('.tsx')) files.push(fs.readFileSync(full, 'utf8'))
    })
    walk(src)
    for (const view of new Set(asking.map((d) => d.view))) {
      const consumer = files.some((code) => code.includes(`useNewEntryRequest('${view}'`))
      expect({ view, consumer }).toEqual({ view, consumer: true })
    }
  })
})
