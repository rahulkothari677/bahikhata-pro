'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { getTranslation, type Language } from '@/lib/i18n'

// Hook to use translations in any component
// Uses mounted state to prevent hydration mismatch
// (server renders in English, client may have Hindi from localStorage)
export function useTranslation() {
  const language = useAppStore((s) => s.language)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    Promise.resolve().then(() => setMounted(true))
  }, [])

  // During SSR and first render, always use English to match server
  const effectiveLanguage = mounted ? language : 'en'

  const t = (key: string): string => {
    return getTranslation(effectiveLanguage as Language, key)
  }

  return { t, language: effectiveLanguage }
}
