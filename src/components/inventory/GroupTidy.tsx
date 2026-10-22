'use client'

/**
 * Phase 7d (#299) — "Tidy groups": groups that should be one ("Tea" next to
 * "Tea & coffee", "Personal Care" next to "Personal care"), merged on a tap.
 * Found by lib/item-groups.ts on the server's counts; nothing moves until the
 * shop says so, and only an item's group changes.
 */
import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast as sonnerToast } from 'sonner'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { offlineFetch } from '@/lib/offline-fetch'
import type { GroupDouble } from '@/lib/item-groups'
import { FolderTree, ArrowRight } from 'lucide-react'

const NOT_NOW_KEY = 'ekbook-group-doubles-not-now'
const keyOf = (d: GroupDouble) => `${d.from}→${d.into}`

export function GroupTidy({ onChanged }: { onChanged: () => void }) {
  const { data, refetch } = useQuery({
    queryKey: ['product-groups'],
    queryFn: async () => {
      const r = await offlineFetch('/api/products/groups')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<{ doubles: GroupDouble[] }>
    },
    staleTime: 60_000,
  })
  const [notNow, setNotNow] = useState<Set<string>>(() => new Set())
  useEffect(() => { try { setNotNow(new Set(JSON.parse(localStorage.getItem(NOT_NOW_KEY) || '[]'))) } catch { /* fresh */ } }, [])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const list = useMemo(() => (data?.doubles ?? []).filter((d) => !notNow.has(keyOf(d))), [data, notNow])
  if (!list.length) return null

  const skip = (d: GroupDouble) => {
    const next = new Set(notNow); next.add(keyOf(d)); setNotNow(next)
    try { localStorage.setItem(NOT_NOW_KEY, JSON.stringify([...next])) } catch { /* it just comes back next time */ }
  }
  const merge = async (ds: GroupDouble[]) => {
    setBusy(true)
    try {
      let moved = 0
      for (const d of ds) {
        const r = await offlineFetch('/api/products/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: [d.from], into: d.into }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { sonnerToast.error(j.error || 'Could not merge these groups'); break }
        moved += j.moved ?? 0
      }
      sonnerToast.success(ds.length === 1 ? `Moved into ${ds[0].into}` : `${ds.length} groups tidied · ${moved} items moved`)
      await refetch()
      onChanged()
      if (ds.length > 1) setOpen(false)
    } finally { setBusy(false) }
  }

  return (
    <>
      <Notice
        level="note"
        icon={FolderTree}
        title={`${list.length} group${list.length === 1 ? '' : 's'} look like doubles`}
        info="Groups spelt two ways, or a small group that belongs inside a bigger one. Merging moves the items into one group; prices, stock and bills do not change."
        action={<Button size="sm" onClick={() => setOpen(true)}>Review</Button>}
      >
        {list[0].from} → {list[0].into}
      </Notice>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[88vh] overflow-y-auto pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-lg">
          <SheetHeader className="pb-2">
            <SheetTitle>Tidy groups</SheetTitle>
            <SheetDescription className="sr-only">Merge groups that should be one.</SheetDescription>
          </SheetHeader>
          <div className="px-4 space-y-3">
            {list.length > 1 && <Button className="w-full h-12" disabled={busy} onClick={() => merge(list)}>Merge all {list.length}</Button>}
            <ul className="divide-y divide-border rounded-xl border border-border">
              {list.map((d) => (
                <li key={keyOf(d)} className="p-3 space-y-2">
                  <p className="text-sm flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold">{d.from}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{d.fromItems}</span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" aria-hidden />
                    <span className="font-semibold">{d.into}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{d.intoItems}</span>
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" disabled={busy} onClick={() => merge([d])}>Merge</Button>
                    <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => skip(d)}>Not now</Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
