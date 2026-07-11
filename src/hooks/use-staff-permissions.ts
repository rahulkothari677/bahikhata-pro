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
import { useMemo } from 'react'
import { DEFAULT_STAFF_PERMISSIONS, type ModuleKey, type StaffPermissions } from '@/lib/staff-permissions'

export function useStaffPermissions() {
  const { data: session } = useSession()
  const user = session?.user

  const isOwner = !user?.role || user?.role === 'owner'
  const isCA = user?.role === 'ca' // V17-Ext Tier 3: CA role

  // V17-Ext Tier 3: CA permissions are hardcoded (read-only allowlist)
  const CA_PERMISSIONS: StaffPermissions = {
    dashboard: true, sales: true, purchases: true, inventory: false,
    scanner: false, reports: true, incomeExpense: true, parties: true, settings: false,
  }

  // Parse permissions from session (stored as JSON by NextAuth)
  const permissions: StaffPermissions = useMemo(() => {
    if (isOwner) {
      // Owner has full access
      return {
        dashboard: true, sales: true, purchases: true, inventory: true,
        scanner: true, reports: true, incomeExpense: true, parties: true, settings: true,
      }
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
  }, [isOwner, isCA, user?.permissions])

  const canAccess = (module: ModuleKey): boolean => {
    return permissions[module] === true
  }

  return { permissions, canAccess, isOwner, isCA }
}
