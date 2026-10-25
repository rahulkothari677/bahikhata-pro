'use client'

/**
 * Phase 7c step 2d (change C12) — the cards for typed lines the bill was not
 * sure of ("dal 400" — which dal?). Rahul, 25 Oct: unsure items wait at the top
 * of the bill as cards, never a popup. Typing carries on underneath; a tap on a
 * choice puts it on the bill with the amount that was said. Save waits while a
 * card is open, so nothing typed is ever dropped without a word (P6).
 */
import { X } from 'lucide-react'

export interface TypedCheck {
  id: number
  said: string
  /** The words a pick is remembered under (lib/typed-pick.ts learnKey). */
  key: string
  choices: { product: any; qty: number }[]
  /** Matches beyond the choices shown. */
  more: number
}

export function TypedChecks({ checks, describe, onPick, onDrop, onNewItem, onOneOff }: {
  checks: TypedCheck[]
  /** "400 g · ₹56", "× 3 · ₹30" — what a choice would put on the bill. */
  describe: (product: any, qty: number) => string
  onPick: (check: TypedCheck, choice: { product: any; qty: number }) => void
  onDrop: (id: number) => void
  onNewItem: (check: TypedCheck) => void
  /** "Bill it once" — only for a shop that charges no GST (OneOffLine.tsx). */
  onOneOff?: (check: TypedCheck) => void
}) {
  if (!checks.length) return null
  return (
    <section aria-label="To check" className="space-y-2 mb-3">
      <p className="text-xs font-semibold text-check">{checks.length} to check · Save waits for {checks.length === 1 ? 'it' : 'them'}</p>
      {checks.map((c) => (
        <div key={c.id} className="rounded-lg border border-check bg-check/10 p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <p className="flex-1 min-w-0 text-sm">
              <span className="font-semibold">“{c.said}”</span>
              {' — '}{c.choices.length ? 'which one?' : 'not in your items'}
              {c.more > 0 && <span className="text-xs text-muted-foreground"> · {c.more} more: type more of the name</span>}
            </p>
            <button type="button" onClick={() => onDrop(c.id)} aria-label={`Remove “${c.said}”`} className="w-12 h-12 shrink-0 inline-flex items-center justify-center rounded-lg hover:bg-muted">
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>
          <div role="group" aria-label={`Choices for ${c.said}`} className="flex gap-1.5 overflow-x-auto no-scrollbar">
            {c.choices.map((ch) => (
              <button
                key={ch.product.id}
                type="button"
                onClick={() => onPick(c, ch)}
                className="hit-48 shrink-0 min-h-10 rounded-lg border border-check bg-card px-2.5 text-xs font-semibold whitespace-nowrap tabular-nums"
              >
                {ch.product.name} · {describe(ch.product, ch.qty)}
              </button>
            ))}
            {!c.choices.length && onOneOff && (
              <button type="button" onClick={() => onOneOff(c)} className="hit-48 shrink-0 min-h-10 rounded-lg border border-primary text-primary bg-card px-2.5 text-xs font-semibold whitespace-nowrap">
                + Bill it once
              </button>
            )}
            {!c.choices.length && (
              <button type="button" onClick={() => onNewItem(c)} className="hit-48 shrink-0 min-h-10 rounded-lg border border-primary text-primary bg-card px-2.5 text-xs font-semibold whitespace-nowrap">
                + Add it as a new item
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}
