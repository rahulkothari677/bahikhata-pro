/**
 * 🔒 AUDIT FIX V5 HB: Email sending for password reset (and future notifications).
 *
 * Was: password reset stored a token but never sent the email — users were
 * silently locked out in production. The V5 auditor flagged this as a HIGH
 * severity issue ("users get locked out of an account holding their financial
 * records").
 *
 * This module supports Resend (https://resend.com — simplest, India-friendly,
 * free tier 3,000 emails/month). When RESEND_API_KEY is not set, sendEmail()
 * returns `{ ok: false, reason: 'no-provider' }` so callers can surface an
 * honest message to the user (instead of pretending the email was sent).
 *
 * Setup (founder task):
 *   1. Sign up at https://resend.com (free)
 *   2. Verify your sending domain (e.g. noreply@ekbook.app)
 *   3. Add to Vercel env vars:
 *        RESEND_API_KEY=re_xxx
 *        RESEND_FROM_EMAIL=EkBook <noreply@ekbook.app>
 *        FOUNDER_ALERT_EMAIL=your@email.com   (for password-reset alerts)
 *   4. Until those are set, the reset endpoint will surface an honest
 *      "contact support" message instead of silently failing.
 */

export interface SendEmailResult {
  ok: boolean
  reason?: 'no-provider' | 'send-failed' | 'invalid-response'
  detail?: string
  messageId?: string
}

interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string  // plain-text fallback
}

/**
 * Send an email via Resend. Returns { ok: false, reason: 'no-provider' } if
 * RESEND_API_KEY is not set — callers should check this and surface an honest
 * message to the user.
 *
 * Never throws — returns { ok: false } on any error so callers can decide
 * how to handle (e.g. show "contact support" message, log to founder alert).
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'EkBook <noreply@ekbook.app>'

  if (!apiKey) {
    return { ok: false, reason: 'no-provider' }
  }

  try {
    // 🔒 V26 R8 (Phase 5): 10s timeout. Was: no timeout → a hung Resend call
    // rode the whole function timeout. On the reset-request path, that's an
    // opaque 504 during "I forgot my password" — the worst moment for opacity.
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('[sendEmail] Resend API error:', response.status, errText)
      return { ok: false, reason: 'send-failed', detail: `HTTP ${response.status}: ${errText.slice(0, 200)}` }
    }

    const data = await response.json()
    if (!data?.id) {
      console.error('[sendEmail] Resend returned no message id:', data)
      return { ok: false, reason: 'invalid-response', detail: JSON.stringify(data).slice(0, 200) }
    }

    return { ok: true, messageId: data.id }
  } catch (error) {
    console.error('[sendEmail] Network/fetch error:', error)
    return { ok: false, reason: 'send-failed', detail: String(error).slice(0, 200) }
  }
}

/**
 * Send a founder alert (e.g. "password reset requested but no email provider
 * configured — user may be locked out, contact them manually"). Falls back
 * to console.error if FOUNDER_ALERT_EMAIL is not set.
 */
export async function sendFounderAlert(subject: string, message: string): Promise<void> {
  const alertEmail = process.env.FOUNDER_ALERT_EMAIL
  if (!alertEmail) {
    console.error(`[FOUNDER ALERT] ${subject}\n${message}`)
    return
  }
  const result = await sendEmail({
    to: alertEmail,
    subject: `[ALERT] ${subject}`,
    html: `<p><strong>${subject}</strong></p><pre style="white-space: pre-wrap;">${message}</pre>`,
    text: `${subject}\n\n${message}`,
  })
  if (!result.ok) {
    // Always log even if email fails — these alerts are important.
    console.error(`[FOUNDER ALERT — email send failed] ${subject}\n${message}\nSend result:`, result)
  }
}

/**
 * Returns true if email is configured (RESEND_API_KEY is set). Used by callers
 * to decide whether to show "email sent" or "contact support" messaging.
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}
