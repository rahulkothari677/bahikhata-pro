-- Migration: Add upiId to Setting for UPI collection links
-- V17-Ext 5.4: The shopkeeper's UPI VPA (e.g. shop@paytm, 9876543210@ybl).
-- Used to generate upi://pay?pa=... deep-links in WhatsApp udhaar reminders.
-- null = no UPI ID configured (the reminder sends without a pay link).
-- Idempotent: uses ADD COLUMN IF NOT EXISTS.

ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "upiId" TEXT;
