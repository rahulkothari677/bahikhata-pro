'use client'

/**
 * The lock screen, and the thing that decides when to show it.
 *
 * 🔒 2026-08-08. See src/lib/app-lock.ts for the threat model and for why
 * every failure path here unlocks rather than locks.
 *
 * Renders children untouched when no PIN is set, which is every user until
 * they turn it on in Account → Security. When a PIN IS set, this covers the
 * app with a keypad on cold start and whenever the app has been in the
 * background longer than the chosen delay.
 *
 * Deliberately NOT a route guard. The books stay mounted underneath, so
 * unlocking is instant and nothing refetches — a shopkeeper who glances at
 * WhatsApp mid-sale comes back to the same half-filled invoice.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock, Delete, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getLockConfig, verifyPin, touch, shouldLock, clearLock } from '@/lib/app-lock'

/** Wrong attempts before the keypad makes the holder wait. */
const LOCKOUT_AFTER = 5
const LOCKOUT_MS = 30_000

export function AppLockGate({ children }: { children: React.ReactNode }) {
  /*
   * Starts null, meaning "not decided yet". A boolean initial value would be
   * a guess: `true` flashes a lock screen at everyone who has no PIN, and
   * `false` flashes the books at someone who does. null renders children
   * only after the first effect has read localStorage — which cannot run on
   * the server anyway, so there is nothing to hydrate-mismatch.
   */
  const [locked, setLocked] = useState<boolean | null>(null)

  // A cold start always locks when a PIN is set — the delay governs returning
  // from the background, not opening the app fresh.
  useEffect(() => {
    setLocked(getLockConfig() !== null)
  }, [])

  /*
   * Lock on the way OUT, not on the way in: the timestamp is written when the
   * app is hidden, and shouldLock() is evaluated when it comes back. Doing it
   * this way means a phone that was asleep for an hour is judged on the hour,
   * not on whatever timer happened to survive the freeze — mobile browsers
   * suspend timers, so an interval-based lock silently stops working exactly
   * when it matters.
   */
  useEffect(() => {
    if (!getLockConfig()) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') touch()
      else if (shouldLock()) setLocked(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const unlock = useCallback(() => {
    touch()
    setLocked(false)
  }, [])

  if (locked === null) return null
  if (!locked) return <>{children}</>

  return (
    <>
      {/* Kept mounted and inert underneath, so unlocking does not remount the app. */}
      <div aria-hidden className="pointer-events-none select-none blur-md">
        {children}
      </div>
      <LockScreen onUnlock={unlock} />
    </>
  )
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const checking = useRef(false)

  const waiting = lockedUntil > now
  const waitSecs = Math.ceil((lockedUntil - now) / 1000)

  useEffect(() => {
    if (!waiting) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [waiting])

  const submit = useCallback(async (candidate: string) => {
    if (checking.current) return
    checking.current = true
    try {
      if (await verifyPin(candidate)) {
        onUnlock()
        return
      }
      const next = attempts + 1
      setAttempts(next)
      setPin('')
      if (next >= LOCKOUT_AFTER) {
        setLockedUntil(Date.now() + LOCKOUT_MS)
        setAttempts(0)
        setError('Too many wrong attempts.')
      } else {
        setError(`Wrong PIN. ${LOCKOUT_AFTER - next} ${LOCKOUT_AFTER - next === 1 ? 'try' : 'tries'} left.`)
      }
    } finally {
      checking.current = false
    }
  }, [attempts, onUnlock])

  const press = (digit: string) => {
    if (waiting) return
    setError(null)
    const next = pin + digit
    setPin(next)
    // 6 is the maximum a PIN can be, so there is nothing left to wait for.
    if (next.length === 6) void submit(next)
  }

  // Physical keyboards exist — this runs in a browser on desktop too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (waiting) return
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') { setError(null); setPin(p => p.slice(0, -1)) }
      else if (e.key === 'Enter' && pin.length >= 4) void submit(pin)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const forgot = async () => {
    /*
     * The escape hatch, and the reason this feature cannot trap anyone.
     * Clears the lock and signs out; the books are on the server and the
     * account password brings them straight back. Nothing local is deleted —
     * offline cache included, because a shopkeeper who forgot a PIN has not
     * asked to lose their pending writes.
     */
    clearLock()
    try {
      const { signOut } = await import('next-auth/react')
      await signOut({ callbackUrl: '/' })
    } catch {
      window.location.href = '/'
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Enter your PIN to unlock EkBook"
      className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center px-6 pt-safe pb-safe"
    >
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <Lock className="w-7 h-7 text-primary" />
      </div>
      <h1 className="text-lg font-bold">Enter your PIN</h1>
      <p className="text-xs text-muted-foreground mt-1">EkBook is locked</p>

      <div className="flex gap-3 my-7" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={cn(
              'w-3 h-3 rounded-full transition',
              i < pin.length ? 'bg-primary scale-110' : 'bg-muted',
            )}
          />
        ))}
      </div>

      <p className="text-xs h-4 text-rose-600 dark:text-rose-400" role="alert">
        {waiting ? `Try again in ${waitSecs}s` : error}
      </p>

      <div className={cn('grid grid-cols-3 gap-3 mt-5 w-full max-w-[15rem]', waiting && 'opacity-40')}>
        {['1','2','3','4','5','6','7','8','9'].map(d => (
          <Key key={d} onClick={() => press(d)} disabled={waiting}>{d}</Key>
        ))}
        <Key
          onClick={() => pin.length >= 4 && void submit(pin)}
          disabled={waiting || pin.length < 4}
          aria-label="Unlock"
        >
          <span className="text-xs font-semibold">OK</span>
        </Key>
        <Key onClick={() => press('0')} disabled={waiting}>0</Key>
        <Key
          onClick={() => { setError(null); setPin(p => p.slice(0, -1)) }}
          disabled={waiting || pin.length === 0}
          aria-label="Delete last digit"
        >
          <Delete className="w-5 h-5" />
        </Key>
      </div>

      <button
        onClick={forgot}
        className="mt-8 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 underline underline-offset-4"
      >
        <LogOut className="w-3.5 h-3.5" />
        Forgot PIN? Sign in with your password
      </button>
      <p className="text-3xs text-muted-foreground mt-2 text-center max-w-xs">
        Your data is safe on the server. Signing in again brings everything back.
      </p>
    </div>
  )
}

function Key({
  children, onClick, disabled, ...rest
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-14 rounded-2xl bg-muted/60 hover:bg-muted active:scale-95 transition text-xl font-semibold flex items-center justify-center disabled:opacity-40 disabled:active:scale-100"
      {...rest}
    >
      {children}
    </button>
  )
}
