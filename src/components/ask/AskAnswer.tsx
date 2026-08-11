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

import { useState } from 'react'
import {
  Receipt, User, Package, Info, CheckCircle2, AlertTriangle,
  MessageCircle, HandCoins, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatINR } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'
import { useAppStore } from '@/store/app-store'
import { handleNavAction } from '@/lib/handle-nav-action'
import { getById } from '@/lib/nav-registry'
import type { AskAnswerPayload, AskSource, AskChoice, AskAction } from '@/lib/ask-thread'

function SourceIcon({ kind }: { kind: AskSource['kind'] }) {
  const cls = 'w-4 h-4 text-muted-foreground flex-shrink-0'
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
          className="w-full text-left px-3 py-3 min-h-[3rem] hover:bg-muted flex items-start gap-3"
        >
          <span className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold flex-shrink-0">
            {c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-base font-medium truncate">{c.name}</span>
              {c.balance !== undefined && (
                <span className={`text-sm tabular-nums font-medium flex-shrink-0 ${c.balance > 0 ? 'text-emerald-600 dark:text-emerald-400' : c.balance < 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>
                  {c.balance === 0 ? '—' : formatINR(Math.abs(c.balance))}
                </span>
              )}
            </span>
            <span className="block text-xs text-muted-foreground truncate">
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
  const setPreviousView = useAppStore(s => s.setPreviousView)
  const setSelectedTransactionId = useAppStore(s => s.setSelectedTransactionId)
  const setSelectedPartyId = useAppStore(s => s.setSelectedPartyId)
  const setPendingSettle = useAppStore(s => s.setPendingSettle)
  /*
   * The SAME toggle PartyProfile checks before it shows its reminder button.
   * A shopkeeper who switched Payment Reminders off in Settings has said they
   * do not want this; offering it here anyway would mean the party screen and
   * the chat disagree about what the app does.
   */
  const remindersOn = useAppStore(s => s.features?.paymentReminders)
  const [busy, setBusy] = useState<AskAction['kind'] | null>(null)

  /*
   * A RECEIPT OPENS THE RECORD IT NAMES.
   *
   * This used to send you to the LIST — tap "INV-0001" under an answer and you
   * landed on the sales screen with fifty bills and no INV-0001 in sight. The
   * whole promise of this feature is that a figure is checkable in one tap, and
   * a list is not the bill.
   *
   * Same navigation GlobalSearch has always used for the same job, including
   * `previousView`, so Back comes straight back to the conversation instead of
   * stranding you in the ledger.
   */
  /*
   * ACTIONS REUSE THE SCREENS, they do not reimplement them.
   *
   * `settle` hands off to the Settle page exactly as PartyBills does, including
   * `pendingSettle` when we know which bill — so allocation, payment direction
   * and the paise arithmetic all stay in the one place that is already tested.
   * A second payment path written for the chat would be a second chance to get
   * money wrong.
   *
   * `remind` calls the same /api/whatsapp-reminder PartyProfile calls, and like
   * PartyProfile it OPENS WhatsApp with the message ready rather than sending
   * anything. Nothing here messages a customer without the shopkeeper pressing
   * send themselves.
   */
  const runAction = async (a: AskAction) => {
    const from = useAppStore.getState().currentView

    /*
     * "Fix before filing" on a notice-risk answer. Reuses handleNavAction — the
     * one shared navigator — rather than a second way to reach a screen.
     */
    if (a.kind === 'open-screen') {
      const dest = a.destinationId ? getById(a.destinationId) : undefined
      if (dest) {
        setPreviousView(from)
        handleNavAction(dest, { previousView: from })
      }
      return
    }

    if (!a.partyId) return   // party actions cannot run without one
    if (a.kind === 'remind') {
      setBusy('remind')
      try {
        const r = await offlineFetch('/api/whatsapp-reminder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partyId: a.partyId }),
        })
        const data = await r.json()
        if (data.success) {
          window.open(data.whatsappUrl, '_blank')
          toast.success('Opening WhatsApp with the reminder ready to send')
        } else {
          toast.error(data.error || "Couldn't prepare the reminder")
        }
      } catch (e: any) {
        toast.error(e?.message || "Couldn't prepare the reminder")
      } finally {
        setBusy(null)
      }
      return
    }
    setSelectedPartyId(a.partyId)
    setPreviousView(from)
    if (a.kind === 'settle') {
      // Only when there is exactly one unpaid bill does the server name it.
      // With several it sends none, and Settle asks which — allocating a
      // payment to the wrong invoice is a real error, not a guess worth making.
      setPendingSettle(
        a.transactionId
          ? { transactionId: a.transactionId, invoiceNo: a.invoiceNo ?? null, amount: a.amount ?? 0 }
          : null,
      )
      setView('party-settle')
    } else {
      setView('party-profile')
    }
  }

  const open = (s: AskSource) => {
    const from = useAppStore.getState().currentView
    if (s.kind === 'transaction') {
      setSelectedTransactionId(s.id)
      setPreviousView(from)
      setView('transaction-detail')
    } else if (s.kind === 'party') {
      setSelectedPartyId(s.id)
      setPreviousView(from)
      setView('party-profile')
    } else {
      setPreviousView(from)
      setView('inventory')
    }
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
      {/* What it understood — always. This is where a misread question is
          caught, and it is the reason a wrong reading is recoverable at all. */}
      {payload.understoodAs && (
        <p className="text-xs text-muted-foreground">
          Showing: <span className="font-medium text-foreground">{payload.understoodAs}</span>
        </p>
      )}

      {payload.answered ? (
        <>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-1.5" />
            <p className="text-2xl font-bold leading-snug">{payload.headline}</p>
          </div>
          {payload.detail && <p className="text-sm text-muted-foreground">{payload.detail}</p>}
        </>
      ) : (
        <div className="flex items-start gap-2">
          {payload.choices?.length
            ? <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            : <Info className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />}
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium">{payload.message}</p>

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
                    className="text-sm px-3.5 py-2 rounded-full border border-border/60 hover:bg-muted">
                    {ex}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* What to do about it. Above the receipts, because the receipts are for
          checking and this is for acting — and acting is why they asked. */}
      {payload.actions?.length ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {payload.actions.filter(a => a.kind !== 'remind' || remindersOn).map(a => (
            <button
              key={a.kind}
              onClick={() => runAction(a)}
              disabled={busy === a.kind}
              className={
                a.kind === 'open-party'
                  ? 'inline-flex items-center gap-1.5 rounded-full border border-border/60 px-4 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-50'
                  : 'inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold disabled:opacity-50'
              }
            >
              {busy === a.kind
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : a.kind === 'remind' ? <MessageCircle className="w-4 h-4" />
                : a.kind === 'settle' ? <HandCoins className="w-4 h-4" />
                : a.kind === 'open-screen' ? <AlertTriangle className="w-4 h-4" />
                : <User className="w-4 h-4" />}
              {a.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* The receipts. */}
      {payload.sources?.length ? (
        <div className="pt-2 border-t border-border space-y-0.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Where this came from</p>
          {payload.sources.map(s => (
            <button key={`${s.kind}-${s.id}`} onClick={() => open(s)}
              className="w-full flex items-center justify-between gap-2 py-2.5 px-1.5 min-h-[2.75rem] text-sm hover:bg-muted rounded-lg">
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
