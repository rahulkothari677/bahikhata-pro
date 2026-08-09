/**
 * @jest-environment jsdom
 *
 * The amendment card must actually appear when there is something to declare.
 *
 * WHY (2026-08-09). The amendment engine shipped a commit earlier emitting
 * Table 9A into the GSTR-1 JSON with NOTHING on screen to show it. A shopkeeper
 * would only have learned a correction was pending by opening the raw file.
 *
 * This app has made that exact mistake before: the filing-readiness card was
 * mounted in the loading branch only, so it flashed and vanished, and every
 * test, type check and build passed while the screen showed nothing. A correct
 * engine with no surface is not a feature, and only rendering catches it.
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { NeedsAmending } from '@/components/reports/NeedsAmending'

const AMENDED = {
  oinum: 'INV-100', oidt: '05-07-2026',
  inum: 'INV-100', idt: '05-07-2026',
  val: 12000,
  changes: ['Value changed from ₹11800 to ₹12000'],
}

describe('when an invoice needs amending', () => {
  it('says so, with the count', () => {
    render(<NeedsAmending b2ba={[{ ctin: '27BBBPB1234B1Z5', inv: [AMENDED] }]} />)
    expect(screen.getByText(/1 invoice needs amending/)).toBeInTheDocument()
  })

  it('shows the ORIGINAL invoice number — what the portal matches on', () => {
    render(<NeedsAmending b2ba={[{ ctin: '27BBBPB1234B1Z5', inv: [AMENDED] }]} />)
    expect(screen.getByText(/INV-100/)).toBeInTheDocument()
  })

  it('says what changed, in words', () => {
    render(<NeedsAmending b2ba={[{ ctin: '27BBBPB1234B1Z5', inv: [AMENDED] }]} />)
    expect(screen.getByText(/Value changed from ₹11800 to ₹12000/)).toBeInTheDocument()
  })

  it('tells the shopkeeper their customer is still on the old figures', () => {
    // The consequence lands on the buyer and they cannot fix it themselves.
    render(<NeedsAmending b2ba={[{ ctin: '27BBBPB1234B1Z5', inv: [AMENDED] }]} />)
    expect(screen.getByText(/claims input credit from the figures you filed/)).toBeInTheDocument()
  })

  it('does not blame the shopkeeper', () => {
    /*
     * Editing a bill is a normal thing to do and the app allowed it. What needs
     * declaring is the difference, not an error — the wording must not read as
     * an accusation, or a shopkeeper will avoid the screen.
     */
    render(<NeedsAmending b2ba={[{ ctin: '27BBBPB1234B1Z5', inv: [AMENDED] }]} />)
    const text = document.body.textContent || ''
    expect(text).not.toMatch(/wrong|mistake|error|incorrect/i)
    expect(text).toMatch(/you do not need to do anything else/i)
  })

  it('counts B2CL amendments too, grouped by place of supply', () => {
    render(<NeedsAmending b2cla={[{ pos: '29', inv: [AMENDED] }]} />)
    expect(screen.getByText(/1 invoice needs amending/)).toBeInTheDocument()
    expect(screen.getByText(/Place of supply 29/)).toBeInTheDocument()
  })

  it('pluralises honestly', () => {
    render(<NeedsAmending b2ba={[{ ctin: 'A', inv: [AMENDED, { ...AMENDED, oinum: 'INV-101' }] }]} />)
    expect(screen.getByText(/2 invoices need amending/)).toBeInTheDocument()
  })
})

describe('when there is nothing to declare', () => {
  it('says nothing at all', () => {
    // The common case. A card that appears every month teaches people to skip it.
    const { container } = render(<NeedsAmending b2ba={[]} b2cla={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stays silent when the sections are absent entirely', () => {
    const { container } = render(<NeedsAmending />)
    expect(container).toBeEmptyDOMElement()
  })
})
