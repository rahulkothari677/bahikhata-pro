-- 🔒 Break-glass emergency access (master report §C4).
--
-- The admin panel is deliberately strict: role checks re-read from the
-- database on every request, step-up TOTP before sensitive actions, sessions
-- revocable by tokenVersion. That strictness is exactly WHY an emergency path
-- is needed — and why it must be impossible to use quietly.
--
-- Every session carries a written reason, a hard expiry, and a critical audit
-- entry. `approvedBy` is nullable on purpose: the "I am the only founder at
-- 3am" case is legitimate, but recording it as NULL makes self-approved
-- sessions countable rather than invisible.
--
-- SAFETY: one new table, no changes to existing ones. No CREATE INDEX
-- CONCURRENTLY, which cannot run inside the transaction Prisma wraps each
-- migration in — that combination caused this project's V12 outage.

CREATE TABLE "BreakGlassSession" (
    "id"         TEXT NOT NULL,
    "adminId"    TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "reason"     TEXT NOT NULL,
    "approvedBy" TEXT,
    "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "revokedAt"  TIMESTAMP(3),
    "revokedBy"  TEXT,

    CONSTRAINT "BreakGlassSession_pkey" PRIMARY KEY ("id")
);

-- "is a break-glass session active right now" is asked on every admin page
-- load, so the banner cannot be missed. That makes it the hot path.
CREATE INDEX "BreakGlassSession_expiresAt_revokedAt_idx"
  ON "BreakGlassSession"("expiresAt", "revokedAt");

-- "what has this operator done" — the review query.
CREATE INDEX "BreakGlassSession_adminId_startedAt_idx"
  ON "BreakGlassSession"("adminId", "startedAt");
