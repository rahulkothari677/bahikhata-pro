'use client'

/**
 * #190 (Phase 7g-4): a return picks from the bill it reverses. The original bill's
 * lines, each with − / + up to what was sold, and "Return all" for a full return.
 * The rules live in lib/return-lines.ts; this only draws them.
 */
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatINR, cn } from '@/lib/utils'
import { returnedQty, returnStep, type OriginalLine, type ReturnRow } from '@/lib/return-lines'

const qtyText = (q: number, unit: string) => `${q}${unit && unit !== 'pcs' ? ` ${unit}` : ''}`

export function ReturnFromBill({
  billNo,
  lines,
  rows,
  onSet,
  onAll,
  loading,
  failed,
}: {
  billNo: string
  lines: OriginalLine[]
  rows: ReturnRow[]
  onSet: (line: OriginalLine, qty: number) => void
  onAll: () => void
  loading?: boolean
  /** The bill could not be read (offline, deleted): say so, never "no items". */
  failed?: boolean
}) {
  const everything = lines.length > 0 && lines.every((l) => returnedQty(rows, l) === l.quantity)
  return (
    <div className="p-3 sm:p-4 border-b border-border" data-return-from-bill>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="font-semibold text-sm">From {billNo}</h3>
        <Button type="button" variant="outline" size="sm" onClick={onAll} disabled={loading || everything || lines.length === 0} className="gap-1.5">
          <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Return all
        </Button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground py-2">Loading the bill…</p>
      ) : failed ? (
        <p className="text-sm text-bad py-2">Couldn&apos;t open {billNo}. Add the items below.</p>
      ) : lines.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">This bill has no items.</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {lines.map((line) => {
            const q = returnedQty(rows, line)
            const step = returnStep(line)
            return (
              <li key={line.key} className="flex items-center gap-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words">{line.productName}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">sold {qtyText(line.quantity, line.unit)} × {formatINR(line.unitPrice)}</p>
                </div>
                <Button
                  type="button" variant="outline" size="iconTouch"
                  aria-label={`One less ${line.productName} back`}
                  disabled={q <= 0}
                  onClick={() => onSet(line, q - step)}
                >
                  <Minus className="w-4 h-4" aria-hidden />
                </Button>
                <span className={cn('w-12 text-center text-sm tabular-nums', q > 0 ? 'font-semibold' : 'text-muted-foreground')} aria-live="polite">
                  {qtyText(q, step === 1 ? '' : line.unit)}
                </span>
                <Button
                  type="button" variant="outline" size="iconTouch"
                  aria-label={`One more ${line.productName} back`}
                  disabled={q >= line.quantity}
                  onClick={() => onSet(line, q + step)}
                >
                  <Plus className="w-4 h-4" aria-hidden />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
