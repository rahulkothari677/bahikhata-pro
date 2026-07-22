'use client'

import * as React from 'react'
import { Minus, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * NumberField — a number input with explicit − / + buttons.
 *
 * WHY (2026-07-22, Rahul-reported): every money field in the app was a bare
 * `<input type="number">`. Two problems, both of which change a stored amount
 * without the user noticing:
 *
 *   1. The mouse wheel edits a focused number input. Scrolling the entry form
 *      with the cursor over "Rate" silently rewrote the rate. (The shared
 *      Input now blurs on wheel, which fixes this everywhere.)
 *   2. The native spinner arrows are ~8px tall — unhittable on a phone, and
 *      the only visible affordance for stepping a value.
 *
 * This component replaces the native spinner with real buttons: touch-sized,
 * hold-to-repeat, and clamped to min/max. The text input is still there, so
 * typing an exact amount is unchanged.
 *
 * `value` is kept as a STRING deliberately. Money fields in this app are
 * controlled strings ('' means empty, not 0) — coercing to a number here would
 * turn a cleared field into 0 and silently zero out an amount.
 */

export interface NumberFieldProps {
  value: string | number
  onValueChange: (value: string) => void
  step?: number
  min?: number
  max?: number
  /** Decimal places used when stepping. 0 for quantities-as-counts, 2 for money. */
  decimals?: number
  id?: string
  placeholder?: string
  disabled?: boolean
  className?: string
  inputClassName?: string
  /** Smaller buttons for dense rows (the item lines in the entry form). */
  compact?: boolean
  'aria-label'?: string
}

/** Hold-to-repeat timings: a short pause, then ~8 steps/second. */
const REPEAT_DELAY_MS = 400
const REPEAT_INTERVAL_MS = 120

export function NumberField({
  value,
  onValueChange,
  step = 1,
  min,
  max,
  decimals = 2,
  id,
  placeholder,
  disabled,
  className,
  inputClassName,
  compact,
  'aria-label': ariaLabel,
}: NumberFieldProps) {
  // Timers for hold-to-repeat. Refs (not state) so a re-render can't orphan one.
  const delayRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // The stepper reads the CURRENT value on every tick. Without this ref the
  // repeat closure would capture the first value and apply the same result
  // over and over — a hold would step exactly once.
  const valueRef = React.useRef(value)
  React.useEffect(() => { valueRef.current = value }, [value])

  const clearTimers = React.useCallback(() => {
    if (delayRef.current) { clearTimeout(delayRef.current); delayRef.current = null }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
  }, [])

  // Timers must not outlive the component (dialogs unmount mid-hold).
  React.useEffect(() => clearTimers, [clearTimers])

  const applyStep = React.useCallback((direction: 1 | -1) => {
    const raw = String(valueRef.current ?? '').trim()
    // An empty field steps from 0 (or from min, when a floor is set), so the
    // first tap on "+" gives 1 rather than NaN.
    const current = raw === '' ? (min ?? 0) : Number(raw)
    if (!Number.isFinite(current)) return
    let next = current + direction * step
    if (min !== undefined && next < min) next = min
    if (max !== undefined && next > max) next = max
    // toFixed then strip trailing zeros: 0.1+0.2 must read 0.3, not
    // 0.30000000000000004, and 5 must read 5, not 5.00.
    const fixed = next.toFixed(decimals)
    onValueChange(decimals > 0 ? String(parseFloat(fixed)) : fixed)
  }, [step, min, max, decimals, onValueChange])

  const startHold = (direction: 1 | -1) => {
    applyStep(direction)
    clearTimers()
    delayRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => applyStep(direction), REPEAT_INTERVAL_MS)
    }, REPEAT_DELAY_MS)
  }

  const atMin = min !== undefined && Number(value || 0) <= min
  const atMax = max !== undefined && Number(value || 0) >= max

  const buttonClass = cn(
    'flex shrink-0 items-center justify-center rounded-md border border-input',
    'bg-transparent text-foreground transition-colors hover:bg-accent active:bg-accent/80',
    'disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none',
    'focus-visible:ring-[3px] focus-visible:ring-ring/50',
    compact ? 'h-8 w-7' : 'h-9 w-9',
  )
  const iconClass = compact ? 'h-3.5 w-3.5' : 'h-4 w-4'

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Decrease"
        className={buttonClass}
        disabled={disabled || atMin}
        onPointerDown={() => startHold(-1)}
        onPointerUp={clearTimers}
        onPointerLeave={clearTimers}
        onPointerCancel={clearTimers}
      >
        <Minus className={iconClass} />
      </button>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        // `step` sizes the BUTTON increment, not what may be typed. Putting it
        // on the input too would make a typed 0.25 kg fail browser step
        // validation when the buttons move in 0.5 kg.
        step="any"
        min={min}
        max={max}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn('no-native-spinner text-center', compact && 'h-8 text-sm', inputClassName)}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Increase"
        className={buttonClass}
        disabled={disabled || atMax}
        onPointerDown={() => startHold(1)}
        onPointerUp={clearTimers}
        onPointerLeave={clearTimers}
        onPointerCancel={clearTimers}
      >
        <Plus className={iconClass} />
      </button>
    </div>
  )
}
