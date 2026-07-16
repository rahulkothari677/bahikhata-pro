'use client'

/**
 * 🔒 V22-13 (Batch C, Phase 7f) — BulkRemindersModal
 *
 * Shows all parties with outstanding receivable balances. Lets the user
 * select multiple parties and send WhatsApp payment reminders one by one.
 *
 * Since browsers block multiple popups, this uses a "step through" flow:
 * 1. User selects parties from the list
 * 2. Clicks "Start Sending"
 * 3. Opens the first party's WhatsApp link
 * 4. After sending, clicks "Next" to open the next one
 * 5. Shows progress (3 of 7 sent)
 *
 * Uses the existing /api/whatsapp-reminder endpoint to generate each link.
 */

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'
import { cn, formatINR } from '@/lib/utils'
import { haptic } from '@/lib/haptic'
import { toast as sonnerToast } from 'sonner'
import {
  X, Send, Check, ChevronRight, User, Loader2, MessageCircle,
} from 'lucide-react'

interface BulkRemindersModalProps {
  open: boolean
  onClose: () => void
}

export function BulkRemindersModal({ open, onClose }: BulkRemindersModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [reminderLinks, setReminderLinks] = useState<{ partyId: string; url: string; name: string }[]>([])

  // 🔒 AUDIT V23 FIX §9.8: Escape key to close modal (accessibility)
  useEffect(() => {
    if (!open) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, sending, onClose])

  // Fetch all parties (API always includes balances)
  const { data, isLoading } = useQuery({
    queryKey: ['parties-for-reminders'],
    queryFn: async () => {
      const r = await offlineFetch('/api/parties')
      if (!r.ok) throw new Error('Failed to load parties')
      return r.json()
    },
    enabled: open,
  })

  if (!open) return null

  // Filter parties with outstanding receivable (positive balance = they owe us)
  const partiesWithDues = (data?.parties || []).filter((p: any) => {
    const balance = p.balance || p.currentBalance || 0
    return balance > 0 && p.phone  // must have a phone number to send WhatsApp
  })

  const toggleSelect = (partyId: string) => {
    haptic.click()
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(partyId)) next.delete(partyId)
      else next.add(partyId)
      return next
    })
  }

  const selectAll = () => {
    haptic.click()
    setSelected(new Set(partiesWithDues.map((p: any) => p.id)))
  }

  const selectNone = () => {
    haptic.click()
    setSelected(new Set())
  }

  // 🔒 AUDIT V23 FIX §8.9: Pre-generate all WhatsApp links BEFORE the flow starts.
  // Was: window.open() called after await fetch() — outside the user-gesture call stack.
  // Safari/Chrome Android block this as a popup. Now: fetch all links upfront in
  // startSending(), store them, and each "Next" tap opens synchronously (no await).

  const startSending = async () => {
    if (selected.size === 0) {
      sonnerToast.error('Select at least one party')
      return
    }
    setSending(true)

    // Pre-generate all links in one batch (before any window.open)
    const selectedParties = partiesWithDues.filter((p: any) => selected.has(p.id))
    const links: { partyId: string; url: string; name: string }[] = []
    for (const party of selectedParties) {
      try {
        const r = await offlineFetch('/api/whatsapp-reminder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partyId: party.id }),
        })
        const result = await r.json()
        if (result.whatsappUrl) {
          links.push({ partyId: party.id, url: result.whatsappUrl, name: party.name })
        }
      } catch {
        sonnerToast.error(`Failed to generate reminder for ${party.name}`)
      }
    }

    if (links.length === 0) {
      sonnerToast.error('No reminders could be generated')
      setSending(false)
      return
    }

    setReminderLinks(links)
    setCurrentIndex(0)
    // Open the first link synchronously (user gesture from the "Start Sending" click)
    window.open(links[0].url, '_blank')
  }

  const nextReminder = () => {
    haptic.click()
    if (currentIndex === null) return
    // Mark current as sent
    const currentLink = reminderLinks[currentIndex]
    if (currentLink) {
      setSentIds(prev => new Set(prev).add(currentLink.partyId))
    }
    const nextIndex = currentIndex + 1
    if (nextIndex >= reminderLinks.length) {
      // Done
      setSending(false)
      setCurrentIndex(null)
      sonnerToast.success(`All ${reminderLinks.length} reminders opened!`)
      onClose()
      return
    }
    setCurrentIndex(nextIndex)
    // Open next link synchronously (user gesture from the "Next" button click)
    window.open(reminderLinks[nextIndex].url, '_blank')
  }

  const selectedParties = partiesWithDues.filter((p: any) => selected.has(p.id))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl shadow-2xl max-w-md w-full max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="font-bold text-sm">WhatsApp Bulk Reminders</h3>
              <p className="text-[11px] text-muted-foreground">
                {sending
                  ? `Opening ${currentIndex !== null ? currentIndex + 1 : 0} of ${reminderLinks.length}`
                  : `${partiesWithDues.length} customers with outstanding dues`}
              </p>
            </div>
          </div>
          <button
            onClick={() => { setSending(false); setCurrentIndex(null); onClose() }}
            className="p-1.5 rounded-lg hover:bg-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sending mode: show current party + Next button */}
        {sending && currentIndex !== null && reminderLinks[currentIndex] ? (
          <div className="flex-1 flex flex-col p-4">
            <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center mb-3">
                <User className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="font-bold text-sm">{reminderLinks[currentIndex].name}</p>
              <p className="text-[11px] text-muted-foreground mt-3 max-w-xs">
                WhatsApp opened with a pre-filled reminder message. After sending, tap "Next" to continue.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setSending(false); setCurrentIndex(null) }}
                className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium hover:bg-muted transition"
              >
                Stop
              </button>
              <button
                onClick={nextReminder}
                className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium flex items-center justify-center gap-1.5"
              >
                {currentIndex + 1 >= reminderLinks.length ? 'Finish' : 'Next'}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Selection mode: list of parties */}
            <div className="flex-1 overflow-y-auto p-3">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : partiesWithDues.length === 0 ? (
                <div className="text-center py-12">
                  <Check className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-medium">No outstanding dues!</p>
                  <p className="text-xs text-muted-foreground mt-1">All customers have settled their balances.</p>
                </div>
              ) : (
                <>
                  {/* Select all / none */}
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-[11px] text-muted-foreground">
                      {selected.size} of {partiesWithDues.length} selected
                    </span>
                    <div className="flex gap-2">
                      <button onClick={selectAll} className="text-[11px] font-medium text-primary hover:underline">
                        Select all
                      </button>
                      <button onClick={selectNone} className="text-[11px] font-medium text-muted-foreground hover:underline">
                        Clear
                      </button>
                    </div>
                  </div>
                  {/* Party list */}
                  <div className="space-y-1.5">
                    {partiesWithDues.map((party: any) => {
                      const isSelected = selected.has(party.id)
                      const isSent = sentIds.has(party.id)
                      const balance = party.balance || party.currentBalance || 0
                      return (
                        <button
                          key={party.id}
                          onClick={() => toggleSelect(party.id)}
                          disabled={isSent}
                          className={cn(
                            'w-full flex items-center gap-3 p-2.5 rounded-lg border transition text-left',
                            isSent
                              ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 opacity-60'
                              : isSelected
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:border-primary/30',
                          )}
                        >
                          <div className={cn(
                            'w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0',
                            isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30',
                          )}>
                            {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                            {isSent && <Check className="w-3 h-3 text-emerald-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{party.name}</p>
                            <p className="text-[11px] text-muted-foreground">{party.phone}</p>
                          </div>
                          <p className="text-sm font-bold text-rose-600 dark:text-rose-400 tabular-nums flex-shrink-0">
                            {formatINR(balance)}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Footer: Send button */}
            {partiesWithDues.length > 0 && (
              <div className="p-3 border-t border-border">
                <button
                  onClick={startSending}
                  disabled={selected.size === 0}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Send Reminders ({selected.size})
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
