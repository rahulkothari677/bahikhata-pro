# Sentry Alert Configuration — GST Filing & Critical Errors

> **🔒 V20-017**: This document specifies the Sentry alert rules to configure
> in the Sentry dashboard. The code-side instrumentation is complete (every
> API 500 now reports to Sentry; GST filing routes have additional tags).
> This document covers the **dashboard-side** alert rules — a one-time manual
> setup task.

## Prerequisites

1. **Sentry DSN is set** — `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` env vars
   in Vercel (already configured — see `sentry.server.config.ts`).
2. **Sentry project exists** — `bahikhata-pro` project on sentry.io.
3. **Alert recipients configured** — Slack integration or email, in Sentry
   project settings → Integrations.

---

## Alert Rule 1: GST Filing Failure (CRITICAL — page immediately)

**Purpose:** Catch a V20-001-class bug (100× wrong GST filing) within minutes
of beta, before a CA sees a wrong filed return.

**Trigger:** Any error where `module = "gst-filing"` AND `http_status >= 500`

**Configuration in Sentry:**
1. Go to: Alerts → Create Alert → "Issue Alert"
2. Name: `🚨 GST Filing Failure`
3. Filter: `event.tags.module` equals `gst-filing` AND `event.tags.http_status`
   greater than or equal to `500`
4. Action: Send to `#alerts-critical` Slack channel + email on-call engineer
5. Throttle: 1 notification per 5 minutes (avoid spam during an outage)
6. Environment: `production` only

**Why this matters:** The auditor's §1.1 flagged that a money-extension bug
in the `upsert` handler would write 100× wrong values to the GST return
snapshot. If that regresses, this alert fires the moment a CA tries to file.

---

## Alert Rule 2: Any 5xx API Error (HIGH — daily digest)

**Purpose:** General API health monitoring. Catches any 500 across the app.

**Trigger:** Any error where `source = "apiError"` AND `http_status >= 500`

**Configuration:**
1. Filter: `event.tags.source` equals `apiError` AND `event.tags.http_status`
   greater than or equal to `500`
2. Action: Daily digest email to engineering team
3. Throttle: 1 email per day (digest mode)

---

## Alert Rule 3: Error Rate Spike (HIGH — real-time)

**Purpose:** Detect when error rate suddenly increases (indicates a bad deploy).

**Trigger:** Error rate > 5% in any 5-minute window

**Configuration:**
1. Go to: Alerts → Create Alert → "Metric Alert"
2. Metric: `event_rate()` per minute
3. Condition: > 5 events per minute for 5 consecutive minutes
4. Action: Slack `#alerts-critical` + page on-call
5. Environment: `production` only

---

## Alert Rule 4: Reconciliation Mismatch (MEDIUM — daily digest)

**Purpose:** The nightly reconciliation job (V20-018, `.github/workflows/nightly-reconciliation.yml`)
runs at 2 AM IST every night, iterates all users, and runs the 3 reconciliation
checks (party balances, GST, orphaned data). If any check fails for any user,
it captures a Sentry event with `module: reconciliation`.

**Trigger:** Any event where `module = "reconciliation"`

**Configuration:**
1. Filter: `event.tags.module` equals `reconciliation`
2. Action: Daily digest email to engineering team + Slack `#alerts-critical`
3. Throttle: 1 notification per hour (avoid spam if multiple users fail)

**What to do when this fires:**
1. Open the Sentry event — it includes `userId`, `userEmail`, `checkName`,
   and `details` in the `reconciliation_failure` context.
2. Log in as that user (via the admin panel) and run the reconciliation check
   manually from the Reports page.
3. If it's a GST mismatch, check whether the user has credit notes or edited
   invoices — the V20-006 tolerance tightening may have surfaced a real drift.
4. If it's a party balance mismatch, check the party-detail page — the SQL
   path and JS path should agree; if they don't, it's a float drift bug.
5. If it's orphaned data, that's a referential integrity issue — someone may
   have manually deleted rows via SQL. Contact support.

**Status:** ACTIVE as of V20-018. The nightly cron job is deployed and will
fire this alert when failures occur.

---

## Available Sentry Tags (reference)

Every Sentry event from `apiError()` includes:

| Tag | Value | Example |
|-----|-------|---------|
| `error_id` | 8-char hex ID | `a3f2b1c9` |
| `http_status` | HTTP status code | `500` |
| `source` | Always `apiError` for API errors | `apiError` |

GST filing errors additionally include:

| Tag | Value | Example |
|-----|-------|---------|
| `module` | `gst-filing` | `gst-filing` |
| `gst_route` | The API route | `/api/gstr-3b` |
| `gst_action` | What was attempted | `file`, `save`, `compute`, `export` |
| `gst_month_year` | Filing period (if known) | `072026` |

**Sentry context payload** (visible in the event details):
- `api_error`: `{ message, errorId, status, ...context }`
- `gst_filing`: `{ route, action, monthYear, userId, ...metadata }`

---

## Setup Checklist (for the founder)

- [ ] Verify `SENTRY_DSN` is set in Vercel env vars (production)
- [ ] Verify `NEXT_PUBLIC_SENTRY_DSN` is set (for client-side errors)
- [ ] Trigger a test error: visit `/api/gstr-3b?month=invalid` (should 400,
      not 500 — if it 500s, that's a real bug). Then visit a guaranteed-500
      path to verify Sentry receives it.
- [ ] Confirm the error appears in Sentry with the `source: apiError` tag
- [ ] Create Alert Rule 1 (GST Filing Failure) in Sentry dashboard
- [ ] Create Alert Rule 2 (Any 5xx) in Sentry dashboard
- [ ] Create Alert Rule 3 (Error Rate Spike) in Sentry dashboard
- [ ] Configure Slack integration in Sentry → `#alerts-critical` channel
- [ ] Do a drill: intentionally break a GST route locally, deploy to staging,
      trigger the error, verify the alert fires in Slack

---

## What happens without SENTRY_DSN

If `SENTRY_DSN` is not set (e.g. local dev, or env var not configured):
- `sentry.server.config.ts` skips `Sentry.init()` — Sentry is a no-op
- `captureInSentry()` in `api-error.ts` still runs `import('@sentry/nextjs')`
  and calls `captureException()` — but Sentry SDK buffers and discards events
  when no DSN is set. No errors, no crashes, just silent no-op.
- `captureGstFilingError()` same behavior — sets tags on a no-op scope.

**Bottom line:** The code is safe with or without SENTRY_DSN. The alerts
only work once SENTRY_DSN is set in production.
