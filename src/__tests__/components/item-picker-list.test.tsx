/**
 * @jest-environment jsdom
 *
 * Phase 7c, change C11 — the List design on screen (Rahul, 22–24 Oct): group
 * tabs, product tabs in a big group, one row per product with all its sizes on
 * that row, a list window; Side view puts the groups in a column. Drawn from the
 * big general store (test-support/big-shop-catalog.ts).
 */
import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ItemPicker, type ItemPickerProps } from '@/components/ledger/ItemPicker'
import { bigShopCatalog } from '@/test-support/big-shop-catalog'

const products = bigShopCatalog().map((c, i) => ({
  id: `p${i}`, name: c.name, category: c.category, unit: c.unit, salePrice: c.price, gstRate: c.gst,
  currentStock: c.stock, lowStockThreshold: 3, tracksInventory: true,
  familyId: c.family ? `f:${c.family}` : null, family: c.family ? { id: `f:${c.family}`, name: c.family } : null,
  sizeLabel: c.sizeLabel ?? null, sizeRank: i,
}))
const idOf = (name: string) => products.find((p) => p.name === name)!.id

function draw(over: Partial<ItemPickerProps> = {}) {
  const added: string[] = []
  const props: ItemPickerProps = {
    products, query: '', onQuery: () => {}, onEnter: () => {}, result: { items: [], total: 0 } as any,
    oftenIds: [idOf('Parle-G ₹10'), idOf('Tata Salt 1 kg')], oftenLabel: 'Often sold', usualIds: [],
    billLines: 0, qtyOf: () => 0, priceOf: (p) => p.salePrice, showsGst: false,
    onAdd: (p) => added.push(p.name), onDecrement: () => {}, empty: <p>empty</p>, ...over,
  }
  const view = render(<ItemPicker {...props} />)
  return { added, view }
}
const groupTabs = () => within(screen.getByRole('group', { name: 'Groups' }))

describe('the List', () => {
  test('opens on ★ Often, then every group as a tab, best sellers\' groups first', () => {
    draw()
    const tabs = groupTabs().getAllByRole('button').map((b) => b.textContent)
    expect(tabs.slice(0, 3)).toEqual(['★ Often', 'Biscuits', 'Sugar & salt'])
    expect(tabs).toHaveLength(15)
    expect(screen.getByRole('button', { name: '★ Often' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: 'Parle-G sizes' })).toBeInTheDocument()
  })

  test('a row carries ALL its sizes on one line, each with its price; one tap adds that size', () => {
    const { added } = draw()
    fireEvent.click(groupTabs().getByRole('button', { name: 'Atta & flour' }))
    const sizes = within(screen.getByRole('group', { name: 'Aashirvaad Atta sizes' })).getAllByRole('button')
    expect(sizes.map((b) => b.textContent)).toEqual(['1 kg₹52', '2 kg₹101', '5 kg₹244', '10 kg₹473', '20 kg₹926'])
    fireEvent.click(screen.getByRole('button', { name: 'Add Aashirvaad Atta 5 kg' }))
    expect(added).toEqual(['Aashirvaad Atta 5 kg'])
  })

  test('a big group gets product tabs; picking one narrows the window to that product', () => {
    draw()
    fireEvent.click(groupTabs().getByRole('button', { name: 'Spices' }))
    const products = within(screen.getByRole('group', { name: 'Products' }))
    expect(products.getAllByRole('button')).toHaveLength(13) // All + 12 products
    fireEvent.click(products.getByRole('button', { name: 'Haldi' }))
    const rows = screen.getAllByRole('group', { name: / sizes$/ }).map((g) => g.getAttribute('aria-label'))
    expect(rows).toHaveLength(10)
    expect(rows.every((r) => r!.endsWith('Haldi sizes'))).toBe(true)
  })

  test('a loose good shows its rate and sits in its product\'s tab beside the brands', () => {
    draw()
    fireEvent.click(groupTabs().getByRole('button', { name: 'Atta & flour' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Products' })).getByRole('button', { name: 'Atta' }))
    expect(within(screen.getByRole('group', { name: 'Chakki Atta sizes' })).getByRole('button').textContent).toBe('1 kg₹40/kg')
  })

  test('on the bill: the size shows how many, carries a −, and its group tab a count', () => {
    const id = idOf('Aashirvaad Atta 5 kg')
    draw({ qtyOf: (x) => (x === id ? 2 : 0), billLines: 1 })
    expect(groupTabs().getByRole('button', { name: 'Atta & flour 1' })).toBeInTheDocument()
    fireEvent.click(groupTabs().getByRole('button', { name: 'Atta & flour 1' }))
    expect(screen.getByRole('button', { name: 'Add another Aashirvaad Atta 5 kg' }).textContent).toBe('5 kg×2')
    expect(screen.getByRole('button', { name: 'One less Aashirvaad Atta 5 kg' })).toBeInTheDocument()
  })

  test('search shows its rows in the same window, in place of the tabs', () => {
    const hit = products.filter((p) => p.name.startsWith('Parle-G'))
    draw({ query: 'parle', result: { items: hit, total: hit.length } as any })
    expect(screen.queryByRole('group', { name: 'Groups' })).toBeNull()
    expect(screen.getByText('Searching every item')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Parle-G sizes' })).getAllByRole('button')).toHaveLength(4)
  })
})

describe('Side view (⚙ on New Sale)', () => {
  test('the groups go in a column on the left; the same rows wrap beside it', () => {
    draw({ sideView: true })
    const rail = screen.getByRole('group', { name: 'Groups' })
    expect(rail.className).toContain('overflow-y-auto')
    fireEvent.click(within(rail).getByRole('button', { name: 'Spices' }))
    expect(within(rail).getByRole('button', { name: 'Spices' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: 'Products' })).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: / sizes$/ })[0].className).toContain('flex-wrap')
  })
})

describe('switches from ⚙ reach the size buttons', () => {
  test('stock: "out" and "2 left" can be switched off; the most-sold mark too', () => {
    const outId = products.find((p) => p.family?.name === 'Aashirvaad Atta')!.id
    const shown = products.map((p) => (p.id === outId ? { ...p, currentStock: 0 } : p))
    const { view } = draw({ products: shown, oftenIds: [idOf('Aashirvaad Atta 5 kg')] })
    fireEvent.click(groupTabs().getByRole('button', { name: 'Atta & flour' }))
    expect(screen.getByRole('button', { name: 'Add Aashirvaad Atta 1 kg' }).textContent).toBe('1 kgout')
    expect(screen.getByRole('button', { name: 'Add Aashirvaad Atta 5 kg' }).className).toContain('border-primary/60')
    view.unmount()
    draw({ products: shown, oftenIds: [idOf('Aashirvaad Atta 5 kg')], sizeStock: false, sizeMark: false })
    fireEvent.click(groupTabs().getByRole('button', { name: 'Atta & flour' }))
    expect(screen.getByRole('button', { name: 'Add Aashirvaad Atta 1 kg' }).textContent).toBe('1 kg₹52')
    expect(screen.getByRole('button', { name: 'Add Aashirvaad Atta 5 kg' }).className).not.toContain('border-primary/60')
  })
})
