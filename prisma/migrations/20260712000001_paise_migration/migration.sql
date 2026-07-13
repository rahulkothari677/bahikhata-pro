-- V18 Paise Migration: Float → Int for all money columns
--
-- This migration changes 73 money columns from Float (rupees) to Int (paise).
-- Existing data is converted by multiplying by 100 (rupees → paise).
--
-- Non-money Float columns (gstRate, quantity, currentStock, etc.) are NOT changed.
--
-- The Prisma client extension (src/lib/prisma-money-extension.ts) auto-converts
-- at the DB boundary: paise (Int in DB) ↔ rupees (Float in JS). This means all
-- existing application code continues to work with rupee values.

-- ─── Product ───────────────────────────────────────────────────────────────
ALTER TABLE "Product" ALTER COLUMN "purchasePrice" TYPE INTEGER USING ROUND("purchasePrice" * 100);
ALTER TABLE "Product" ALTER COLUMN "salePrice" TYPE INTEGER USING ROUND("salePrice" * 100);
ALTER TABLE "Product" ALTER COLUMN "mrp" TYPE INTEGER USING ROUND("mrp" * 100);

-- ─── Party ─────────────────────────────────────────────────────────────────
ALTER TABLE "Party" ALTER COLUMN "openingBalance" TYPE INTEGER USING ROUND("openingBalance" * 100);

-- ─── Transaction ───────────────────────────────────────────────────────────
ALTER TABLE "Transaction" ALTER COLUMN "subtotal" TYPE INTEGER USING ROUND("subtotal" * 100);
ALTER TABLE "Transaction" ALTER COLUMN "discountAmount" TYPE INTEGER USING ROUND("discountAmount" * 100);
ALTER TABLE "Transaction" ALTER COLUMN "cgst" TYPE INTEGER USING ROUND("cgst" * 100);
ALTER TABLE "Transaction" ALTER COLUMN "sgst" TYPE INTEGER USING ROUND("sgst" * 100);
ALTER TABLE "Transaction" ALTER COLUMN "igst" TYPE INTEGER USING ROUND("igst" * 100);
ALTER TABLE "Transaction" ALTER COLUMN "totalAmount" TYPE INTEGER USING ROUND("totalAmount" * 100);
ALTER TABLE "Transaction" ALTER COLUMN "roundOff" TYPE INTEGER USING ROUND("roundOff" * 100);
ALTER TABLE "Transaction" ALTER COLUMN "paidAmount" TYPE INTEGER USING ROUND("paidAmount" * 100);
ALTER TABLE "Transaction" ALTER COLUMN "grossProfit" TYPE INTEGER USING ROUND("grossProfit" * 100);

-- ─── TransactionItem ──────────────────────────────────────────────────────
ALTER TABLE "TransactionItem" ALTER COLUMN "unitPrice" TYPE INTEGER USING ROUND("unitPrice" * 100);
ALTER TABLE "TransactionItem" ALTER COLUMN "purchasePriceAtSale" TYPE INTEGER USING ROUND("purchasePriceAtSale" * 100);
ALTER TABLE "TransactionItem" ALTER COLUMN "discountAmount" TYPE INTEGER USING ROUND("discountAmount" * 100);
ALTER TABLE "TransactionItem" ALTER COLUMN "cgst" TYPE INTEGER USING ROUND("cgst" * 100);
ALTER TABLE "TransactionItem" ALTER COLUMN "sgst" TYPE INTEGER USING ROUND("sgst" * 100);
ALTER TABLE "TransactionItem" ALTER COLUMN "igst" TYPE INTEGER USING ROUND("igst" * 100);
ALTER TABLE "TransactionItem" ALTER COLUMN "csamt" TYPE INTEGER USING ROUND("csamt" * 100);
ALTER TABLE "TransactionItem" ALTER COLUMN "total" TYPE INTEGER USING ROUND("total" * 100);

-- ─── Payment ───────────────────────────────────────────────────────────────
ALTER TABLE "Payment" ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount" * 100);

-- ─── Subscription ──────────────────────────────────────────────────────────
ALTER TABLE "Subscription" ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount" * 100);

