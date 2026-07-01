'use client'

/**
 * useSubscription — returns the current user's plan and feature access.
 *
 * Plans:
 *   free   — Basic sales/purchase, inventory, manual invoicing
 *   pro    — AI scanner, barcode, GST reports, WhatsApp, voice, recurring
 *   elite  — Smart insights, advanced analytics, staff accounts, priority support
 *
 * Usage:
 *   const { plan, canUse, upgrade } = useSubscription()
 *   if (!canUse('ai_scanner')) { showPaywall() }
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'
import { useState, useCallback } from 'react'

export type Plan = 'free' | 'pro' | 'elite'

export type GatedFeature =
  | 'ai_scanner'
  | 'barcode_scanner'
  | 'gstr_export'
  | 'whatsapp_sharing'
  | 'voice_entry'
  | 'recurring_entries'
  | 'smart_insights'
  | 'advanced_reports'
  | 'staff_accounts'
  | 'split_view'
  | 'customer_statement'
  | 'expense_budgets'
  | 'repeat_last_sale'
  | 'share_summary'

const PLAN_FEATURES: Record<Plan, GatedFeature[]> = {
  free: [],
  pro: [
    'ai_scanner',
    'barcode_scanner',
    'gstr_export',
    'whatsapp_sharing',
    'voice_entry',
    'recurring_entries',
    'split_view',
    'customer_statement',
    'expense_budgets',
    'repeat_last_sale',
    'share_summary',
  ],
  elite: [
    'ai_scanner',
    'barcode_scanner',
    'gstr_export',
    'whatsapp_sharing',
    'voice_entry',
    'recurring_entries',
    'smart_insights',
    'advanced_reports',
    'staff_accounts',
    'split_view',
    'customer_statement',
    'expense_budgets',
    'repeat_last_sale',
    'share_summary',
  ],
}

export const FEATURE_LABELS: Record<GatedFeature, { label: string; plan: Plan }> = {
  ai_scanner: { label: 'AI Bill Scanner', plan: 'pro' },
  barcode_scanner: { label: 'Barcode Scanner', plan: 'pro' },
  gstr_export: { label: 'GSTR-1 Export', plan: 'pro' },
  whatsapp_sharing: { label: 'WhatsApp Invoice Sharing', plan: 'pro' },
  voice_entry: { label: 'Voice Entry', plan: 'pro' },
  recurring_entries: { label: 'Recurring Entries', plan: 'pro' },
  smart_insights: { label: 'Smart Insights', plan: 'elite' },
  advanced_reports: { label: 'Advanced Reports', plan: 'elite' },
  staff_accounts: { label: 'Staff Accounts', plan: 'elite' },
  split_view: { label: 'Split View (Desktop)', plan: 'pro' },
  customer_statement: { label: 'Customer Statement PDF', plan: 'pro' },
  expense_budgets: { label: 'Expense Budgets', plan: 'pro' },
  repeat_last_sale: { label: 'Repeat Last Sale', plan: 'pro' },
  share_summary: { label: 'Share Daily Summary', plan: 'pro' },
}

export function useSubscription() {
  const queryClient = useQueryClient()
  const [showPaywall, setShowPaywall] = useState(false)
  const [paywallFeature, setPaywallFeature] = useState<GatedFeature | null>(null)

  const { data } = useQuery({
    queryKey: ['subscription-status'],
    queryFn: async () => {
      const r = await offlineFetch('/api/subscription/status')
      return r.json()
    },
    staleTime: 5 * 60 * 1000, // 5 min
  })

  const plan: Plan = (data?.current?.plan as Plan) || 'free'

  // Usage info — null if not yet loaded
  const usage = data?.usage ?? null

  const canUse = useCallback((feature: GatedFeature): boolean => {
    const allowed = PLAN_FEATURES[plan] || []
    return allowed.includes(feature)
  }, [plan])

  const requireFeature = useCallback((feature: GatedFeature): boolean => {
    if (canUse(feature)) return true
    setPaywallFeature(feature)
    setShowPaywall(true)
    return false
  }, [canUse])

  const closePaywall = useCallback(() => {
    setShowPaywall(false)
    setPaywallFeature(null)
  }, [])

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['subscription-status'] })
  }, [queryClient])

  return {
    plan,
    canUse,
    requireFeature,
    showPaywall,
    paywallFeature,
    closePaywall,
    refresh,
    usage,
    isFree: plan === 'free',
    isPro: plan === 'pro',
    isElite: plan === 'elite',
  }
}
