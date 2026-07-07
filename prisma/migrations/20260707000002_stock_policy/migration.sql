-- 🔒 V11 STOCK POLICY: Add Setting.stockPolicy column.
--
-- WHY: The app previously allowed sales to push stock below 0 with only a
-- post-hoc warning (V5 MD design). The user wants the default to BLOCK
-- overselling, with a per-shop toggle to allow it (kirana workflow:
-- sell first, record purchase later).
--
-- Values:
--   'block' (default) — sale is REJECTED if it would push stock negative.
--   'allow'            — sale goes through with a warning.
--
-- The column is added with NOT NULL DEFAULT 'block' so all existing settings
-- rows get the strict policy. New users also get 'block' by default. Users
-- can toggle to 'allow' in Settings.

ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "stockPolicy" TEXT NOT NULL DEFAULT 'block';
