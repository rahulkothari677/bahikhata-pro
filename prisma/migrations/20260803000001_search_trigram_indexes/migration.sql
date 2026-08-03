-- 🔒 Ledger search: make substring matching index-backed.
--
-- CONTEXT. Server-side ledger search shipped 2026-08-03. GET /api/transactions
-- matches `contains` across Transaction.invoiceNo, Transaction.notes,
-- Party.name and Party.phone, ANDed inside the userId scope and capped at 50
-- rows per page.
--
-- THE PROBLEM. `contains` compiles to LIKE '%term%'. A leading wildcard means
-- NO btree index can serve it — not even the existing
-- @@unique([userId, invoiceNo]). Postgres narrows by userId, then sequentially
-- scans that shop's slice and joins Party for the name/phone arms.
--
-- MEASURED FIRST, on the live app with ~200 transactions:
--     no search (baseline)   440ms median
--     search by invoice      300ms median
--     search by party name   327ms median
-- i.e. no measurable cost at this size; the time is network and Neon
-- cold-start, not the query. So this migration is NOT fixing an observed
-- slowdown.
--
-- WHY ADD IT ANYWAY, NOW. The cost of creating these indexes scales with table
-- size. On today's tables it is instant. On a shop with a few hundred thousand
-- invoices it becomes a maintenance operation needing CREATE INDEX CONCURRENTLY
-- and a watchful eye. Adding it while the tables are small is the cheap moment,
-- and search is a daily task that gets slower exactly as a business succeeds.
--
-- THE TRADE-OFF, STATED. GIN trigram indexes are not free: every INSERT and
-- UPDATE to these columns must also update the index, and they are larger than
-- btree. For a ledger the read pattern (search on demand) is worth it, but this
-- is a real write cost, not a pure win.
--
-- IF THIS EVER NEEDS REVERTING: dropping the indexes restores the previous
-- behaviour exactly — the query does not depend on them, only its speed does.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Transaction.invoiceNo — the most common search ("find that bill").
CREATE INDEX IF NOT EXISTS "Transaction_invoiceNo_trgm_idx"
  ON "Transaction" USING GIN ("invoiceNo" gin_trgm_ops);

-- Transaction.notes — free text, so substring search is the only option.
CREATE INDEX IF NOT EXISTS "Transaction_notes_trgm_idx"
  ON "Transaction" USING GIN ("notes" gin_trgm_ops);

-- Party.name — searching the ledger by customer name goes through a join.
CREATE INDEX IF NOT EXISTS "Party_name_trgm_idx"
  ON "Party" USING GIN ("name" gin_trgm_ops);

-- Party.phone — shopkeepers look a customer up by number as often as by name.
CREATE INDEX IF NOT EXISTS "Party_phone_trgm_idx"
  ON "Party" USING GIN ("phone" gin_trgm_ops);
