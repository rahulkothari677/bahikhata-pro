'use client'

/**
 * useStaffPermissions — returns the current user's module permissions.
 *
 * For owners: all modules are accessible (returns all true).
 * For staff: returns their saved permissions from the session.
 *
 * Used by Sidebar, MobileBottomNav, and page.tsx to gate navigation.
 */

import { useSession } from 'next-auth/react'
import { DEFAULT_STAFF_PERMISSIONS, type ModuleKey, type StaffPermissions } from '@/lib/staff-permissions'

// 🔒 V26 lint fix: hoisted to module scope — these were recreated inside the
// component on every render, which broke the React Compiler's memoization of
// the `permissions` useMemo (react-hooks/preserve-manual-memoization).
// V17-Ext Tier 3: CA permissions are hardcoded (read-only allowlist).
const CA_PERMISSIONS: StaffPermissions = {
  dashboard: true, sales: true, purchases: true, inventory: false,
  scanner: false, reports: true, incomeExpense: true, parties: true, settings: false,
}
const OWNER_PERMISSIONS: StaffPermissions = {
  dashboard: true, sales: true, purchases: true, inventory: true,
  scanner: true, reports: true, incomeExpense: true, parties: true, settings: true,
}

export function useStaffPermissions() {
  const { data: session } = useSession()
  const user = session?.user

  const isOwner = !user?.role || user?.role === 'owner'
  const isCA = user?.role === 'ca' // V17-Ext Tier 3: CA role

  // Parse permissions from session (stored as JSON by NextAuth).
  // 🔒 V26 lint fix: the manual useMemo (deps [isOwner, isCA, user?.permissions])
  // blocked React Compiler compilation of this whole hook ("could not preserve
  // manual memoization") — which meant `canAccess` was a NEW function identity
  // every render, silently defeating every downstream useMemo that lists it as
  // a dep (Sidebar/MoreScreen nav lists). Plain computation lets the compiler
  // memoize both `permissions` and `canAccess` correctly.
  const computePermissions = (): StaffPermissions => {
    if (isOwner) {
      // Owner has full access
      return OWNER_PERMISSIONS
    }
    // V17-Ext Tier 3: CA — hardcoded read-only allowlist
    if (isCA) {
      return CA_PERMISSIONS
    }
    // Staff — use their saved permissions (stored as JSON string in session)
    if (user?.permissions && typeof user.permissions === 'string') {
      try {
        const parsed = JSON.parse(user.permissions) as Partial<StaffPermissions>
        return { ...DEFAULT_STAFF_PERMISSIONS, ...parsed }
      } catch {
        return DEFAULT_STAFF_PERMISSIONS
      }
    }
    return DEFAULT_STAFF_PERMISSIONS
  }
  const permissions: StaffPermissions = computePermissions()

  const canAccess = (module: ModuleKey): boolean => {
    return permissions[module] === true
  }

  return { permissions, canAccess, isOwner, isCA }
}
