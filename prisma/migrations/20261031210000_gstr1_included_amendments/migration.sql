-- #103 (Phase 8c): corrections to earlier filed returns switched ON for this month
-- ({ "b2b:INV-0003": "<fingerprint>" }). Additive and nullable: no existing row changes.
ALTER TABLE "Gstr1Snapshot" ADD COLUMN "includedAmendments" JSONB;
