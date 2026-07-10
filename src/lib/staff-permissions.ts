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
 *
 * 🔒 V17-Ext §2.1 FIX: Was `if (role !== 'staff') return true` — fail-OPEN.
 * That meant any future role (accountant, viewer, manager, a read-only CA
 * login) would get FULL ACCESS to everything by default. In an access-control
 * function, the default must be DENY. Now: explicit allowlist — owners full,
 * staff checked against perms, everyone else DENIED.
 *
 * When you add a new role, you MUST explicitly handle it here (either grant
 * full access like owner, or check against a permission set like staff).
 * This prevents the "new role silently gets god mode" failure mode.
 */
export function canAccessModule(
  role: string | undefined | null,
  permissions: any,
  module: ModuleKey
): boolean {
  // Owner (or null role = legacy owner) always has full access
  if (!role || role === 'owner') return true

  // Staff are checked against their permission set
  if (role === 'staff') {
    const perms = parsePermissions(permissions)
    return perms[module] === true
  }

  // V17-Ext Tier 3: CA (Chartered Accountant) — read-only access to a
  // specific allowlist of modules. CAs can VIEW reports, transactions,
  // parties, and dashboard, but cannot create/edit/delete anything
  // (enforced separately via assertCanWrite in get-auth.ts).
  if (role === 'ca') {
    const CA_MODULES: ModuleKey[] = [
      'dashboard',   // view KPIs + analytics
      'sales',       // view sales ledger (read-only)
      'purchases',   // view purchase ledger (read-only)
      'reports',     // view GST reports + GSTR-1/3B/2B exports
      'incomeExpense', // view income/expense entries (read-only)
      'parties',     // view party statements + balances
    ]
    return CA_MODULES.includes(module)
  }

  // 🔒 V17-Ext §2.1: Any OTHER role is DENIED by default.
  return false
}
