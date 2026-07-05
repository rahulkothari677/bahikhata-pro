'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { getTranslation, type Language } from '@/lib/i18n'

// SSR-safe translation hook
// Uses Zustand store as the single source of truth
// Syncs with localStorage on mount and on changes
export function useTranslation() {
  const language = useAppStore((s) => s.language)
  const setLanguage = useAppStore((s) => s.setLanguage)

  // On mount: load saved language from localStorage into store
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bahikhata-language')
      if (saved) {
        const parsed = JSON.parse(saved)
        const validLangs = ['en', 'hi', 'gu', 'mr', 'ta', 'te']
        if (validLangs.includes(parsed)) {
          if (parsed !== language) {
            setLanguage(parsed)
          }
        }
      }
    } catch (e) {
      // localStorage not available
    }
  }, [])

  // When language changes in store: save to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('bahikhata-language', JSON.stringify(language))
    } catch (e) {
      // localStorage not available
    }
  }, [language])

  const t = (key: string): string => {
    return getTranslation(language as Language, key)
  }

  return { t, language, setLanguage }
}
