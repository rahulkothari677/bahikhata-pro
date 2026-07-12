'use client'

/**
 * useSubscription — returns the current user's plan and feature access.
 *
 * Plans:
 *   free   — Basic sales/purchase, inventory, manual invoicing
 *   pro    — AI scanner, barcode, GST reports, WhatsApp, voice, recurring
 *   elite  — Smart insights, advanced analytics, staff accounts, priority support
 *
 * Paywall state is stored GLOBALLY in Zustand (app-store.ts) so that
 * requireFeature() called from any component (BillScanner, VoiceEntry, etc.)
 * correctly opens the PaywallModal rendered in page.tsx.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch } from '@/lib/offline-fetch'
import { useAppStore, type PaywallFeature } from '@/store/app-store'

export type Plan = 'free' | 'pro' | 'elite'

export type GatedFeature = PaywallFeature

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
  // Paywall state is GLOBAL via Zustand — BillScanner calling requireFeature()
  // will correctly show the PaywallModal in page.tsx.
  const { paywallOpen: showPaywall, paywallFeature, openPaywall, closePaywall } = useAppStore()
  // 🔒 V21-008: Wait for bootstrap to prime the cache before fetching.
  const bootstrapDone = useAppStore((s) => s.bootstrapDone)

  const { data } = useQuery({
    queryKey: ['subscription-status'],
    queryFn: async () => {
      const r = await offlineFetch('/api/subscription/status')
      return r.json()
    },
    staleTime: 5 * 60 * 1000, // 5 min
    // 🔒 V21-008: Don't fetch until bootstrap has primed the cache.
    enabled: bootstrapDone,
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

    // Show a visible toast FIRST so the user knows exactly why they're blocked.
    // The PaywallModal opens after, giving them the upgrade path.
    const info = FEATURE_LABELS[feature]
    const requiredPlan = info.plan

    if (plan === 'free') {
      // Free user — feature not in their plan at all
      sonnerToast.error(`${info.label} requires ${requiredPlan === 'elite' ? 'Elite' : 'Pro'} plan`, {
        description: `This feature isn't available on the Free plan. Upgrade to unlock it.`,
        duration: 5000,
      })
    } else if (plan === 'pro' && requiredPlan === 'elite') {
      // Pro user trying Elite feature
      sonnerToast.error(`${info.label} requires Elite plan`, {
        description: `This feature isn't available on your Pro plan. Upgrade to Elite to unlock it.`,
        duration: 5000,
      })
    } else {
      // User has the feature in their plan but hit the daily limit (e.g. 20/20 scans today)
      const usageInfo = usage as Record<string, any>
      const featureUsage = feature === 'ai_scanner' ? usageInfo?.aiScans : feature === 'voice_entry' ? usageInfo?.voiceEntries : null
      if (featureUsage && featureUsage.remaining === 0) {
        sonnerToast.error(`Daily limit reached for ${info.label}`, {
          description: `You've used all ${featureUsage.limit} ${feature === 'ai_scanner' ? 'AI scans' : 'voice entries'} today. Come back tomorrow or upgrade for more.`,
          duration: 6000,
        })
      } else {
        sonnerToast.error(`${info.label} not available`, {
          description: `Upgrade your plan to unlock this feature.`,
          duration: 5000,
        })
      }
    }

    openPaywall(feature)
    return false
  }, [canUse, openPaywall, plan, usage])

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
