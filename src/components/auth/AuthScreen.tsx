'use client'

import { useState, useEffect } from 'react'
import { useSession, signIn } from 'next-auth/react'
import { BookOpenText, Mail, Lock, User, Eye, EyeOff, Loader2, ArrowRight, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast as sonnerToast } from 'sonner'
import { getCachedSession } from '@/lib/offline-db'
import { useAppStore } from '@/store/app-store'
import { useTranslation } from '@/hooks/use-translation'
import { track, identifyUser, EVENTS } from '@/lib/analytics'
import { Globe } from 'lucide-react'

// 🔒 V20-5C: Language options for the login screen toggle
// 🔒 V20-009 FIX: The toggle now actually drives translation via useTranslation.
//   Previously the toggle set the store value but the AuthScreen used hardcoded
//   English strings — selecting Hindi did nothing visible. Now all visible
//   text uses t('auth.*') keys from i18n.ts (which has all 5 languages).
const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'हिं' },
  { code: 'gu', label: 'ગુ' },
  { code: 'mr', label: 'मरा' },
  { code: 'ta', label: 'தமி' },
] as const

export function AuthScreen() {
  const { data: session, status } = useSession()
  const { language, setLanguage } = useAppStore()
  const { t } = useTranslation()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const [hasCachedSession, setHasCachedSession] = useState(false)

  useEffect(() => {
    setIsOnline(navigator.onLine)
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    getCachedSession().then((s) => setHasCachedSession(!!s))
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (session) {
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (!navigator.onLine) {
        sonnerToast.error('You are offline. Please connect to internet to login.')
        setLoading(false)
        return
      }

      if (mode === 'signup') {
        const r = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        })
        const data = await r.json()
        if (!r.ok) {
          sonnerToast.error(data.error || 'Failed to sign up')
          setLoading(false)
          return
        }
        // 🔒 V20-025: Track signup event
        track(EVENTS.SIGNUP, { method: 'email' })
      }

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        sonnerToast.error('Invalid email or password')
        setLoading(false)
      } else if (result?.ok) {
        sonnerToast.success(mode === 'signup' ? 'Account created! Welcome to EkBook.' : 'Welcome back!')
        // 🔒 V20-025: Track login + identify user for attribution
        if (mode === 'login') {
          track(EVENTS.LOGIN, { method: 'email' })
        }
        // identifyUser will be called again after session loads with the real userId,
        // but calling it here with the email hash ensures the login event is attributed.
        try { identifyUser(btoa(email).slice(0, 16)) } catch {}
        // Small delay to let session propagate
        setTimeout(() => window.location.reload(), 500)
      } else {
        sonnerToast.error('Something went wrong. Please try again.')
        setLoading(false)
      }
    } catch (error) {
      sonnerToast.error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted/30">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 w-96 h-96 bg-primary/10 rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-primary/5 rounded-full translate-x-1/2 translate-y-1/2 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-saffron items-center justify-center shadow-lg mb-4">
            <BookOpenText className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">EkBook</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('auth.india_smart')}</p>

          {/* 🔒 V20-5C: Language toggle on login screen — front and center */}
          <div className="flex items-center justify-center gap-1.5 mt-3">
            <Globe className="w-3.5 h-3.5 text-muted-foreground" />
            {LANGS.map(l => (
              <button
                key={l.code}
                onClick={() => setLanguage(l.code)}
                className={`px-2 py-1 rounded-md text-xs font-medium transition ${
                  language === l.code
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-2xl shadow-xl border border-border p-6 lg:p-8">
          <div className="flex gap-2 p-1 bg-muted rounded-lg mb-6">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                mode === 'login' ? 'bg-background shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {t('auth.sign_in')}
            </button>
            <button
              onClick={() => setMode('signup')}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                mode === 'signup' ? 'bg-background shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {t('auth.sign_up')}
            </button>
          </div>

          {!isOnline && (
            <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex flex-col gap-2 text-amber-700 dark:text-amber-400">
              <div className="flex items-start gap-2">
                <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="text-xs space-y-1">
                  <p className="font-semibold">You are offline</p>
                  {hasCachedSession ? (
                    <p>You have a cached session. Tap below to continue using the app offline.</p>
                  ) : (
                    <p>First-time login requires internet. Please connect to WiFi or mobile data to sign in. After that, you can use the app offline anytime.</p>
                  )}
                </div>
              </div>
              {hasCachedSession && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                  onClick={() => {
                    // Force a page reload — the useOfflineSession hook will
                    // detect the cached session and bypass the AuthScreen.
                    window.location.reload()
                  }}
                >
                  Continue Offline
                </Button>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <Label>{t('auth.name')}</Label>
                <div className="relative mt-1">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Rajesh Sharma"
                    className="pl-9"
                    required
                  />
                </div>
              </div>
            )}

            <div>
              <Label>{t('auth.email')}</Label>
              <div className="relative mt-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="pl-9"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <Label>{t('auth.password')}</Label>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'Min 8 characters' : 'Your password'}
                  className="pl-9 pr-10"
                  required
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-saffron gap-2 shadow-md h-11"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {mode === 'signup' ? t('auth.sign_up') + '...' : t('auth.sign_in') + '...'}
                </>
              ) : (
                <>
                  {mode === 'login' ? t('auth.sign_in') : t('auth.sign_up')}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground mt-4">
            {mode === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <button onClick={() => setMode('signup')} className="text-primary font-medium hover:underline">
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button onClick={() => setMode('login')} className="text-primary font-medium hover:underline">
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-4">
          🔒 {t('auth.data_secure')}
        </p>
      </div>
    </div>
  )
}
