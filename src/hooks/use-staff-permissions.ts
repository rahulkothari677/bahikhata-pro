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
  const user = session?.user as any

  const isOwner = !user?.role || user?.role === 'owner'

  // Parse permissions from session (stored as JSON by NextAuth)
  const permissions: StaffPermissions = useMemo(() => {
    if (isOwner) {
      // Owner has full access
      return {
        dashboard: true, sales: true, purchases: true, inventory: true,
        scanner: true, reports: true, incomeExpense: true, parties: true, settings: true,
      }
    }
    // Staff — use their saved permissions
    if (user?.permissions && typeof user.permissions === 'object') {
      return { ...DEFAULT_STAFF_PERMISSIONS, ...user.permissions }
    }
    return DEFAULT_STAFF_PERMISSIONS
  }, [isOwner, user?.permissions])

  const canAccess = (module: ModuleKey): boolean => {
    return permissions[module] === true
  }

  return { permissions, canAccess, isOwner }
}
