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
import { Mic, AudioLines, Square, ArrowUp, X, Keyboard, Plus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

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

  const beginListening = async (forMode: 'dictating' | 'voice') => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    draftRef.current = ''
    const rec = new SR()
    /*
     * en-IN even for Hinglish and Hindi, for now. It returns romanised words
     * our patterns can read; hi-IN returns Devanagari, which they cannot match
     * yet. When the Devanagari branch lands (Phase 2.7) this follows the
     * chosen language instead.
     */
    rec.lang = 'en-IN'
    rec.interimResults = true
    rec.continuous = forMode === 'voice'
    rec.onresult = (e: any) => {
      let finalText = ''
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interim += r[0].transcript
      }
      if (interim) onChange(draftRef.current + interim)
      if (finalText) {
        draftRef.current = (draftRef.current + finalText).trim()
        onChange(draftRef.current)
        // In conversation mode a finished sentence IS the send. In dictation
        // it only fills the box — you still press send, which is the whole
        // reason the two modes exist.
        if (forMode === 'voice') {
          const said = draftRef.current
          draftRef.current = ''
          onChange('')
          onSend(said, true)
        }
      }
    }
    rec.onerror = () => { if (forMode === 'dictating') endAll() }
    rec.onend = () => {
      // Conversation mode should keep listening between turns; dictation stops.
      if (forMode === 'voice' && recognitionRef.current) {
        try { rec.start() } catch { /* restarting too fast; next tick is fine */ }
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
    <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card pl-2 pr-2 py-1.5 shadow-sm">
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
        className="flex-1 bg-transparent outline-none text-sm min-w-0"
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
  )
}
