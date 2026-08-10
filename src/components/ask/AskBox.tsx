'use client'

/**
 * "Ask your books" — type it or say it.
 *
 * WHAT THIS SCREEN IS RESPONSIBLE FOR, beyond looking tidy:
 *
 *  1. SHOWING WHAT IT UNDERSTOOD. Every answer carries "Showing: …" above it.
 *     If the question was misread, that line is where the user sees it — a
 *     wrong QUESTION is visible and one tap from being fixed, whereas a wrong
 *     ANSWER would be invisible. The whole design leans on this.
 *
 *  2. SHOWING THE RECEIPTS. Figures come with the bills behind them, tappable.
 *     A number a shopkeeper cannot trace is one they must take on faith.
 *
 *  3. REFUSING WELL. "I can't answer that yet" plus examples is a real answer.
 *     Nothing here guesses.
 *
 * VOICE USES THE BROWSER, NOT AN AI. SpeechRecognition turns speech into text
 * on the device; the same local patterns then handle it. So voice costs
 * nothing, works for English and Hinglish alike, and adds no new way to be
 * wrong — it is just another way to fill the same box.
 */

import { useState, useRef, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Mic, MicOff, Search, Loader2, Receipt, User, Package, Info } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'
import { formatINR } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { ASK_EXAMPLES } from '@/lib/ask-patterns'

interface AskSource {
  kind: 'transaction' | 'party' | 'product'
  id: string
  label: string
  amount?: number
  quantity?: number
  unit?: string
  date?: string
}

interface AskAnswer {
  answered: boolean
  question: string
  understoodAs?: string
  headline?: string
  detail?: string
  message?: string
  examples?: readonly string[]
  choices?: { id: string; name: string }[]
  sources?: AskSource[]
}

export function AskBox() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const recognitionRef = useRef<any>(null)
  const setView = useAppStore(s => s.setView)

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setVoiceSupported(!!SR)
  }, [])

  const ask = async (text: string) => {
    const t = text.trim()
    if (!t) return
    setBusy(true)
    setAnswer(null)
    try {
      const r = await offlineFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: t }),
      })
      setAnswer(await r.json())
    } catch {
      setAnswer({ answered: false, question: t, message: 'Could not reach your books just now. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const toggleVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    if (listening) { recognitionRef.current?.stop(); setListening(false); return }

    const rec = new SR()
    /*
     * en-IN, deliberately, even for Hinglish. Indian English recognition
     * transcribes romanised Hindi far more usefully than hi-IN does — hi-IN
     * returns Devanagari, which our patterns do not read. "ramesh ka kitna
     * baaki hai" comes back as those words under en-IN.
     */
    rec.lang = 'en-IN'
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (e: any) => {
      const said = e.results[0][0].transcript
      setQuestion(said)
      ask(said)          // speaking should ANSWER, not just fill the box
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recognitionRef.current = rec
    rec.start()
    setListening(true)
  }

  const openSource = (s: AskSource) => {
    if (s.kind === 'transaction') setView('sales')
    else if (s.kind === 'party') setView('parties')
    else setView('inventory')
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold">Ask your books</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Type or say it, in English or Hinglish. Every answer shows the bills it came from.
        </p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            id="field-ask"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') ask(question) }}
            placeholder="Ramesh ka kitna baaki hai"
            className="pl-9"
          />
        </div>
        {voiceSupported && (
          <Button
            variant={listening ? 'destructive' : 'outline'}
            size="icon"
            onClick={toggleVoice}
            aria-label={listening ? 'Stop listening' : 'Ask by voice'}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </Button>
        )}
        <Button onClick={() => ask(question)} disabled={busy || !question.trim()}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ask'}
        </Button>
      </div>

      {listening && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" /> Listening…
        </p>
      )}

      {/* Examples, until they have asked something. Teaching by showing beats
          a paragraph explaining what the box accepts. */}
      {!answer && !busy && (
        <div className="flex flex-wrap gap-1.5">
          {ASK_EXAMPLES.map(ex => (
            <button
              key={ex}
              onClick={() => { setQuestion(ex); ask(ex) }}
              className="text-2xs px-2.5 py-1.5 rounded-full border border-border/60 hover:bg-muted"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {answer && (
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4 space-y-3">
            {/* What it understood — always, so a misread is caught here. */}
            {answer.understoodAs && (
              <p className="text-2xs text-muted-foreground">
                Showing: <span className="font-medium text-foreground">{answer.understoodAs}</span>
              </p>
            )}

            {answer.answered ? (
              <>
                <p className="text-lg font-bold leading-snug">{answer.headline}</p>
                {answer.detail && <p className="text-xs text-muted-foreground">{answer.detail}</p>}
              </>
            ) : (
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{answer.message}</p>
                  {answer.examples && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {answer.examples.map(ex => (
                        <button key={ex} onClick={() => { setQuestion(ex); ask(ex) }}
                          className="text-2xs px-2 py-1 rounded-full border border-border/60 hover:bg-muted">
                          {ex}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Two people with similar names: ask, never pick. */}
                  {answer.choices && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {answer.choices.map(c => (
                        <button key={c.id} onClick={() => { setQuestion(`${c.name} ka kitna baaki hai`); ask(`${c.name} ka kitna baaki hai`) }}
                          className="text-2xs px-2 py-1 rounded-full border border-border/60 hover:bg-muted">
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* The receipts. */}
            {answer.sources && answer.sources.length > 0 && (
              <div className="pt-2 border-t border-border space-y-1">
                <p className="text-3xs uppercase tracking-wide text-muted-foreground">Where this came from</p>
                {answer.sources.map(s => (
                  <button
                    key={`${s.kind}-${s.id}`}
                    onClick={() => openSource(s)}
                    className="w-full flex items-center justify-between gap-2 py-1.5 text-xs hover:bg-muted rounded-md px-1"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {s.kind === 'transaction' ? <Receipt className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        : s.kind === 'party' ? <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          : <Package className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                      <span className="truncate">{s.label}</span>
                    </span>
                    <span className="tabular-nums flex-shrink-0 font-medium">
                      {s.amount !== undefined ? formatINR(s.amount)
                        : s.quantity !== undefined ? `${s.quantity} ${s.unit || ''}`.trim() : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
