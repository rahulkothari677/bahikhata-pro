-- Migration: Add lockedUntil to Setting for financial-year / period lock
-- V17-Ext 5.1: Once a month's GST is filed, that period must become
-- read-only. Without this, any past transaction is editable forever.
-- Adds a nullable lockedUntil column to Setting. When set, no writes
-- are allowed to transactions or payments dated on or before lockedUntil.
-- null = no lock (the default, every existing shop starts unlocked).
-- Idempotent: uses ADD COLUMN IF NOT EXISTS so re-running is safe.

ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);
