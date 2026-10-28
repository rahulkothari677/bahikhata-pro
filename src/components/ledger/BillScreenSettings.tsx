'use client'

/**
 * Phase 7c, change C12 (#310) — ⚙ on New Sale: the bill screen's switches, on
 * the bill screen itself.
 *
 * Rahul, 25 Oct: "settings to change all these on new sale page so the user can
 * instantly change according to their comfort". A switch takes effect the
 * moment it is flipped — there is no Save — and the screen behind the sheet
 * changes with it. The list is lib/bill-screen-settings.ts, the same one
 * Settings → Features draws, so the two can never say different things.
 *
 * The shop's GST type is SHOWN here, not switched: it is the shop's
 * registration, a fact about the law, and it lives in the shop profile.
 */
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/app-store'
import { BILL_SETTING_GROUPS, billSettingsFor, startsOn } from '@/lib/bill-screen-settings'
import type { GstStatus } from '@/lib/shop-tax'

const GST_WORDS: Record<GstStatus, string> = {
  unregistered: 'Not registered: no GST on bills',
  regular: 'GST registered: tax invoice',
  composition: 'Composition: bill of supply',
}

export function BillScreenSettings({ open, onClose, isSale, shopGst }: {
  open: boolean
  onClose: () => void
  isSale: boolean
  shopGst: GstStatus
}) {
  const features = useAppStore((s) => s.features)
  const setFeature = useAppStore((s) => s.setFeature)
  const rows = billSettingsFor(isSale)
  const atDefaults = rows.every((r) => !!features[r.key] === startsOn(r))
  // C12: picks remembered on this device (the same pick twice for the same typed words).
  const learnedPicks = useAppStore((s) => s.learnedPicks)
  const setLearnedPicks = useAppStore((s) => s.setLearnedPicks)
  const learned = Object.values(learnedPicks).filter((e) => e.n >= 2).length
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      {/* #312 (7h): 55% of the phone and a light dim, so a switch's change shows on the bill above
          while the panel is still open (it covered 85% and dimmed it all). */}
      <SheetContent side="bottom" overlayClassName="bg-black/15" className="rounded-t-3xl max-h-[55dvh] overflow-y-auto pb-[calc(1rem+var(--safe-bottom))] lg:mx-auto lg:max-w-lg">
        <SheetHeader className="pb-1">
          <SheetTitle>Bill screen</SheetTitle>
          <SheetDescription>Changes apply at once and stay on this device.</SheetDescription>
        </SheetHeader>
        <div className="px-4 space-y-4">
          {BILL_SETTING_GROUPS.map((g) => {
            const inGroup = rows.filter((r) => r.group === g.id)
            if (!inGroup.length) return null
            return (
              <section key={g.id} aria-labelledby={`bill-set-${g.id}`}>
                <h3 id={`bill-set-${g.id}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{g.title}</h3>
                <ul className="rounded-lg border border-border divide-y divide-border">
                  {inGroup.map((r) => (
                    <li key={r.key} className="min-h-14 px-3 py-2 flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{r.label}</span>
                        <span className="block text-xs text-muted-foreground">{r.help}</span>
                      </span>
                      <Switch
                        id={`bill-set-${r.key}`}
                        checked={!!features[r.key]}
                        onCheckedChange={(on) => setFeature(r.key, on)}
                        aria-label={r.label}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          {learned > 0 && (
            <div className="rounded-lg border border-border min-h-14 px-3 py-2 flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium">Learned picks</span>
                <span className="block text-xs text-muted-foreground">{learned} remembered on this device</span>
              </span>
              <Button type="button" variant="outline" className="h-12 shrink-0" onClick={() => setLearnedPicks({})}>Forget</Button>
            </div>
          )}
          <section aria-labelledby="bill-set-tax">
            <h3 id="bill-set-tax" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Tax</h3>
            <div className="rounded-lg border border-border min-h-14 px-3 py-2 flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{GST_WORDS[shopGst]}</span>
                <span className="block text-xs text-muted-foreground">From your shop profile</span>
              </span>
              <Button
                type="button"
                variant="outline"
                className="h-12 shrink-0"
                onClick={() => {
                  onClose()
                  useAppStore.getState().setPendingSettingsTab('profile')
                  useAppStore.getState().setView('settings')
                }}
              >
                Change
              </Button>
            </div>
          </section>
          {!atDefaults && (
            <Button type="button" variant="outline" className="w-full h-12" onClick={() => rows.forEach((r) => setFeature(r.key, startsOn(r)))}>
              Back to the defaults
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
