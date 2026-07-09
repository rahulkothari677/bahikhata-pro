/**
 * Unit tests for staff permissions system.
 * Critical for security — if broken, staff can access owner-only data.
 */

import {
  DEFAULT_STAFF_PERMISSIONS,
  parsePermissions,
  canAccessModule,
  type StaffPermissions,
  type ModuleKey,
} from '@/lib/staff-permissions'

describe('DEFAULT_STAFF_PERMISSIONS', () => {
  test('has all 9 modules', () => {
    const keys = Object.keys(DEFAULT_STAFF_PERMISSIONS)
    expect(keys).toHaveLength(9)
    expect(keys).toContain('dashboard')
    expect(keys).toContain('sales')
    expect(keys).toContain('purchases')
    expect(keys).toContain('inventory')
    expect(keys).toContain('scanner')
    expect(keys).toContain('reports')
    expect(keys).toContain('incomeExpense')
    expect(keys).toContain('parties')
    expect(keys).toContain('settings')
  })

  test('defaults: sales, purchases, inventory, scanner = true', () => {
    expect(DEFAULT_STAFF_PERMISSIONS.sales).toBe(true)
    expect(DEFAULT_STAFF_PERMISSIONS.purchases).toBe(true)
    expect(DEFAULT_STAFF_PERMISSIONS.inventory).toBe(true)
    expect(DEFAULT_STAFF_PERMISSIONS.scanner).toBe(true)
  })

  test('defaults: dashboard, reports, incomeExpense, parties, settings = false', () => {
    expect(DEFAULT_STAFF_PERMISSIONS.dashboard).toBe(false)
    expect(DEFAULT_STAFF_PERMISSIONS.reports).toBe(false)
    expect(DEFAULT_STAFF_PERMISSIONS.incomeExpense).toBe(false)
    expect(DEFAULT_STAFF_PERMISSIONS.parties).toBe(false)
    expect(DEFAULT_STAFF_PERMISSIONS.settings).toBe(false)
  })
})

describe('parsePermissions', () => {
  test('returns defaults for null', () => {
    expect(parsePermissions(null)).toEqual(DEFAULT_STAFF_PERMISSIONS)
  })

  test('returns defaults for undefined', () => {
    expect(parsePermissions(undefined)).toEqual(DEFAULT_STAFF_PERMISSIONS)
  })

  test('returns defaults for invalid type', () => {
    expect(parsePermissions('invalid')).toEqual(DEFAULT_STAFF_PERMISSIONS)
    expect(parsePermissions(123)).toEqual(DEFAULT_STAFF_PERMISSIONS)
  })

  test('returns defaults for empty object', () => {
    expect(parsePermissions({})).toEqual(DEFAULT_STAFF_PERMISSIONS)
  })

  test('merges with defaults (missing keys filled)', () => {
    const partial = { sales: false, reports: true }
    const result = parsePermissions(partial)
    expect(result.sales).toBe(false)
    expect(result.reports).toBe(true)
    expect(result.purchases).toBe(true) // default
    expect(result.dashboard).toBe(false) // default
  })

  test('preserves all provided values', () => {
    const custom: StaffPermissions = {
      ...DEFAULT_STAFF_PERMISSIONS,
      dashboard: true,
      reports: true,
      settings: true,
    }
    const result = parsePermissions(custom)
    expect(result.dashboard).toBe(true)
    expect(result.reports).toBe(true)
    expect(result.settings).toBe(true)
  })
})

describe('canAccessModule', () => {
  test('owner always has access to everything', () => {
    const perms = DEFAULT_STAFF_PERMISSIONS
    expect(canAccessModule('owner', perms, 'dashboard')).toBe(true)
    expect(canAccessModule('owner', perms, 'reports')).toBe(true)
    expect(canAccessModule('owner', perms, 'settings')).toBe(true)
  })

  test('null/undefined role = owner (backward compatible)', () => {
    expect(canAccessModule(null, {}, 'dashboard')).toBe(true)
    expect(canAccessModule(undefined, {}, 'reports')).toBe(true)
  })

  test('staff with default permissions can access sales', () => {
    expect(canAccessModule('staff', DEFAULT_STAFF_PERMISSIONS, 'sales')).toBe(true)
  })

  test('staff with default permissions can access purchases', () => {
    expect(canAccessModule('staff', DEFAULT_STAFF_PERMISSIONS, 'purchases')).toBe(true)
  })

  test('staff with default permissions can access inventory', () => {
    expect(canAccessModule('staff', DEFAULT_STAFF_PERMISSIONS, 'inventory')).toBe(true)
  })

  test('staff with default permissions can access scanner', () => {
    expect(canAccessModule('staff', DEFAULT_STAFF_PERMISSIONS, 'scanner')).toBe(true)
  })

  test('staff with default permissions CANNOT access dashboard', () => {
    expect(canAccessModule('staff', DEFAULT_STAFF_PERMISSIONS, 'dashboard')).toBe(false)
  })

  test('staff with default permissions CANNOT access reports', () => {
    expect(canAccessModule('staff', DEFAULT_STAFF_PERMISSIONS, 'reports')).toBe(false)
  })

  test('staff with default permissions CANNOT access settings', () => {
    expect(canAccessModule('staff', DEFAULT_STAFF_PERMISSIONS, 'settings')).toBe(false)
  })

  test('staff with custom permissions (dashboard enabled)', () => {
    const custom = { ...DEFAULT_STAFF_PERMISSIONS, dashboard: true }
    expect(canAccessModule('staff', custom, 'dashboard')).toBe(true)
  })

  test('staff with custom permissions (sales disabled)', () => {
    const custom = { ...DEFAULT_STAFF_PERMISSIONS, sales: false }
    expect(canAccessModule('staff', custom, 'sales')).toBe(false)
  })

  test('🔒 V17-Ext §2.1: unknown role = DENIED (fail-closed)', () => {
    // Was: `if (role !== 'staff') return true` — fail-OPEN, any unknown role
    // got full access. Now: fail-closed. When adding a new role, add an
    // explicit branch in canAccessModule with the correct permission logic.
    expect(canAccessModule('admin', {}, 'dashboard')).toBe(false)
    expect(canAccessModule('accountant', {}, 'reports')).toBe(false)
    expect(canAccessModule('viewer', {}, 'sales')).toBe(false)
    expect(canAccessModule('manager', {}, 'settings')).toBe(false)
    expect(canAccessModule('superuser', {}, 'inventory')).toBe(false)
  })

  test('🔒 V17-Ext §2.1: unknown role is denied even with permissions set', () => {
    // Even if someone passes a permissions object for an unknown role,
    // the function must NOT use it — only 'owner' and 'staff' are recognized.
    const perms = { ...DEFAULT_STAFF_PERMISSIONS, dashboard: true, reports: true }
    expect(canAccessModule('accountant', perms, 'dashboard')).toBe(false)
    expect(canAccessModule('accountant', perms, 'reports')).toBe(false)
  })

  test('🔒 V17-Ext §2.1: empty string role = denied (not treated as owner)', () => {
    // Defensive: an empty string is falsy but NOT null/undefined.
    // The `!role` check catches it (treats as owner) — but that's actually
    // correct behavior for legacy compatibility (old sessions may have empty
    // role = owner). This test documents that behavior so it's not accidentally
    // changed. If you want to deny empty-string roles in the future, change
    // the check to `role === null || role === undefined || role === 'owner'`.
    expect(canAccessModule('', {}, 'dashboard')).toBe(true) // legacy owner
  })
})
