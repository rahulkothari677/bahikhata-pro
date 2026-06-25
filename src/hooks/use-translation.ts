'use client'

import { useAppStore } from '@/store/app-store'
import { getTranslation, type Language } from '@/lib/i18n'

export function useTranslation() {
  const language = useAppStore((s) => s.language)

  // On server, always use English. On client, use the stored language.
  // This prevents hydration mismatch without needing useState/useEffect.
  const isClient = typeof window !== 'undefined'
  const effectiveLanguage = isClient ? language : 'en'

  const t = (key: string): string => {
    return getTranslation(effectiveLanguage as Language, key)
  }

  return { t, language: effectiveLanguage }
}
