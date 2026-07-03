'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Mic, Square, Loader2, X, Plus, Check, RefreshCw, Sparkles, Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch } from '@/lib/offline-fetch'
import { useToast } from '@/hooks/use-toast'
import { useSubscription } from '@/hooks/use-subscription'
import { haptic } from '@/lib/haptic'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * VoiceEntry — redesigned for continuous recording + add more.
 *
 * Features:
 * 1. No more transcript duplication (tracks processed result indices)
 * 2. Product names shown in parsed result
 * 3. Delete (X) button on each parsed item
 * 4. Animated waveform during recording (visual feedback)
 * 5. Multi-language support — reads `voiceLang` from user settings and maps
 *    it to a BCP-47 locale for the Web Speech API (hi-IN, mr-IN, ta-IN, etc.).
 * 6. Quick toggle between the selected language and English (for translation).
 * 7. Example phrases users can tap to see how it works
 */

interface VoiceEntryProps {
  onTransactionParsed: (data: any) => void
  products?: any[]  // Pass products so we can auto-fill prices
}

// Map the user's voiceLang setting code → BCP-47 locale for Web Speech API.
// 'original' defaults to hi-IN (Hindi) because the browser cannot auto-detect
// the spoken language — the user must pick one. Hindi is the most common for
// Indian shop owners and also handles Hinglish reasonably well.
const VOICE_LANG_TO_LOCALE: Record<string, string> = {
  original: 'hi-IN',
  en: 'en-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  gu: 'gu-IN',
  mr: 'mr-IN',
  bn: 'bn-IN',
  te: 'te-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  pa: 'pa-IN',
}

// Human-readable label for each locale, shown in the "Listening in X..." banner
const LOCALE_TO_LABEL: Record<string, string> = {
  'hi-IN': 'Hindi',
  'en-IN': 'English',
  'ta-IN': 'Tamil',
  'gu-IN': 'Gujarati',
  'mr-IN': 'Marathi',
  'bn-IN': 'Bengali',
  'te-IN': 'Telugu',
  'kn-IN': 'Kannada',
  'ml-IN': 'Malayalam',
  'pa-IN': 'Punjabi',
}

// Short chip label for the toggle button (native script)
const LOCALE_TO_CHIP: Record<string, string> = {
  'hi-IN': 'हिं',
  'en-IN': 'EN',
  'ta-IN': 'த',
  'gu-IN': 'ગુ',
  'mr-IN': 'मरा',
  'bn-IN': 'বাং',
  'te-IN': 'తె',
  'kn-IN': 'ಕ',
  'ml-IN': 'മ',
  'pa-IN': 'ਪੰ',
}

// Example phrases shown when user hasn't recorded yet
const EXAMPLE_PHRASES = [
  { text: '2 kg Aatta, 1 kg Sugar, 3 Dabar soap', lang: 'Hinglish' },
  { text: 'Rahul se 500 rupaye received, mobile repair ke liye', lang: 'Hinglish' },
  { text: '5 packet Milk, 2 bread, 1 kg Tomatoes', lang: 'English' },
  { text: 'Do kilo Chini, ek kilo Namak, paanch sabun', lang: 'Hindi' },
]

