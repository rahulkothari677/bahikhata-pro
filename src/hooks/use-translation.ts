'use client'

import { useAppStore } from '@/store/app-store'
import { getTranslation, type Language } from '@/lib/i18n'

export function useTranslation() {
  // Always use English to prevent hydration mismatch
  // Hindi support will be added back properly in next update
  const language = 'en' as Language

  const t = (key: string): string => {
    return getTranslation(language, key)
  }

  return { t, language }
}
