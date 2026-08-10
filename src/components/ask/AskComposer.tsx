'use client'

/**
 * The bottom bar — three states, one bar.
 *
 *   IDLE       ＋ │ Ask your books…        │ 🎤 │ 🔊
 *   DICTATING  ✕ │ ▁▃▅▇ waveform + words  │ ■  │ ↑
 *   VOICE      ✕ │ words appear as spoken │ ⌨  │
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE FIRST VERSION HEARD NOTHING
 *
 * The waveform moved and the box stayed empty, in both modes, on a real
 * phone. The cause was mine and it was structural:
 *
 *   I CALLED getUserMedia TO DRIVE THE WAVEFORM.
 *
 * The Web Speech API opens the microphone itself. Holding a second live
 * MediaStream alongside it starves the recogniser on Android Chrome — the
 * meter got the audio, recognition got silence. Every symptom follows from
 * that one line: bars animating (my stream worked), no text (recognition
 * did not), and both modes failing identically because both took the stream.
 *
 * `components/common/VoiceEntry` has worked for months and NEVER touches
 * getUserMedia. Its waveform is pure CSS. That is the whole trick, and I
 * would have found it by reading one file.
 *
 * So the meter is gone. The waveform is now driven by RECOGNITION ACTIVITY —
 * it lifts when words are actually arriving, which is more honest than a
 * volume meter anyway: it shows the app is HEARING you, not merely that the
 * room is loud.
 *
 * Two smaller faults fixed at the same time:
 *   - rec.start() was called synchronously inside onend, which throws
 *     InvalidStateError in Chrome and kills the session. It is deferred now.
 *   - the bars were fixed-width, so they filled about half the pill. They
 *     flex to the available width now.
 *
 * DICTATION vs CONVERSATION — different jobs, which is why there are two
 * buttons. Dictation puts words in the box for you to check and send.
 * Conversation sends each finished sentence and reads the answer back, for
 * when your hands are on the rice. Both now SHOW THE WORDS AS THEY ARRIVE.
 */

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, AudioLines, Square, ArrowUp, X, Keyboard, Plus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * ASKING LISTENS IN en-IN. Deliberately, and deliberately NOT the user's
 * `voiceLang` setting.
 *
 * I wired this to voiceLang so that asking would respect the same language as
 * entering a sale. It defaults to 'original' → hi-IN, so every spoken question
 * came back in Devanagari: "रमेश का कितना बाकी है".
 *
 * Which is a perfectly good transcription and completely useless to us,
 * because `lib/ask-patterns` is Latin-only. I tested it: every Devanagari
 * question returns null. So the chain was voice works → text appears → nothing
 * understands it.
 *
 * en-IN is the right locale for THIS job. It transcribes spoken Hinglish as
 * romanised words — "ramesh ka kitna baaki hai" — which is exactly the dialect
 * the patterns are written for, and exactly what Rahul asked for: English and
 * Hinglish first.
 *
 * VOICE ENTRY IS A DIFFERENT JOB and keeps voiceLang. There, Devanagari is
 * wanted: a shopkeeper naming "चीनी" should get "चीनी" on the product.
 * Understanding a question and recording a product name are not the same task
 * and should not share a setting.
 *
 * Hindi asking (a Devanagari branch in the patterns, plus transliterating
 * names so "रमेश" finds a customer stored as "Ramesh") is Phase 2.7. When it
 * lands, this becomes a real choice again rather than a constant.
 */
const ASK_LOCALE = 'en-IN'

export type ComposerMode = 'idle' | 'dictating' | 'voice'

/**
 * Bars that fill the whole width and lift when speech is being recognised.
 *
 * No microphone stream — see the note at the top of this file. `active` rises
 * when words arrive, so the bar says "I am hearing you" rather than "the shop
 * is noisy", which is the thing the user actually needs to know.
 */
