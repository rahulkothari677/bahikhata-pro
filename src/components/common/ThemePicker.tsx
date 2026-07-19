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
 * Design: compact dialog that fits within viewport on all screen sizes.
 * Uses max-h-[90vh] + overflow-y-auto to prevent cutoff on small screens
 * or when desktop taskbar reduces available height.
 */

import { useState, useEffect } from 'react'
import { useAppStore, type ThemeColor } from '@/store/app-store'
import { THEME_OPTIONS } from '@/components/providers/ThemeProvider'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Check, Sun, Moon, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'

const STORAGE_KEY = 'bahikhata-theme-picker-done'

export function ThemePicker({ open, onDone }: { open: boolean; onDone: () => void }) {
  const { themeColor, setThemeColor, setFeature } = useAppStore()
  const [selectedColor, setSelectedColor] = useState<ThemeColor>(themeColor)
  const [selectedDark, setSelectedDark] = useState<boolean>(false)

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
      <DialogContent
        className="max-w-sm p-0 overflow-hidden gap-0 max-h-[90vh] flex flex-col"
        showCloseButton={false}
      >
        {/* Header — compact gradient banner */}
        <div className="bg-gradient-saffron px-5 py-4 text-white relative overflow-hidden flex-shrink-0">
          <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-12 -mt-12 pointer-events-none" />
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold font-heading tracking-tight">Choose Your Theme</h2>
              <p className="text-white/80 text-xs mt-0.5 leading-tight">
                Pick a color you love. Change anytime in Settings.
              </p>
            </div>
          </div>
        </div>

        {/* Body — scrollable if needed, but compact enough to fit most screens */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Color swatches — compact grid */}
          <div>
            <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Color</p>
            <div className="grid grid-cols-3 gap-2">
              {THEME_OPTIONS.map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => { haptic.click(); setSelectedColor(theme.id) }}
                  className={cn(
                    'relative rounded-xl p-2 border-2 transition-all active:scale-95',
                    selectedColor === theme.id
                      ? 'border-primary shadow-sm'
                      : 'border-transparent hover:border-border'
                  )}
                >
                  {/* Swatch — smaller, circular for premium feel */}
                  <div
                    className="w-full aspect-square rounded-lg mb-1.5"
                    style={{ background: theme.swatch }}
                  />
                  <p className="text-3xs font-medium text-center leading-tight">{theme.label}</p>
                  {selectedColor === theme.id && (
                    <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-primary-foreground" strokeWidth={3} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Light / Dark toggle — compact horizontal pills */}
          <div>
            <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Mode</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { haptic.click(); setSelectedDark(false) }}
                className={cn(
                  'rounded-xl px-3 py-2.5 border-2 transition-all active:scale-95 flex items-center justify-center gap-2',
                  !selectedDark
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                )}
              >
                <Sun className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-medium">Light</span>
              </button>
              <button
                onClick={() => { haptic.click(); setSelectedDark(true) }}
                className={cn(
                  'rounded-xl px-3 py-2.5 border-2 transition-all active:scale-95 flex items-center justify-center gap-2',
                  selectedDark
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                )}
              >
                <Moon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                <span className="text-sm font-medium">Dark</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer — Confirm button, always visible (not scrolled away) */}
        <div className="p-4 pt-0 flex-shrink-0">
          <Button
            onClick={handleConfirm}
            className="w-full bg-gradient-saffron shadow-md gap-2 h-10"
            size="default"
          >
            <Check className="w-4 h-4" />
            Confirm Theme
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
