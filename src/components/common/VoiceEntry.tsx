'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Mic, Square, Loader2, X } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/store/app-store'
import { offlineFetch } from '@/lib/offline-fetch'

// Voice Entry component - uses Web Speech API for speech recognition
// and AI (Groq) to parse the transcribed text into a transaction
export function VoiceEntry({ onTransactionParsed }: { onTransactionParsed: (data: any) => void }) {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [processing, setProcessing] = useState(false)
  const recognitionRef = useRef<any>(null)
  const { toast } = useToast()

  useEffect(() => {
    // Check if Web Speech API is supported
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-IN' // Indian English (supports Hindi-English mix)

    recognition.onresult = (event: any) => {
      let final = ''
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          final += transcript + ' '
        } else {
          interim += transcript
        }
      }
      setTranscript(prev => final + interim)
    }

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error)
      if (event.error === 'not-allowed') {
        toast({ title: 'Microphone access denied', variant: 'destructive' })
      }
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognitionRef.current = recognition

    return () => {
      recognition.stop()
    }
  }, [toast])

  const startListening = () => {
    if (!recognitionRef.current) {
      toast({ title: 'Voice input not supported in this browser', variant: 'destructive' })
      return
    }
    setTranscript('')
    setIsListening(true)
    recognitionRef.current.start()
    sonnerToast.info('Listening... Speak your transaction')
  }

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
    setIsListening(false)
  }

  const handleProcess = async () => {
    if (!transcript.trim()) {
      toast({ title: 'No speech detected', variant: 'destructive' })
      return
    }

    setProcessing(true)
    try {
      const r = await offlineFetch('/api/voice-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      })
      const data = await r.json()

      if (data.success) {
        sonnerToast.success('Voice entry parsed!')
        onTransactionParsed(data.transaction)
      } else {
        toast({ title: 'Could not parse voice entry', description: data.error, variant: 'destructive' })
      }
    } catch (e) {
      toast({ title: 'Failed to process voice', variant: 'destructive' })
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          onClick={isListening ? stopListening : startListening}
          className={`gap-2 ${isListening ? 'bg-rose-500 hover:bg-rose-600' : 'bg-gradient-saffron'}`}
          disabled={processing}
        >
          {isListening ? (
            <><Square className="w-4 h-4" /> Stop</>
          ) : processing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
          ) : (
            <><Mic className="w-4 h-4" /> Speak</>
          )}
        </Button>
        {transcript && !isListening && (
          <Button onClick={handleProcess} disabled={processing} className="gap-2">
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Parse Entry
          </Button>
        )}
      </div>

      {transcript && (
        <div className="rounded-lg bg-muted/50 p-3 border border-border">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase text-muted-foreground font-medium">You said:</p>
            <button onClick={() => setTranscript('')} className="text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          </div>
          <p className="text-sm">{transcript}</p>
        </div>
      )}

      {isListening && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
          </span>
          Listening... Speak naturally, e.g. &quot;Sold 2 kg sugar to Ramesh at 50 rupees cash&quot;
        </div>
      )}
    </div>
  )
}
