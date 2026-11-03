-- 9a-2: the shop's answers about 2B documents ("same bill", "different bills",
-- "not mine"), kept by supplier GSTIN + document number. New table only.
CREATE TABLE "Gstr2bDecision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplierGstin" TEXT NOT NULL,
    "docType" TEXT NOT NULL DEFAULT 'invoice',
    "documentNumber" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gstr2bDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Gstr2bDecision_doc_answer_key"
  ON "Gstr2bDecision"("userId", "supplierGstin", "docType", "documentNumber", "decision", "purchaseId");
CREATE INDEX "Gstr2bDecision_userId_idx" ON "Gstr2bDecision"("userId");

ALTER TABLE "Gstr2bDecision" ADD CONSTRAINT "Gstr2bDecision_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
