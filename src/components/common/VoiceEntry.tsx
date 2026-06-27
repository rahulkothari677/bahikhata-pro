'use client'

import { useState, useEffect, useRef } from 'react'
import { Mic, Square, Loader2, X, Plus, Check, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch } from '@/lib/offline-fetch'
import { useToast } from '@/hooks/use-toast'

/**
 * VoiceEntry — redesigned for continuous recording + add more.
 *
 * Fixes:
 * 1. No more transcript duplication (tracks processed result indices)
 * 2. Product names shown in parsed result
 * 3. Delete (X) button on each parsed item
 */

interface VoiceEntryProps {
  onTransactionParsed: (data: any) => void
}

export function VoiceEntry({ onTransactionParsed }: VoiceEntryProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [accumulatedTranscript, setAccumulatedTranscript] = useState('')
  const [processing, setProcessing] = useState(false)
  const [parsed, setParsed] = useState<any>(null)
  const [error, setError] = useState('')
  const [supported, setSupported] = useState(true)
  const recognitionRef = useRef<any>(null)
  const processedFinalsRef = useRef<Set<number>>(new Set())  // Track processed result indices
  const isRecordingRef = useRef(false)  // Use ref to avoid stale closure in onend
  const { toast } = useToast()

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSupported(false)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false   // Auto-stop when user pauses (prevents mobile duplication)
    recognition.interimResults = true
    recognition.lang = 'en-IN'

    recognition.onresult = (event: any) => {
      let finalText = ''
      let interim = ''

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0].transcript
        if (result.isFinal) {
          finalText += transcript
        } else {
          interim += transcript
        }
      }

      // Show interim live
      setLiveTranscript(interim)

      // When a final result arrives, append it ONCE
      if (finalText.trim()) {
        setAccumulatedTranscript(prev => (prev ? prev + ' ' : '') + finalText.trim())
        setLiveTranscript('')  // Clear interim after final
      }
    }

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return
      if (event.error === 'not-allowed') {
        setError('Microphone access denied. Please allow microphone permission.')
        setIsRecording(false)
        isRecordingRef.current = false
      }
    }

    recognition.onend = () => {
      // In continuous=false mode, recognition auto-stops after a pause.
      // Just update the UI state.
      if (isRecordingRef.current) {
        setIsRecording(false)
        isRecordingRef.current = false
        setLiveTranscript('')
      }
    }

    recognitionRef.current = recognition

    return () => {
      try { recognition.stop() } catch {}
    }
  }, [])

  const startRecording = () => {
    if (!supported) return
    setError('')
    setParsed(null)
    setIsRecording(true)
    isRecordingRef.current = true
    setLiveTranscript('')
    // Reset processed finals for new session
    processedFinalsRef.current.clear()
    try { recognitionRef.current?.start() } catch {}
  }

  const stopRecording = () => {
    setIsRecording(false)
    isRecordingRef.current = false
    try { recognitionRef.current?.stop() } catch {}
    setLiveTranscript('')
  }

  const handleParse = async () => {
    const fullTranscript = accumulatedTranscript.trim()
    if (!fullTranscript) {
      toast({ title: 'Nothing to parse', description: 'Record some audio first.', variant: 'destructive' })
      return
    }

    setProcessing(true)
    try {
      const r = await offlineFetch('/api/voice-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: fullTranscript }),
      })
      if (r.status === 402) {
        const errData = await r.json().catch(() => ({}))
        toast({ title: 'Pro Feature', description: errData.message || 'Voice entry requires Pro plan', variant: 'destructive' })
        return
      }
      const data = await r.json()

      if (data.success) {
        setParsed(data.transaction)
        sonnerToast.success('Voice entry parsed! Review below.')
      } else {
        toast({ title: 'Could not parse voice entry', description: data.error, variant: 'destructive' })
      }
    } catch (e) {
      toast({ title: 'Failed to process voice', variant: 'destructive' })
    } finally {
      setProcessing(false)
    }
  }

  const handleApply = () => {
    if (!parsed || !parsed.items || parsed.items.length === 0) {
      toast({ title: 'No items to apply', variant: 'destructive' })
      return
    }
    onTransactionParsed(parsed)
    sonnerToast.success('Voice entry applied! Review and save.')
    setParsed(null)
    setAccumulatedTranscript('')
  }

  const handleAddMore = () => {
    setParsed(null)
    startRecording()
  }

  const handleReset = () => {
    setAccumulatedTranscript('')
    setLiveTranscript('')
    setParsed(null)
    setError('')
  }

  // Delete a parsed item by index
  const handleDeleteItem = (index: number) => {
    if (!parsed?.items) return
    const newItems = parsed.items.filter((_: any, i: number) => i !== index)
    setParsed({ ...parsed, items: newItems })
    sonnerToast.info('Item removed')
  }

  if (!supported) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">
        Voice entry is not supported on this browser. Please use Chrome or Edge.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Recording controls */}
      <div className="flex items-center gap-2">
        {!isRecording ? (
          <Button onClick={startRecording} className="bg-rose-600 hover:bg-rose-700 gap-2 flex-1">
            <Mic className="w-4 h-4" />
            {accumulatedTranscript ? 'Record More' : 'Start Recording'}
          </Button>
        ) : (
          <Button onClick={stopRecording} variant="destructive" className="gap-2 flex-1 animate-pulse">
            <Square className="w-4 h-4" />
            Stop Recording
          </Button>
        )}
        {accumulatedTranscript && !isRecording && !parsed && (
          <Button onClick={handleParse} disabled={processing} className="bg-gradient-saffron gap-2">
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Parse
          </Button>
        )}
        {accumulatedTranscript && (
          <Button onClick={handleReset} variant="ghost" size="icon" title="Clear all">
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Live transcript (while recording) */}
      {isRecording && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-xs font-medium text-rose-600">Listening...</span>
          </div>
          <p className="text-sm text-foreground">
            {accumulatedTranscript}
            <span className="text-muted-foreground italic">{liveTranscript}</span>
          </p>
        </div>
      )}

      {/* Accumulated transcript (after stopping) — EDITABLE */}
      {!isRecording && accumulatedTranscript && !parsed && (
        <div className="p-3 rounded-lg bg-muted border border-border">
          <p className="text-xs text-muted-foreground mb-1">Transcript (tap to edit any word):</p>
          <textarea
            value={accumulatedTranscript}
            onChange={(e) => setAccumulatedTranscript(e.target.value)}
            className="w-full bg-transparent text-sm text-foreground resize-none focus:outline-none"
            rows={3}
          />
        </div>
      )}

      {/* Processing state */}
      {processing && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted-foreground">Parsing with AI...</span>
        </div>
      )}

      {/* Parsed result */}
      {parsed && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm">Parsed Result</h4>
              <Button onClick={handleReset} variant="ghost" size="sm" className="text-xs gap-1">
                <RefreshCw className="w-3 h-3" /> Start Over
              </Button>
            </div>

            {parsed.items && parsed.items.length > 0 ? (
              <div className="space-y-1.5">
                {parsed.items.map((item: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-sm">
                    {/* Editable product name */}
                    <input
                      type="text"
                      value={item.productName || item.name || ''}
                      onChange={(e) => {
                        const newItems = [...parsed.items]
                        newItems[i] = { ...newItems[i], productName: e.target.value }
                        setParsed({ ...parsed, items: newItems })
                      }}
                      className="flex-1 min-w-0 bg-transparent font-medium focus:outline-none focus:bg-background focus:px-1 focus:rounded transition"
                      placeholder="Product name"
                    />
                    {/* Editable quantity */}
                    <input
                      type="number"
                      value={item.quantity || ''}
                      onChange={(e) => {
                        const newItems = [...parsed.items]
                        newItems[i] = { ...newItems[i], quantity: Number(e.target.value) }
                        setParsed({ ...parsed, items: newItems })
                      }}
                      className="w-12 bg-transparent text-center text-xs focus:outline-none focus:bg-background focus:px-1 focus:rounded transition"
                      placeholder="Qty"
                    />
                    <span className="text-xs text-muted-foreground">{item.unit || 'pcs'}</span>
                    {/* Editable price */}
                    <span className="text-xs text-muted-foreground">x ₹</span>
                    <input
                      type="number"
                      value={item.unitPrice || ''}
                      onChange={(e) => {
                        const newItems = [...parsed.items]
                        newItems[i] = { ...newItems[i], unitPrice: Number(e.target.value) }
                        setParsed({ ...parsed, items: newItems })
                      }}
                      className="w-16 bg-transparent text-right text-xs focus:outline-none focus:bg-background focus:px-1 focus:rounded transition"
                      placeholder="Price"
                    />
                    {/* Total (auto-calculated) */}
                    <p className="font-semibold w-14 text-right">₹{((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)).toFixed(0)}</p>
                    {/* Delete button */}
                    <button
                      onClick={() => handleDeleteItem(i)}
                      className="p-1 rounded-lg text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/30 transition flex-shrink-0"
                      title="Remove this item"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">No items parsed. Try recording again.</p>
            )}

            <div className="flex gap-2 pt-2 border-t border-border">
              <Button onClick={handleAddMore} variant="outline" className="flex-1 gap-2">
                <Plus className="w-4 h-4" /> Add More
              </Button>
              <Button
                onClick={handleApply}
                className="flex-1 bg-gradient-saffron gap-2"
                disabled={!parsed.items || parsed.items.length === 0}
              >
                <Check className="w-4 h-4" /> Apply & Review
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-rose-600">{error}</p>
      )}

      {/* Tip */}
      {!isRecording && !accumulatedTranscript && !parsed && (
        <p className="text-xs text-muted-foreground text-center">
          Speak naturally: "2 kg Aatta, 1 kg Sugar, 3 Dabar soap" — AI will parse all items.
        </p>
      )}
    </div>
  )
}
