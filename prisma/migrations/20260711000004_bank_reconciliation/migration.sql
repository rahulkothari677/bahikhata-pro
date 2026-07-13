-- V17 Audit Phase 6: Bank Reconciliation — BankStatement + BankTransaction models

-- BankStatement: header for an imported bank statement
CREATE TABLE IF NOT EXISTS "BankStatement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT,
    "statementPeriod" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalCredits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDebits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "txnCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "rawCsv" TEXT,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BankStatement_userId_importedAt_idx"
  ON "BankStatement"("userId", "importedAt");

ALTER TABLE "BankStatement"
  ADD CONSTRAINT "BankStatement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE;

-- BankTransaction: individual transactions from a bank statement
CREATE TABLE IF NOT EXISTS "BankTransaction" (
    "id" TEXT NOT NULL,
    "bankStatementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balance" DOUBLE PRECISION,
    "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "matchedPaymentId" TEXT,
    "matchedTransactionId" TEXT,
    "matchMethod" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BankTransaction_userId_date_idx"
  ON "BankTransaction"("userId", "date");

CREATE INDEX IF NOT EXISTS "BankTransaction_bankStatementId_idx"
  ON "BankTransaction"("bankStatementId");

CREATE INDEX IF NOT EXISTS "BankTransaction_matchStatus_idx"
  ON "BankTransaction"("matchStatus");

ALTER TABLE "BankTransaction"
  ADD CONSTRAINT "BankTransaction_bankStatementId_fkey"
  FOREIGN KEY ("bankStatementId") REFERENCES "BankStatement"("id")
  ON DELETE CASCADE;

ALTER TABLE "BankTransaction"
  ADD CONSTRAINT "BankTransaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE;

ALTER TABLE "BankTransaction"
  ADD CONSTRAINT "BankTransaction_matchedPaymentId_fkey"
  FOREIGN KEY ("matchedPaymentId") REFERENCES "Payment"("id")
  ON DELETE SET NULL;

ALTER TABLE "BankTransaction"
  ADD CONSTRAINT "BankTransaction_matchedTransactionId_fkey"
  FOREIGN KEY ("matchedTransactionId") REFERENCES "Transaction"("id")
  ON DELETE SET NULL;
