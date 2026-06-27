/**
 * Staff permission types and helpers.
 *
 * Permissions control which modules a staff member can access.
 * Owner always has full access — permissions only apply to role='staff'.
 *
 * Default staff permissions:
 *   sales: true, purchases: true, inventory: true, scanner: true
 *   dashboard: false, reports: false, incomeExpense: false, parties: false, settings: false
 */

export type ModuleKey =
  | 'dashboard'
  | 'sales'
  | 'purchases'
  | 'inventory'
  | 'scanner'
  | 'reports'
  | 'incomeExpense'
  | 'parties'
  | 'settings'

export type StaffPermissions = Record<ModuleKey, boolean>

export const DEFAULT_STAFF_PERMISSIONS: StaffPermissions = {
  dashboard: false,
  sales: true,
  purchases: true,
  inventory: true,
  scanner: true,
  reports: false,
  incomeExpense: false,
  parties: false,
  settings: false,
}

export const MODULE_LABELS: Record<ModuleKey, { label: string; description: string }> = {
  dashboard: { label: 'Dashboard', description: 'View business overview, KPIs, charts' },
  sales: { label: 'Sales Ledger', description: 'View and create sales transactions' },
  purchases: { label: 'Purchase Ledger', description: 'View and create purchase transactions' },
  inventory: { label: 'Inventory', description: 'Manage products, stock, prices' },
  scanner: { label: 'AI Bill Scanner', description: 'Scan bills with AI to auto-fill' },
  reports: { label: 'Reports & GST', description: 'View P&L, GST, stock reports' },
  incomeExpense: { label: 'Income & Expense', description: 'Record rent, salary, other income' },
  parties: { label: 'Customers & Suppliers', description: 'Manage party ledger and dues' },
  settings: { label: 'Settings', description: 'Change shop profile, features, theme' },
}

/**
 * Parse a permissions JSON value from the database.
 * Returns DEFAULT_STAFF_PERMISSIONS if null or invalid.
 */
export function parsePermissions(raw: any): StaffPermissions {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_STAFF_PERMISSIONS }
  }
  // Merge with defaults so new modules are accounted for
  return {
    ...DEFAULT_STAFF_PERMISSIONS,
    ...raw,
  }
}

/**
 * Check if a user can access a specific module.
 * Owners always have access. Staff are checked against their permissions.
 */
export function canAccessModule(
  role: string | undefined | null,
  permissions: any,
  module: ModuleKey
): boolean {
  // Owner (or null role = legacy owner) always has full access
  if (!role || role === 'owner') return true
  if (role !== 'staff') return true

  const perms = parsePermissions(permissions)
  return perms[module] === true
}
