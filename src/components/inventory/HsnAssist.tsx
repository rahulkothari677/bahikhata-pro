'use client'

/**
 * Phase 8b (#129) — the item form's HSN help: a suggestion from the name, and a
 * check of the code typed. Rules live in lib/hsn-by-name.ts; this only draws.
 *
 * The rate is the biggest thing on each button (§4: the number first), the
 * condition under it in shop words, the statute behind ⓘ.
 */
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { InfoHint } from '@/components/common/InfoHint'
import type { HsnChoice, HsnSuggestion } from '@/lib/hsn-by-name'

const rateText = (c: HsnChoice) => (c.treatment === 'exempt' ? 'No GST' : `${c.gstRate}% GST`)
const sideText = (c: HsnChoice) => (c.label === 'No GST' ? 'Exempt' : c.label)

/** What ⓘ says: each choice's row, verbatim, and where it comes from. */
function statuteText(choices: HsnChoice[]): string {
  return choices.map((c) => `${rateText(c)} — ${c.description}. (${c.source})`).join('\n\n')
}

function Choices({ choices, onPick }: { choices: HsnChoice[]; onPick: (c: HsnChoice) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((c) => (
        <Button
          key={`${c.treatment}-${c.gstRate}-${c.label}`}
          type="button"
          variant="outline"
          onClick={() => onPick(c)}
          className="h-auto min-h-12 py-1.5 px-3 flex-col items-start gap-0 text-left min-w-0 max-w-full"
        >
          <span className="text-sm font-semibold tabular-nums leading-tight">{rateText(c)}</span>
          <span className="text-xs text-muted-foreground font-normal leading-tight truncate max-w-full">{sideText(c)}</span>
        </Button>
      ))}
    </div>
  )
}

/** Under the item name: "HSN 1101 for atta" and one button per way it can be sold. */
export function HsnSuggestCard({ suggestion, onPick }: { suggestion: HsnSuggestion; onPick: (hsn: string, c: HsnChoice) => void }) {
  return (
    <div className="mt-2 rounded-2xl border border-border px-3 py-2.5 min-w-0" data-testid="hsn-suggest">
      <div className="flex items-center gap-1.5 min-w-0">
        <Sparkles className="w-4 h-4 text-ai flex-shrink-0" aria-hidden />
        <p className="text-sm min-w-0">
          HSN <span className="font-mono font-semibold">{suggestion.hsn}</span>
          <span className="text-muted-foreground"> for “{suggestion.word}”</span>
        </p>
        <InfoHint text={`Tap how you sell it. From the GST notification:\n\n${statuteText(suggestion.choices)}`} label={`HSN ${suggestion.hsn}`} className="ml-1" />
      </div>
      <div className="mt-2">
        <Choices choices={suggestion.choices} onPick={(c) => onPick(suggestion.hsn, c)} />
      </div>
    </div>
  )
}

/**
 * Under the HSN field: a wrong shape with its fix; a rate that does not fit the
 * code with the ones that do; or, when all is well, which row the item follows.
 */
export function HsnCodeLine({
  code, problem, fix, choices, fits, gst, gstRate, treatment, onFix, onPick,
}: {
  code: string
  problem?: string
  fix?: string
  choices: HsnChoice[]
  fits: boolean | null
  /** Rate help only for a shop that is GST-registered; the shape check is for everyone. */
  gst: boolean
  gstRate: number
  treatment: string
  onFix: (code: string) => void
  onPick: (c: HsnChoice) => void
}) {
  if (problem) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2" data-testid="hsn-problem">
        <p className="text-xs text-bad font-medium">{problem}</p>
        {fix && (
          <Button type="button" variant="outline" size="sm" onClick={() => onFix(fix)} className="font-mono">
            Use {fix}
          </Button>
        )}
      </div>
    )
  }
  if (!gst || fits === null) return null
  if (!fits) {
    const options = [...new Set(choices.map(rateText))].join(' or ')
    return (
      <Notice level="act" className="mt-2" title={`HSN ${code}: ${options}`} info={statuteText(choices)} data-testid="hsn-mismatch"
        content={<Choices choices={choices} onPick={onPick} />}
      />
    )
  }
  const chosen = choices.find((c) => (c.treatment === 'exempt' ? treatment === 'exempt' : c.gstRate === gstRate)) ?? choices[0]
  return (
    <p className="mt-1.5 text-xs text-muted-foreground flex items-center gap-1 min-w-0" data-testid="hsn-fits">
      <span className="text-good" aria-hidden>✓</span>
      <span className="truncate">{sideText(chosen)} · {rateText(chosen)}</span>
      <InfoHint text={statuteText([chosen])} label={`HSN ${code}`} className="ml-1" />
    </p>
  )
}
