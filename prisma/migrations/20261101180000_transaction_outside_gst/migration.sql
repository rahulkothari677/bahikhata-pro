-- #351 (Phase 8f): a discount credit note given after the s.34(2) date carries
-- no GST and is left out of every GST return (GSTR-1, 3B, 4, CMP-08), while
-- still lowering the customer's khata and the shop's sales.
-- Additive, NOT NULL with a default: every existing row becomes false (unchanged).
ALTER TABLE "Transaction" ADD COLUMN "outsideGst" BOOLEAN NOT NULL DEFAULT false;
