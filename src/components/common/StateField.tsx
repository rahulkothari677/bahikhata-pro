'use client'

/**
 * State and GSTIN inputs used by every form that records a place. (Phase 2b, #143)
 *
 * WHY. State was a free-text box on the party form, the quick-add party form
 * and the shop profile, so "UP", "RJ" and "Rajasthan " all reached the tax
 * rule (#118). A dropdown of the official names makes new entries one value;
 * an old typed value ("RJ") still shows as the state it means. And the GSTIN
 * — whose first two digits ARE the state — now fills the state as it is typed.
 */
import { Input } from '@/components/ui/input'
import { INDIAN_STATES, resolveStateCode, stateNameForCode, checkGstin, gstinStateCode } from '@/lib/gst-states'

export function StateField({
  id,
  value,
  onChange,
  gstin,
}: {
  id: string
  /** The stored state text — may be an old free-text value like "RJ". */
  value: string
  onChange: (stateName: string) => void
  /** When given, a state that disagrees with the GSTIN is flagged. */
  gstin?: string | null
}) {
  const code = resolveStateCode(value)
  const selected = code ? stateNameForCode(code)! : (value ? '__raw__' : '')
  const gstinCode = gstinStateCode(gstin)
  const mismatch = !!gstinCode && !!code && gstinCode !== code
  return (
    <>
      <select
        id={id}
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full h-11 rounded-lg border border-input bg-background px-3 text-sm"
      >
        <option value="">Choose state</option>
        {selected === '__raw__' && <option value="__raw__" disabled>{value} (not recognised — choose one)</option>}
        {INDIAN_STATES.map(s => <option key={s.code} value={s.name}>{s.name}</option>)}
      </select>
      {mismatch && (
        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
          The GSTIN is from {stateNameForCode(gstinCode)}.
        </p>
      )}
    </>
  )
}

export function GstinField({
  id,
  value,
  onChange,
  placeholder = '15-digit GST number',
}: {
  id: string
  value: string
  /** Called with the upper-cased GSTIN and, when it carries a valid state code, that state's name. */
  onChange: (gstin: string, stateFromGstin: string | null) => void
  placeholder?: string
}) {
  const check = checkGstin(value)
  const showProblem = !!value && value.trim().length >= 15 && !!check.reason
  return (
    <>
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          const v = e.target.value.toUpperCase().replace(/\s/g, '')
          const c = checkGstin(v)
          onChange(v, c.stateCode ? stateNameForCode(c.stateCode) : null)
        }}
        placeholder={placeholder}
        className="font-mono uppercase"
        maxLength={15}
        autoCapitalize="characters"
        spellCheck={false}
      />
      {showProblem ? (
        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{check.reason}</p>
      ) : check.ok && check.stateCode ? (
        <p className="text-xs text-muted-foreground mt-1">{stateNameForCode(check.stateCode)} — state filled from the GSTIN</p>
      ) : null}
    </>
  )
}
