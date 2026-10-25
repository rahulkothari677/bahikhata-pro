/**
 * @jest-environment jsdom
 *
 * Phase 7g-4b — a saved bill's delivery can be changed (#226).
 *
 * The edit dialog kept the saved delivery state with no way to change it, so a
 * wrong delivery meant delete and re-enter. It now shows New Sale's OWN block
 * (components/ledger/DeliveryFields.tsx) — one block, one rule (deliveryCheck in
 * lib/gst-states.ts), the same the server applies (resolveBillDelivery keeps the
 * saved delivery only when an edit sends none).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { deliveryCheck } from '@/lib/gst-states'
import { DeliveryFields } from '@/components/ledger/DeliveryFields'
import { readCode } from '@/test-support/read-source'

const shop = { gstin: '08AAJFG2468H1Z7', state: 'Rajasthan' }
const buyer = { gstin: '27AAPPR4321Q1ZY', state: 'Maharashtra' } // registered in Maharashtra

describe('when "Who gets the goods" is asked (one rule)', () => {
  test('a registered buyer\'s goods to a state other than their GSTIN\'s', () => {
    expect(deliveryCheck({ shop, party: buyer, delivery: 'Gujarat', billToShipTo: null })).toEqual({ asksShipTo: true, needsShipToChoice: true, buyerLosesCredit: false })
    expect(deliveryCheck({ shop, party: buyer, delivery: 'Gujarat', billToShipTo: false })).toEqual({ asksShipTo: true, needsShipToChoice: false, buyerLosesCredit: true })
  })
  test('not when the goods go to the buyer\'s own state, or no delivery, or no GSTIN', () => {
    expect(deliveryCheck({ shop, party: buyer, delivery: 'Maharashtra', billToShipTo: null }).asksShipTo).toBe(false)
    expect(deliveryCheck({ shop, party: buyer, delivery: null, billToShipTo: null }).asksShipTo).toBe(false)
    expect(deliveryCheck({ shop, party: { gstin: null, state: 'Maharashtra' }, delivery: 'Gujarat', billToShipTo: null }).asksShipTo).toBe(false)
  })
})

describe('the block', () => {
  const props = {
    partyName: 'Patil Traders',
    deliveryState: 'Gujarat', onDeliveryState: jest.fn(),
    deliveryAddress: '', onDeliveryAddress: jest.fn(),
    onShipElsewhere: jest.fn(), onBillToShipTo: jest.fn(),
  }
  test('switched off: only the switch', () => {
    render(<DeliveryFields {...props} places={{ shop, party: buyer, delivery: null, billToShipTo: null }} shipElsewhere={false} billToShipTo={null} />)
    expect(screen.getByText('Ship to another address')).toBeTruthy()
    expect(screen.queryByText('Delivery state')).toBeNull()
  })
  test('to another state for a registered buyer: asks, and answers through the callback', () => {
    render(<DeliveryFields {...props} places={{ shop, party: buyer, delivery: 'Gujarat', billToShipTo: null }} shipElsewhere billToShipTo={null} />)
    expect(screen.getByText('Who gets the goods in Gujarat?')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'The buyer' }))
    expect(props.onBillToShipTo).toHaveBeenLastCalledWith(false)
  })
  test('"the buyer" in another state: says they cannot claim the GST', () => {
    render(<DeliveryFields {...props} places={{ shop, party: buyer, delivery: 'Gujarat', billToShipTo: false }} shipElsewhere billToShipTo={false} />)
    expect(screen.getByText(/Patil Traders can.t claim this GST/)).toBeTruthy()
  })
})

describe('both screens use the one block', () => {
  const entry = readCode('components/ledger/TransactionEntry.tsx')
  const detail = readCode('components/ledger/TransactionDetail.tsx')
  test('New Sale draws it; its own copy is gone', () => {
    expect(entry).toContain('<DeliveryFields')
    expect(entry).not.toContain('htmlFor="field-ship-elsewhere"')
    expect(entry).toContain('const asksShipTo = shipCheck.asksShipTo')
  })
  test('the edit dialog draws it, sends the delivery, and waits for the answer', () => {
    const at = detail.indexOf('function EditTransactionDialog(')
    const end = detail.indexOf('function PrintInvoice(', at)
    expect(at).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(at)
    const dialog = detail.slice(at, end)
    expect(dialog).toContain('<DeliveryFields')
    expect(dialog).toContain('deliveryState: delivery.on ? (delivery.state || null) : null')
    expect(dialog).toContain('disabled={saving || editTaxSplitPending}')
    expect(dialog).toContain('const editSupply = supplyKind(editPlaces)')
    // the GST type shown follows the EDITED delivery, not the saved one
    expect(dialog).not.toMatch(/delivery: transaction\?\.deliveryState \?\? null,\s*billToShipTo: savedBillToShipTo/)
  })
})
