'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { getTranslation, type Language } from '@/lib/i18n'
import { useLocalStorage } from '@/hooks/use-local-storage'

// SSR-safe translation hook
// During SSR: always returns English (matches server output)
// After mount: loads saved language from localStorage
export function useTranslation() {
  const storeLanguage = useAppStore((s) => s.language)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const [savedLanguage, setSavedLanguage] = useLocalStorage('bahikhata-language', 'en')

  // On mount, load saved language into store
  useEffect(() => {
    if (savedLanguage !== storeLanguage) {
      setLanguage(savedLanguage)
    }
  }, [])

  // Save to localStorage when store changes
  useEffect(() => {
    setSavedLanguage(storeLanguage)
  }, [storeLanguage])

  // Use savedLanguage if it's loaded (client-side after mount)
  // Otherwise use storeLanguage (which is 'en' by default during SSR)
  const language = savedLanguage as Language

  const t = (key: string): string => {
    return getTranslation(language, key)
  }

  return { t, language }
}
