-- Migration: Add lockedUntil to Setting for financial-year / period lock
-- 🔒 V17-Ext §5.1: Once a month's GST is filed, that period must become
-- read-only (no edits/deletes to transactions dated before the lock date).
-- This is a compliance and dispute defense — without it, any past transaction
-- is editable forever, which means filed GST returns can be silently altered.
--
-- Adds a nullable lockedUntil column to Setting. When set, NO writes
(create/
-- edit / delete / restore) are allowed to transactions or payments dated
-- on or before lockedUntil. null = no lock (the default — every existing
-- shop starts unlocked, so this is a pure additive change with zero impact
-- on existing behavior).
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS so re-running is safe.

ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);
