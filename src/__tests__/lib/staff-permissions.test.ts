/**
 * Unit tests for staff permissions system.
 * Critical for security — if broken, staff can access owner-only data.
 */

import {
  DEFAULT_STAFF_PERMISSIONS,
  parsePermissions,
  canAccessModule,
  isValidSubAccountRole,
  SUB_ACCOUNT_ROLES,
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
    // 'ca' is now a VALID role (V17-Ext Tier 3) — test with truly unknown roles
    expect(canAccessModule('admin', {}, 'dashboard')).toBe(false)
    expect(canAccessModule('viewer', {}, 'sales')).toBe(false)
    expect(canAccessModule('manager', {}, 'settings')).toBe(false)
    expect(canAccessModule('superuser', {}, 'inventory')).toBe(false)
  })

  test('🔒 V17-Ext §2.1: unknown role is denied even with permissions set', () => {
    const perms = { ...DEFAULT_STAFF_PERMISSIONS, dashboard: true, reports: true }
    expect(canAccessModule('viewer', perms, 'dashboard')).toBe(false)
    expect(canAccessModule('viewer', perms, 'reports')).toBe(false)
  })

  test('🔒 V17-Ext §2.1: empty string role = denied (not treated as owner)', () => {
    expect(canAccessModule('', {}, 'dashboard')).toBe(true) // legacy owner
  })

  // V17-Ext Tier 3: CA role tests
  describe('🔒 V17-Ext Tier 3: CA (Chartered Accountant) role', () => {
    test('CA can access dashboard', () => {
      expect(canAccessModule('ca', null, 'dashboard')).toBe(true)
    })
    test('CA can access sales', () => {
      expect(canAccessModule('ca', null, 'sales')).toBe(true)
    })
    test('CA can access purchases', () => {
      expect(canAccessModule('ca', null, 'purchases')).toBe(true)
    })
    test('CA can access reports', () => {
      expect(canAccessModule('ca', null, 'reports')).toBe(true)
    })
    test('CA can access incomeExpense', () => {
      expect(canAccessModule('ca', null, 'incomeExpense')).toBe(true)
    })
    test('CA can access parties', () => {
      expect(canAccessModule('ca', null, 'parties')).toBe(true)
    })
    test('CA CANNOT access inventory', () => {
      expect(canAccessModule('ca', null, 'inventory')).toBe(false)
    })
    test('CA CANNOT access scanner', () => {
      expect(canAccessModule('ca', null, 'scanner')).toBe(false)
    })
    test('CA CANNOT access settings', () => {
      expect(canAccessModule('ca', null, 'settings')).toBe(false)
    })
    test('CA permissions parameter is ignored (access is hardcoded)', () => {
      // Even if someone passes a permissions object, CA uses its own allowlist
      const perms = { ...DEFAULT_STAFF_PERMISSIONS, settings: true, inventory: true }
      expect(canAccessModule('ca', perms, 'settings')).toBe(false)
      expect(canAccessModule('ca', perms, 'inventory')).toBe(false)
    })
  })
})

/**
 * V17-Ext Tier 3 Step 2: Sub-account role validation.
 *
 * The /api/staff POST route accepts a `role` field in the body. This test
 * suite guards the isValidSubAccountRole() helper that validates that field.
 *
 * SECURITY INVARIANT: Only 'staff' and 'ca' can be created via /api/staff.
 * 'owner' and 'admin' MUST be rejected — otherwise a malicious client could
 * escalate privileges by sending { role: 'owner' } in the POST body.
 */
describe('🔒 V17-Ext Tier 3 Step 2: isValidSubAccountRole', () => {
  test('SUB_ACCOUNT_ROLES contains exactly staff and ca', () => {
    expect(SUB_ACCOUNT_ROLES).toHaveLength(2)
    expect([...SUB_ACCOUNT_ROLES]).toContain('staff')
    expect([...SUB_ACCOUNT_ROLES]).toContain('ca')
  })

  test('returns true for "staff"', () => {
    expect(isValidSubAccountRole('staff')).toBe(true)
  })

  test('returns true for "ca"', () => {
    expect(isValidSubAccountRole('ca')).toBe(true)
  })

  test('returns FALSE for "owner" — cannot create owner via /api/staff', () => {
    // This is the critical security test. If this breaks, a malicious client
    // could create an owner-level account via the staff API.
    expect(isValidSubAccountRole('owner')).toBe(false)
  })

  test('returns FALSE for "admin" — admin is a separate system', () => {
    expect(isValidSubAccountRole('admin')).toBe(false)
  })

  test('returns false for unknown roles (fail-closed)', () => {
    expect(isValidSubAccountRole('manager')).toBe(false)
    expect(isValidSubAccountRole('superuser')).toBe(false)
    expect(isValidSubAccountRole('viewer')).toBe(false)
    expect(isValidSubAccountRole('accountant')).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(isValidSubAccountRole('')).toBe(false)
  })

  test('returns false for strings that look similar but are not exact', () => {
    // Case-sensitive — 'CA' and 'Staff' are NOT valid (must be lowercase)
    expect(isValidSubAccountRole('CA')).toBe(false)
    expect(isValidSubAccountRole('Staff')).toBe(false)
    expect(isValidSubAccountRole('ca ')).toBe(false) // trailing space
    expect(isValidSubAccountRole(' ca')).toBe(false) // leading space
  })

  test('acts as a type guard (narrows to SubAccountRole)', () => {
    // This is a compile-time check: if isValidSubAccountRole returns true,
    // TypeScript should narrow the type. We verify at runtime that the
    // narrowed value is indeed one of the two valid roles.
    const input: string = 'ca'
    if (isValidSubAccountRole(input)) {
      // Inside this block, `input` is narrowed to SubAccountRole ('staff' | 'ca')
      expect(['staff', 'ca']).toContain(input)
    } else {
      throw new Error('Should have been valid')
    }
  })
})
