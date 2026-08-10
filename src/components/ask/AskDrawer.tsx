'use client'

/**
 * The conversations drawer.
 *
 * WHY A DRAWER AND NOT THE INLINE PANEL IT REPLACES. The first version was a
 * box that dropped down over the thread, listing past QUESTIONS, and tapping
 * one re-asked it. Three things wrong with that:
 *
 *   it covered the conversation you were reading
 *   it listed questions, when what you want is the conversation
 *   re-asking spends a round trip to reproduce something already on screen,
 *     and throws away the answer's original timestamp
 *
 * ChatGPT's drawer is the right shape and Rahul pointed at it: a panel that
 * slides in from the side, a list of conversations by name, and "New chat"
 * pinned where the thumb is. Opening one RESTORES it.
 *
 * Slides from the LEFT, like the apps it is modelled on, and closes on the
 * backdrop, on Escape and on choosing something — three ways out, because a
 * drawer you cannot dismiss is a trap on a phone.
 */

import { useEffect } from 'react'
import { X, Plus, MessageSquare, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { whenLabel, type AskConversation } from '@/lib/ask-thread'

export function AskDrawer({
  open, onClose, conversations, currentId, onOpenConversation, onNewChat, onDelete,
}: {
  open: boolean
  onClose: () => void
  conversations: AskConversation[]
  currentId: string | null
  onOpenConversation: (id: string) => void
  onNewChat: () => void
  onDelete: (id: string) => void
}) {
  // Escape closes it. Cheap, and the thing a keyboard user reaches for first.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      {/* Backdrop. Fades rather than appearing, so the panel reads as sliding
          over the page instead of the page being replaced. */}
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          'fixed inset-0 z-50 bg-black/40 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />
      <aside
        role="dialog"
        aria-label="Conversations"
        aria-hidden={!open}
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-[82%] max-w-sm bg-card border-r border-border',
          'flex flex-col shadow-2xl transition-transform duration-250 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 flex-shrink-0">
          <p className="text-xl font-bold">Conversations</p>
          <button onClick={onClose} aria-label="Close conversations"
            className="w-12 h-12 rounded-full hover:bg-muted flex items-center justify-center -mr-2.5">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide px-3 pb-2">
          {conversations.length === 0 ? (
            <p className="text-sm text-muted-foreground px-2 py-6 text-center">
              Nothing saved yet. Ask something and it will appear here.
            </p>
          ) : (
            conversations.map(c => (
              <div
                key={c.id}
                className={cn(
                  'group flex items-center gap-1 rounded-xl',
                  c.id === currentId ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <button
                  onClick={() => { onOpenConversation(c.id); onClose() }}
                  className="flex-1 min-w-0 text-left px-3 py-3 min-h-[3rem] flex items-start gap-3"
                >
                  <MessageSquare className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base truncate">{c.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {whenLabel(c.updatedAt)} · {c.messages.filter(m => m.role === 'user').length} question
                      {c.messages.filter(m => m.role === 'user').length === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => onDelete(c.id)}
                  aria-label={`Delete conversation: ${c.title}`}
                  className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100 focus:opacity-100 hover:text-rose-600"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Pinned at the bottom, where the thumb already is — the one action
            you always want from this panel. */}
        <div className="p-3 border-t border-border flex-shrink-0">
          <button
            onClick={() => { onNewChat(); onClose() }}
            className="w-full flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground py-3.5 text-base font-semibold"
          >
            <Plus className="w-5 h-5" /> New chat
          </button>
        </div>
      </aside>
    </>
  )
}
