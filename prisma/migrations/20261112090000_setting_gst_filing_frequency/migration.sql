-- 9b-1 (#106): monthly or quarterly (QRMP) filing. Additive; NULL = not answered = monthly, as before.
ALTER TABLE "Setting" ADD COLUMN "gstFilingFrequency" TEXT;
