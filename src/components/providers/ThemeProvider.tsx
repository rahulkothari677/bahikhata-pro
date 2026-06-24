'use client'

import { useEffect } from 'react'
import { useAppStore, type ThemeColor } from '@/store/app-store'

// Theme color palettes — each overrides the --primary CSS variable
const THEME_PALETTES: Record<ThemeColor, { primary: string; ring: string; gradient: string }> = {
  saffron: {
    primary: 'oklch(0.62 0.18 42)',
    ring: 'oklch(0.62 0.18 42)',
    gradient: 'linear-gradient(135deg, oklch(0.62 0.18 42) 0%, oklch(0.65 0.2 25) 100%)',
  },
  emerald: {
    primary: 'oklch(0.62 0.15 155)',
    ring: 'oklch(0.62 0.15 155)',
    gradient: 'linear-gradient(135deg, oklch(0.62 0.15 155) 0%, oklch(0.55 0.13 170) 100%)',
  },
  blue: {
    primary: 'oklch(0.55 0.18 250)',
    ring: 'oklch(0.55 0.18 250)',
    gradient: 'linear-gradient(135deg, oklch(0.55 0.18 250) 0%, oklch(0.5 0.16 260) 100%)',
  },
  violet: {
    primary: 'oklch(0.55 0.2 290)',
    ring: 'oklch(0.55 0.2 290)',
    gradient: 'linear-gradient(135deg, oklch(0.55 0.2 290) 0%, oklch(0.5 0.18 300) 100%)',
  },
  rose: {
    primary: 'oklch(0.62 0.22 15)',
    ring: 'oklch(0.62 0.22 15)',
    gradient: 'linear-gradient(135deg, oklch(0.62 0.22 15) 0%, oklch(0.58 0.2 350) 100%)',
  },
  teal: {
    primary: 'oklch(0.6 0.12 200)',
    ring: 'oklch(0.6 0.12 200)',
    gradient: 'linear-gradient(135deg, oklch(0.6 0.12 200) 0%, oklch(0.55 0.1 210) 100%)',
  },
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const darkMode = useAppStore((s) => s.features.darkMode)
  const themeColor = useAppStore((s) => s.themeColor)

  useEffect(() => {
    const root = document.documentElement

    // Apply dark mode
    if (darkMode) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }

    // Apply theme color
    const palette = THEME_PALETTES[themeColor]
    root.style.setProperty('--primary', palette.primary)
    root.style.setProperty('--ring', palette.ring)

    // Update gradient utility class
    const styleId = 'theme-gradient-style'
    let styleEl = document.getElementById(styleId)
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }
    styleEl.textContent = `
      .bg-gradient-saffron { background: ${palette.gradient} !important; }
      .bg-gradient-emerald { background: ${palette.gradient} !important; }
    `
  }, [darkMode, themeColor])

  return <>{children}</>
}

export const THEME_OPTIONS: { id: ThemeColor; label: string; color: string; gradient: string }[] = [
  { id: 'saffron', label: 'Saffron', color: 'oklch(0.62 0.18 42)', gradient: 'linear-gradient(135deg, oklch(0.62 0.18 42), oklch(0.65 0.2 25))' },
  { id: 'emerald', label: 'Emerald', color: 'oklch(0.62 0.15 155)', gradient: 'linear-gradient(135deg, oklch(0.62 0.15 155), oklch(0.55 0.13 170))' },
  { id: 'blue', label: 'Ocean Blue', color: 'oklch(0.55 0.18 250)', gradient: 'linear-gradient(135deg, oklch(0.55 0.18 250), oklch(0.5 0.16 260))' },
  { id: 'violet', label: 'Royal Violet', color: 'oklch(0.55 0.2 290)', gradient: 'linear-gradient(135deg, oklch(0.55 0.2 290), oklch(0.5 0.18 300))' },
  { id: 'rose', label: 'Rose Pink', color: 'oklch(0.62 0.22 15)', gradient: 'linear-gradient(135deg, oklch(0.62 0.22 15), oklch(0.58 0.2 350))' },
  { id: 'teal', label: 'Teal Cyan', color: 'oklch(0.6 0.12 200)', gradient: 'linear-gradient(135deg, oklch(0.6 0.12 200), oklch(0.55 0.1 210))' },
]
