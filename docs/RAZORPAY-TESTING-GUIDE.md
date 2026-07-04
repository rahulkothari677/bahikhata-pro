# Razorpay Payment Testing Guide

## Overview

The Razorpay integration is **fully coded** — both frontend (CheckoutButton) and backend (create-order + verify routes). You just need to:

1. Get Razorpay API keys (free — no charge until real transactions)
2. Add keys to Vercel env vars
3. Test with a ₹1 test payment

## Step 1: Get Razorpay API Keys (Free)

1. Go to https://razorpay.com → click "Sign Up"
2. Fill in your details (name, email, phone, business name)
3. Complete KYC later (not needed for testing)
4. Go to **Settings** → **API Keys** → **Generate Key**
5. You'll see:
   - **Key ID:** `rzp_test_XXXXXXXXXX` (starts with `rzp_test_` for test mode)
   - **Key Secret:** `XXXXXXXXXXXXXXXXXXXX` (shown only once — copy it!)
6. Save both keys securely

**Test mode vs Live mode:**
- `rzp_test_` = test mode (no real money charged, use test cards)
- `rzp_live_` = live mode (real money charged) — DON'T use until ready for production

## Step 2: Add Keys to Vercel

1. Go to Vercel → `ekbook-pro` → **Settings** → **Environment Variables**
2. Add 2 variables:

| Variable | Value |
|----------|-------|
| `RAZORPAY_KEY_ID` | `rzp_test_XXXXXXXXXX` (your test key ID) |
| `RAZORPAY_KEY_SECRET` | `your_key_secret` |

3. Set environment: **Production** ✓
4. **Redeploy** (Deployments → "..." → Redeploy → uncheck cache)

## Step 3: Test the Payment Flow

### Test with Razorpay Test Cards

Once keys are set and Vercel is redeployed:

1. Open your app: https://ekbook-pro.vercel.app
2. Login with any user account
3. Go to **Settings** → **Pricing Plans** (or wherever the upgrade button is)
4. Click **"Upgrade to Pro"**
5. Razorpay checkout popup opens
6. Use a **test card** (NOT your real card):

| Card Number | Expiry | CVV | What It Does |
|------------|--------|-----|-------------|
| `4111 1111 1111 1111` | Any future date | Any 3 digits | ✅ Success payment |
| `5104 0155 5555 5558` | Any future date | Any 3 digits | ✅ Success (Mastercard) |
| `4000 0000 0000 0002` | Any future date | Any 3 digits | ❌ Card declined (test failure) |

**For UPI testing:**
- UPI ID: `success@razorpay` (success)
- UPI ID: `failure@razorpay` (failure)

7. Complete the payment with the success test card
8. You should see: "Welcome to Pro! Your subscription is active until..."
9. Page auto-reloads → your plan should show "Pro"

### What Happens Behind the Scenes:

```
User clicks "Upgrade to Pro"
    ↓
Frontend calls /api/payment/create-order
    ↓
Backend creates Razorpay order (₹299 = 29900 paise)
    ↓
Razorpay checkout popup opens
    ↓
User enters test card → pays
    ↓
Razorpay returns payment_id + signature
    ↓
Frontend calls /api/payment/verify with signature
    ↓
Backend verifies signature (HMAC SHA256)
    ↓
If valid: updates User.plan to "pro" + creates Subscription record
    ↓
User sees "Welcome to Pro!" toast
```

## Step 4: Verify in Admin Panel

After a successful test payment:

1. Open admin panel → **Subscriptions** page
2. You should see a new subscription:
   - Plan: Pro
   - Amount: ₹299
   - Status: Active
   - Payment ID: starts with `pay_`
3. Open admin → **Users** → find the test user → plan should show "Pro"
4. Open admin → **Revenue Recognition** → click "Recompute" → should show recognized revenue

## Step 5: Test Failure Scenarios

### Test 1: Card Declined
1. Click "Upgrade to Pro"
2. Use card: `4000 0000 0000 0002`
3. Payment should fail
4. User should see error message
5. User's plan should NOT change (still free)
6. No Subscription record created in admin

### Test 2: Payment Cancelled
1. Click "Upgrade to Pro"
2. When Razorpay popup opens → click "Close" or press Escape
3. Should see: "Payment cancelled." toast
4. User's plan should NOT change

### Test 3: Razorpay Keys Not Set
1. Remove `RAZORPAY_KEY_ID` from Vercel env vars
2. Redeploy
3. Click "Upgrade to Pro"
4. Should see: "Razorpay not configured" error
5. No payment popup opens

## Step 6: Go Live (When Ready)

When you're ready to accept real payments:

1. Complete Razorpay KYC (Aadhaar, PAN, bank details)
2. Go to Razorpay → Settings → API Keys → **Generate Live Key**
3. Update Vercel env vars:
   - `RAZORPAY_KEY_ID` = `rzp_live_XXXXXXXXXX` (starts with `rzp_live_`)
   - `RAZORPAY_KEY_SECRET` = your live secret
4. Redeploy
5. Test with a real ₹1 payment (or minimum amount)
6. Check Razorpay dashboard → Payments → should show real payment

## Pricing (Current)

| Plan | Monthly | Yearly (Save 16%) |
|------|---------|-------------------|
| Pro | ₹299 | ₹2,999 |
| Elite | ₹599 | ₹5,999 |

## Razorpay Fees

| Payment Method | Fee |
|---------------|-----|
| UPI | 0% (free) |
| Credit/Debit Card | 2% + ₹3 |
| Net Banking | 2% + ₹3 |
| Wallet | 2% + ₹3 |

**Example:** User pays ₹299 via credit card → Razorpay fee = ₹299 × 2% + ₹3 = ₹8.98 → You receive ₹290.02

## Security Features Already Built

| Feature | How It Works |
|---------|-------------|
| Signature verification | HMAC SHA256 prevents tampered payments |
| Order ID validation | Every payment linked to a pre-created order |
| Audit trail | Every payment logged to AuditLog + Subscription table |
| User authentication | Only logged-in users can create orders |
| Plan validation | Only "pro" and "elite" accepted |
| Amount validation | Amount set server-side (not from frontend) |

## Troubleshooting

### "Razorpay not configured" error
- `RAZORPAY_KEY_ID` or `RAZORPAY_KEY_SECRET` not set in Vercel env vars
- Or Vercel not redeployed after adding keys

### "Payment verification failed"
- Signature mismatch — usually means `RAZORPAY_KEY_SECRET` is different between Vercel and what Razorpay used
- Check that you're using the same key pair (ID + Secret must match)

### Razorpay popup doesn't open
- Check browser console for errors
- Ensure `https://checkout.razorpay.com/v1/checkout.js` is loadable (not blocked by firewall)
- Try in Chrome incognito mode

### Payment succeeds but plan doesn't change
- Check Vercel function logs for the `/api/payment/verify` endpoint
- Look for database errors
- Check that `RAZORPAY_KEY_SECRET` is correct (signature verification needs it)

## Code Locations

| File | Purpose |
|------|---------|
| `src/app/api/payment/create-order/route.ts` | Creates Razorpay order (server-side) |
| `src/app/api/payment/verify/route.ts` | Verifies signature + upgrades plan (server-side) |
| `src/components/subscription/CheckoutButton.tsx` | Opens Razorpay checkout popup (client-side) |
| `src/components/subscription/PricingPlans.tsx` | Shows pricing plans + upgrade buttons |
