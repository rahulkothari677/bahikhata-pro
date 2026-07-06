-- 🔒 V10 §2.2: Add per-item CGST/SGST/IGST columns to TransactionItem.
--
-- WHY: Previously only the Transaction header stored cgst/sgst/igst as summed
-- totals. Reports/GSTR recomputed GST in SQL using a different rounding path
-- (ROUND(x::numeric, 2) vs the server's roundMoney with 1e-9 epsilon) → for
-- any invoice whose GST is an odd number of paise, the stored split (e.g.
-- CGST 4.51 / SGST 4.50) disagreed with the recomputed split (CGST 4.51 /
-- SGST 4.51). A CA reconciling slab totals against the return summary would
-- see the mismatch.
--
-- FIX: Make the per-item stored values the single source of truth. Every code
-- path (POST, PUT, reports, GSTR, dashboard, invoice PDF) aggregates these
-- stored per-item values — never recomputes GST from (taxable × rate) in SQL.
--
-- The backfill recomputes the per-item CGST/SGST/IGST from each existing
-- TransactionItem using the SAME formula the server uses at write time:
--   taxable = (quantity * unitPrice) - discountAmount
--   gst     = ROUND(taxable * gstRate / 100, 2)
--   cgst    = ROUND(gst / 2, 2)                  -- intra-state only
--   sgst    = gst - cgst                          -- intra-state only (ensures cgst+sgst == gst exactly)
--   igst    = gst                                 -- inter-state only
--
-- Note: existing items all have discountAmount = 0 (the UI previously sent
-- the order-level discount as a separate field and never populated per-item
-- discount), so this backfill is equivalent to "gst on full pre-discount
-- amount" — which is the same (buggy) behavior the app had before V10 §2.1.
-- A separate one-time recompute migration script (run by the founder) will
-- fix existing discounted invoices by re-applying the order-level discount
-- proportionally across items. See scripts/v10-recompute-discounted-invoices.ts.

-- 1. Add the three new columns with safe defaults
ALTER TABLE "TransactionItem" ADD COLUMN "cgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "TransactionItem" ADD COLUMN "sgst" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "TransactionItem" ADD COLUMN "igst" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 2. Backfill from existing data using the server's write-time formula.
--    PostgreSQL ROUND(numeric, 2) is "round half away from zero" which matches
--    the server's roundMoney() (the 1e-9 epsilon only matters for float repr
--    edge cases like 1.005; for sum/aggregate backfill on existing rows the
--    numeric ROUND is the correct deterministic behavior).
UPDATE "TransactionItem" ti
SET
  "cgst" = sub.cgst,
  "sgst" = sub.sgst,
  "igst" = sub.igst
FROM (
  SELECT
    ti2.id,
    CASE
      WHEN t."isInterState" THEN 0
      ELSE ROUND(
        ROUND(
          (ti2."quantity" * ti2."unitPrice" - COALESCE(ti2."discountAmount", 0))::numeric
            * ti2."gstRate"::numeric / 100::numeric,
          2
        ) / 2,
        2
      )
    END AS cgst,
    CASE
      WHEN t."isInterState" THEN 0
      ELSE
        ROUND(
          (ti2."quantity" * ti2."unitPrice" - COALESCE(ti2."discountAmount", 0))::numeric
            * ti2."gstRate"::numeric / 100::numeric,
          2
        )
        -
        ROUND(
          ROUND(
            (ti2."quantity" * ti2."unitPrice" - COALESCE(ti2."discountAmount", 0))::numeric
              * ti2."gstRate"::numeric / 100::numeric,
            2
          ) / 2,
          2
        )
    END AS sgst,
    CASE
      WHEN t."isInterState" THEN
        ROUND(
          (ti2."quantity" * ti2."unitPrice" - COALESCE(ti2."discountAmount", 0))::numeric
            * ti2."gstRate"::numeric / 100::numeric,
          2
        )
      ELSE 0
    END AS igst
  FROM "TransactionItem" ti2
  JOIN "Transaction" t ON ti2."transactionId" = t.id
) sub
WHERE ti.id = sub.id;
