'use client'

import { useEffect } from 'react'
import { useAppStore, type ThemeColor } from '@/store/app-store'

export type ThemePalette = {
  primary: string
  ring: string
  gradient: string
  sidebar: string
  sidebarForeground: string
  sidebarPrimary: string
  sidebarPrimaryForeground: string
  sidebarAccent: string
  sidebarAccentForeground: string
  sidebarBorder: string
  background: string
  charts: [string, string, string, string, string]
  swatch: string
  // Dark mode palette — warm-tinted dark, not pure black.
  // Each theme uses its own hue so dark mode feels "cozy and themed"
  // instead of "cold and black".
  dark: {
    primary: string         // more vibrant than light mode primary
    background: string      // app body — deep but warm
    card: string            // slightly lighter than bg for separation
    popover: string         // matches card
    secondary: string       // muted buttons
    muted: string           // muted backgrounds
    accent: string          // accent tinted with theme hue
    sidebar: string         // sidebar slightly darker than body
    sidebarAccent: string
    border: string          // subtle white border
  }
}

const THEMES: Record<ThemeColor, ThemePalette> = {
  saffron: {
    primary: 'oklch(0.55 0.19 42)',
    ring: 'oklch(0.55 0.19 42)',
    gradient: 'linear-gradient(135deg, oklch(0.55 0.19 42) 0%, oklch(0.58 0.21 25) 100%)',
    sidebar: 'oklch(0.97 0.01 60)',
    sidebarForeground: 'oklch(0.25 0.02 30)',
    sidebarPrimary: 'oklch(0.55 0.19 42)',
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: 'oklch(0.93 0.02 60)',
    sidebarAccentForeground: 'oklch(0.25 0.02 30)',
    sidebarBorder: 'oklch(0.90 0.01 60)',
    background: 'oklch(0.98 0.008 60)',
    charts: ['oklch(0.55 0.19 42)', 'oklch(0.55 0.16 155)', 'oklch(0.72 0.16 80)', 'oklch(0.6 0.12 200)', 'oklch(0.65 0.22 15)'],
    swatch: 'linear-gradient(135deg, oklch(0.55 0.19 42), oklch(0.58 0.21 25))',
    dark: {
      primary: 'oklch(0.75 0.21 42)',
      background: 'oklch(0.14 0.015 30)',
      card: 'oklch(0.19 0.015 30)',
      popover: 'oklch(0.21 0.015 30)',
      secondary: 'oklch(0.25 0.015 30)',
      muted: 'oklch(0.25 0.015 30)',
      accent: 'oklch(0.28 0.04 42)',
      sidebar: 'oklch(0.16 0.015 30)',
      sidebarAccent: 'oklch(0.22 0.015 30)',
      border: 'oklch(1 0 0 / 10%)',
    },
  },
  emerald: {
    primary: 'oklch(0.50 0.16 155)',
    ring: 'oklch(0.50 0.16 155)',
    gradient: 'linear-gradient(135deg, oklch(0.50 0.16 155) 0%, oklch(0.46 0.14 170) 100%)',
    sidebar: 'oklch(0.97 0.01 160)',
    sidebarForeground: 'oklch(0.22 0.03 160)',
    sidebarPrimary: 'oklch(0.50 0.16 155)',
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: 'oklch(0.93 0.03 160)',
    sidebarAccentForeground: 'oklch(0.22 0.03 160)',
    sidebarBorder: 'oklch(0.90 0.01 160)',
    background: 'oklch(0.98 0.008 160)',
    charts: ['oklch(0.50 0.16 155)', 'oklch(0.55 0.19 42)', 'oklch(0.72 0.16 80)', 'oklch(0.6 0.12 200)', 'oklch(0.65 0.22 15)'],
    swatch: 'linear-gradient(135deg, oklch(0.50 0.16 155), oklch(0.46 0.14 170))',
    dark: {
      primary: 'oklch(0.70 0.18 155)',
      background: 'oklch(0.14 0.015 160)',
      card: 'oklch(0.19 0.015 160)',
      popover: 'oklch(0.21 0.015 160)',
      secondary: 'oklch(0.25 0.015 160)',
      muted: 'oklch(0.25 0.015 160)',
      accent: 'oklch(0.28 0.04 155)',
      sidebar: 'oklch(0.16 0.015 160)',
      sidebarAccent: 'oklch(0.22 0.015 160)',
      border: 'oklch(1 0 0 / 10%)',
    },
  },
  blue: {
    primary: 'oklch(0.50 0.19 250)',
    ring: 'oklch(0.50 0.19 250)',
    gradient: 'linear-gradient(135deg, oklch(0.50 0.19 250) 0%, oklch(0.46 0.17 260) 100%)',
    sidebar: 'oklch(0.97 0.01 250)',
    sidebarForeground: 'oklch(0.22 0.03 250)',
    sidebarPrimary: 'oklch(0.50 0.19 250)',
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: 'oklch(0.93 0.03 250)',
    sidebarAccentForeground: 'oklch(0.22 0.03 250)',
    sidebarBorder: 'oklch(0.90 0.01 250)',
    background: 'oklch(0.98 0.008 250)',
    charts: ['oklch(0.50 0.19 250)', 'oklch(0.50 0.16 155)', 'oklch(0.72 0.16 80)', 'oklch(0.55 0.19 42)', 'oklch(0.65 0.22 15)'],
    swatch: 'linear-gradient(135deg, oklch(0.50 0.19 250), oklch(0.46 0.17 260))',
    dark: {
      primary: 'oklch(0.70 0.21 250)',    // brighter blue in dark
      background: 'oklch(0.14 0.015 250)', // deep navy-black
      card: 'oklch(0.19 0.015 250)',
      popover: 'oklch(0.21 0.015 250)',
      secondary: 'oklch(0.25 0.015 250)',
      muted: 'oklch(0.25 0.015 250)',
      accent: 'oklch(0.28 0.04 250)',
      sidebar: 'oklch(0.16 0.015 250)',
      sidebarAccent: 'oklch(0.22 0.015 250)',
      border: 'oklch(1 0 0 / 10%)',
    },
  },
  violet: {
    primary: 'oklch(0.50 0.21 290)',
    ring: 'oklch(0.50 0.21 290)',
    gradient: 'linear-gradient(135deg, oklch(0.50 0.21 290) 0%, oklch(0.46 0.19 300) 100%)',
    sidebar: 'oklch(0.97 0.01 290)',
    sidebarForeground: 'oklch(0.22 0.03 290)',
    sidebarPrimary: 'oklch(0.50 0.21 290)',
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: 'oklch(0.93 0.03 290)',
    sidebarAccentForeground: 'oklch(0.22 0.03 290)',
    sidebarBorder: 'oklch(0.90 0.01 290)',
    background: 'oklch(0.98 0.008 290)',
    charts: ['oklch(0.50 0.21 290)', 'oklch(0.50 0.16 155)', 'oklch(0.72 0.16 80)', 'oklch(0.50 0.19 250)', 'oklch(0.65 0.22 15)'],
    swatch: 'linear-gradient(135deg, oklch(0.50 0.21 290), oklch(0.46 0.19 300))',
    dark: {
      primary: 'oklch(0.70 0.23 290)',    // brighter violet in dark
      background: 'oklch(0.14 0.015 290)', // deep purple-black
      card: 'oklch(0.19 0.015 290)',
      popover: 'oklch(0.21 0.015 290)',
      secondary: 'oklch(0.25 0.015 290)',
      muted: 'oklch(0.25 0.015 290)',
      accent: 'oklch(0.28 0.04 290)',
      sidebar: 'oklch(0.16 0.015 290)',
      sidebarAccent: 'oklch(0.22 0.015 290)',
      border: 'oklch(1 0 0 / 10%)',
    },
  },
  rose: {
    primary: 'oklch(0.58 0.23 15)',
    ring: 'oklch(0.58 0.23 15)',
    gradient: 'linear-gradient(135deg, oklch(0.58 0.23 15) 0%, oklch(0.54 0.21 350) 100%)',
    sidebar: 'oklch(0.97 0.01 15)',
    sidebarForeground: 'oklch(0.22 0.03 15)',
    sidebarPrimary: 'oklch(0.58 0.23 15)',
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: 'oklch(0.93 0.03 15)',
    sidebarAccentForeground: 'oklch(0.22 0.03 15)',
    sidebarBorder: 'oklch(0.90 0.01 15)',
    background: 'oklch(0.98 0.008 15)',
    charts: ['oklch(0.58 0.23 15)', 'oklch(0.50 0.16 155)', 'oklch(0.72 0.16 80)', 'oklch(0.50 0.19 250)', 'oklch(0.55 0.19 42)'],
    swatch: 'linear-gradient(135deg, oklch(0.58 0.23 15), oklch(0.54 0.21 350))',
    dark: {
      primary: 'oklch(0.75 0.25 15)',     // brighter rose in dark
      background: 'oklch(0.14 0.015 15)',  // deep warm rose-black
      card: 'oklch(0.19 0.015 15)',
      popover: 'oklch(0.21 0.015 15)',
      secondary: 'oklch(0.25 0.015 15)',
      muted: 'oklch(0.25 0.015 15)',
      accent: 'oklch(0.28 0.04 15)',
      sidebar: 'oklch(0.16 0.015 15)',
      sidebarAccent: 'oklch(0.22 0.015 15)',
      border: 'oklch(1 0 0 / 10%)',
    },
  },
  teal: {
    primary: 'oklch(0.55 0.13 200)',
    ring: 'oklch(0.55 0.13 200)',
    gradient: 'linear-gradient(135deg, oklch(0.55 0.13 200) 0%, oklch(0.50 0.11 210) 100%)',
    sidebar: 'oklch(0.97 0.01 200)',
    sidebarForeground: 'oklch(0.22 0.03 200)',
    sidebarPrimary: 'oklch(0.55 0.13 200)',
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: 'oklch(0.93 0.03 200)',
    sidebarAccentForeground: 'oklch(0.22 0.03 200)',
    sidebarBorder: 'oklch(0.90 0.01 200)',
    background: 'oklch(0.98 0.008 200)',
    charts: ['oklch(0.55 0.13 200)', 'oklch(0.50 0.16 155)', 'oklch(0.72 0.16 80)', 'oklch(0.50 0.19 250)', 'oklch(0.65 0.22 15)'],
    swatch: 'linear-gradient(135deg, oklch(0.55 0.13 200), oklch(0.50 0.11 210))',
    dark: {
      primary: 'oklch(0.72 0.15 200)',    // brighter teal in dark
      background: 'oklch(0.14 0.015 200)', // deep cyan-black
      card: 'oklch(0.19 0.015 200)',
      popover: 'oklch(0.21 0.015 200)',
      secondary: 'oklch(0.25 0.015 200)',
      muted: 'oklch(0.25 0.015 200)',
      accent: 'oklch(0.28 0.04 200)',
      sidebar: 'oklch(0.16 0.015 200)',
      sidebarAccent: 'oklch(0.22 0.015 200)',
      border: 'oklch(1 0 0 / 10%)',
    },
  },
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const darkMode = useAppStore((s) => s.features?.darkMode ?? false)
  const themeColor = useAppStore((s) => s.themeColor)
  const setFeature = useAppStore((s) => s.setFeature)
  const setThemeColor = useAppStore((s) => s.setThemeColor)

  // On mount: load saved theme from localStorage into store
  useEffect(() => {
    try {
      const savedDark = localStorage.getItem('bahikhata-darkMode')
      if (savedDark !== null) {
        const parsed = JSON.parse(savedDark)
        if (parsed !== darkMode) {
          setFeature('darkMode', parsed)
        }
      }
      const savedColor = localStorage.getItem('bahikhata-themeColor')
      if (savedColor !== null) {
        const parsed = JSON.parse(savedColor)
        if (parsed !== themeColor) {
          setThemeColor(parsed)
        }
      }
    } catch (e) {}
  }, [])

  // Save to localStorage when values change
  useEffect(() => {
    try {
      localStorage.setItem('bahikhata-darkMode', JSON.stringify(darkMode))
    } catch (e) {}
  }, [darkMode])

  useEffect(() => {
    try {
      localStorage.setItem('bahikhata-themeColor', JSON.stringify(themeColor))  // 🔒 V26 N5: typo fixed (was 'bahakhata' → 'bahikhata')
    } catch (e) {}
  }, [themeColor])

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement
    const palette = THEMES[themeColor]

    if (darkMode) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }

    if (!darkMode) {
      // Light mode — use light palette
      root.style.setProperty('--primary', palette.primary)
      root.style.setProperty('--ring', palette.ring)
      root.style.setProperty('--background', palette.background)
      root.style.setProperty('--card', 'oklch(0.99 0 0)')
      root.style.setProperty('--popover', 'oklch(0.99 0 0)')
      root.style.setProperty('--secondary', 'oklch(0.96 0.005 60)')
      root.style.setProperty('--muted', 'oklch(0.96 0.005 60)')
      root.style.setProperty('--accent', palette.sidebarAccent)
      root.style.setProperty('--sidebar', palette.sidebar)
      root.style.setProperty('--sidebar-foreground', palette.sidebarForeground)
      root.style.setProperty('--sidebar-primary', palette.sidebarPrimary)
      root.style.setProperty('--sidebar-primary-foreground', palette.sidebarPrimaryForeground)
      root.style.setProperty('--sidebar-accent', palette.sidebarAccent)
      root.style.setProperty('--sidebar-accent-foreground', palette.sidebarAccentForeground)
      root.style.setProperty('--sidebar-border', palette.sidebarBorder)
    } else {
      // Dark mode — use per-theme dark palette (warm-tinted, not pure black)
      const d = palette.dark
      root.style.setProperty('--primary', d.primary)
      root.style.setProperty('--ring', d.primary)
      root.style.setProperty('--background', d.background)
      root.style.setProperty('--card', d.card)
      root.style.setProperty('--popover', d.popover)
      root.style.setProperty('--secondary', d.secondary)
      root.style.setProperty('--muted', d.muted)
      root.style.setProperty('--accent', d.accent)
      root.style.setProperty('--sidebar', d.sidebar)
      root.style.setProperty('--sidebar-foreground', 'oklch(0.96 0 0)')
      root.style.setProperty('--sidebar-primary', d.primary)
      root.style.setProperty('--sidebar-primary-foreground', 'oklch(0.99 0 0)')
      root.style.setProperty('--sidebar-accent', d.sidebarAccent)
      root.style.setProperty('--sidebar-accent-foreground', 'oklch(0.96 0 0)')
      root.style.setProperty('--sidebar-border', d.border)
    }
    root.style.setProperty('--chart-1', palette.charts[0])
    root.style.setProperty('--chart-2', palette.charts[1])
    root.style.setProperty('--chart-3', palette.charts[2])
    root.style.setProperty('--chart-4', palette.charts[3])
    root.style.setProperty('--chart-5', palette.charts[4])

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

export const THEME_OPTIONS: { id: ThemeColor; label: string; description: string; swatch: string }[] = [
  { id: 'saffron', label: 'Saffron', description: 'Warm Indian orange', swatch: THEMES.saffron.swatch },
  { id: 'emerald', label: 'Emerald', description: 'Fresh green', swatch: THEMES.emerald.swatch },
  { id: 'blue', label: 'Ocean Blue', description: 'Professional blue', swatch: THEMES.blue.swatch },
  { id: 'violet', label: 'Royal Violet', description: 'Premium purple', swatch: THEMES.violet.swatch },
  { id: 'rose', label: 'Rose Pink', description: 'Warm pink', swatch: THEMES.rose.swatch },
  { id: 'teal', label: 'Teal Cyan', description: 'Modern teal', swatch: THEMES.teal.swatch },
]
