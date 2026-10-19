/**
 * @jest-environment node
 *
 * 🔒 GUARD: demo data is real data (19 Oct, Phase 5c).
 *
 * The demo-data maker (lib/seed.ts, behind "try demo data" on onboarding)
 * wrote its sales by hand: no cost price on the lines, the bill discount not
 * split, GST even on a not-registered shop. Insights then showed profit by
 * item adding up to ₹54,092 against ₹8,526 on the bills. Runs the real seed
 * against an in-memory store and checks every sample bill the way a filed
 * bill must hold.
 */
import { describe, test, expect, beforeEach } from '@jest/globals'

const mockStore = { sales: [] as any[], purchases: [] as any[], stock: new Map<string, any>(), setting: {} as Record<string, unknown>, id: 0 }
jest.mock('@/lib/db', () => ({
  db: {
    product: {
      count: async () => 0,
      create: async ({ data }: any) => ({ id: `p${++mockStore.id}`, priceIncludesGst: false, ...data }),
      update: async ({ where, data }: any) => { mockStore.stock.set(where.id, data); return data },
    },
    party: { create: async ({ data }: any) => ({ id: `c${++mockStore.id}`, ...data }) },
    setting: { upsert: async () => ({}), findUnique: async () => mockStore.setting },
    transaction: { create: async ({ data }: any) => { if (data.type === 'sale') mockStore.sales.push(data); if (data.type === 'purchase') mockStore.purchases.push(data); return data } },
  },
}))

import { seedDemoData } from '@/lib/seed'

const p = (r: number) => Math.round(r * 100)
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

beforeEach(() => { mockStore.sales = []; mockStore.purchases = []; mockStore.stock = new Map(); mockStore.id = 0 })

describe('demo sales are built by the billing code', () => {
  test('a GST shop: lines add up to the bill — value, discount, GST and profit — on every sample bill', async () => {
    mockStore.setting = { gstRegistered: true }
    await seedDemoData('u1')
    expect(mockStore.sales.length).toBeGreaterThan(30)
    let discounted = 0
    for (const s of mockStore.sales) {
      const lines = s.items.create as any[]
      const taxable = lines.map((l) => p(l.total) - p(l.cgst) - p(l.sgst) - p(l.igst))
      const cost = lines.map((l) => Math.round(l.quantity * p(l.purchasePriceAtSale)))
      if (s.discountAmount > 0) discounted++
      expect({ inv: s.invoiceNo, value: sum(taxable), profit: sum(taxable) - sum(cost), cgst: sum(lines.map((l) => p(l.cgst))), disc: sum(lines.map((l) => p(l.discountAmount))) })
        .toEqual({ inv: s.invoiceNo, value: p(s.subtotal) - p(s.discountAmount), profit: p(s.grossProfit), cgst: p(s.cgst), disc: p(s.discountAmount) })
      expect(p(s.totalAmount)).toBe(p(s.subtotal) - p(s.discountAmount) + p(s.cgst) + p(s.sgst) + p(s.igst))
      expect(lines.every((l) => l.purchasePriceAtSale > 0)).toBe(true)
    }
    expect(discounted).toBeGreaterThan(0)
    expect(mockStore.sales.some((s) => s.cgst > 0)).toBe(true)
  })

  test('stock is a running balance: opening + bought − sold = current, never below zero, for every item', async () => {
    mockStore.setting = {}
    await seedDemoData('u3')
    const net = new Map<string, number>()
    for (const t of [...mockStore.sales, ...mockStore.purchases]) {
      for (const l of t.items.create) net.set(l.productId, (net.get(l.productId) ?? 0) + (t.type === 'purchase' ? l.quantity : -l.quantity))
    }
    expect(mockStore.stock.size).toBe(15)
    for (const [id, s] of mockStore.stock) {
      expect({ id, current: s.currentStock }).toEqual({ id, current: s.openingStock + (net.get(id) ?? 0) })
      expect(s.openingStock).toBeGreaterThanOrEqual(0)
      expect(s.currentStock).toBeGreaterThanOrEqual(0)
    }
    expect([...mockStore.stock.values()].filter((s) => s.currentStock > 0).length).toBeGreaterThan(10)
  })

  test('a not-registered shop: no GST on any sample sale (Section 32(1) CGST Act)', async () => {
    mockStore.setting = { gstRegistered: false }
    await seedDemoData('u2')
    expect(mockStore.sales.length).toBeGreaterThan(30)
    expect(mockStore.sales.filter((s) => s.cgst || s.sgst || s.igst || (s.items.create as any[]).some((l) => l.gstRate || l.cgst || l.sgst))).toEqual([])
  })
})
