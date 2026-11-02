-- #353: 2B bill rows keep whether credit is available (itcavl) and why not (rsn).
-- Additive with defaults: existing rows read as available, as before.
ALTER TABLE "Gstr2bInvoice" ADD COLUMN "itcAvailable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Gstr2bInvoice" ADD COLUMN "itcReason" TEXT;
