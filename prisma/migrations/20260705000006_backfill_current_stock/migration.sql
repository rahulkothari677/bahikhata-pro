-- Migration: Backfill currentStock from transaction history
-- Audit fix N2/N8: Make currentStock the single source of truth
--
-- The previous migration (20260705000002) set currentStock = openingStock,
-- which doesn't account for any historical transactions. This migration
-- recomputes currentStock correctly:
--   currentStock = openingStock + Σ(purchase quantities) - Σ(sale quantities)
-- where transactions are NOT soft-deleted (deletedAt IS NULL).
--
-- After this backfill, the app reads currentStock directly instead of
-- re-deriving it from transaction items on every page load (O(N) → O(1)).

UPDATE "Product" SET "currentStock" = "openingStock" + COALESCE(
  (SELECT SUM(ti.quantity)
   FROM "TransactionItem" ti
   JOIN "Transaction" t ON ti."transactionId" = t.id
   WHERE ti."productId" = "Product"."id"
     AND t.type = 'purchase'
     AND t."deletedAt" IS NULL
  ), 0
) - COALESCE(
  (SELECT SUM(ti.quantity)
   FROM "TransactionItem" ti
   JOIN "Transaction" t ON ti."transactionId" = t.id
   WHERE ti."productId" = "Product"."id"
     AND t.type = 'sale'
     AND t."deletedAt" IS NULL
  ), 0
);
