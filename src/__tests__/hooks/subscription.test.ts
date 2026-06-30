/**
 * Unit tests for subscription gating system.
 * Critical for monetization — if broken, users get free access to paid features.
 */

import {
  DEFAULT_STAFF_PERMISSIONS,
  parsePermissions,
  canAccessModule,
} from '@/lib/staff-permissions'

// Also test the feature labels and plan assignments
import { FEATURE_LABELS, type GatedFeature } from '@/hooks/use-subscription'

describe('Subscription Feature Labels', () => {
  test('all features have labels', () => {
    const features: GatedFeature[] = [
      'ai_scanner', 'barcode_scanner', 'gstr_export', 'whatsapp_sharing',
      'voice_entry', 'recurring_entries', 'smart_insights', 'advanced_reports',
      'staff_accounts', 'split_view', 'customer_statement', 'expense_budgets',
      'repeat_last_sale', 'share_summary',
    ]

    features.forEach(f => {
      expect(FEATURE_LABELS[f]).toBeDefined()
      expect(FEATURE_LABELS[f].label).toBeTruthy()
      expect(FEATURE_LABELS[f].plan).toBeTruthy()
    })
  })

  test('Pro features are assigned to pro plan', () => {
    const proFeatures: GatedFeature[] = [
      'ai_scanner', 'barcode_scanner', 'gstr_export', 'whatsapp_sharing',
      'voice_entry', 'recurring_entries', 'split_view', 'customer_statement',
      'expense_budgets', 'repeat_last_sale', 'share_summary',
    ]

    proFeatures.forEach(f => {
      expect(FEATURE_LABELS[f].plan).toBe('pro')
    })
  })

  test('Elite features are assigned to elite plan', () => {
    const eliteFeatures: GatedFeature[] = [
      'smart_insights', 'advanced_reports', 'staff_accounts',
    ]

    eliteFeatures.forEach(f => {
      expect(FEATURE_LABELS[f].plan).toBe('elite')
    })
  })
})

describe('Staff Permissions + Subscription Integration', () => {
  test('owner has full staff permissions regardless of plan', () => {
    const ownerPerms = parsePermissions(null) // null role = owner
    // Owner can access everything
    Object.keys(DEFAULT_STAFF_PERMISSIONS).forEach(module => {
      expect(canAccessModule('owner', ownerPerms, module as any)).toBe(true)
    })
  })

  test('staff with default perms can access sales but not reports', () => {
    expect(canAccessModule('staff', DEFAULT_STAFF_PERMISSIONS, 'sales')).toBe(true)
    expect(canAccessModule('staff', DEFAULT_STAFF_PERMISSIONS, 'reports')).toBe(false)
  })

  test('staff with all perms enabled can access everything', () => {
    const allEnabled = Object.keys(DEFAULT_STAFF_PERMISSIONS).reduce((acc, key) => {
      acc[key as keyof typeof DEFAULT_STAFF_PERMISSIONS] = true
      return acc
    }, { ...DEFAULT_STAFF_PERMISSIONS })

    Object.keys(allEnabled).forEach(module => {
      expect(canAccessModule('staff', allEnabled, module as any)).toBe(true)
    })
  })
})