function Waveform({ active, tick }: { active: boolean; tick: number }) {
  const bars = 34
  return (
    <div className="flex items-center justify-between gap-[2px] h-7 flex-1 min-w-0 px-1" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const wave = Math.sin(tick / 3 + i * 0.55)
        const idle = 3 + Math.abs(Math.sin(tick / 6 + i * 0.4)) * 3
        const loud = 4 + Math.abs(wave) * 18
        return (
          <span
            key={i}
            className="flex-1 rounded-full bg-current transition-[height] duration-100"
            style={{ height: `${active ? loud : idle}px`, opacity: active ? 0.9 : 0.45 }}
          />
        )
      })}
    </div>
  )
}

export function AskComposer({
  mode, setMode, value, onChange, onSend, busy, speaking, statusLine,
}: {
  mode: ComposerMode
  setMode: (m: ComposerMode) => void
  value: string
  onChange: (v: string) => void
  onSend: (text: string, viaVoice: boolean) => void
  busy: boolean
  speaking: boolean
  statusLine: string | null
}) {
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [hearing, setHearing] = useState(false)   // words currently arriving
  const [tick, setTick] = useState(0)
  const recognitionRef = useRef<any>(null)
  const finalRef = useRef('')
  const modeRef = useRef<ComposerMode>('idle')
  const stoppingRef = useRef(false)
  const hearingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { modeRef.current = mode }, [mode])

  // Drive the bars while any listening state is on screen.
  useEffect(() => {
    if (mode === 'idle') return
    const t = setInterval(() => setTick(n => n + 1), 70)
    return () => clearInterval(t)
  }, [mode])

  const markHearing = () => {
    setHearing(true)
    if (hearingTimer.current) clearTimeout(hearingTimer.current)
    hearingTimer.current = setTimeout(() => setHearing(false), 550)
  }

  const stopRecognition = () => {
    stoppingRef.current = true
    try { recognitionRef.current?.stop() } catch { /* already stopped */ }
    recognitionRef.current = null
  }

  const endAll = () => {
    stopRecognition()
    setHearing(false)
    setMode('idle')
  }

  useEffect(() => () => { stopRecognition() }, [])

  const beginListening = (forMode: 'dictating' | 'voice') => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setVoiceError('Voice isn’t available in this browser. You can type instead.')
      setMode('idle')
      return
    }
    setVoiceError(null)
    finalRef.current = ''
    stoppingRef.current = false

    const rec = new SR()
    // continuous=false, restarted on end. True is unreliable on Android
    // Chrome — the session runs but often yields no final result at all.
    rec.continuous = false
    rec.interimResults = true
    rec.lang = ASK_LOCALE
    rec.maxAlternatives = 1

    rec.onresult = (e: any) => {
      markHearing()
      let finalText = ''
      let interim = ''
      // FROM ZERO, not from e.resultIndex — with continuous=false the result
      // set is re-read each time, and starting at resultIndex skipped exactly
      // the text we were waiting for.
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interim += r[0].transcript
      }
      const base = finalRef.current
      if (finalText.trim()) {
        finalRef.current = (base ? base + ' ' : '') + finalText.trim()
        onChange(finalRef.current)
      } else if (interim) {
        // Words on screen while they are still being spoken — in BOTH modes.
        onChange((base ? base + ' ' : '') + interim)
      }
    }

    rec.onerror = (e: any) => {
      // A pause is not a failure. Treating it as one ended the session every
      // time the user stopped to think.
      if (e?.error === 'no-speech' || e?.error === 'aborted') return
      setVoiceError(
        e?.error === 'not-allowed' || e?.error === 'service-not-allowed'
          ? 'Microphone blocked. Allow it in your browser settings, or type instead.'
          : 'Voice isn’t available on this device. You can type instead.',
      )
      endAll()
    }

    rec.onend = () => {
      if (stoppingRef.current || !recognitionRef.current) return
      if (forMode === 'voice') {
        const said = finalRef.current.trim()
        if (said) { finalRef.current = ''; onChange(''); onSend(said, true) }
      }
      // DEFERRED. Calling start() synchronously inside onend throws
      // InvalidStateError in Chrome and the session never comes back.
      setTimeout(() => {
        if (stoppingRef.current || !recognitionRef.current) return
        try { rec.start() } catch { /* raced a teardown; harmless */ }
      }, 120)
    }

    recognitionRef.current = rec
    try { rec.start() } catch { /* already running */ }
  }

  const voiceSupported = typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  /* ── VOICE CONVERSATION ────────────────────────────────────────────── */
  if (mode === 'voice') {
    return (
      <div className="space-y-2">
        {(statusLine || value) && (
          <p className="text-center text-xs text-muted-foreground px-4 line-clamp-2">
            {value || statusLine}
          </p>
        )}
        <div className="flex items-center gap-2 rounded-[1.75rem] border border-border/60 bg-card px-2 py-2 shadow-sm">
          <button onClick={endAll} aria-label="Leave voice mode"
            className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
          <div className={cn('flex-1 min-w-0 flex items-center',
            speaking ? 'text-primary' : hearing ? 'text-primary' : 'text-muted-foreground')}>
            <Waveform active={speaking || hearing} tick={tick} />
          </div>
          <button onClick={() => { stopRecognition(); setMode('idle') }} aria-label="Switch to typing"
            className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
            <Keyboard className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  /* ── DICTATION ─────────────────────────────────────────────────────── */
  if (mode === 'dictating') {
    return (
      <div className="space-y-2">
        {value && (
          <p className="text-center text-sm px-4 line-clamp-2 font-medium">{value}</p>
        )}
        <div className="flex items-center gap-2 rounded-[1.75rem] border border-border/60 bg-card px-2 py-2 shadow-sm">
          <button onClick={() => { onChange(''); endAll() }} aria-label="Cancel dictation"
            className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
          <div className={cn('flex-1 min-w-0 flex items-center', hearing ? 'text-primary' : 'text-muted-foreground')}>
            <Waveform active={hearing} tick={tick} />
          </div>
          <button onClick={() => { stopRecognition(); setMode('idle') }} aria-label="Stop dictation"
            className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
            <Square className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { const t = value.trim(); stopRecognition(); setMode('idle'); if (t) onSend(t, true) }}
            disabled={!value.trim()} aria-label="Send"
            className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 disabled:opacity-40"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  /* ── IDLE ──────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-1.5">
      {voiceError && (
        <div className="flex items-start gap-2 px-2 text-2xs text-muted-foreground">
          <MicOff className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <p className="flex-1">{voiceError}</p>
          <button onClick={() => setVoiceError(null)} aria-label="Dismiss" className="p-0.5">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-1.5 rounded-[1.75rem] border border-border/60 bg-card pl-1.5 pr-1.5 py-1.5 shadow-sm">
        <button aria-label="Add a bill or photo" title="Coming soon" disabled
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-muted-foreground disabled:opacity-40">
          <Plus className="w-4 h-4" />
        </button>
        <input
          id="field-ask"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) onSend(value.trim(), false) }}
          placeholder="Ask your books…"
          className="flex-1 bg-transparent outline-none text-base min-w-0 py-2.5 px-1 placeholder:text-muted-foreground"
        />
        {value.trim() ? (
          <button onClick={() => onSend(value.trim(), false)} disabled={busy} aria-label="Send"
            className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 disabled:opacity-40">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
          </button>
        ) : voiceSupported ? (
          <>
            <button onClick={() => { setMode('dictating'); beginListening('dictating') }} aria-label="Dictate a question"
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-muted-foreground hover:text-foreground">
              <Mic className="w-5 h-5" />
            </button>
            <button onClick={() => { setMode('voice'); beginListening('voice') }} aria-label="Talk to your books"
              className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
              <AudioLines className="w-5 h-5" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
