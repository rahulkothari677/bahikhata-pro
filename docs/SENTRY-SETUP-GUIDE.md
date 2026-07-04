# Sentry Error Monitoring Setup Guide

## Overview

Sentry is **fully configured** in the codebase — both client-side (browser errors) and server-side (API errors). You just need to create a free Sentry account and add the DSN to Vercel.

## What Sentry Does

| Feature | What It Catches |
|---------|----------------|
| Browser errors | JavaScript errors in user's browser (React crashes, undefined variables, etc.) |
| API errors | Server-side errors in API routes (database failures, timeouts, etc.) |
| Performance monitoring | Slow API responses, slow page loads (10% sampling to save cost) |
| Session replay (errors only) | Video-like replay of what user did before a crash |
| Environment tagging | Separate production errors from development |

## Step 1: Create Sentry Account (Free)

1. Go to https://sentry.io/signup/
2. Sign up with Google or email
3. Create a new project:
   - **Platform:** Next.js
   - **Project name:** `ekbook-pro`
   - **Team:** (create a team or use default)
4. After creating, go to **Settings** → **Client Keys (DSN)**
5. Copy the **DSN** — it looks like:
   ```
   https://abc123def456@o789012.ingest.sentry.io/1234567
   ```

## Step 2: Add to Vercel Environment Variables

Go to Vercel → `ekbook-pro` → Settings → Environment Variables

Add these variables:

| Variable | Value | Environment |
|----------|-------|-------------|
| `SENTRY_DSN` | `https://abc123...@o789012.ingest.sentry.io/1234567` | Production ✓ |
| `NEXT_PUBLIC_SENTRY_DSN` | Same DSN as above | Production ✓ |

**Note:** `NEXT_PUBLIC_` prefix makes it available in the browser (for client-side error tracking).

## Step 3: Redeploy

1. Vercel → Deployments → "..." → Redeploy → uncheck cache → Redeploy
2. Wait for "Ready" status

## Step 4: Verify Sentry Is Working

### Test client-side error:
1. Open your app in browser: https://ekbook-pro.vercel.app
2. Open browser console (F12 → Console)
3. Type: `throw new Error("Sentry test - client side")`
4. Press Enter
5. Go to Sentry dashboard → should see the error within seconds

### Test server-side error:
1. In Sentry dashboard, go to **Issues**
2. You should see any API errors that have occurred
3. If no errors yet, that's good — Sentry will catch them as they happen

## Step 5: Configure Alerts (Recommended)

In Sentry dashboard:

1. Go to **Settings** → **Alerts** → **Create Alert**
2. Set up:
   - **Alert type:** Issue alert
   - **Condition:** When an error is seen for the first time
   - **Action:** Send email to your email address
3. Save

Now you'll get an email whenever a new error occurs in production.

## Cost

| Plan | Cost | What You Get |
|------|------|-------------|
| Free (Developer) | ₹0 | 5,000 errors/month, 50 performance transactions, 10 replays |
| Team | $26/mo (~₹2,100) | 50,000 errors, 10K transactions, 100 replays |
| Business | $80/mo (~₹6,500) | 450K errors, 100K transactions |

**Free plan is enough until you have ~10K active users.**

## What's Already Configured in Code

| File | What It Does |
|------|-------------|
| `sentry.client.config.ts` | Browser error tracking + session replay on errors |
| `sentry.server.config.ts` | API route error tracking + performance monitoring |
| `instrumentation.ts` | Auto-loads Sentry on server startup (Next.js hook) |
| `.env.example` | Documents `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` |

### Configuration Details:

**Client-side:**
- 10% transaction sampling (saves cost)
- Session replay: only on errors (not all sessions)
- Environment: production vs development tagging

**Server-side:**
- 5% transaction sampling (API routes are high volume)
- Ignores: rate limit errors, quota exceeded errors (handled by our own code)

## Sentry Dashboard Guide

### What to Check Daily:

| Section | What to Look For |
|---------|-----------------|
| **Issues** | New errors (red badge = unresolved) |
| **Performance** | Slow API routes (response time > 2s) |
| **Replays** | Video replays of user sessions before crash |

### What to Check Weekly:

| Metric | Where | Healthy |
|--------|-------|---------|
| Error rate | Overview | < 1% of requests |
| Total errors | Issues | Trending down |
| Slowest API routes | Performance | All < 2s |
| Affected users | Issues | 0 for new errors |

## Troubleshooting

### Sentry not receiving errors
- Verify `SENTRY_DSN` is set in Vercel (not just `NEXT_PUBLIC_SENTRY_DSN`)
- Verify Vercel redeployed after adding env vars
- Check browser console for "Sentry initialized" message
- Ensure DSN is correct (copy from Sentry → Settings → Client Keys)

### Too many errors
- Some errors are expected (e.g., network timeouts, offline users)
- Use Sentry's "ignore" feature for known non-critical errors
- Increase sampling rate to reduce cost

### Session replay not working
- `replaysOnErrorSampleRate` is set to 1.0 (always replay on error)
- `replaysSessionSampleRate` is 0 (no replay for normal sessions)
- To enable all-session replay, set `replaysSessionSampleRate` to 0.1
