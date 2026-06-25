'use client'

// Simplified: just return the key as-is (no translation)
// This eliminates ALL translation-related crashes
export function useTranslation() {
  const t = (key: string): string => key
  return { t, language: 'en' as const }
}
