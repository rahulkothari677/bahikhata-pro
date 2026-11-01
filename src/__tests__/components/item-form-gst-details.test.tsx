/**
 * @jest-environment jsdom
 *
 * #338 (D-21): a shop that is not registered charges no GST, so the item form keeps
 * HSN and the GST rate behind one closed "GST details" row. Not removed: the rate
 * still prices a registered supplier's GST into a purchase. A GST shop sees both
 * fields, as before, with HSN and the rate side by side.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProductDialog } from '@/components/inventory/ProductDialog'

let mockSetting: Record<string, unknown> = {}
jest.mock('@/hooks/use-setting', () => ({ useSetting: () => ({ setting: mockSetting, hideProfit: false }) }))
jest.mock('@/lib/offline-fetch', () => ({
  offlineFetch: jest.fn(async () => ({ ok: true, json: async () => ({ groups: [] }) })),
  isQueuedResponse: () => false,
}))

// jsdom has no matchMedia (NumberField asks whether the pointer is a mouse).
beforeAll(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never
})

const mount = (product?: Record<string, unknown>) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ProductDialog open onOpenChange={() => {}} product={product as never} onSuccess={() => {}} />
  </QueryClientProvider>,
)
const order = () => Array.from(document.querySelectorAll('label[for^="field-"]')).map((l) => l.getAttribute('for'))

describe('item form: GST details (#338)', () => {
  it('not registered: HSN and rate wait behind a closed row; one tap opens both', () => {
    mockSetting = { gstRegistered: false }
    mount()
    expect(document.getElementById('field-hsn-sac-code')).toBeNull()
    expect(document.getElementById('field-gst-rate')).toBeNull()
    const row = screen.getByRole('button', { name: /^GST details/ })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById('field-hsn-sac-code')).not.toBeNull()
    expect(order()).toEqual(expect.arrayContaining(['field-unit', 'field-hsn-sac-code', 'field-gst-rate']))
  })

  it('not registered, an item with HSN and a rate: the closed row says what is set', () => {
    mockSetting = { gstRegistered: false }
    mount({ id: 'p1', name: 'Atta 5kg', salePrice: 250, purchasePrice: 230, unit: 'pcs', hsn: '1101', gstRate: 5, gstTreatment: 'taxable', tracksInventory: true })
    expect(screen.getByRole('button', { name: /^GST details/ }).textContent).toMatch(/HSN 1101 · 5%/)
  })

  it('the row starts closed every time the form opens (it stayed open from the last item, local check 1 Nov)', () => {
    mockSetting = { gstRegistered: false }
    const atta = { id: 'p1', name: 'Atta 5kg', salePrice: 250, purchasePrice: 230, unit: 'pcs', hsn: '1101', gstRate: 5, gstTreatment: 'taxable', tracksInventory: true }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = (open: boolean) => (
      <QueryClientProvider client={client}>
        <ProductDialog open={open} onOpenChange={() => {}} product={atta as never} onSuccess={() => {}} />
      </QueryClientProvider>
    )
    const { rerender } = render(view(true))
    fireEvent.click(screen.getByRole('button', { name: /^GST details/ }))
    rerender(view(false))
    rerender(view(true))
    const row = screen.getByRole('button', { name: /^GST details/ })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(row.textContent).toMatch(/HSN 1101 · 5%/)
  })

  it('GST shop: no row, both fields shown, HSN right beside the rate', () => {
    mockSetting = { gstRegistered: true, gstin: '08AAAAA0000A1Z5' }
    mount()
    expect(screen.queryByRole('button', { name: /^GST details/ })).toBeNull()
    const o = order()
    expect(o.indexOf('field-gst-rate') - o.indexOf('field-hsn-sac-code')).toBe(1)
    expect(o.indexOf('field-unit')).toBeLessThan(o.indexOf('field-hsn-sac-code'))
  })

  it('#201: the two checkbox explanations sit behind ⓘ, not on screen', () => {
    mockSetting = { gstRegistered: true, gstin: '08AAAAA0000A1Z5' }
    mount()
    expect(document.body.textContent).not.toMatch(/For work you do rather than goods you keep/)
    expect(document.body.textContent).not.toMatch(/GST is taken out of the price/)
    expect(screen.getByRole('button', { name: /service/i })).toBeTruthy()
  })
})
