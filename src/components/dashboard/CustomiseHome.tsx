'use client'

/**
 * Customise Home (Phase 5b-6): a switch per Home section, saved on this
 * device. The Today card is always on. See lib/home-sections.ts.
 */
import { useCallback, useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/hooks/use-translation'
import { HOME_SECTIONS, readHidden, writeHidden, type HomeSectionId } from '@/lib/home-sections'

export function useHomeSections() {
  // Everything shows until storage is read (first paint matches the server).
  const [hidden, setHidden] = useState<HomeSectionId[]>([])
  useEffect(() => { setHidden(readHidden()) }, [])
  const shown = useCallback((id: HomeSectionId) => !hidden.includes(id), [hidden])
  const set = useCallback((id: HomeSectionId, on: boolean) => {
    setHidden((h) => {
      const next = on ? h.filter((x) => x !== id) : [...new Set([...h, id])]
      writeHidden(next)
      return next
    })
  }, [])
  const reset = useCallback(() => { writeHidden([]); setHidden([]) }, [])
  return { shown, set, reset, hiddenCount: hidden.length }
}

export function CustomiseHome({ home }: { home: ReturnType<typeof useHomeSections> }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" className="w-full min-h-12 gap-2" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="w-4 h-4" />
        {t('home.customise')}
        {home.hiddenCount > 0 && <span className="text-xs text-muted-foreground">· {t('home.hidden_n').replace('{n}', String(home.hiddenCount))}</span>}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[88vh] overflow-y-auto gap-0 pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-lg">
          <SheetHeader className="pb-1">
            <SheetTitle className="text-lg">{t('home.customise')}</SheetTitle>
            <SheetDescription className="text-xs">{t('home.customise_note')}</SheetDescription>
          </SheetHeader>
          <ul className="px-4 divide-y divide-border">
            {HOME_SECTIONS.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 min-h-12 py-1">
                <label htmlFor={`home-sec-${s.id}`} className="text-sm flex-1">{t(s.key)}</label>
                <Switch id={`home-sec-${s.id}`} checked={home.shown(s.id)} onCheckedChange={(on) => home.set(s.id, on)} />
              </li>
            ))}
          </ul>
          <div className="px-4 pt-3">
            <Button variant="ghost" className="w-full min-h-12" onClick={home.reset}>{t('home.reset')}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
