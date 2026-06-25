'use client'

import { useAppStore } from '@/store/app-store'
import { getTranslation, type Language } from '@/lib/i18n'

export function useTranslation() {
  const language = useAppStore((s) => s.language)
  
  // Always use English for now (Hindi will be re-enabled properly later)
  const t = (key: string): string => {
    return getTranslation('en', key)
  }

  return { t, language: 'en' as const }
}
