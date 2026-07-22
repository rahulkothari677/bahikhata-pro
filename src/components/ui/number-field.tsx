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

  // Reveal state for the in-box controls.
  //
  // This is deliberately React state and an inline opacity rather than
  // `group-hover:` / `group-focus-within:` utilities: this Tailwind build does
  // not emit a `group-focus-within` rule at all, so the controls stayed
  // invisible while the field had focus. Driving it from events is immune to
  // which variants the JIT decides to generate.
  const [revealed, setRevealed] = React.useState(false)

  // Desktop only. On a phone the buttons are not rendered at all: the field
  // needs its full width to show the amount (v1 flanked the input with
  // buttons and left ~26px for the digits), and a numeric keypad already
  // makes entry easy. The wheel bug this component exists for is mouse-only.
  const [isDesktop, setIsDesktop] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const sync = () => setIsDesktop(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const atMin = min !== undefined && Number(value || 0) <= min
  const atMax = max !== undefined && Number(value || 0) >= max

  /**
   * 🔒 LAYOUT v2 (2026-07-22, after Rahul saw v1 on a phone).
   *
   * v1 put the buttons OUTSIDE the input, flanking it. On a 375px screen that
   * ate the field: the number itself had ~26–61px left and the value was
   * unreadable — worse than the problem it solved.
   *
   * v2:
   *   - MOBILE: no buttons at all. Phones have a numeric keypad and the field
   *     gets its full width back. The wheel bug this component exists for is a
   *     mouse problem, so nothing is lost.
   *   - DESKTOP (sm+): the buttons sit INSIDE the box, one at each end, and are
   *     invisible until the field is hovered or focused. The resting state is a
   *     plain input at full width; the controls appear where the cursor is.
   *
   * The input carries symmetric padding at sm+ so text never slides under a
   * revealed button (padding is unconditional — animating it on hover would
   * make the digits jump).
   */
  // Visibility (hidden on mobile, fade-in on hover/focus at sm+) lives in
  // globals.css under `.number-field` / `.number-field-btn`. Tailwind's
  // `group-focus-within:` variant is not emitted by this build, so relying on
  // it left the controls invisible even while the field had focus.
  const buttonClass = cn(
    'number-field-btn absolute top-1/2 -translate-y-1/2 flex items-center justify-center rounded',
    'text-muted-foreground hover:text-foreground hover:bg-accent transition-opacity',
    compact ? 'h-6 w-5' : 'h-7 w-6',
  )
  const iconClass = compact ? 'h-3 w-3' : 'h-3.5 w-3.5'

  return (
    <div
      className={cn('number-field relative', className)}
      onPointerEnter={() => setRevealed(true)}
      onPointerLeave={() => { setRevealed(false); clearTimers() }}
      onFocus={() => setRevealed(true)}
      onBlur={(e) => {
        // Keep the controls up while focus moves between the input and its own
        // buttons; hide only when focus leaves the field entirely.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setRevealed(false)
      }}
    >
      {isDesktop && (
      <button
        type="button"
        tabIndex={-1}
        aria-label="Decrease"
        className={cn(buttonClass, 'left-1')}
        style={{ opacity: revealed && !(disabled || atMin) ? 1 : 0 }}
        disabled={disabled || atMin}
        onPointerDown={() => startHold(-1)}
        onPointerUp={clearTimers}
        onPointerLeave={clearTimers}
        onPointerCancel={clearTimers}
      >
        <Minus className={iconClass} />
      </button>
      )}
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
        className={cn(
          'no-native-spinner text-center',
          // Room for the in-box controls, reserved unconditionally on desktop
          // so the digits do not jump when the buttons fade in.
          isDesktop && (compact ? 'px-6' : 'px-7'),
          compact && 'h-8 text-sm',
          inputClassName,
        )}
      />
      {isDesktop && (
      <button
        type="button"
        tabIndex={-1}
        aria-label="Increase"
        className={cn(buttonClass, 'right-1')}
        style={{ opacity: revealed && !(disabled || atMax) ? 1 : 0 }}
        disabled={disabled || atMax}
        onPointerDown={() => startHold(1)}
        onPointerUp={clearTimers}
        onPointerLeave={clearTimers}
        onPointerCancel={clearTimers}
      >
        <Plus className={iconClass} />
      </button>
      )}
    </div>
  )
}
