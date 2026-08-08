'use client'

/**
 * Account → Security → App Lock. Turn the PIN on, change it, or turn it off.
 *
 * 🔒 2026-08-08. See src/lib/app-lock.ts for the threat model.
 *
 * Setting a PIN asks for it twice, because a lock whose combination was a typo
 * is the one failure mode that actually costs a shopkeeper their afternoon.
 * Turning it off asks for the current PIN, so the lock is not a formality that
 * anyone holding the unlocked phone can switch off in two taps.
 */

import { useEffect, useState } from 'react'
import { Lock, ShieldCheck, X } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import {
  LOCK_DELAYS, isValidPin, setPin as persistPin, clearLock,
  getLockConfig, setLockDelay, verifyPin,
} from '@/lib/app-lock'

type Mode = null | 'set' | 'remove'

export function AppLockCard() {
  const [enabled, setEnabled] = useState(false)
  const [delayMs, setDelayMs] = useState<number>(0)
  const [mode, setMode] = useState<Mode>(null)

  // localStorage is not readable during SSR, so the real state arrives on mount.
  useEffect(() => {
    const cfg = getLockConfig()
    setEnabled(cfg !== null)
    setDelayMs(cfg?.delayMs ?? 300_000)
  }, [])

  const onToggle = (next: boolean) => setMode(next ? 'set' : 'remove')

  const onDone = () => {
    const cfg = getLockConfig()
    setEnabled(cfg !== null)
    setDelayMs(cfg?.delayMs ?? 300_000)
    setMode(null)
  }

  return (
    <div className="bg-card rounded-2xl shadow-card border border-border/60 overflow-hidden">
      <div className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center flex-shrink-0">
          <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">App Lock</p>
          <p className="text-xs text-muted-foreground">
            {enabled ? 'A PIN is required to open EkBook' : 'Require a PIN to open EkBook'}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label="App lock" />
      </div>

      {enabled && mode === null && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/40 pt-3">
          <div>
            <p className="text-xs font-medium mb-2">Ask for the PIN</p>
            <div className="grid grid-cols-2 gap-2">
              {LOCK_DELAYS.map(d => (
                <button
                  key={d.value}
                  onClick={() => {
                    setLockDelay(d.value)
                    setDelayMs(d.value)
                    sonnerToast.success(`Locks ${d.label.toLowerCase()}`)
                  }}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs font-medium transition text-left',
                    delayMs === d.value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/25'
                      : 'border-border/70 hover:border-border',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-3xs text-muted-foreground mt-1.5">
              Opening the app fresh always asks. This is for coming back after
              switching to another app.
            </p>
          </div>
          <button
            onClick={() => setMode('set')}
            className="text-xs font-medium text-primary underline underline-offset-4"
          >
            Change PIN
          </button>
        </div>
      )}

      {mode && (
        <div className="px-4 pb-4 border-t border-border/40 pt-3">
          {mode === 'set'
            ? <SetPinForm delayMs={delayMs} onDone={onDone} onCancel={() => setMode(null)} />
            : <RemovePinForm onDone={onDone} onCancel={() => setMode(null)} />}
        </div>
      )}

      {/* Said plainly, because the previous version of this feature promised
          more than it delivered and had to be torn out. */}
      <div className="px-4 pb-4">
        <p className="text-3xs text-muted-foreground">
          This keeps someone who picks up your phone out of your books. It is not
          a password and it does not encrypt anything — your data is protected on
          the server by your account password. Forgot the PIN? The lock screen
          lets you sign in with your password instead; nothing is lost.
        </p>
      </div>
    </div>
  )
}

function SetPinForm({ delayMs, onDone, onCancel }: { delayMs: number; onDone: () => void; onCancel: () => void }) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const problem =
    pin && !isValidPin(pin) ? 'PIN must be 4 to 6 digits'
    : confirm && pin !== confirm ? 'The two PINs do not match'
    : null
  const ready = isValidPin(pin) && pin === confirm && !busy

  const save = async () => {
    if (!ready) return
    setBusy(true)
    try {
      await persistPin(pin, delayMs)
      sonnerToast.success('App lock is on')
      onDone()
    } catch (e) {
      // Never swallowed: a PIN the shopkeeper believes is set but is not would
      // be worse than the error.
      console.error('[app-lock] could not save PIN:', e)
      sonnerToast.error('Could not turn on App Lock', {
        description: e instanceof Error ? e.message : 'Please try again.',
      })
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2.5">
      <PinInput label="New PIN" value={pin} onChange={setPin} autoFocus />
      <PinInput label="Confirm PIN" value={confirm} onChange={setConfirm} />
      <p className="text-3xs h-3 text-rose-600 dark:text-rose-400">{problem}</p>
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={!ready}
          className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 transition"
        >
          {busy ? 'Saving…' : 'Turn on App Lock'}
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 rounded-lg border border-border text-sm">
          Cancel
        </button>
      </div>
    </div>
  )
}

function RemovePinForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    if (!(await verifyPin(pin))) {
      setError('Wrong PIN')
      return
    }
    clearLock()
    sonnerToast.success('App lock is off')
    onDone()
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground">Enter your current PIN to turn the lock off.</p>
      <PinInput label="Current PIN" value={pin} onChange={v => { setPin(v); setError(null) }} autoFocus />
      <p className="text-3xs h-3 text-rose-600 dark:text-rose-400">{error}</p>
      <div className="flex gap-2">
        <button
          onClick={remove}
          disabled={pin.length < 4}
          className="flex-1 py-2.5 rounded-lg bg-rose-600 text-white text-sm font-medium disabled:opacity-40 transition flex items-center justify-center gap-2"
        >
          <X className="w-4 h-4" /> Turn off App Lock
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 rounded-lg border border-border text-sm">
          Cancel
        </button>
      </div>
    </div>
  )
}

function PinInput({
  label, value, onChange, autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <input
        // type=password rather than type=number: a numeric input on Android
        // shows the digits as they are typed, which defeats the point of
        // setting a PIN in front of whoever is standing at the counter.
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={6}
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
        placeholder="4–6 digits"
        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tracking-[0.4em] font-mono"
      />
    </label>
  )
}

/** The green "your data is protected" panel, kept from the old page. */
export function DataSecurityFacts() {
  return (
    <div className="bg-card rounded-2xl shadow-card border border-border/60 p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <p className="font-semibold text-sm">Data Security</p>
          <p className="text-xs text-muted-foreground">Your data is protected</p>
        </div>
      </div>
    </div>
  )
}
