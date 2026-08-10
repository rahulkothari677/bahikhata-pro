'use client'

/**
 * One answer, with its receipts.
 *
 * WHAT THIS IS NOT: a chat bubble containing prose. Every other assistant
 * returns a paragraph you have to trust. This returns a figure, what it was
 * read as, and the documents behind it — because the whole claim of this
 * feature is that you never have to take a number on faith.
 *
 * SO THERE IS NO "AI CAN MAKE MISTAKES" LINE HERE, and there never will be.
 * Gemini prints that under every answer. It has to: it generated the number.
 * Ours is computed by the same tested code the screens use, and the bills are
 * one tap away. Where they apologise in advance, we show the working.
 *
 * AND NO THUMBS UP / DOWN on a figure. A balance is not a matter of taste.
 * The useful correction is "you read the wrong Ramesh", which is what the
 * disambiguation list is for.
 */

import { Receipt, User, Package, Info, CheckCircle2, AlertTriangle } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import type { AskAnswerPayload, AskSource, AskChoice } from '@/lib/ask-thread'

function SourceIcon({ kind }: { kind: AskSource['kind'] }) {
  const cls = 'w-3.5 h-3.5 text-muted-foreground flex-shrink-0'
  if (kind === 'transaction') return <Receipt className={cls} />
  if (kind === 'party') return <User className={cls} />
  return <Package className={cls} />
}

/**
 * More than one person matched.
 *
 * Names alone are useless here — two customers called Ramesh tell you nothing.
 * Phone, balance and WHEN YOU LAST DEALT WITH THEM are what a shopkeeper
 * actually recognises: "the Ramesh I saw last week". Enough to choose without
 * opening any of them.
 *
 * It never picks, not even when one match is far likelier. A confidently wrong
 * Ramesh is worse than a question.
 */
function ChoiceList({ choices, onPick }: { choices: AskChoice[]; onPick: (c: AskChoice) => void }) {
  return (
    <div className="mt-2 rounded-xl border border-border/60 divide-y divide-border overflow-hidden">
      {choices.map(c => (
        <button
          key={c.id}
          onClick={() => onPick(c)}
          className="w-full text-left px-3 py-2.5 hover:bg-muted flex items-start gap-3"
        >
          <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xs font-bold flex-shrink-0">
            {c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium truncate">{c.name}</span>
              {c.balance !== undefined && (
                <span className={`text-xs tabular-nums font-medium flex-shrink-0 ${c.balance > 0 ? 'text-emerald-600 dark:text-emerald-400' : c.balance < 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>
                  {c.balance === 0 ? '—' : formatINR(Math.abs(c.balance))}
                </span>
              )}
            </span>
            <span className="block text-2xs text-muted-foreground truncate">
              {[c.phone, c.lastInvoiceNo && `Last: ${c.lastInvoiceNo}`, c.lastActivity]
                .filter(Boolean).join(' · ') || 'No other details'}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function AskAnswer({
  payload, onAsk,
}: {
  payload: AskAnswerPayload
  onAsk: (q: string) => void
}) {
  const setView = useAppStore(s => s.setView)

  const open = (s: AskSource) => {
    if (s.kind === 'transaction') setView('sales')
    else if (s.kind === 'party') setView('parties')
    else setView('inventory')
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 space-y-2.5">
      {/* What it understood — always. This is where a misread question is
          caught, and it is the reason a wrong reading is recoverable at all. */}
      {payload.understoodAs && (
        <p className="text-2xs text-muted-foreground">
          Showing: <span className="font-medium text-foreground">{payload.understoodAs}</span>
        </p>
      )}

      {payload.answered ? (
        <>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-1" />
            <p className="text-lg font-bold leading-snug">{payload.headline}</p>
          </div>
          {payload.detail && <p className="text-xs text-muted-foreground">{payload.detail}</p>}
        </>
      ) : (
        <div className="flex items-start gap-2">
          {payload.choices?.length
            ? <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            : <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{payload.message}</p>

            {payload.choices?.length ? (
              <ChoiceList
                choices={payload.choices}
                onPick={c => onAsk(`${c.name} ka kitna baaki hai`)}
              />
            ) : null}

            {payload.examples?.length ? (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {payload.examples.map(ex => (
                  <button key={ex} onClick={() => onAsk(ex)}
                    className="text-2xs px-2.5 py-1 rounded-full border border-border/60 hover:bg-muted">
                    {ex}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* The receipts. */}
      {payload.sources?.length ? (
        <div className="pt-2 border-t border-border space-y-0.5">
          <p className="text-3xs uppercase tracking-wide text-muted-foreground mb-1">Where this came from</p>
          {payload.sources.map(s => (
            <button key={`${s.kind}-${s.id}`} onClick={() => open(s)}
              className="w-full flex items-center justify-between gap-2 py-1.5 px-1 text-xs hover:bg-muted rounded-md">
              <span className="flex items-center gap-2 min-w-0">
                <SourceIcon kind={s.kind} />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="tabular-nums flex-shrink-0 font-medium">
                {s.amount !== undefined ? formatINR(s.amount)
                  : s.quantity !== undefined ? `${s.quantity} ${s.unit || ''}`.trim() : ''}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
