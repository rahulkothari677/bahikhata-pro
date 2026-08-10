'use client'

/**
 * The bottom bar — three states, one bar.
 *
 * Taken from how Gemini and ChatGPT actually behave, checked frame by frame
 * rather than guessed from a screenshot:
 *
 *   IDLE       ＋ │ Ask your books…        │ 🎤 │ 🔊
 *   DICTATING  ✕ │ ▁▃▅▇▅▃▁ live waveform  │ ■  │ ↑
 *   VOICE      ✕ │ ● listening / speaking │ ⌨  │
 *
 * THE BAR MORPHS; THE CONVERSATION NEVER MOVES. That is the detail that makes
 * those apps feel expensive — leaving voice mode does not clear, reset or
 * navigate anything. The thread stays exactly where it was and only this strip
 * changes. Anything else reads as "the app went somewhere".
 *
 * DICTATION AND CONVERSATION ARE DIFFERENT JOBS, which is why there are two
 * buttons rather than one toggle:
 *   🎤 dictate — speech becomes TEXT IN THE BOX. You read it, fix it, send it.
 *      For when the shop is noisy and you want to check before committing.
 *   🔊 converse — speak and hear the answer. Hands stay on the rice.
 *      For when you cannot look at the screen at all.
 *
 * VOICE MODE IS INTERRUPTIBLE. A real customer interrupts a shopkeeper
 * mid-sentence. Tapping the keyboard icon drops straight back to typing with
 * the thread intact — you are never trapped in a mode.
 *
 * NO MODEL PICKER. Their users care which model answers; ours must never have
 * to think about it.
 */

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, AudioLines, Square, ArrowUp, X, Keyboard, Plus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSetting } from '@/hooks/use-setting'

/**
 * The shopkeeper's chosen voice language, as a BCP-47 locale.
 *
 * Mirrors VoiceEntry: the app already stores `voiceLang` and already respects
 * it for voice ENTRY, so asking a question must not suddenly listen in a
 * different language from the one they set. 'original' means "keep what I
 * speak", which for recognition purposes is Hindi.
 */
const VOICE_LOCALE: Record<string, string> = {
  original: 'hi-IN', hi: 'hi-IN', en: 'en-IN', mr: 'mr-IN',
  gu: 'gu-IN', ta: 'ta-IN', te: 'te-IN', kn: 'kn-IN',
  ml: 'ml-IN', bn: 'bn-IN', pa: 'pa-IN',
}

export type ComposerMode = 'idle' | 'dictating' | 'voice'

/** Live level bars. Purely decorative, but it is the difference between
 *  "is this thing listening?" and knowing that it is. */
