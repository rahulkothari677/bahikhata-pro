-- 9c-4 (#123): a counter return's recipient address (Rule 53(1A)). Additive, nullable.
ALTER TABLE "Transaction" ADD COLUMN "payeeAddress" TEXT;