-- ─── GstReturn (27 money columns) ─────────────────────────────────────────
ALTER TABLE "GstReturn" ALTER COLUMN "outwardTaxableValue" TYPE INTEGER USING ROUND("outwardTaxableValue" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "outwardCgst" TYPE INTEGER USING ROUND("outwardCgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "outwardSgst" TYPE INTEGER USING ROUND("outwardSgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "outwardIgst" TYPE INTEGER USING ROUND("outwardIgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "rcmTaxableValue" TYPE INTEGER USING ROUND("rcmTaxableValue" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "rcmCgst" TYPE INTEGER USING ROUND("rcmCgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "rcmSgst" TYPE INTEGER USING ROUND("rcmSgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "rcmIgst" TYPE INTEGER USING ROUND("rcmIgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "nilRatedValue" TYPE INTEGER USING ROUND("nilRatedValue" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "exemptValue" TYPE INTEGER USING ROUND("exemptValue" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "nonGstValue" TYPE INTEGER USING ROUND("nonGstValue" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "itcTaxableValue" TYPE INTEGER USING ROUND("itcTaxableValue" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "itcCgst" TYPE INTEGER USING ROUND("itcCgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "itcSgst" TYPE INTEGER USING ROUND("itcSgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "itcIgst" TYPE INTEGER USING ROUND("itcIgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "creditNoteTaxableValue" TYPE INTEGER USING ROUND("creditNoteTaxableValue" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "creditNoteCgst" TYPE INTEGER USING ROUND("creditNoteCgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "creditNoteSgst" TYPE INTEGER USING ROUND("creditNoteSgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "creditNoteIgst" TYPE INTEGER USING ROUND("creditNoteIgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "debitNoteTaxableValue" TYPE INTEGER USING ROUND("debitNoteTaxableValue" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "debitNoteCgst" TYPE INTEGER USING ROUND("debitNoteCgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "debitNoteSgst" TYPE INTEGER USING ROUND("debitNoteSgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "debitNoteIgst" TYPE INTEGER USING ROUND("debitNoteIgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "exemptInwardValue" TYPE INTEGER USING ROUND("exemptInwardValue" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "interstateB2cTaxableValue" TYPE INTEGER USING ROUND("interstateB2cTaxableValue" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "interstateB2cIgst" TYPE INTEGER USING ROUND("interstateB2cIgst" * 100);
ALTER TABLE "GstReturn" ALTER COLUMN "netTaxPayable" TYPE INTEGER USING ROUND("netTaxPayable" * 100);

-- ─── Gstr1Snapshot ─────────────────────────────────────────────────────────
ALTER TABLE "Gstr1Snapshot" ALTER COLUMN "totalOutputTax" TYPE INTEGER USING ROUND("totalOutputTax" * 100);
ALTER TABLE "Gstr1Snapshot" ALTER COLUMN "totalTaxableValue" TYPE INTEGER USING ROUND("totalTaxableValue" * 100);

-- ─── BankStatement ─────────────────────────────────────────────────────────
ALTER TABLE "BankStatement" ALTER COLUMN "totalCredits" TYPE INTEGER USING ROUND("totalCredits" * 100);
ALTER TABLE "BankStatement" ALTER COLUMN "totalDebits" TYPE INTEGER USING ROUND("totalDebits" * 100);

-- ─── BankTransaction ───────────────────────────────────────────────────────
ALTER TABLE "BankTransaction" ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount" * 100);
ALTER TABLE "BankTransaction" ALTER COLUMN "balance" TYPE INTEGER USING ROUND("balance" * 100);

-- ─── Gstr2bImport ──────────────────────────────────────────────────────────
ALTER TABLE "Gstr2bImport" ALTER COLUMN "taxableTotal" TYPE INTEGER USING ROUND("taxableTotal" * 100);
ALTER TABLE "Gstr2bImport" ALTER COLUMN "igstTotal" TYPE INTEGER USING ROUND("igstTotal" * 100);
ALTER TABLE "Gstr2bImport" ALTER COLUMN "cgstTotal" TYPE INTEGER USING ROUND("cgstTotal" * 100);
ALTER TABLE "Gstr2bImport" ALTER COLUMN "sgstTotal" TYPE INTEGER USING ROUND("sgstTotal" * 100);

-- ─── Gstr2bInvoice ─────────────────────────────────────────────────────────
ALTER TABLE "Gstr2bInvoice" ALTER COLUMN "taxableValue" TYPE INTEGER USING ROUND("taxableValue" * 100);
ALTER TABLE "Gstr2bInvoice" ALTER COLUMN "igst" TYPE INTEGER USING ROUND("igst" * 100);
ALTER TABLE "Gstr2bInvoice" ALTER COLUMN "cgst" TYPE INTEGER USING ROUND("cgst" * 100);
ALTER TABLE "Gstr2bInvoice" ALTER COLUMN "sgst" TYPE INTEGER USING ROUND("sgst" * 100);
ALTER TABLE "Gstr2bInvoice" ALTER COLUMN "totalAmount" TYPE INTEGER USING ROUND("totalAmount" * 100);

-- ─── AiUsageLog ────────────────────────────────────────────────────────────
ALTER TABLE "AiUsageLog" ALTER COLUMN "costInr" TYPE INTEGER USING ROUND("costInr" * 100);

-- ─── DailyStats ────────────────────────────────────────────────────────────
ALTER TABLE "DailyStats" ALTER COLUMN "mrr" TYPE INTEGER USING ROUND("mrr" * 100);
ALTER TABLE "DailyStats" ALTER COLUMN "newMrr" TYPE INTEGER USING ROUND("newMrr" * 100);
ALTER TABLE "DailyStats" ALTER COLUMN "churnedMrr" TYPE INTEGER USING ROUND("churnedMrr" * 100);
ALTER TABLE "DailyStats" ALTER COLUMN "arr" TYPE INTEGER USING ROUND("arr" * 100);
ALTER TABLE "DailyStats" ALTER COLUMN "totalGmv" TYPE INTEGER USING ROUND("totalGmv" * 100);
ALTER TABLE "DailyStats" ALTER COLUMN "aiCostInr" TYPE INTEGER USING ROUND("aiCostInr" * 100);

-- ─── RevenueSchedule ───────────────────────────────────────────────────────
ALTER TABLE "RevenueSchedule" ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount" * 100);