export function VoiceEntry({ onTransactionParsed, products = [] }: VoiceEntryProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [accumulatedTranscript, setAccumulatedTranscript] = useState('')
  const [processing, setProcessing] = useState(false)
  const [parsed, setParsed] = useState<any>(null)
  const [error, setError] = useState('')
  const [supported, setSupported] = useState(true)
  // `lang` is the BCP-47 locale currently active for recognition. It starts
  // as hi-IN (sensible default) and is synced to the user's voiceLang setting
  // once settings load. The user can toggle between this language and English.
  const [lang, setLang] = useState<string>('hi-IN')
  // `voiceLangCode` is the user's setting code ('original' | 'en' | 'hi' | …).
  // Sent to /api/voice-parse so the LLM knows whether to translate or keep
  // the spoken language in the parsed output.
  const [voiceLangCode, setVoiceLangCode] = useState<string>('original')
  const recognitionRef = useRef<any>(null)
  const processedFinalsRef = useRef<Set<number>>(new Set())
  const isRecordingRef = useRef(false)
  const { toast } = useToast()
  const { requireFeature } = useSubscription()

  // Fetch user settings to get voiceLang (and stay in sync if changed elsewhere)
  const { data: settingsData } = useQuery({
    queryKey: ['user-settings'],
    queryFn: async () => {
      const r = await fetch('/api/settings')
      if (!r.ok) return null
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  // Sync `lang` + `voiceLangCode` from settings whenever voiceLang changes.
  // The user's selected language becomes the DEFAULT recognition locale; the
  // toggle button lets them temporarily switch to English for that session.
  useEffect(() => {
    const code = settingsData?.setting?.voiceLang || 'original'
    setVoiceLangCode(code)
    const locale = VOICE_LANG_TO_LOCALE[code] || 'hi-IN'
    // Only override the active locale if the user hasn't toggled to English
    // mid-session. We detect this by checking if the current locale matches
    // the previous setting's locale OR is the default hi-IN (initial state).
    setLang(prevLocale => {
      // If currently on English due to a manual toggle but the setting is
      // not English, keep English until the user toggles back. Otherwise,
      // follow the setting.
      if (prevLocale === 'en-IN' && code !== 'en') return prevLocale
      return locale
    })
  }, [settingsData])

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSupported(false)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = lang

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

      setLiveTranscript(interim)

      if (finalText.trim()) {
        setAccumulatedTranscript(prev => (prev ? prev + ' ' : '') + finalText.trim())
        setLiveTranscript('')
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
  }, [lang]) // Re-init when language changes

  const startRecording = () => {
    if (!supported) return
    haptic.medium()
    setError('')
    setParsed(null)
    setIsRecording(true)
    isRecordingRef.current = true
    setLiveTranscript('')
    processedFinalsRef.current.clear()
    try { recognitionRef.current?.start() } catch {}
  }

  const stopRecording = () => {
    haptic.click()
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

    // Subscription gating — free users get 5 voice entries/month, Pro gets 150, Elite gets 500.
    // The hook shows the PaywallModal automatically if the feature is gated.
    if (!requireFeature('voice_entry')) {
      return
    }

    setProcessing(true)
    try {
      // Compute the effective voice language for the API. If the user toggled
      // to English mid-session (lang === 'en-IN'), the spoken language is
      // English, so the output should be English too — regardless of the
      // user's setting. Otherwise, use the user's voiceLang setting.
      const effectiveVoiceLang = lang === 'en-IN' ? 'en' : voiceLangCode
      const r = await offlineFetch('/api/voice-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: fullTranscript, lang, voiceLang: effectiveVoiceLang }),
      })

      // Handle 402 quota exceeded — show upgrade prompt instead of generic error
      if (r.status === 402) {
        const quotaData = await r.json().catch(() => ({}))
        sonnerToast.error('Voice entry limit reached', {
          description: quotaData.message || 'Upgrade to Pro for more voice entries',
          duration: 6000,
        })
        requireFeature('voice_entry')
        return
      }

      // Handle non-200 responses with visible error details
      if (!r.ok) {
        const errData = await r.json().catch(() => ({}))
        // Prefer 'detail' over 'error' — 'detail' has the actual provider error message
        const errorDetail = errData.detail || errData.error || errData.message || r.statusText || 'Unknown server error'
        sonnerToast.error(`Voice parse failed (HTTP ${r.status})`, {
          description: errorDetail,
          duration: 10000,
        })
        return
      }

      const data = await r.json()

      if (!data.success) {
        sonnerToast.error('AI parse error', {
          description: `${data.error || 'Unknown error'}${data.detail ? ': ' + data.detail : ''}`,
          duration: 10000,
        })
        return
      }

      if (data.success) {
        const enrichedItems = (data.transaction.items || []).map((item: any) => {
          const nameLower = (item.productName || item.name || '').toLowerCase().trim()
          const matched = products.find((p: any) =>
            p.name?.toLowerCase() === nameLower
          ) || products.find((p: any) =>
            p.name?.toLowerCase().includes(nameLower) || nameLower.includes(p.name?.toLowerCase())
          )

          if (matched && (!item.unitPrice || item.unitPrice === 0)) {
            return {
              ...item,
              productName: matched.name,
              productId: matched.id,
              unitPrice: matched.salePrice || matched.unitPrice || 0,
              unit: matched.unit || item.unit || 'pcs',
              gstRate: matched.gstRate ?? item.gstRate ?? 0,
            }
          }
          return item
        })

        setParsed({ ...data.transaction, items: enrichedItems })
        haptic.success()
        const matchedCount = enrichedItems.filter((i: any) => i.unitPrice > 0).length
        sonnerToast.success(`Parsed ${enrichedItems.length} items! ${matchedCount} prices auto-filled from inventory.`)
      } else {
        haptic.error()
        toast({ title: 'Could not parse voice entry', description: data.error, variant: 'destructive' })
      }
    } catch (e: any) {
      haptic.error()
      sonnerToast.error('Voice request failed', {
        description: `${e?.name || 'Error'}: ${e?.message || String(e)}. Check your internet connection.`,
        duration: 10000,
      })
    } finally {
      setProcessing(false)
    }
  }

  const handleApply = () => {
    if (!parsed || !parsed.items || parsed.items.length === 0) {
      toast({ title: 'No items to apply', variant: 'destructive' })
      return
    }
    haptic.success()
    onTransactionParsed(parsed)
    sonnerToast.success('Voice entry applied! Review and save.')
    setParsed(null)
    setAccumulatedTranscript('')
  }

  const handleAddMore = () => {
    haptic.click()
    setParsed(null)
    startRecording()
  }

  const handleReset = () => {
    haptic.click()
    setAccumulatedTranscript('')
    setLiveTranscript('')
    setParsed(null)
    setError('')
  }

  const handleDeleteItem = (index: number) => {
    if (!parsed?.items) return
    haptic.click()
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
      {/* Language toggle + Recording controls */}
      <div className="flex items-center gap-2">
        {/* Language toggle — switches between the user's selected voice language
            and English. If the selected language IS English, the toggle is a
            no-op (disabled) since both sides would be English. */}
        <button
          onClick={() => {
            haptic.click()
            // If currently on the user's selected language, switch to English
            // (for translation). If on English, switch back to the selected.
            const selectedLocale = VOICE_LANG_TO_LOCALE[voiceLangCode] || 'hi-IN'
            setLang(lang === 'en-IN' ? selectedLocale : 'en-IN')
          }}
          disabled={isRecording || voiceLangCode === 'en'}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition flex-shrink-0',
            lang !== 'en-IN'
              ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
              : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
            (isRecording || voiceLangCode === 'en') && 'opacity-50 cursor-not-allowed'
          )}
          title={voiceLangCode === 'en' ? 'English is your default voice language' : `Toggle between ${LOCALE_TO_LABEL[VOICE_LANG_TO_LOCALE[voiceLangCode] || 'hi-IN']} and English`}
        >
          <Languages className="w-3.5 h-3.5" />
          {lang === 'en-IN' ? 'EN' : (LOCALE_TO_CHIP[lang] || 'हिं')}
        </button>

        {!isRecording ? (
          <Button onClick={startRecording} className="bg-rose-600 hover:bg-rose-700 gap-2 flex-1">
            <Mic className="w-4 h-4" />
            {accumulatedTranscript ? 'Record More' : 'Start Recording'}
          </Button>
        ) : (
          <Button onClick={stopRecording} variant="destructive" className="gap-2 flex-1">
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

      {/* Live transcript with animated waveform (while recording) */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50"
          >
            <div className="flex items-center gap-2 mb-2">
              {/* Animated waveform — 5 bars that pulse up and down */}
              <div className="flex items-center gap-0.5 h-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <motion.div
                    key={i}
                    className="w-1 rounded-full bg-rose-500"
                    animate={{
                      height: [4, 14, 8, 16, 6, 4],
                    }}
                    transition={{
                      duration: 0.8,
                      repeat: Infinity,
                      delay: i * 0.1,
                      ease: 'easeInOut',
                    }}
                    style={{ height: 4 }}
                  />
                ))}
              </div>
              <span className="text-xs font-semibold text-rose-600 flex items-center gap-1">
                <motion.span
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  ●
                </motion.span>
                Listening in {LOCALE_TO_LABEL[lang] || 'Hindi'}...
              </span>
            </div>
            <p className="text-sm text-foreground min-h-[20px]">
              {accumulatedTranscript}
              <span className="text-muted-foreground italic">{liveTranscript}</span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>

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
              <h4 className="font-semibold text-sm flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-primary" />
                Parsed Result
              </h4>
              <Button onClick={handleReset} variant="ghost" size="sm" className="text-xs gap-1">
                <RefreshCw className="w-3 h-3" /> Start Over
              </Button>
            </div>

            {parsed.items && parsed.items.length > 0 ? (
              <div className="space-y-1">
                {parsed.items.map((item: any, i: number) => (
                  <div key={i} className="rounded-lg bg-muted/40 hover:bg-muted/60 transition px-3 py-2">
                    {/* Row 1: Item number + Product name (full width) + Total + Delete */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-muted-foreground flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center">
                        {i + 1}
                      </span>
                      <input
                        type="text"
                        value={item.productName || item.name || ''}
                        onChange={(e) => {
                          const newItems = [...parsed.items]
                          newItems[i] = { ...newItems[i], productName: e.target.value }
                          setParsed({ ...parsed, items: newItems })
                        }}
                        className="flex-1 min-w-0 bg-transparent font-medium text-sm focus:outline-none focus:bg-background focus:px-2 focus:py-0.5 focus:rounded transition border border-transparent focus:border-border"
                        placeholder="Product name"
                      />
                      <span className="font-bold tabular-nums flex-shrink-0 text-sm text-primary w-16 text-right">
                        ₹{((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)).toFixed(0)}
                      </span>
                      <button
                        onClick={() => handleDeleteItem(i)}
                        className="p-1 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition flex-shrink-0"
                        title="Remove this item"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Row 2: Qty + Unit + Price — flat, no inner boxes */}
                    <div className="flex items-center gap-2 pl-7">
                      <div className="flex-1 min-w-0 flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground w-7">Qty</span>
                        <input
                          type="number"
                          value={item.quantity || ''}
                          onChange={(e) => {
                            const newItems = [...parsed.items]
                            newItems[i] = { ...newItems[i], quantity: Number(e.target.value) }
                            setParsed({ ...parsed, items: newItems })
                          }}
                          className="w-full min-w-0 bg-background border border-border rounded tabular-nums focus:ring-1 focus:ring-primary text-center text-sm px-1 py-1"
                          placeholder="0"
                        />
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-1 w-16">
                        <span className="text-[10px] text-muted-foreground w-6">Unit</span>
                        <span className="block flex-1 bg-muted/50 border border-border rounded text-center text-sm px-1 py-1 text-muted-foreground">
                          {item.unit || 'pcs'}
                        </span>
                      </div>
                      <span className="text-muted-foreground flex-shrink-0 text-xs">×</span>
                      <div className="flex-1 min-w-0 flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground w-4">₹</span>
                        <input
                          type="number"
                          value={item.unitPrice || ''}
                          onChange={(e) => {
                            const newItems = [...parsed.items]
                            newItems[i] = { ...newItems[i], unitPrice: Number(e.target.value) }
                            setParsed({ ...parsed, items: newItems })
                          }}
                          className="w-full min-w-0 bg-background border border-border rounded tabular-nums focus:ring-1 focus:ring-primary text-center text-sm px-1 py-1"
                          placeholder="0"
                        />
                      </div>
                    </div>
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

      {/* Example phrases — shown when user hasn't recorded yet */}
      {!isRecording && !accumulatedTranscript && !parsed && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Try saying
          </p>
          <div className="space-y-1.5">
            {EXAMPLE_PHRASES.map((ex, i) => (
              <button
                key={i}
                onClick={() => { haptic.click(); setAccumulatedTranscript(ex.text) }}
                className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-muted/40 hover:bg-muted border border-border/40 hover:border-primary/30 transition text-left group"
              >
                <span className="text-[10px] font-semibold text-muted-foreground bg-background px-1.5 py-0.5 rounded flex-shrink-0">
                  {ex.lang}
                </span>
                <span className="text-sm text-foreground/80 group-hover:text-foreground flex-1 italic">
                  "{ex.text}"
                </span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground text-center pt-1">
            Tap a phrase to try it, or speak your own. AI parses all items automatically.
          </p>
        </div>
      )}
    </div>
  )
}

