'use client'

import posthog from 'posthog-js'
import { useEffect, useState } from 'react'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || ''
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com'

let isInitialized = false
let hasConsent = false

function checkConsent(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem('bahikhata-analytics-consent') === 'true'
  } catch {
    return false
  }
}

export function initAnalytics() {
  if (typeof window === 'undefined') return
  if (isInitialized) return
  if (!POSTHOG_KEY) return
  hasConsent = checkConsent()
  if (!hasConsent) return
  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      loaded: (ph) => {
        const userId = localStorage.getItem('bahikhata-user-uuid')
        if (userId) ph.identify(userId)
      },
      capture_pageview: true,
      capture_pageleave: true,
      disable_session_recording: true,
      autocapture: false,
      opt_out_capturing_by_default: true,
      request_batching: true,
      flush_at: 10,
      property_denylist: ['$ip', 'email', 'phone', 'password'],
    })
    isInitialized = true
  } catch (e) {
    console.error('[analytics] init failed:', e)
  }
}

export function setAnalyticsConsent(consent: boolean) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('bahikhata-analytics-consent', consent ? 'true' : 'false')
    hasConsent = consent
    if (consent && !isInitialized) initAnalytics()
    if (!consent && isInitialized) posthog.opt_out_capturing()
  } catch {}
}

export function hasAnalyticsConsent(): boolean { return hasConsent }

export function identifyUser(userId: string, traits?: any) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem('bahikhata-user-uuid', userId) } catch {}
  if (!isInitialized || !hasConsent) return
  try { posthog.identify(userId, traits) } catch {}
}

export function resetUser() {
  if (!isInitialized) return
  try { posthog.reset() } catch {}
}

export function track(event: string, properties?: Record<string, any>) {
  if (!isInitialized || !hasConsent) return
  try {
    const safeProps = { ...properties }
    delete safeProps.email; delete safeProps.phone; delete safeProps.password; delete safeProps.gstin; delete safeProps.address
    posthog.capture(event, safeProps)
  } catch {}
}

export const EVENTS = {
  SIGNUP: 'user.signup', LOGIN: 'user.login', LOGOUT: 'user.logout',
  SALE_CREATED: 'feature.sale_created', PURCHASE_CREATED: 'feature.purchase_created',
  PRODUCT_ADDED: 'feature.product_added', PARTY_ADDED: 'feature.party_added',
  INCOME_RECORDED: 'feature.income_recorded', EXPENSE_RECORDED: 'feature.expense_recorded',
  GSTR_EXPORTED: 'feature.gstr_exported', WHATSAPP_INVOICE_SENT: 'feature.whatsapp_invoice_sent',
  WHATSAPP_REMINDER_SENT: 'feature.whatsapp_reminder_sent',
  AI_SCAN_ATTEMPT: 'ai.scan_attempt', AI_SCAN_SUCCESS: 'ai.scan_success', AI_SCAN_FAILURE: 'ai.scan_failure',
  AI_VOICE_ATTEMPT: 'ai.voice_attempt', AI_VOICE_SUCCESS: 'ai.voice_success',
  APP_OPENED: 'engagement.app_opened', SESSION_START: 'engagement.session_start',
  VIEW_CHANGED: 'engagement.view_changed', SEARCH_USED: 'engagement.search_used',
  TRANSACTION_CREATED: 'business.transaction_created', TRANSACTION_VALUE: 'business.transaction_value',
  SUBSCRIPTION_STARTED: 'subscription.started', SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  PAYWALL_SHOWN: 'subscription.paywall_shown', PAYWALL_DISMISSED: 'subscription.paywall_dismissed',
  ONBOARDING_STARTED: 'onboarding.started', ONBOARDING_COMPLETED: 'onboarding.completed',
  ONBOARDING_SKIPPED: 'onboarding.skipped', TOUR_STARTED: 'onboarding.tour_started',
  TOUR_COMPLETED: 'onboarding.tour_completed', TOUR_SKIPPED: 'onboarding.tour_skipped',
} as const
