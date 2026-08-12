'use client'

/**
 * Ask your books — the conversation.
 *
 * OWNS THE WHOLE SCREEN, including the bottom edge, and for a concrete reason:
 * it first shipped inside the ordinary shell, so the composer sat under the
 * fixed bottom nav and the text field, waveform and send button were all
 * hidden. Voice had been working the entire time; none of its controls were
 * visible. Same treatment as `party-settle`, whose comment records the same
 * collision months earlier.
 *
 * WHAT IS DELIBERATELY DIFFERENT FROM GEMINI AND CHATGPT:
 *   No model picker — a shopkeeper must never think about which model ran.
 *   No "AI can make mistakes" — they generated the number; ours is computed
 *     and carries its bills.
 *   The resting state is not empty. A general assistant knows nothing until
 *     you speak; we know the time, the unpaid bills and the GST deadline.
 *     (Live counts are 2.5; the shape is here.)
 *
 * HISTORY IS CONVERSATIONS, NOT QUESTIONS. Opening one restores it — no
 * re-asking, no second round trip, and stored answers keep their original
 * timestamps, because a balance from Tuesday is not a claim about today.
 */

/*
 * SIZING FOLLOWS THE PLATFORM, NOT MY EYE.
 *
 * Checked against Material Design 3 (this ships as an Android app) and the
 * apps a shopkeeper already has open all day:
 *
 *   Touch target   48dp minimum (Material) / 44pt (iOS HIG). Ours were 36px.
 *   Bar icons      24dp — what WhatsApp, Instagram and Gmail use. Ours 16px,
 *                  which is Material's "small/inline" size, not an action.
 *   Screen margin  16dp. AppShell passes children through untouched, so this
 *                  screen had NONE and every control touched the glass.
 *   Body text      14-16sp. I had used 10px and 11px in fourteen places —
 *                  those tokens exist for chart ticks and badges, and
 *                  globals.css says outright that 9px was "below any
 *                  legibility floor on mid-range Android in bright shops".
 *                  A shopkeeper reading a rupee figure in sunlight is the
 *                  exact case those sizes fail.
 *
 * The rule going forward: nothing a finger presses is under 44px, nothing a
 * person reads is under 12px, and money is the largest thing on screen.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { Sparkles, Menu, Plus, ArrowLeft, Lightbulb, X } from 'lucide-react'
import { offlineFetch, isOnline } from '@/lib/offline-fetch'
import { askFailureMessage } from '@/lib/ask-offline-message'
import { AskComposer, type ComposerMode } from '@/components/ask/AskComposer'
import { AskAnswer } from '@/components/ask/AskAnswer'
import { AskDrawer } from '@/components/ask/AskDrawer'
import {
  loadConversations, saveConversations, newId, whenLabel, titleFor,
  type AskMessage, type AskConversation,
} from '@/lib/ask-thread'
import { ASK_EXAMPLES } from '@/lib/ask-patterns'
import { useAppStore } from '@/store/app-store'
import { handleNavAction } from '@/lib/handle-nav-action'
import { getById } from '@/lib/nav-registry'
import { presetForAskPeriod } from '@/lib/ask-period-preset'
import { getPresetLabel } from '@/components/common/DateRangePicker'
import type { AskPeriod } from '@/lib/ask-patterns'

export function AskChat() {
  const [conversations, setConversations] = useState<AskConversation[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AskMessage[]>([])
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<ComposerMode>('idle')
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tipsOpen, setTipsOpen] = useState(false)
  const setView = useAppStore(st => st.setView)
  /*
   * The conversation as it stands RIGHT NOW, for follow-ups.
   *
   * `ask` is a useCallback and would close over a stale `messages`; a stale
   * list here would resolve "aur pichhle mahine?" against the wrong earlier
   * question, which is worse than not resolving it at all. A ref is read at
   * call time, so it cannot go stale.
   */
  const messagesRef = useRef<AskMessage[]>([])
  const threadRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef<ComposerMode>('idle')
  const lastCount = useRef(0)

  useEffect(() => { modeRef.current = mode }, [mode])

  // Load saved conversations, and resume the most recent one.
  useEffect(() => {
    const list = loadConversations()
    setConversations(list)
    if (list.length) { setCurrentId(list[0].id); setMessages(list[0].messages) }
  }, [])

  /** Persist the live thread into its conversation on every change. */
  useEffect(() => {
    if (!messages.length) return
    setConversations(prev => {
      const now = Date.now()
      const id = currentId || newId()
      const existing = prev.find(c => c.id === id)
      const updated: AskConversation = existing
        ? { ...existing, messages, title: existing.title || titleFor(messages), updatedAt: now }
        : { id, title: titleFor(messages), messages, createdAt: now, updatedAt: now }
      const next = [updated, ...prev.filter(c => c.id !== id)]
      saveConversations(next)
      if (!currentId) setCurrentId(id)
      return next
    })
  }, [messages, currentId])

  /*
   * Scroll only when a message is ADDED, and only the thread's own scrollTop.
   * `scrollIntoView` scrolls every scrollable ancestor, which dragged the page
   * as well — the "it jumps down" report. Restoring a conversation must land
   * at the newest message without animating through the whole history.
   */
  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    if (messages.length > lastCount.current && lastCount.current !== 0) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else if (messages.length > 0) {
      el.scrollTop = el.scrollHeight
    }
    lastCount.current = messages.length
  }, [messages])

  // Keep the follow-up ref in step with the conversation, including one
  // restored from history — "aur pichhle mahine?" must work when you re-open
  // a chat from last week, not only in a thread you started this minute.
  useEffect(() => { messagesRef.current = messages }, [messages])

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en-IN'
      u.rate = 0.98
      u.onstart = () => setSpeaking(true)
      u.onend = () => setSpeaking(false)
      window.speechSynthesis.speak(u)
    } catch { setSpeaking(false) }
  }, [])

  const ask = useCallback(async (text: string, viaVoice = false) => {
    const t = text.trim()
    if (!t) return
    setDraft('')
    setTipsOpen(false)
    setBusy(true)
    setStatus(viaVoice ? 'Checking your books…' : null)

    const userMsg: AskMessage = { id: newId(), role: 'user', text: t, at: Date.now(), viaVoice }
    const thinking: AskMessage = { id: newId(), role: 'thinking', at: Date.now() }
    setMessages(m => [...m, userMsg, thinking])

    /*
     * The questions already asked in THIS conversation, newest first — so
     * "aur pichhle mahine?" can be resolved against the last one that had a
     * subject. Questions only: the answers are ours, and a follow-up continues
     * what the shopkeeper asked, not what we replied.
     */
    const recentQuestions = messagesRef.current
      .filter((m): m is Extract<AskMessage, { role: 'user' }> => m.role === 'user')
      .slice(-8)
      .reverse()
      .map(m => m.text)

    try {
      const r = await offlineFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: t, recentQuestions }),
      })
      const payload = await r.json()
      setMessages(m => [...m.filter(x => x.id !== thinking.id),
        { id: newId(), role: 'answer', payload, at: Date.now() }])
      /*
       * "GSTR-1 kholo" — GO THERE.
       *
       * DELIBERATELY HERE AND NOT IN AskAnswer's render. A restored
       * conversation re-renders every card it holds, so navigating from render
       * would fling the shopkeeper out of their own history the instant they
       * opened it — and again every time they scrolled back. This function is
       * only called when someone actually asks something, which is exactly the
       * moment the navigation was requested.
       *
       * Feature flags are checked HERE and not on the server, because they
       * live in this store and the server has no view of them. The server
       * already filtered by module permission and owner-only; between the two,
       * a command cannot reach a screen the menus hide.
       */
      const nav = payload.navigate
      if (nav) {
        setTimeout(() => {
          if (nav.kind === 'record' && nav.transactionId) {
            useAppStore.getState().setSelectedTransactionId(nav.transactionId)
            useAppStore.getState().setPreviousView('ask')
            setView('transaction-detail')
            return
          }
          if (nav.kind === 'screen' && nav.destinationId) {
            const dest = getById(nav.destinationId)
            if (!dest) return
            const features = useAppStore.getState().features
            if (dest.featureFlag && !features?.[dest.featureFlag as keyof typeof features]) return

            /*
             * ARM THE PERIOD BEFORE NAVIGATING, not after — the destination
             * reads `pendingDateRange` in a mount effect, so setting it
             * afterwards would arrive too late and the report would render
             * this month before jumping.
             *
             * `preset` is the picker's LABEL, because that is the contract
             * pendingDateRange already has with Ledger: it matches on
             * getPresetLabel(p). Where no preset is exactly this range —
             * "this week", "this financial year" — the label is "Custom",
             * which is the honest thing for the picker to show.
             */
            if (nav.from && nav.to) {
              const preset = presetForAskPeriod(nav.period as AskPeriod)
              useAppStore.getState().setPendingDateRange({
                from: nav.from,
                to: nav.to,
                preset: preset ? getPresetLabel(preset) : 'Custom',
              })
            }

            handleNavAction(dest, { previousView: 'ask' })
          }
        }, 400)   // let the answer paint first, so the move is legible
      }

      if (modeRef.current === 'voice') {
        speak(payload.answered ? (payload.headline || '') : (payload.message || ''))
      }
    } catch {
      /*
       * 🔒 B3: WHICH failure it was decides what we say. `isOnline` is the
       * same signal the rest of the app's offline handling uses, read at the
       * moment it failed — one message for both cases told a shopkeeper on a
       * dead network that we "could not reach" the books, which reads as our
       * server being down, and told them the same thing when it really was.
       */
      const failure = askFailureMessage(isOnline())
      setMessages(m => [...m.filter(x => x.id !== thinking.id), {
        id: newId(), role: 'answer', at: Date.now(),
        payload: { answered: false, message: failure.message },
      }])
    } finally {
      setBusy(false)
      setStatus(null)
    }
  }, [speak])

  /** File the current conversation away and start an empty one. */
  const newChat = () => {
    setMessages([])
    setCurrentId(null)
    lastCount.current = 0
    setDraft('')
    setTipsOpen(false)
  }

  const openConversation = (id: string) => {
    const c = conversations.find(x => x.id === id)
    if (!c) return
    setCurrentId(id)
    setMessages(c.messages)
    lastCount.current = 0        // restore lands at the bottom, without animating
  }

  const deleteConversation = (id: string) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id)
      saveConversations(next)
      if (id === currentId) { setMessages([]); setCurrentId(null); lastCount.current = 0 }
      return next
    })
  }

  const isEmpty = messages.length === 0

  return (
    <div
      /*
       * FULL WIDTH ON DESKTOP, deliberately, and this reverses a decision I
       * made an hour earlier.
       *
       * I had capped this at max-w-3xl on the reading-measure argument — 45-75
       * characters a line, which is what ChatGPT and Gemini do. Rahul looked at
       * it beside our own Profit & Loss report and overruled it: every other
       * screen in EkBook spans the full width and reflows when the sidebar
       * expands, and a page that stops two thirds of the way across looks
       * broken next to them. Consistency inside our own app beats matching
       * someone else's chat layout.
       *
       * Width therefore comes entirely from the shell. `w-full` inside
       * AppShell's flex column means the sidebar opening or collapsing moves
       * this straight away, with nothing to keep in sync.
       */
      className="flex flex-col w-full"
      style={{
        height: '100dvh',
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'var(--safe-bottom)',
        paddingLeft: 'max(1rem, var(--safe-left))',
        paddingRight: 'max(1rem, var(--safe-right))',
      }}
    >
      <AskDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        conversations={conversations}
        currentId={currentId}
        onOpenConversation={openConversation}
        onNewChat={newChat}
        onDelete={deleteConversation}
      />

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 pb-2 flex-shrink-0">
        <button onClick={() => setDrawerOpen(true)} aria-label="Conversations"
          className="w-12 h-12 rounded-full hover:bg-muted flex items-center justify-center flex-shrink-0 -ml-2.5">
          <Menu className="w-6 h-6" />
        </button>
        <div className="min-w-0 flex-1 px-1">
          <h2 className="text-xl font-bold truncate leading-tight">Ask your books</h2>
          <p className="text-xs text-muted-foreground">English or Hinglish · type or speak</p>
        </div>
        {!isEmpty && (
          <button onClick={newChat} aria-label="New chat"
            className="w-12 h-12 rounded-full hover:bg-muted flex items-center justify-center flex-shrink-0">
            <Plus className="w-6 h-6" />
          </button>
        )}
        {/* Negative margin of 10px against the screen's 16px: the 48px target
            keeps its full size, but the 24px GLYPH lands 18px from the glass —
            Material puts app-bar icons at 16dp. Without it the icon sat 28px
            in and the bar looked indented rather than aligned. */}
        <button onClick={() => setView('more')} aria-label="Go back"
          className="w-12 h-12 rounded-full hover:bg-muted flex items-center justify-center flex-shrink-0 -mr-2.5">
          <ArrowLeft className="w-6 h-6" />
        </button>
      </div>

      {/* ── Thread ─────────────────────────────────────────────────── */}
      {/* scrollbar-hide, not a new utility — globals.css has carried this since
          the pill tab strips, and Dashboard, DocumentVault and Ledger all use
          it. A visible track down the side of a conversation is something no
          messaging app shows; the content itself is the position indicator. */}
      <div ref={threadRef} className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide space-y-3 pb-3">
        {isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <Sparkles className="w-9 h-9 text-primary mb-4" />
            <p className="text-lg font-semibold">What would you like to know?</p>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-xs">
              Every answer shows the bills it came from, so you can check it.
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center mt-4">
              {ASK_EXAMPLES.map(ex => (
                <button key={ex} onClick={() => ask(ex)}
                  className="text-sm px-3.5 py-2 rounded-full border border-border/60 hover:bg-muted">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(m => {
            if (m.role === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%]">
                    <div className="rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-2.5 text-base">
                      {m.text}
                    </div>
                    <p className="text-xs text-muted-foreground text-right mt-1 pr-1">
                      {m.viaVoice ? 'spoken · ' : ''}{whenLabel(m.at)}
                    </p>
                  </div>
                </div>
              )
            }
            if (m.role === 'thinking') {
              return (
                <div key={m.id} className="flex items-center gap-2 text-sm text-muted-foreground px-1">
                  <span className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"
                        style={{ animationDelay: `${i * 150}ms` }} />
                    ))}
                  </span>
                  Checking your books…
                </div>
              )
            }
            return (
              <div key={m.id} className="max-w-[95%]">
                <AskAnswer payload={m.payload} onAsk={ask} />
                <p className="text-xs text-muted-foreground mt-1 pl-1">{whenLabel(m.at)}</p>
              </div>
            )
          })
        )}
      </div>

      {/* ── Suggestions, available at any point ─────────────────────── */}
      {tipsOpen && (
        <div className="mb-2 rounded-2xl border border-border/60 bg-card p-3 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Things you can ask</p>
            <button onClick={() => setTipsOpen(false)} aria-label="Close suggestions"
              className="w-11 h-11 -my-2.5 -mr-2.5 flex items-center justify-center flex-shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ASK_EXAMPLES.map(ex => (
              <button key={ex} onClick={() => ask(ex)}
                className="text-sm px-3.5 py-2 rounded-full border border-border/60 hover:bg-muted">
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Composer ───────────────────────────────────────────────── */}
      <div className="pt-1 flex-shrink-0">
        {/* The suggestions button lives beside the composer rather than only on
            the empty screen: the moment you have asked one thing, the examples
            vanished and there was no way back to them. */}
        {!isEmpty && !tipsOpen && mode === 'idle' && (
          <button onClick={() => setTipsOpen(true)}
            className="mb-1 ml-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground py-3">
            <Lightbulb className="w-4 h-4" /> Things you can ask
          </button>
        )}
        <AskComposer
          mode={mode}
          setMode={setMode}
          value={draft}
          onChange={setDraft}
          onSend={ask}
          busy={busy}
          speaking={speaking}
          statusLine={status}
        />
      </div>
    </div>
  )
}
