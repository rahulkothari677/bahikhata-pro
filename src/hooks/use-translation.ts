'use client'

import { useAppStore } from '@/store/app-store'
import { getTranslation, type Language } from '@/lib/i18n'

// Hook to use translations in any component
export function useTranslation() {
  const language = useAppStore((s) => s.language)

  const t = (key: string): string => {
    return getTranslation(language as Language, key)
  }

  return { t, language }
}
