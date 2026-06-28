'use client'

import { useQuery } from '@tanstack/react-query'

interface FeatureFlags {
  ai_scanner: boolean
  voice_entry: boolean
  gstr_export: boolean
  whatsapp_sharing: boolean
  smart_insights: boolean
  recurring_entries: boolean
  new_signups: boolean
  payments: boolean
}

const DEFAULT_FLAGS: FeatureFlags = {
  ai_scanner: true,
  voice_entry: true,
  gstr_export: true,
  whatsapp_sharing: true,
  smart_insights: true,
  recurring_entries: true,
  new_signups: true,
  payments: false,
}

export function useFeatureFlags() {
  const { data } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: async () => {
      const r = await fetch('/api/feature-flags')
      if (!r.ok) return DEFAULT_FLAGS
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
    initialData: DEFAULT_FLAGS,
  })

  const flags: FeatureFlags = { ...DEFAULT_FLAGS, ...data }
  const isFlagEnabled = (key: keyof FeatureFlags): boolean => flags[key] ?? true

  return { flags, isFlagEnabled }
}
