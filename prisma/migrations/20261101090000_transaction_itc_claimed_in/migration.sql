-- #117 (Phase 8d): the GSTR-3B period (MMYYYY) whose filing claimed a purchase's input credit.
-- Additive and nullable: every existing row stays NULL (= not yet claimed).
ALTER TABLE "Transaction" ADD COLUMN "itcClaimedIn" TEXT;
