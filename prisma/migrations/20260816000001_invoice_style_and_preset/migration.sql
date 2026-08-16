-- Phase 7c: design is three choices, not one.
--
-- invoiceTemplate already holds the LAYOUT. These add the other two axes:
-- STYLE (how blocks are dressed) and the PRESET shortcut that writes all
-- three at once.
--
-- Additive only, both nullable. A shop that never opens the picker resolves
-- to the defaults and its bill is byte-identical to yesterday's.

ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "invoiceStyle"  TEXT;
ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "invoicePreset" TEXT;
