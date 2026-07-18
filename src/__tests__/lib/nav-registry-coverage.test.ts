/**
 * 🔒 AUDIT V25 §6.1 (Batch 8 Phase 1): Navigation Registry coverage test.
 *
 * Verifies that the NAV_REGISTRY contains every destination currently
 * hardcoded in the 6 nav surfaces. This test is the "parity guard" — if
 * a destination exists in a surface but NOT in the registry, this test
 * fails, ensuring the registry is always the complete source of truth.
 *
 * When a surface is migrated to render from the registry (Phases 2-7),
 * the corresponding hardcoded list is deleted. At that point, this test
 * becomes the "no hardcoded lists remain" guard (Phase 8).
 */

import { NAV_REGISTRY, getById, getByFrequency, getByCategory } from '@/lib/nav-registry'

describe('Navigation Registry (V25 §6.1 Phase 1)', () => {
  // ─── Registry integrity ───────────────────────────────────────────

  it('should have unique ids for every destination', () => {
    const ids = NAV_REGISTRY.map(d => d.id)
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(duplicates).toEqual([])
  })

  it('should have at least 50 destinations (covers all 6 surfaces)', () => {
    expect(NAV_REGISTRY.length).toBeGreaterThanOrEqual(50)
  })

  it('should have every destination with a label + icon + category + frequency', () => {
    for (const d of NAV_REGISTRY) {
      expect(d.label).toBeTruthy()
      expect(d.icon).toBeTruthy()
      expect(d.category).toBeTruthy()
      expect(d.frequency).toBeTruthy()
    }
  })

  // ─── Coverage: Sidebar main nav (8 items) ─────────────────────────

  it('should cover all Sidebar main nav items', () => {
    const sidebarIds = ['dashboard', 'scanner', 'sales', 'purchases', 'inventory', 'income-expense', 'parties', 'reports']
    for (const id of sidebarIds) {
      const d = getById(id)
      expect(d).toBeDefined()
      expect(d!.frequency).toBe('primary')
    }
  })

  // ─── Coverage: Sidebar Tools section (5 items) ────────────────────

  it('should cover all Sidebar Tools items', () => {
    const toolsIds = ['document-vault', 'ai-usage', 'ai-comparison', 'reconciliation', 'period-lock']
    for (const id of toolsIds) {
      const d = getById(id)
      expect(d).toBeDefined()
      expect(d!.frequency).toBe('secondary')
    }
  })

  // ─── Coverage: MobileBottomNav tabs (3 + More) ────────────────────

  it('should cover all MobileBottomNav tab views', () => {
    const tabIds = ['dashboard', 'sales', 'purchases']
    for (const id of tabIds) {
      const d = getById(id)
      expect(d).toBeDefined()
      expect(d!.frequency).toBe('primary')
    }
  })

  // ─── Coverage: MoreScreen items (26 items across 6 sections) ──────

  it('should cover all MoreScreen destinations', () => {
    const moreIds = [
      'new-sale', 'new-purchase', 'sale-return', 'purchase-return', 'estimates', 'income-expense',
      'reconciliation', 'period-lock',
      'bank-reconciliation', 'cash-in-hand', 'day-end-summary', 'whatsapp-reminders',
      'inventory', 'low-stock-alerts', 'parties',
      'multi-shop-management', 'staff-access',
      'reports',
      'scanner', 'voice-entry', 'barcode-scanner', 'ai-usage', 'smart-insights', 'document-vault',
    ]
    for (const id of moreIds) {
      const d = getById(id)
      expect(d).toBeDefined()
    }
  })

  // ─── Coverage: ReportsHub (16 report types in 4 categories) ───────

  it('should cover all ReportsHub report types', () => {
    const reportIds = [
      'pl', 'bill-profit', 'item-profit', 'party-statement', 'debt-aging', 'trial-balance',
      'gstr-1', 'gstr-3b', 'gstr-2b', 'gst-summary', 'hsn-summary',
      'stock-report', 'inventory-aging',
      'bank-reconciliation', 'cashflow', 'consolidated',
    ]
    for (const id of reportIds) {
      const d = getById(id)
      expect(d).toBeDefined()
      expect(d!.actionKind).toBe('navigate-report')
      expect(d!.actionParams?.reportType).toBeTruthy()
    }
  })

  // ─── Coverage: AccountScreen (14 items across 4 sections) ─────────

  it('should cover all AccountScreen destinations', () => {
    const accountIds = [
      'my-profile', 'business-card', 'subscription', 'security',
      'app-settings', 'feature-toggles', 'accounting-controls', 'data-backup',
      'staff-access', 'refer-earn',
      'help-support', 'rate-ekbook', 'about', 'logout',
    ]
    for (const id of accountIds) {
      const d = getById(id)
      expect(d).toBeDefined()
      expect(d!.category).toBe('account')
    }
  })

  // ─── Coverage: GlobalSearch commands (13 commands) ────────────────

  it('should cover all GlobalSearch command destinations', () => {
    const searchIds = [
      'new-sale', 'new-purchase', 'scanner', 'inventory', 'parties',
      'dashboard', 'sales', 'purchases', 'income-expense', 'reports',
      // Plus product/party/transaction search (runtime, not registry)
    ]
    for (const id of searchIds) {
      const d = getById(id)
      expect(d).toBeDefined()
    }
  })

  // ─── Action kind correctness ──────────────────────────────────────

  it('should have navigate-report destinations with reportType', () => {
    const reportDestinations = NAV_REGISTRY.filter(d => d.actionKind === 'navigate-report')
    for (const d of reportDestinations) {
      expect(d.actionParams?.reportType).toBeTruthy()
    }
  })

  it('should have navigate-account destinations with accountSection', () => {
    const accountDestinations = NAV_REGISTRY.filter(d => d.actionKind === 'navigate-account')
    for (const d of accountDestinations) {
      expect(d.actionParams?.accountSection).toBeTruthy()
    }
  })

  it('should have navigate-settings destinations with settingsTab', () => {
    const settingsDestinations = NAV_REGISTRY.filter(d => d.actionKind === 'navigate-settings')
    for (const d of settingsDestinations) {
      expect(d.actionParams?.settingsTab).toBeTruthy()
    }
  })

  it('should have navigate-scroll destinations with scrollTarget', () => {
    const scrollDestinations = NAV_REGISTRY.filter(d => d.actionKind === 'navigate-scroll')
    for (const d of scrollDestinations) {
      expect(d.actionParams?.scrollTarget).toBeTruthy()
    }
  })

  // ─── Frequency distribution ───────────────────────────────────────

  it('should have primary destinations for Sidebar + BottomNav', () => {
    const primary = getByFrequency('primary')
    expect(primary.length).toBeGreaterThanOrEqual(8)
    // Should include dashboard, sales, purchases, inventory, income-expense, parties, reports, scanner
    expect(primary.map(d => d.id)).toEqual(expect.arrayContaining([
      'dashboard', 'sales', 'purchases', 'inventory', 'income-expense', 'parties', 'reports', 'scanner'
    ]))
  })

  it('should have secondary destinations for More + Tools', () => {
    const secondary = getByFrequency('secondary')
    expect(secondary.length).toBeGreaterThanOrEqual(20)
  })

  it('should have tertiary destinations for AccountScreen', () => {
    const tertiary = getByFrequency('tertiary')
    expect(tertiary.length).toBeGreaterThanOrEqual(10)
  })

  // ─── Phase 8: Single source of truth verification ─────────────────

  it('Phase 8: should have every surface covered by at least one destination', () => {
    const surfaces = ['sidebar-main', 'sidebar-tools', 'bottom-nav', 'more', 'reports-hub', 'account', 'global-search']
    for (const surface of surfaces) {
      const items = NAV_REGISTRY.filter(d => d.surfaces?.includes(surface as any))
      expect(items.length).toBeGreaterThan(0)
    }
  })

  it('Phase 8: should have surfaces field on every destination', () => {
    for (const d of NAV_REGISTRY) {
      expect(d.surfaces).toBeDefined()
      expect(d.surfaces!.length).toBeGreaterThan(0)
    }
  })

  it('Phase 8: should have at least 5 items per major surface', () => {
    expect(NAV_REGISTRY.filter(d => d.surfaces?.includes('sidebar-main')).length).toBeGreaterThanOrEqual(8)
    expect(NAV_REGISTRY.filter(d => d.surfaces?.includes('sidebar-tools')).length).toBeGreaterThanOrEqual(5)
    expect(NAV_REGISTRY.filter(d => d.surfaces?.includes('bottom-nav')).length).toBeGreaterThanOrEqual(3)
    expect(NAV_REGISTRY.filter(d => d.surfaces?.includes('more')).length).toBeGreaterThanOrEqual(15)
    expect(NAV_REGISTRY.filter(d => d.surfaces?.includes('reports-hub')).length).toBeGreaterThanOrEqual(16)
    expect(NAV_REGISTRY.filter(d => d.surfaces?.includes('account')).length).toBeGreaterThanOrEqual(10)
    expect(NAV_REGISTRY.filter(d => d.surfaces?.includes('global-search')).length).toBeGreaterThanOrEqual(10)
  })
})
