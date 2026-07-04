'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast as sonnerToast } from 'sonner'
import { Mail, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react'
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
 * NOTE: For now, since we don't have email sending set up, this uses a
 * "dev mode" approach: the reset link is shown directly in the toast
 * (NOT emailed). When you add email service (Resend, SendGrid, etc.),
 * we'll switch to actually emailing the link.
 *
 * TODO: Integrate Resend (https://resend.com) for actual email sending.
 * Free tier: 100 emails/day, perfect for password resets.
 */

interface PasswordResetProps {
  onBack: () => void
}

export function PasswordReset({ onBack }: PasswordResetProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [resetLink, setResetLink] = useState<string | null>(null)

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
        } else {
          sonnerToast.success('Password reset link sent to your email')
        }
      } else {
        sonnerToast.error(data.error || 'Failed to send reset link')
      }
    } catch {
      sonnerToast.error('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <div className="inline-flex w-12 h-12 rounded-full bg-emerald-100 items-center justify-center mb-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
          </div>
          <h3 className="font-semibold">Reset Link Ready</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {resetLink
              ? 'Dev mode: Click the link below to reset your password.'
              : 'Check your email for a password reset link.'}
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
        <Label>Email</Label>
        <div className="relative mt-1">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
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
