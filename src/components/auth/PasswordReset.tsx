'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast as sonnerToast } from 'sonner'
import { Mail, ArrowLeft, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { offlineFetch } from '@/lib/offline-fetch'

/**
 * PasswordReset — "Forgot password?" flow.
 *
 * Flow:
 * 1. User enters their email
 * 2. We send a reset link to their email (via the /api/auth/reset-request endpoint)
 * 3. User clicks the link in email → goes to /reset-password?token=xxx
 * 4. User enters new password → /api/auth/reset-confirm updates it
 *
 * 🔒 AUDIT FIX V5 HB: Email IS now sent in production when RESEND_API_KEY is
 * configured. In dev mode (ALLOW_DEV_RESET=true), the reset link is returned
 * in the response so it can be shown in the UI for testing. The server logs
 * a founder alert if no provider is configured so the founder can manually
 * help the user.
 *
 * 🔒 AUDIT FIX V6 PP5: When no email provider is configured, the login screen
 * honestly tells the user "contact support to reset" instead of pretending
 * the email was sent. The `passwordResetEmailEnabled` flag is fetched from
 * /api/feature-flags (public, no auth — it's not secret).
 */

interface PasswordResetProps {
  onBack: () => void
}

export function PasswordReset({ onBack }: PasswordResetProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [resetLink, setResetLink] = useState<string | null>(null)

  // 🔒 V6 PP5: Fetch whether email is configured so we can show an honest
  // message instead of pretending the reset email was sent.
  const { data: flags } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: async () => {
      const r = await fetch('/api/feature-flags')
      if (!r.ok) return null
      return r.json()
    },
    staleTime: 5 * 60 * 1000,  // 5 min cache
  })
  const emailConfigured = flags?.passwordResetEmailEnabled === true

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    try {
      const r = await offlineFetch('/api/auth/reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await r.json()

      if (r.ok) {
        setSent(true)
        // In dev mode, show the reset link directly (no email sent)
        if (data.resetLink) {
          setResetLink(data.resetLink)
          sonnerToast.success('Reset link generated (dev mode — see below)')
        } else if (emailConfigured) {
          sonnerToast.success('Password reset link sent to your email')
        } else {
          // 🔒 V6 PP5: Email not configured — honest message.
          sonnerToast.warning('Password reset request logged', {
            description: 'Email sending is not yet configured. Our team will contact you to reset your password. For urgent access, email support with your registered email.',
            duration: 10000,
          })
        }
      } else {
        sonnerToast.error(data.error || "Couldn't send the reset link")
      }
    } catch (e: any) {
      sonnerToast.error(e?.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <div className="inline-flex w-12 h-12 rounded-full bg-emerald-100 items-center justify-center mb-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h3 className="font-semibold">Reset Link Ready</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {resetLink
              ? 'Dev mode: Click the link below to reset your password.'
              : emailConfigured
                ? 'Check your email for a password reset link.'
                : 'Reset request received — our team will contact you.'}
          </p>
        </div>

        {resetLink && (
          <a
            href={resetLink}
            className="block w-full bg-gradient-saffron text-white text-center py-2.5 rounded-lg font-medium hover:opacity-90 transition"
          >
            Reset My Password →
          </a>
        )}

        {/* 🔒 V6 PP5: Honest "contact support" message when email isn't configured. */}
        {!resetLink && !emailConfigured && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Email sending is not yet configured.</p>
              <p className="mt-1">
                We&apos;ve logged your reset request. To reset your password now,
                email <a href="mailto:support@ekbook.app" className="underline font-medium">support@ekbook.app</a> with
                your registered email and we&apos;ll help you within 24 hours.
              </p>
            </div>
          </div>
        )}

        <Button variant="outline" onClick={onBack} className="w-full gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to Login
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="field-email">Email</Label>
        <div className="relative mt-1">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input id="field-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="pl-9"
            required
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          We'll send a password reset link to this email.
        </p>
      </div>

      <Button type="submit" disabled={loading} className="w-full bg-gradient-saffron gap-2">
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Sending link...
          </>
        ) : (
          'Send Reset Link'
        )}
      </Button>

      <Button type="button" variant="ghost" onClick={onBack} className="w-full gap-2 text-sm">
        <ArrowLeft className="w-4 h-4" />
        Back to Login
      </Button>
    </form>
  )
}
