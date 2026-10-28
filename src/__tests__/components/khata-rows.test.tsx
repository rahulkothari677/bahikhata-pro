/**
 * @jest-environment jsdom
 *
 * Phase 7h — Khata as compact rows (#284).
 *
 * On a phone each party was a ~330 px card (two a screen) that said the balance
 * twice ("lene hain" and "They owe you"). Now one row, as Items (#200): name and
 * balance, then the last bill or payment and the balance in words. Edit stays its
 * own 48 px button (#31), never inside the row's button.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { readCode } from '@/test-support/read-source'
import { billDayKey } from '@/lib/bill-days'

jest.mock('@/hooks/use-translation', () => {
  const words: Record<string, string> = {
    'khata.last': 'Last {d}', 'khata.no_bills': 'No bills yet', 'khata.settled': 'Settled',
    'stat.lene_hain': 'lene hain', 'stat.dene_hain': 'dene hain', 'bills.today': 'Today', 'bills.yesterday': 'Yesterday',
  }
  return { useTranslation: () => ({ t: (k: string) => words[k] ?? k }) }
})

import { PartyRow } from '@/components/parties/Parties'

const today = new Date().toISOString()

function row(party: Record<string, unknown>) {
  const onOpen = jest.fn()
  const onEdit = jest.fn()
  render(<PartyRow party={{ id: 'p1', name: 'Gupta Kirana Bhandar', type: 'customer', ...party }} onOpen={onOpen} onEdit={onEdit} />)
  return { onOpen, onEdit }
}

describe('one row per party', () => {
  it('a customer who owes: the amount, "lene hain" once, and the last activity', () => {
    row({ balance: 1200, lastAt: today })
    expect(screen.getByText('₹1,200')).toBeTruthy()
    expect(screen.getAllByText('lene hain')).toHaveLength(1)
    expect(screen.getByText('Last Today')).toBeTruthy()
    expect(screen.queryByText(/They owe you/)).toBeNull()
  })
  it('a party you owe: "dene hain"; a settled one says so; no activity says so', () => {
    row({ balance: -450, lastAt: null })
    expect(screen.getByText('₹450')).toBeTruthy()
    expect(screen.getByText('dene hain')).toBeTruthy()
    expect(screen.getByText('No bills yet')).toBeTruthy()
  })
  it('settled', () => {
    row({ balance: 0, lastAt: today })
    expect(screen.getByText('Settled')).toBeTruthy()
    expect(screen.queryByText(/hain/)).toBeNull()
  })
  it('the day is the bills\' own IST day (lib/bill-days.ts)', () => {
    expect(billDayKey(today)).toBe(billDayKey(new Date()))
  })
  it('tapping the row opens the party; ✎ edits without opening it', () => {
    const { onOpen, onEdit } = row({ balance: 1200, lastAt: today })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Gupta Kirana Bhandar' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Gupta Kirana Bhandar'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('Khata draws the rows', () => {
  const code = readCode('components/parties/Parties.tsx')
  it('the phone (and the desktop row view) render PartyRow; the tall card is gone', () => {
    expect(code).toMatch(/<PartyRow\s/)
    expect(code).not.toMatch(/They owe you/)
  })
  it('edit is a 48 px button beside the row, not inside it', () => {
    const at = code.indexOf('export function PartyRow(')
    const block = code.slice(at, code.indexOf('function PartyDialog(', at))
    expect(block).toContain('size="iconTouch"')
    // the row's own button closes before the edit button opens
    expect(block.indexOf('</button>')).toBeLessThan(block.indexOf('aria-label={`Edit ${p.name}`}'))
  })
})
