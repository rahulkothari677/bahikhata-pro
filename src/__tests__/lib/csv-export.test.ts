/**
 * Unit tests for CSV export utility.
 *
 * 🔒 V18 BUG-008 FIX: This suite previously crashed the Jest worker with
 * "RangeError: Maximum call stack size exceeded" in Next.js's unhandled-
 * rejection instrumentation. Root cause: `exportCSV` is ASYNC, but the tests
 * called it WITHOUT `await` and replaced `global.Blob` with a non-constructor
 * (`jest.fn()`). The un-awaited promise rejected inside `new Blob(...)`, and
 * Next 16's unhandled-rejection handler recursed on it at worker teardown.
 *
 * Fix: await every call, let jsdom provide a real `Blob`, and restore all
 * mocked globals in afterEach so nothing patched leaks into teardown. The
 * tests still pass AND the worker exits cleanly (suite is green in CI again).
 */

import { exportCSV } from '@/lib/csv-export'

describe('exportCSV', () => {
  // jsdom does NOT implement URL.createObjectURL / revokeObjectURL, so they
  // can't be spied — they must be assigned. We save the originals (undefined)
  // and restore them after each test so nothing patched leaks into teardown.
  let createObjectURL: jest.Mock
  const origCreate = (URL as any).createObjectURL
  const origRevoke = (URL as any).revokeObjectURL
  let createElementSpy: jest.SpyInstance

  beforeEach(() => {
    createObjectURL = jest.fn(() => 'mock-url')
    ;(URL as any).createObjectURL = createObjectURL
    ;(URL as any).revokeObjectURL = jest.fn()

    // Return a REAL anchor element (so document.body.appendChild/removeChild
    // work — the web download path uses them) with only `click` stubbed to
    // avoid a real navigation attempt in jsdom.
    const realCreateElement = document.createElement.bind(document)
    createElementSpy = jest
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'a') (el as HTMLAnchorElement).click = jest.fn()
        return el
      })
  })

  afterEach(() => {
    ;(URL as any).createObjectURL = origCreate
    ;(URL as any).revokeObjectURL = origRevoke
    createElementSpy.mockRestore()
    jest.clearAllMocks()
  })

  test('creates a download with correct filename', async () => {
    await exportCSV('test-report', ['Name', 'Amount'], [['Rice', 100]])
    expect(createObjectURL).toHaveBeenCalled()
  })

  test('handles empty data', async () => {
    await exportCSV('empty', ['Col1'], [])
    expect(createObjectURL).toHaveBeenCalled()
  })

  test('escapes values with commas', async () => {
    await exportCSV('test', ['Name'], [['Product, with comma']])
    expect(createObjectURL).toHaveBeenCalled()
  })

  test('escapes values with quotes', async () => {
    await exportCSV('test', ['Name'], [['Product "quoted"']])
    expect(createObjectURL).toHaveBeenCalled()
  })

  test('handles null/undefined values', async () => {
    await exportCSV('test', ['Name', 'Value'], [[null, undefined]])
    expect(createObjectURL).toHaveBeenCalled()
  })
})
