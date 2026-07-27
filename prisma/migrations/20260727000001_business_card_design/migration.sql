-- 🐛 UI/UX Phase 2: Business card redesign fields.
--
-- cardDesign: stores the user's chosen design ID from the design registry
--   (src/lib/business-card-designs.ts). null = default design ("saffron-classic").
--
-- cardSlug: a unique URL-safe slug for the public business card page
--   (/card/[slug]). null = no public card. Auto-generated from shopName on
--   first card view if not set. Unique constraint prevents slug collisions.

ALTER TABLE "Setting" ADD COLUMN "cardDesign" TEXT;
ALTER TABLE "Setting" ADD COLUMN "cardSlug" TEXT;

-- Unique index for cardSlug (allows multiple NULLs — standard SQL behavior)
CREATE UNIQUE INDEX "Setting_cardSlug_key" ON "Setting"("cardSlug");
