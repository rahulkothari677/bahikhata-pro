'use client'

/**
 * Ask your books — the conversation.
 *
 * WHY A THREAD RATHER THAN A SEARCH BOX. Not for the look of it. A question
 * about a person is rarely the last question about that person: you ask what
 * they owe, then when they last paid, then you want to chase them. A box that
 * forgets between questions makes you retype the name every time.
 *
 * WHAT IS DELIBERATELY DIFFERENT FROM GEMINI AND CHATGPT:
 *
 *   THE RESTING STATE IS NOT EMPTY. Theirs must be — a general assistant knows
 *   nothing about you until you speak. We know it is 3pm, we know four bills
 *   are unpaid, and we know the GST deadline. An empty box would be us
 *   pretending to know nothing about a business we know everything about.
 *   (Live counts land in Phase 2.5; the shape is here.)
 *
 *   NO "AI CAN MAKE MISTAKES" DISCLAIMER. They need it — they generated the
 *   number. Ours is computed and carries its bills.
 *
 *   NO MODEL PICKER. A shopkeeper must never think about which model answered.
 *
 * SPEAKING BACK, AND WHEN NOT TO. In voice mode the headline is read aloud,
 * because the point is not looking at the screen. It reads the HEADLINE only —
 * never the list of bills, which would be a minute of droning account numbers.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { Sparkles, History, Trash2, X, ArrowLeft } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { AskComposer, type ComposerMode } from '@/components/ask/AskComposer'
import { AskAnswer } from '@/components/ask/AskAnswer'
import {
  loadThread, saveThread, clearThread, recentQuestions, newId, whenLabel,
  type AskMessage,
} from '@/lib/ask-thread'
import { ASK_EXAMPLES } from '@/lib/ask-patterns'
import { useAppStore } from '@/store/app-store'

export function AskChat() {
  const [messages, setMessages] = useState<AskMessage[]>([])
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<ComposerMode>('idle')
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const setView = useAppStore(st => st.setView)
  const threadRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef<ComposerMode>('idle')

  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { setMessages(loadThread()) }, [])
  useEffect(() => { if (messages.length) saveThread(messages) }, [messages])

  /*
   * SCROLL TO THE BOTTOM ONLY WHEN A MESSAGE IS ADDED — and only inside the
   * thread.
   *
   * Two bugs in one line before this. `scrollIntoView` scrolls every scrollable
   * ANCESTOR, so it dragged the whole page as well as the thread — which is
   * the "it jumps down" Rahul reported. And it ran on every `messages` change,
   * including the restore-from-storage on mount, so opening the screen threw
   * you to the bottom of an old conversation instead of showing its start.
   *
   * Now: track the count, scroll only when it GROWS, and move the thread's own
   * scrollTop rather than asking the browser to reveal an element.
   */
  const lastCount = useRef(0)
  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    if (messages.length > lastCount.current && lastCount.current !== 0) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else if (lastCount.current === 0 && messages.length > 0) {
      el.scrollTop = el.scrollHeight   // first paint: land at the newest, no animation
    }
    lastCount.current = messages.length
  }, [messages])

  /** Read the headline aloud — voice mode only, headline only. */
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
    setBusy(true)
    setStatus(viaVoice ? 'Checking your books…' : null)

    const userMsg: AskMessage = { id: newId(), role: 'user', text: t, at: Date.now(), viaVoice }
    const thinking: AskMessage = { id: newId(), role: 'thinking', at: Date.now() }
    setMessages(m => [...m, userMsg, thinking])

    try {
      const r = await offlineFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: t }),
      })
      const payload = await r.json()
      setMessages(m => [
        ...m.filter(x => x.id !== thinking.id),
        { id: newId(), role: 'answer', payload, at: Date.now() },
      ])
      // Only in voice mode, and only the headline.
      if (modeRef.current === 'voice') {
        speak(payload.answered ? (payload.headline || '') : (payload.message || ''))
      }
    } catch {
      setMessages(m => [
        ...m.filter(x => x.id !== thinking.id),
        {
          id: newId(), role: 'answer', at: Date.now(),
          payload: { answered: false, message: 'Could not reach your books just now. Try again.' },
        },
      ])
    } finally {
      setBusy(false)
      setStatus(null)
    }
  }, [speak])

  const history = recentQuestions(messages)
  const isEmpty = messages.length === 0

  return (
    /*
     * OWNS THE WHOLE SCREEN, including the bottom edge.
     *
     * This used to render inside the ordinary shell, so the composer sat under
     * the fixed bottom nav — the text field, the dictation waveform and the
     * send button were all hidden behind it. Voice had been working the whole
     * time; you simply could not see any of its controls.
     *
     * 100dvh, not 100vh: on a phone the browser chrome grows and shrinks as
     * you scroll, and vh is measured against the largest state — which puts
     * the composer below the fold at exactly the moment the keyboard opens.
     */
    <div
      className="flex flex-col"
      style={{ height: 'calc(100dvh - var(--safe-top) - var(--safe-bottom))' }}
    >
      {/* ── Its own top bar, since the global one is gone ───────────── */}
      <div className="flex items-center gap-2 pb-2 flex-shrink-0">
        <button
          onClick={() => setView('more')}
          aria-label="Go back"
          className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center flex-shrink-0 -ml-1"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold truncate leading-tight">Ask your books</h2>
          <p className="text-2xs text-muted-foreground">English or Hinglish · type or speak</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {history.length > 0 && (
            <button onClick={() => setHistoryOpen(o => !o)} aria-label="Recent questions"
              className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center">
              <History className="w-4 h-4" />
            </button>
          )}
          {!isEmpty && (
            <button
              onClick={() => { clearThread(); setMessages([]); setHistoryOpen(false) }}
              aria-label="Clear conversation"
              className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Recent questions ───────────────────────────────────────── */}
      {historyOpen && history.length > 0 && (
        <div className="mb-2 rounded-xl border border-border/60 bg-card p-2">
          <div className="flex items-center justify-between mb-1 px-1">
            <p className="text-3xs uppercase tracking-wide text-muted-foreground">Recent questions</p>
            <button onClick={() => setHistoryOpen(false)} aria-label="Close" className="p-1"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="max-h-40 overflow-y-auto">
            {history.map(h => (
              <button key={h} onClick={() => { setHistoryOpen(false); ask(h) }}
                className="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-muted truncate">
                {h}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Thread ─────────────────────────────────────────────────── */}
      <div ref={threadRef} className="flex-1 overflow-y-auto overscroll-contain space-y-3 pb-3">
        {isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <Sparkles className="w-7 h-7 text-primary mb-3" />
            <p className="text-sm font-medium">What would you like to know?</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Every answer shows the bills it came from, so you can check it.
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center mt-4">
              {ASK_EXAMPLES.map(ex => (
                <button key={ex} onClick={() => ask(ex)}
                  className="text-2xs px-2.5 py-1.5 rounded-full border border-border/60 hover:bg-muted">
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
                    <div className="rounded-2xl rounded-br-md bg-primary text-primary-foreground px-3.5 py-2 text-sm">
                      {m.text}
                    </div>
                    <p className="text-3xs text-muted-foreground text-right mt-0.5 pr-1">
                      {m.viaVoice ? 'spoken · ' : ''}{whenLabel(m.at)}
                    </p>
                  </div>
                </div>
              )
            }
            if (m.role === 'thinking') {
              return (
                <div key={m.id} className="flex items-center gap-2 text-xs text-muted-foreground px-1">
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
                <p className="text-3xs text-muted-foreground mt-0.5 pl-1">{whenLabel(m.at)}</p>
              </div>
            )
          })
        )}
      </div>

      {/* ── Composer ───────────────────────────────────────────────── */}
      <div className="pt-1">
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
