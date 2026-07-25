-- 🐛 INTEGRATION PHASE D.3 (2026-07-25): Impersonation flow.
--
-- The separate bahikhata-admin app's /api/admin/impersonate endpoint generates
-- a one-time token and returns a URL to ${MAIN_APP_URL}/api/auth/impersonate.
-- This table stores the token hash so the main app's consumer endpoint can:
--   1. Validate the token (via crypto.timingSafeEqual against tokenHash)
--   2. Check expiry (expiresAt > now)
--   3. Enforce single-use (usedAt IS NULL → set usedAt = now() on redemption)
--   4. Bind the session to the exact targetUserId (no token replay)
--
-- Security:
--   - Only the SHA-256 hash is stored (not the raw token) — DB compromise
--     doesn't reveal usable tokens
--   - 5-minute expiry (expiresAt)
--   - Single-use (usedAt) — a redeemed token can't be replayed
--   - Admin + target are both logged for full audit trail

CREATE TABLE "ImpersonationToken" (
    "id"            TEXT NOT NULL,
    "tokenHash"     TEXT NOT NULL,
    "adminId"       TEXT NOT NULL,
    "adminEmail"    TEXT NOT NULL,
    "targetUserId"  TEXT NOT NULL,
    "expiresAt"     TIMESTAMP(3) NOT NULL,
    "usedAt"        TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationToken_pkey" PRIMARY KEY ("id")
);

-- Unique index: tokenHash is the lookup key (one token = one row).
-- A redeemed token's row stays in the table (for audit) but usedAt is set,
-- so the consumer endpoint's WHERE clause (usedAt IS NULL) excludes it.
CREATE UNIQUE INDEX "ImpersonationToken_tokenHash_key" ON "ImpersonationToken"("tokenHash");

-- Lookup by target user (for "show me all impersonations of user X" queries).
CREATE INDEX "ImpersonationToken_targetUserId_idx" ON "ImpersonationToken"("targetUserId");

-- Lookup by admin (for "show me all impersonations by admin Y" queries).
CREATE INDEX "ImpersonationToken_adminId_idx" ON "ImpersonationToken"("adminId");

-- Lookup by expiry (for cleanup jobs that delete expired tokens).
CREATE INDEX "ImpersonationToken_expiresAt_idx" ON "ImpersonationToken"("expiresAt");
