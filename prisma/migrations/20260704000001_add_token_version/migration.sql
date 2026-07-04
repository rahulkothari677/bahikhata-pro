-- Migration: Add tokenVersion column to User table
-- Audit fix Phase 3.3: JWT revocation via tokenVersion
--
-- This column stores an integer that is embedded in every JWT at login.
-- The jwt callback in auth.ts checks (once per 5 min) that the JWT's
-- tokenVersion matches the DB's value. If they differ, the session is
-- treated as logged out.
--
-- Bumping tokenVersion (via increment) invalidates ALL existing JWTs for
-- that user — used for "logout all devices", password reset, and admin
-- force-logout.
--
-- Default 0 means all existing users start at version 0 (no existing JWTs
-- are invalidated until the user re-logs in or someone bumps the version).

ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
