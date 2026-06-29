'use client'

/**
 * ThemePicker — first-run theme selection screen.
 *
 * Shows when a user first installs the app (detected via localStorage flag).
 * Lets them choose:
 *   1. Theme color (saffron, emerald, blue, violet, rose, teal)
 *   2. Light or dark mode
 *
 * After they pick, the choice is saved and this screen never shows again.
 * Users can still change their theme later in Settings.
 *
 * The picker itself uses the currently-selected theme for its own styling,
 * so users see live previews as they tap different swatches.
 */

import { useState, useEffect } from 'react'
import { useAppStore, type ThemeColor } from '@/store/app-store'
import { THEME_OPTIONS } from '@/components/providers/ThemeProvider'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Check, Sun, Moon, Sparkles, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'

const STORAGE_KEY = 'bahikhata-theme-picker-done'

export function ThemePicker({ open, onDone }: { open: boolean; onDone: () => void }) {
  const { themeColor, darkMode, setThemeColor, setFeature } = useAppStore()
  const [selectedColor, setSelectedColor] = useState<ThemeColor>(themeColor)
  const [selectedDark, setSelectedDark] = useState<boolean>(darkMode)

  // Apply the user's selection live as they tap (so they see previews)
  useEffect(() => {
    if (open) {
      setThemeColor(selectedColor)
      setFeature('darkMode', selectedDark)
    }
  }, [selectedColor, selectedDark, open, setThemeColor, setFeature])

  const handleConfirm = () => {
    haptic.success()
    try {
      localStorage.setItem(STORAGE_KEY, 'true')
    } catch {}
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={() => { /* don't allow closing by clicking outside */ }}>
      <DialogContent className="max-w-md p-0 overflow-hidden" showCloseButton={false}>
        {/* Header — gradient banner */}
        <div className="bg-gradient-saffron p-6 text-white text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 pointer-events-none" />
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold font-heading tracking-tight">Choose Your Theme</h2>
            <p className="text-white/80 text-sm mt-1">
              Pick a color you love. You can change it anytime in Settings.
            </p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Color swatches */}
          <div>
            <p className="text-sm font-semibold mb-3">Color</p>
            <div className="grid grid-cols-3 gap-3">
              {THEME_OPTIONS.map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => { haptic.click(); setSelectedColor(theme.id) }}
                  className={cn(
                    'relative rounded-2xl p-3 border-2 transition-all active:scale-95',
                    selectedColor === theme.id
                      ? 'border-primary shadow-md'
                      : 'border-border hover:border-primary/40'
                  )}
                >
                  {/* Swatch — gradient preview */}
                  <div
                    className="w-full aspect-square rounded-xl mb-2"
                    style={{ background: theme.swatch }}
                  />
                  <p className="text-xs font-medium text-center">{theme.label}</p>
                  {selectedColor === theme.id && (
                    <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                      <Check className="w-3 h-3 text-primary-foreground" strokeWidth={3} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Light / Dark toggle */}
          <div>
            <p className="text-sm font-semibold mb-3">Mode</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { haptic.click(); setSelectedDark(false) }}
                className={cn(
                  'rounded-2xl p-4 border-2 transition-all active:scale-95 flex flex-col items-center gap-2',
                  !selectedDark
                    ? 'border-primary shadow-md bg-primary/5'
                    : 'border-border hover:border-primary/40'
                )}
              >
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <Sun className="w-5 h-5 text-amber-600" />
                </div>
                <span className="text-sm font-medium">Light</span>
              </button>
              <button
                onClick={() => { haptic.click(); setSelectedDark(true) }}
                className={cn(
                  'rounded-2xl p-4 border-2 transition-all active:scale-95 flex flex-col items-center gap-2',
                  selectedDark
                    ? 'border-primary shadow-md bg-primary/5'
                    : 'border-border hover:border-primary/40'
                )}
              >
                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center">
                  <Moon className="w-5 h-5 text-slate-200" />
                </div>
                <span className="text-sm font-medium">Dark</span>
              </button>
            </div>
          </div>

          {/* Confirm button */}
          <Button
            onClick={handleConfirm}
            className="w-full bg-gradient-saffron shadow-md gap-2 h-11"
            size="lg"
          >
            <Check className="w-4 h-4" />
            Confirm Theme
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Check if the theme picker has been completed.
 * Used by page.tsx to decide whether to show the picker on app launch.
 */
export function isThemePickerDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}
