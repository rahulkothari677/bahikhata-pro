'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/store/app-store'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const darkMode = useAppStore((s) => s.features.darkMode)

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  return <>{children}</>
}
