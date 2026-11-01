-- #335: Setting.priorFyTurnover holds a YEAR of sales in paise. INTEGER tops out
-- at 2,147,483,647 paise = ₹2.15 crore, so a shop above that could not save its
-- turnover — exactly the shops the ₹5 crore HSN and e-invoice rules are about.
-- BIGINT holds any real turnover. Widening is lossless; every value is kept.
ALTER TABLE "Setting" ALTER COLUMN "priorFyTurnover" SET DATA TYPE BIGINT;
