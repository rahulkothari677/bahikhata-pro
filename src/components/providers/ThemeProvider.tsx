'use client'

import { useEffect } from 'react'
import { useAppStore, type ThemeColor } from '@/store/app-store'

// Full theme palettes — each defines ALL colors for a cohesive look
export type ThemePalette = {
  // Main accent
  primary: string
  ring: string
  gradient: string
  // Sidebar - now LIGHT to complement dashboard
  sidebar: string
  sidebarForeground: string
  sidebarPrimary: string
  sidebarPrimaryForeground: string
  sidebarAccent: string
  sidebarAccentForeground: string
  sidebarBorder: string
  // Background tint - subtle warm/cool tone
  background: string
  // Chart colors - 5 complementary colors
  charts: [string, string, string, string, string]
  // Preview swatch
  swatch: string
}

const THEMES: Record<ThemeColor, ThemePalette> = {
  saffron: {
    primary: 'oklch(0.62 0.18 42)',
    ring: 'oklch(0.62 0.18 42)',
    gradient: 'linear-gradient(135deg, oklch(0.62 0.18 42) 0%, oklch(0.65 0.2 25) 100%)',
    sidebar: 'oklch(0.97 0.01 60)',
    sidebarForeground: 'oklch(0.25 0.02 30)',
    sidebarPrimary: 'oklch(0.62 0.18 42)',
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: 'oklch(0.93 0.02 60)',
    sidebarAccentForeground: 'oklch(0.25 0.02 30)',
    sidebarBorder: 'oklch(0.90 0.01 60)',
    background: 'oklch(0.99 0.005 60)',
    charts: ['oklch(0.62 0.18 42)', 'oklch(0.62 0.15 155)', 'oklch(0.72 0.16 80)', 'oklch(0.6 0.12 200)', 'oklch(0.65 0.22 15)'],
    swatch: 'linear-gradient(135deg, oklch(0.62 0.18 42), oklch(0.65 0.2 25))',
  },
  emerald: {
    primary: 'oklch(0.55 0.15 155)',
    ring: 'oklch(0.55 0.15 155)',
    gradient: 'linear-gradient(135deg, oklch(0.55 0.15 155) 0%, oklch(0.50 0.13 170) 100%)',
    sidebar: 'oklch(0.97 0.01 160)',
    sidebarForeground: 'oklch(0.22 0.03 160)',
    sidebarPrimary: 'oklch(0.55 0.15 155)',
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: 'oklch(0.93 0.03 160)',
    sidebarAccentForeground: 'oklch(0.22 0.03 160)',
    sidebarBorder: 'oklch(0.90 0.01 160)',
    background: 'oklch(0.99 0.005 160)',
    charts: ['oklch(0.55 0.15 155)', 'oklch(0.62 0.18 42)', 'oklch(0.72 0.16 80)', 'oklch(0.6 0.12 200)', 'oklch(0.65 0.22 15)'],
    swatch: 'linear-gradient(135deg, oklch(0.55 0.15 155), oklch(0.50 0.13 170))',
  },
  blue: {
    primary: 'oklch(0.55 0.18 250)',
    ring: 'oklch(0.55 0.18 250)',
    gradient: 'linear-gradient(135deg, oklch(0.55 0.18 250) 0%, oklch(0.50 0.16 260) 100%)',
    sidebar: 'oklch(0.97 0.01 250)',
    sidebarForeground: 'oklch(0.22 0.03 250)',
    sidebarPrimary: 'oklch(0.55 0.18 250)',
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: 'oklch(0.93 0.03 250)',
    sidebarAccentForeground: 'oklch(0.22 0.03 250)',
    sidebarBorder: 'oklch(0.90 0.01 250)',
    background: 'oklch(0.99 0.005 250)',
    charts: ['oklch(0.55 0.18 250)', 'oklch(0.55 0.15 155)', 'oklch(0.72 0.16 80)', 'oklch(0.62 0.18 42)', 'oklch(0.65 0.22 15)'],
    swatch: 'linear-gradient(135deg, oklch(0.55 0.18 250), oklch(0.50 0.16 260))',
  },
  violet: {
    primary: 'oklch(0.55 0.2 290)',
    ring: 'oklch(0.55 0.2 290)',
    gradient: 'linear-gradient(135deg, oklch(0.55 0.2 290) 0%, oklch(0.50 0.18 300) 100%)',
    sidebar: 'oklch(0.97 0.01 290)',
    sidebarForeground: 'oklch(0.22 0.03 290)',
    sidebarPrimary: 'oklch(0.55 0.2 290)',
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: 'oklch(0.93 0.03 290)',
    sidebarAccentForeground: 'oklch(0.22 0.03 290)',
    sidebarBorder: 'oklch(0.90 0.01 290)',
    background: 'oklch(0.99 0.005 290)',
    charts: ['oklch(0.55 0.2 290)', 'oklch(0.55 0.15 155)', 'oklch(0.72 0.16 80)', 'oklch(0.55 0.18 250)', 'oklch(0.65 0.22 15)'],
    swatch: 'linear-gradient(135deg, oklch(0.55 0.2 290), oklch(0.50 0.18 300))',
  },
  rose: {
    primary: 'oklch(0.62 0.22 15)',
    ring: 'oklch(0.62 0.22 15)',
    gradient: 'linear-gradient(135deg, oklch(0.62 0.22 15) 0%, oklch(0.58 0.2 350) 100%)',
    sidebar: 'oklch(0.97 0.01 15)',
    sidebarForeground: 'oklch(0.22 0.03 15)',
    sidebarPrimary: 'oklch(0.62 0.22 15)',
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: 'oklch(0.93 0.03 15)',
    sidebarAccentForeground: 'oklch(0.22 0.03 15)',
    sidebarBorder: 'oklch(0.90 0.01 15)',
    background: 'oklch(0.99 0.005 15)',
    charts: ['oklch(0.62 0.22 15)', 'oklch(0.55 0.15 155)', 'oklch(0.72 0.16 80)', 'oklch(0.55 0.18 250)', 'oklch(0.62 0.18 42)'],
    swatch: 'linear-gradient(135deg, oklch(0.62 0.22 15), oklch(0.58 0.2 350))',
  },
  teal: {
    primary: 'oklch(0.6 0.12 200)',
    ring: 'oklch(0.6 0.12 200)',
    gradient: 'linear-gradient(135deg, oklch(0.6 0.12 200) 0%, oklch(0.55 0.1 210) 100%)',
    sidebar: 'oklch(0.97 0.01 200)',
    sidebarForeground: 'oklch(0.22 0.03 200)',
    sidebarPrimary: 'oklch(0.6 0.12 200)',
    sidebarPrimaryForeground: 'oklch(0.99 0 0)',
    sidebarAccent: 'oklch(0.93 0.03 200)',
    sidebarAccentForeground: 'oklch(0.22 0.03 200)',
    sidebarBorder: 'oklch(0.90 0.01 200)',
    background: 'oklch(0.99 0.005 200)',
    charts: ['oklch(0.6 0.12 200)', 'oklch(0.55 0.15 155)', 'oklch(0.72 0.16 80)', 'oklch(0.55 0.18 250)', 'oklch(0.65 0.22 15)'],
    swatch: 'linear-gradient(135deg, oklch(0.6 0.12 200), oklch(0.55 0.1 210))',
  },
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const darkMode = useAppStore((s) => s.features.darkMode)
  const themeColor = useAppStore((s) => s.themeColor)

  useEffect(() => {
    const root = document.documentElement
    const palette = THEMES[themeColor]

    // Apply dark mode class
    if (darkMode) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }

    // Apply ALL theme variables via inline style override
    root.style.setProperty('--primary', palette.primary)
    root.style.setProperty('--ring', palette.ring)

    // In LIGHT mode: override sidebar to match the theme color (light sidebar)
    if (!darkMode) {
      root.style.setProperty('--background', palette.background)
      root.style.setProperty('--sidebar', palette.sidebar)
      root.style.setProperty('--sidebar-foreground', palette.sidebarForeground)
      root.style.setProperty('--sidebar-primary', palette.sidebarPrimary)
      root.style.setProperty('--sidebar-primary-foreground', palette.sidebarPrimaryForeground)
      root.style.setProperty('--sidebar-accent', palette.sidebarAccent)
      root.style.setProperty('--sidebar-accent-foreground', palette.sidebarAccentForeground)
      root.style.setProperty('--sidebar-border', palette.sidebarBorder)
    } else {
      // In DARK mode: CLEAR the inline overrides so the .dark CSS class takes over
      // This lets the dark mode CSS (globals.css) control the sidebar colors
      root.style.removeProperty('--background')
      root.style.removeProperty('--sidebar')
      root.style.removeProperty('--sidebar-foreground')
      root.style.removeProperty('--sidebar-primary')
      root.style.removeProperty('--sidebar-primary-foreground')
      root.style.removeProperty('--sidebar-accent')
      root.style.removeProperty('--sidebar-accent-foreground')
      root.style.removeProperty('--sidebar-border')
    }
    root.style.setProperty('--chart-1', palette.charts[0])
    root.style.setProperty('--chart-2', palette.charts[1])
    root.style.setProperty('--chart-3', palette.charts[2])
    root.style.setProperty('--chart-4', palette.charts[3])
    root.style.setProperty('--chart-5', palette.charts[4])

    // Update gradient utility classes
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
