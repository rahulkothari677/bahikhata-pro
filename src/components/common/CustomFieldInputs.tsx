'use client'

/**
 * The boxes a shopkeeper actually fills in for their own fields.
 *
 * 📄 Phase 5 part 2 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * ONE component for all three places — the bill, each line, and a customer —
 * because three copies of "render an input for a typed field" will disagree
 * about dates within a release, and the one that gets it wrong is whichever
 * screen nobody re-tested. GATE 2's one-vocabulary rule.
 *
 * TYPE DRIVES THE KEYBOARD, which is most of the value on a phone. A date
 * field opens a date picker; a number field opens the numeric pad. A chemist
 * entering an expiry on every line does that dozens of times a day, and a
 * text box that makes them type "12/03/2027" by hand is the difference
 * between a feature used and a feature abandoned.
 *
 * Values are held as strings and typed on the SERVER against the shop's own
 * definitions. This component never decides what a value means.
 */

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { CustomFieldDef } from '@/lib/custom-fields'

export function CustomFieldInputs({
  defs,
  values,
  onChange,
  compact = false,
  idPrefix,
  className,
}: {
  defs: CustomFieldDef[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  /** Tighter layout for the per-line boxes inside an item row. */
  compact?: boolean
  /** Unique per instance — a bill has many lines, each with the same keys. */
  idPrefix: string
  className?: string
}) {
  if (!defs.length) return null

  return (
    <div className={cn(compact ? 'grid grid-cols-2 gap-1.5' : 'space-y-3', className)}>
      {defs.map(f => {
        const id = `${idPrefix}-${f.key}`
        return (
          <div key={f.key}>
            <Label htmlFor={id} className={cn(compact && 'text-2xs')}>
              {f.label}
              {/*
                * The asterisk is the only marking a required field gets here.
                * The real enforcement is on the server, where it cannot be
                * skipped by an offline client replaying a queued sale.
                */}
              {f.required && <span className="text-rose-600" aria-hidden> *</span>}
              {f.required && <span className="sr-only"> (required)</span>}
            </Label>
            <Input
              id={id}
              value={values[f.key] ?? ''}
              onChange={e => onChange(f.key, e.target.value)}
              type={f.type === 'date' ? 'date' : 'text'}
              inputMode={f.type === 'number' || f.type === 'money' ? 'decimal' : undefined}
              className={cn('mt-1', compact && 'h-8 text-xs')}
              placeholder={f.type === 'money' ? '₹' : undefined}
            />
          </div>
        )
      })}
    </div>
  )
}