function Waveform({ level }: { level: number }) {
  const bars = 28
  return (
    <div className="flex items-center gap-[3px] h-6 flex-1 overflow-hidden" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        // A travelling wave so it never looks frozen, scaled by real input.
        const phase = Math.sin((Date.now() / 180) + i * 0.5)
        const h = Math.max(3, Math.min(24, 4 + Math.abs(phase) * 10 + level * 22 * Math.abs(phase)))
        return (
          <span
            key={i}
            className="w-[2px] rounded-full bg-current opacity-70"
            style={{ height: `${h}px` }}
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
  /*
   * WHY THE MICROPHONE CAN FAIL SILENTLY, AND WHY THAT IS NOT ALLOWED.
   *
   * Found in browser testing: tapping the mic did nothing at all. Speech
   * recognition raises an error the instant the microphone is unavailable —
   * permission denied, no device, or a browser that blocks it — and the error
   * handler dropped straight back to typing. Correct behaviour, invisible
   * execution: the shopkeeper taps a button, the screen does not change, and
   * they are left tapping it again.
   *
   * Reverting to typing IS right. Saying nothing is not. A refusal has to be
   * legible, exactly like the ones the answers give.
   */
  // `useSetting` exposes the whole record on `.setting`; voiceLang is not one
  // of its named conveniences (only hideProfit is).
  const { setting } = useSetting()
  const locale = VOICE_LOCALE[setting?.voiceLang || 'original'] || 'hi-IN'
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [, force] = useState(0)
  const recognitionRef = useRef<any>(null)
  const audioRef = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null)
  const draftRef = useRef('')

  // Repaint the waveform while it is on screen.
  useEffect(() => {
    if (mode === 'idle') return
    const t = setInterval(() => force(n => n + 1), 60)
    return () => clearInterval(t)
  }, [mode])

  /** Real microphone level, so the bars respond to the room rather than pretending. */
  const startMeter = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128)
        setLevel(peak)
        const raf = requestAnimationFrame(tick)
        if (audioRef.current) audioRef.current.raf = raf
      }
      const raf = requestAnimationFrame(tick)
      audioRef.current = { ctx, stream, raf }
    } catch {
      /* Permission refused, or no microphone. Speech recognition may still
         work; the bars simply stay calm rather than the screen breaking. */
    }
  }

  const stopMeter = () => {
    const a = audioRef.current
    if (!a) return
    cancelAnimationFrame(a.raf)
    a.stream.getTracks().forEach(t => t.stop())
    a.ctx.close().catch(() => {})
    audioRef.current = null
    setLevel(0)
  }

  const stopRecognition = () => {
    try { recognitionRef.current?.stop() } catch { /* already stopped */ }
    recognitionRef.current = null
  }

  /*
   * SPEECH RECOGNITION, COPIED FROM THE ONE IN THIS APP THAT ALREADY WORKS.
   *
   * My first version was written from scratch and captured nothing — the
   * waveform moved and the box stayed empty. `components/common/VoiceEntry`
   * has been doing this correctly for months, and three of its choices are
   * the reason it works:
   *
   *   continuous = false. I used `true` for conversation mode. On Android
   *     Chrome continuous recognition frequently delivers no final result at
   *     all — the session simply runs until it is stopped. False, restarted
   *     on `onend`, is the pattern that actually fires.
   *
   *   Loop the results FROM ZERO, not from `event.resultIndex`. With
   *     continuous=false the result set is short and re-read each time;
   *     starting at resultIndex skipped the very text we were waiting for.
   *
   *   Build the recogniser ONCE per language, not on every tap. Constructing
   *     a new one per press races the previous instance's teardown.
   *
   * The lesson is the boring one: the answer was three files away and I wrote
   * my own instead of reading it.
   */
  const beginListening = async (forMode: 'dictating' | 'voice') => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setVoiceError('Voice isn’t available in this browser. You can type instead.')
      setMode('idle')
      return
    }
    setVoiceError(null)
    draftRef.current = ''

    const rec = new SR()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = locale
    rec.maxAlternatives = 1

    rec.onresult = (e: any) => {
      let finalText = ''
      let interim = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interim += r[0].transcript
      }
      // Show the words as they are heard — an empty box next to a moving
      // waveform is what made this look broken.
      if (interim) onChange((draftRef.current ? draftRef.current + ' ' : '') + interim)
      if (finalText.trim()) {
        draftRef.current = (draftRef.current ? draftRef.current + ' ' : '') + finalText.trim()
        onChange(draftRef.current)
      }
    }

    rec.onerror = (e: any) => {
      // 'no-speech' is a pause, not a failure — VoiceEntry ignores it too, and
      // treating it as fatal would end the session every time someone thinks.
      if (e?.error === 'no-speech' || e?.error === 'aborted') return
      const why = e?.error === 'not-allowed' || e?.error === 'service-not-allowed'
        ? 'Microphone blocked. Allow it in your browser settings, or type instead.'
        : 'Voice isn’t available on this device. You can type instead.'
      setVoiceError(why)
      endAll()
    }

    rec.onend = () => {
      if (!recognitionRef.current) return          // we stopped it deliberately
      if (forMode === 'voice') {
        // A finished sentence IS the question in conversation mode.
        const said = draftRef.current.trim()
        if (said) { draftRef.current = ''; onChange(''); onSend(said, true) }
        try { rec.start() } catch { /* too soon; the next tick restarts it */ }
      } else {
        // Dictation: one utterance, then hand control back. The words stay in
        // the box so they can be read and corrected before sending.
        try { rec.start() } catch { /* ignore */ }
      }
    }

    recognitionRef.current = rec
    try { rec.start() } catch { /* already running */ }
    await startMeter()
  }

  const endAll = () => {
    stopRecognition()
    stopMeter()
    setMode('idle')
  }

  useEffect(() => () => { stopRecognition(); stopMeter() }, [])

  const voiceSupported = typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)

  /* ── VOICE CONVERSATION ────────────────────────────────────────────── */
  if (mode === 'voice') {
    return (
      <div className="space-y-2">
        {statusLine && (
          <p className="text-center text-xs text-muted-foreground">{statusLine}</p>
        )}
        <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-2 shadow-sm">
          <button
            onClick={endAll}
            aria-label="Leave voice mode"
            className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
          <div className={cn('flex-1 flex items-center justify-center',
            speaking ? 'text-primary' : 'text-foreground')}>
            <Waveform level={speaking ? 0.5 : level} />
          </div>
          {/* Straight back to typing, thread intact — never trapped in a mode. */}
          <button
            onClick={() => { stopRecognition(); stopMeter(); setMode('idle') }}
            aria-label="Switch to typing"
            className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0"
          >
            <Keyboard className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  /* ── DICTATION ─────────────────────────────────────────────────────── */
  if (mode === 'dictating') {
    return (
      <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-2 shadow-sm">
        <button onClick={() => { onChange(''); endAll() }} aria-label="Cancel dictation"
          className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
        <Waveform level={level} />
        <button onClick={() => { stopRecognition(); stopMeter(); setMode('idle') }} aria-label="Stop dictation"
          className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
          <Square className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => { const t = value.trim(); stopRecognition(); stopMeter(); setMode('idle'); if (t) onSend(t, true) }}
          disabled={!value.trim()}
          aria-label="Send"
          className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 disabled:opacity-40"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      </div>
    )
  }

  /* ── IDLE ──────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-1.5">
    {/* The refusal, said out loud. Dismissed the moment they start typing,
        because by then they have already worked around it. */}
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
      <button
        aria-label="Add a bill or photo"
        title="Coming soon"
        disabled
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-muted-foreground disabled:opacity-40"
      >
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
          className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 disabled:opacity-40">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
        </button>
      ) : voiceSupported ? (
        <>
          <button onClick={() => { setMode('dictating'); beginListening('dictating') }} aria-label="Dictate a question"
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-muted-foreground hover:text-foreground">
            <Mic className="w-4 h-4" />
          </button>
          <button onClick={() => { setMode('voice'); beginListening('voice') }} aria-label="Talk to your books"
            className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
            <AudioLines className="w-4 h-4" />
          </button>
        </>
      ) : null}
    </div>
    </div>
  )
}
