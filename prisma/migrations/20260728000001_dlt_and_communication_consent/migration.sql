-- 🔒 TRAI TCCCPR / DPDP consent (audit 2026-07-28, master report §B6).
--
-- The admin panel can message every shopkeeper in the product. That is
-- commercial communication and it is regulated, but nothing in the send path
-- checked any of it: a promotional SMS blast at 2am, to users who never opted
-- in, on an unregistered template, was three clicks away.
--
-- This migration adds the columns that make the check possible. The
-- enforcement lives in src/lib/comms-compliance.ts.
--
-- SAFETY: every change here is additive. Two nullable columns and one column
-- with a default (Postgres 11+ stores a default in the catalogue rather than
-- rewriting the table), plus a new table. No existing row is touched and no
-- lock is held long enough to matter. There is no CREATE INDEX CONCURRENTLY,
-- which cannot run inside the transaction Prisma wraps each migration in —
-- that combination caused this project's V12 outage.

-- ── DLT registration on notification templates ───────────────────────────────
-- Null for transactional and service templates. Those are contract performance
-- (payment receipts, password resets) and are deliberately NOT gated: gating
-- them would break the messages users actually need, and would get the whole
-- compliance layer removed by whoever is on call.
ALTER TABLE "NotificationTemplate"
  ADD COLUMN "dltTemplateId"  TEXT,
  ADD COLUMN "dltHeaderId"    TEXT,
  ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'pending';

-- ── Per-user messaging consent ───────────────────────────────────────────────
-- The ABSENCE of a row means no promotional consent. Silence is not opt-in
-- under DPDP, so this table only ever grants permission, never assumes it.
--
-- `source` exists to evidence double opt-in: a consent record that cannot say
-- where it came from is not much of a record if anyone asks.
CREATE TABLE "CommunicationPreference" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "channel"    TEXT NOT NULL,
    "category"   TEXT NOT NULL,
    "optedIn"    BOOLEAN NOT NULL DEFAULT false,
    "source"     TEXT,
    "optedInAt"  TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationPreference_pkey" PRIMARY KEY ("id")
);

-- One row per user per channel per category. The unique constraint is what
-- makes an upsert safe: recording consent twice must not create two rows that
-- disagree about whether the person opted in.
CREATE UNIQUE INDEX "CommunicationPreference_userId_channel_category_key"
  ON "CommunicationPreference"("userId", "channel", "category");

CREATE INDEX "CommunicationPreference_userId_idx"
  ON "CommunicationPreference"("userId");
