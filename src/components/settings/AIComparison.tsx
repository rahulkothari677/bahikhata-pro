'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Upload, Loader2, Sparkles, Trophy, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { toast as sonnerToast } from 'sonner'
import { offlineFetch } from '@/lib/offline-fetch'

interface ProviderResult {
  success: boolean
  parsed?: any
  error?: string
  durationMs: number
  tokensUsed?: number
}

interface ComparisonResults {
  gemini: ProviderResult | null
  openai: ProviderResult | null
  groq: ProviderResult | null
}

interface Stats {
  gemini: { tests: number; successRate: number; avgDurationMs: number; avgScore: number | null }
  openai: { tests: number; successRate: number; avgDurationMs: number; avgScore: number | null }
  groq: { tests: number; successRate: number; avgDurationMs: number; avgScore: number | null }
  totalComparisons: number
}

interface HistoryItem {
  id: string
  imageName: string | null
  billType: string
  geminiResult: ProviderResult | null
  openaiResult: ProviderResult | null
  groqResult: ProviderResult | null
  groundTruth: any
  geminiScore: number | null
  openaiScore: number | null
  groqScore: number | null
  createdAt: string
}

const PROVIDERS = [
  { key: 'gemini' as const, name: 'Gemini 2.5 Flash', color: 'bg-blue-500', textColor: 'text-blue-600', badge: 'bg-blue-100 text-blue-700' },
  { key: 'openai' as const, name: 'OpenAI GPT-4o mini', color: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-400', badge: 'bg-emerald-100 text-emerald-700' },
  { key: 'groq' as const, name: 'Groq Llama 3.2 90B', color: 'bg-orange-500', textColor: 'text-orange-600', badge: 'bg-orange-100 text-orange-700' },
]

export function AIComparison() {
  const { setView } = useAppStore()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [imageBase64, setImageBase64] = useState<string>('')
  const [imageName, setImageName] = useState<string>('')
  const [billType, setBillType] = useState<'sale' | 'purchase'>('purchase')
  const [currentResults, setCurrentResults] = useState<ComparisonResults | null>(null)
  const [currentComparisonId, setCurrentComparisonId] = useState<string | null>(null)
  const [groundTruth, setGroundTruth] = useState({
    sellerName: '',
    totalAmount: '',
    itemsCount: '',
  })

  // Fetch comparison history + aggregate stats
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['ai-comparison-history'],
    queryFn: async () => {
      const r = await offlineFetch('/api/scan-bill/compare/history?limit=50')
      return r.json()
    },
  })

  // Run comparison mutation
  const compareMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/scan-bill/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, billType, imageName }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Comparison failed')
      return data
    },
    onSuccess: (data) => {
      setCurrentResults(data.results)
      setCurrentComparisonId(data.comparisonId)
      sonnerToast.success('Comparison complete! Review results below.')
      refetchHistory()
    },
    onError: (err: Error) => {
      sonnerToast.error(err.message)
    },
  })

  // Save ground truth mutation
  const saveTruthMutation = useMutation({
    mutationFn: async () => {
      if (!currentComparisonId) throw new Error('No comparison to score')
      const r = await fetch(`/api/scan-bill/compare/${currentComparisonId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groundTruth: {
            sellerName: groundTruth.sellerName || null,
            totalAmount: groundTruth.totalAmount ? Number(groundTruth.totalAmount) : null,
            itemsCount: groundTruth.itemsCount ? Number(groundTruth.itemsCount) : null,
            items: [],
          },
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed to save')
      return data
    },
    onSuccess: (data) => {
      sonnerToast.success(`Scores saved! Gemini: ${data.scores.gemini ?? '—'} / OpenAI: ${data.scores.openai ?? '—'} / Groq: ${data.scores.groq ?? '—'}`)
      refetchHistory()
    },
    onError: (err: Error) => {
      sonnerToast.error(err.message)
    },
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      sonnerToast.error('Please select an image file')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      sonnerToast.error('Image too large. Max 10MB')
      return
    }
    setImageName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      setImageBase64(reader.result as string)
      setCurrentResults(null)
      setCurrentComparisonId(null)
    }
    reader.onerror = () => sonnerToast.error('Failed to read image file')
    reader.readAsDataURL(file)
  }

  const handleRunComparison = () => {
    if (!imageBase64) {
      sonnerToast.error('Please select a bill image first')
      return
    }
    compareMutation.mutate()
  }

  const handleSaveTruth = () => {
    if (!groundTruth.sellerName && !groundTruth.totalAmount && !groundTruth.itemsCount) {
      sonnerToast.error('Enter at least one ground-truth field (seller, amount, or item count)')
      return
    }
    saveTruthMutation.mutate()
  }

  const stats: Stats | undefined = historyData?.stats

  return (
    <div className="space-y-6 p-4 lg:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => { useAppStore.getState().setPreviousView('account'); setView('account') }}
          className="p-2 -ml-2 rounded-lg hover:bg-muted"
          aria-label="Back to account"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            AI Scanner Comparison
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Test Gemini, OpenAI, and Groq side-by-side on the same bill to find the most accurate provider
          </p>
        </div>
      </div>

      {/* Aggregate Stats Card */}
      {stats && stats.totalComparisons > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" />
              Leaderboard — {stats.totalComparisons} test{stats.totalComparisons !== 1 ? 's' : ''} run
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {PROVIDERS.map((p) => {
                const s = stats[p.key]
                const isBest = s.avgScore !== null && s.avgScore === Math.max(
                  stats.gemini.avgScore ?? -1,
                  stats.openai.avgScore ?? -1,
                  stats.groq.avgScore ?? -1,
                )
                return (
                  <div
                    key={p.key}
                    className={`rounded-lg border p-3 ${isBest ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30' : 'border-border bg-card'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{p.name}</span>
                      {isBest && <Badge className="bg-emerald-100 text-emerald-700 dark:text-emerald-300">🏆 Best</Badge>}
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Avg accuracy</span>
                        <span className="font-bold">{s.avgScore !== null ? `${s.avgScore}/100` : '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Success rate</span>
                        <span>{s.tests > 0 ? `${s.successRate.toFixed(0)}%` : '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Avg speed</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {s.tests > 0 ? `${s.avgDurationMs}ms` : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tests run</span>
                        <span>{s.tests}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Upload image */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Step 1 — Upload a bill image</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
                id="ai-compare-file"
              />
              <Label htmlFor="ai-compare-file" className="cursor-pointer">
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary hover:bg-primary/5 transition-colors">
                  <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium">{imageName || 'Click to select bill image'}</p>
                  <p className="text-xs text-muted-foreground mt-1">PNG, JPG, WEBP — max 10MB</p>
                </div>
              </Label>
            </div>
            {imageBase64 && (
              <div className="md:w-48">
                <img
                  src={imageBase64}
                  alt="Selected bill"
                  className="w-full h-32 object-cover rounded-lg border"
                />
              </div>
            )}
          </div>

          <div className="flex flex-col md:flex-row gap-3 items-end">
            <div className="flex-1 w-full">
              <Label className="text-xs">Bill type</Label>
              <div className="flex gap-2 mt-1">
                <Button
                  type="button"
                  size="sm"
                  variant={billType === 'purchase' ? 'default' : 'outline'}
                  onClick={() => setBillType('purchase')}
                >
                  Purchase bill
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={billType === 'sale' ? 'default' : 'outline'}
                  onClick={() => setBillType('sale')}
                >
                  Sale bill
                </Button>
              </div>
            </div>
            <Button
              onClick={handleRunComparison}
              disabled={!imageBase64 || compareMutation.isPending}
              className="w-full md:w-auto"
            >
              {compareMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Testing all 3 providers...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Run comparison
                </>
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            ⚠️ Each comparison uses 3 AI API calls (one per provider). Rate limited to 5/hour.
            Only providers with API keys configured will be tested.
          </p>
        </CardContent>
      </Card>

      {/* Step 2: Side-by-side results */}
      {currentResults && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Step 2 — Compare results side-by-side</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {PROVIDERS.map((p) => (
                <ProviderResultCard
                  key={p.key}
                  providerName={p.name}
                  badgeClass={p.badge}
                  result={currentResults[p.key]}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Ground truth */}
      {currentResults && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Step 3 — Enter ground truth (what's actually on the bill)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Enter what's actually printed/written on the bill. We'll auto-score each provider on accuracy.
              Leave fields blank if not applicable.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Seller / Party name</Label>
                <Input
                  value={groundTruth.sellerName}
                  onChange={(e) => setGroundTruth({ ...groundTruth, sellerName: e.target.value })}
                  placeholder="e.g. Sharma Traders"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Total amount (₹)</Label>
                <Input
                  type="number"
                  value={groundTruth.totalAmount}
                  onChange={(e) => setGroundTruth({ ...groundTruth, totalAmount: e.target.value })}
                  placeholder="e.g. 450"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Number of items</Label>
                <Input
                  type="number"
                  value={groundTruth.itemsCount}
                  onChange={(e) => setGroundTruth({ ...groundTruth, itemsCount: e.target.value })}
                  placeholder="e.g. 5"
                  className="mt-1"
                />
              </div>
            </div>
            <Button
              onClick={handleSaveTruth}
              disabled={saveTruthMutation.isPending}
              variant="default"
              className="w-full md:w-auto"
            >
              {saveTruthMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Scoring...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Save & score providers
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {historyData?.comparisons?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Test history</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {historyData.comparisons.map((item: HistoryItem) => (
                <HistoryRow key={item.id} item={item} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Setup help card */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900">
        <CardContent className="pt-4 text-xs space-y-2">
          <p className="font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            How to set up API keys
          </p>
          <p className="text-amber-700 dark:text-amber-300">
            Add these env vars in Vercel → Settings → Environment Variables:
          </p>
          <ul className="list-disc list-inside text-amber-700 dark:text-amber-300 space-y-1 ml-2">
            <li><code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">GEMINI_API_KEY</code> — free from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline">aistudio.google.com/apikey</a></li>
            <li><code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">OPENAI_API_KEY</code> — from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="underline">platform.openai.com/api-keys</a> (requires billing)</li>
            <li><code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">GROQ_API_KEY</code> — free from <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="underline">console.groq.com/keys</a></li>
          </ul>
          <p className="text-amber-700 dark:text-amber-300">
            Providers without keys are auto-skipped. After redeploying, this page will test all configured providers.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Renders one provider's result in the side-by-side comparison grid.
 */
function ProviderResultCard({
  providerName,
  badgeClass,
  result,
}: {
  providerName: string
  badgeClass: string
  result: ProviderResult | null
}) {
  return (
    <div className="border rounded-lg p-3 space-y-2 bg-card">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{providerName}</span>
        {result === null ? (
          <Badge variant="outline">Not configured</Badge>
        ) : result.success ? (
          <Badge className={badgeClass}>Success</Badge>
        ) : (
          <Badge variant="destructive">Failed</Badge>
        )}
      </div>

      {result === null ? (
        <p className="text-xs text-muted-foreground">API key not set in env vars.</p>
      ) : !result.success ? (
        <div className="text-xs space-y-1">
          <div className="flex items-start gap-1 text-destructive">
            <XCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span className="break-words">{result.error?.slice(0, 200) || 'Unknown error'}</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" />
            {result.durationMs}ms
          </div>
        </div>
      ) : (
        <div className="text-xs space-y-1.5">
          {result.parsed.sellerName && (
            <div>
              <span className="text-muted-foreground">Seller:</span>{' '}
              <span className="font-medium">{String(result.parsed.sellerName)}</span>
            </div>
          )}
          {result.parsed.invoiceNo && (
            <div>
              <span className="text-muted-foreground">Invoice #:</span>{' '}
              <span className="font-medium">{String(result.parsed.invoiceNo)}</span>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Items:</span>{' '}
            <span className="font-medium">{result.parsed.items?.length || 0}</span>
          </div>
          {typeof result.parsed.totalAmount === 'number' && (
            <div>
              <span className="text-muted-foreground">Total:</span>{' '}
              <span className="font-bold">₹{result.parsed.totalAmount.toFixed(2)}</span>
            </div>
          )}
          {typeof result.parsed.overallConfidence === 'number' && (
            <div>
              <span className="text-muted-foreground">Confidence:</span>{' '}
              <span className="font-medium">{(result.parsed.overallConfidence * 100).toFixed(0)}%</span>
            </div>
          )}
          <div className="flex items-center gap-1 text-muted-foreground pt-1 border-t">
            <Clock className="w-3 h-3" />
            {result.durationMs}ms
            {result.tokensUsed && <span className="ml-2">· {result.tokensUsed} tokens</span>}
          </div>
          {result.parsed.items?.length > 0 && (
            <details className="pt-1">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Show {result.parsed.items.length} items
              </summary>
              <ul className="mt-1 space-y-0.5">
                {result.parsed.items.map((item: any, idx: number) => (
                  <li key={idx} className="text-[11px]">
                    {item.name} × {item.quantity} {item.unit} = ₹{Number(item.total).toFixed(2)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One row in the test history list.
 */
function HistoryRow({ item }: { item: HistoryItem }) {
  const date = new Date(item.createdAt)
  const dateStr = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) +
    ' ' + date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="border rounded-lg p-2 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium truncate">{item.imageName || 'Untitled bill'}</span>
        <span className="text-muted-foreground text-[10px]">{dateStr}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {PROVIDERS.map((p) => {
          const result = item[`${p.key}Result`]
          const score = item[`${p.key}Score`]
          return (
            <div key={p.key} className="text-center">
              <div className="text-[10px] text-muted-foreground">{p.name.split(' ')[0]}</div>
              {result === null ? (
                <div className="text-[10px] text-muted-foreground">—</div>
              ) : score !== null ? (
                <div className={`font-bold ${score >= 75 ? 'text-emerald-600 dark:text-emerald-400' : score >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                  {score}/100
                </div>
              ) : result.success ? (
                <div className="text-emerald-600 dark:text-emerald-400 text-[10px]">✓ unscored</div>
              ) : (
                <div className="text-red-600 dark:text-red-400 text-[10px]">✗ failed</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
