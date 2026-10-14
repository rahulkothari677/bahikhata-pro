'use client'

/**
 * NewEntrySheet — one place to create anything (Phase 5a-3, ledger model §6).
 *
 * A tap on the bottom bar's + opens this sheet; holding + still goes straight
 * to New sale (see MobileBottomNav). Every entry is a nav-registry destination
 * on the 'new-sheet' surface and opens through the shared handleNavAction, so
 * the sheet holds no second list of screens and opens no new forms.
 *
 * Layout, thumb-first: the two AI ways in (Scan a bill, Speak) at the top, the
 * eight kinds of entry in a grid, and New sale as the big button at the bottom,
 * nearest the thumb.
 */
import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { useAppStore } from '@/store/app-store'
import { NAV_REGISTRY, filterByPermissions, type NavDestination } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { useTranslation } from '@/hooks/use-translation'
import { haptic } from '@/lib/haptic'
import { cn } from '@/lib/utils'

/** The sheet's three rows, in order, from the registry. Exported for the guard. */
export function newSheetEntries(registry: NavDestination[]) {
  const all = registry
    .filter((d) => d.surfaces?.includes('new-sheet'))
    .sort((a, b) => (a.sheetOrder ?? 0) - (b.sheetOrder ?? 0))
  return {
    ai: all.filter((d) => d.sheetRow === 'ai'),
    grid: all.filter((d) => d.sheetRow === 'grid'),
    primary: all.find((d) => d.sheetRow === 'primary'),
  }
}

export function NewEntrySheet() {
  const newSheetOpen = useAppStore((s) => s.newSheetOpen)
  const setNewSheetOpen = useAppStore((s) => s.setNewSheetOpen)
  const { canAccess } = useStaffPermissions()
  const { t } = useTranslation()

  const entries = useMemo(() => newSheetEntries(filterByPermissions(
    NAV_REGISTRY.filter((d) => d.surfaces?.includes('new-sheet')),
    { canAccess, isFlagEnabled: () => true, isOwner: true, isFounder: true, platform: 'mobile' },
  )), [canAccess])

  const name = (d: NavDestination) => t(d.shortLabelKey ?? d.labelKey ?? '') || d.label
  const open = (d: NavDestination) => {
    haptic.click()
    setNewSheetOpen(false)
    handleNavAction(d)
  }

  return (
    <Sheet open={newSheetOpen} onOpenChange={setNewSheetOpen}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl max-h-[88vh] overflow-y-auto gap-0 pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-lg"
      >
        <SheetHeader className="pb-2">
          <SheetTitle className="text-lg">{t('new.title')}</SheetTitle>
          <SheetDescription className="sr-only">Choose what to add</SheetDescription>
        </SheetHeader>

        {entries.ai.length > 0 && (
          <div className="px-4 grid grid-cols-2 gap-3">
            {entries.ai.map((d) => {
              const Icon = d.icon
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => open(d)}
                  className="min-h-12 rounded-2xl bg-ai-soft p-3 text-left flex items-center gap-3"
                >
                  <span className="w-10 h-10 rounded-xl bg-card text-ai flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="text-sm font-bold text-ai leading-tight">{name(d)}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="px-4 mt-4 grid grid-cols-4 gap-1">
          {entries.grid.map((d) => {
            const Icon = d.icon
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => open(d)}
                className="min-h-12 rounded-xl py-2 px-1 flex flex-col items-center gap-1.5 text-center hover:bg-muted transition-colors"
              >
                <span className={cn('w-11 h-11 rounded-2xl flex items-center justify-center', d.iconBg || 'bg-muted', d.iconColor || 'text-foreground')}>
                  <Icon className="w-5 h-5" />
                </span>
                <span className="text-xs font-semibold leading-tight">{name(d)}</span>
              </button>
            )
          })}
        </div>

        {entries.primary && (
          <div className="px-4 mt-4">
            <button
              type="button"
              onClick={() => open(entries.primary!)}
              className="w-full min-h-14 rounded-2xl bg-gradient-saffron text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-primary/30"
            >
              <Plus className="w-5 h-5" strokeWidth={2.5} />
              {name(entries.primary)}
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
