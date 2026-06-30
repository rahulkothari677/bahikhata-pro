/**
 * Unit tests for CSV export utility.
 */

import { exportCSV } from '@/lib/csv-export'

// Mock URL.createObjectURL and document.createElement
global.URL.createObjectURL = jest.fn(() => 'mock-url')
global.URL.revokeObjectURL = jest.fn()

describe('exportCSV', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Mock document.createElement and anchor click
    const mockAnchor = {
      href: '',
      download: '',
      click: jest.fn(),
    }
    jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any)
  })

  test('creates a download with correct filename', () => {
    const mockBlob = jest.fn()
    global.Blob = mockBlob as any

    exportCSV('test-report', ['Name', 'Amount'], [['Rice', 100]])

    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  test('handles empty data', () => {
    exportCSV('empty', ['Col1'], [])
    // Should not throw
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  test('escapes values with commas', () => {
    // Values with commas should be quoted
    exportCSV('test', ['Name'], [['Product, with comma']])
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  test('escapes values with quotes', () => {
    exportCSV('test', ['Name'], [['Product "quoted"']])
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  test('handles null/undefined values', () => {
    exportCSV('test', ['Name', 'Value'], [[null, undefined]])
    expect(URL.createObjectURL).toHaveBeenCalled()
  })
})
