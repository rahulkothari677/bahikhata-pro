-- A typeface per element of the business card, not one for the whole card.
--
-- Rahul: "when they choose for shop name only shop name fonts should be
-- changed. when they choose for tagline then it should change the tagline."
-- One column could not express a copperplate monogram over a plain, readable
-- address, which is what a real card does.
--
-- cardFontId (already present) stays as the LOGO/monogram face so existing
-- rows keep the mark their owner chose.
--
-- Additive and nullable: no row is rewritten, and NULL means "keep the app's
-- default face for this element", which is exactly today's appearance.

ALTER TABLE "Setting" ADD COLUMN "cardShopFontId"    TEXT;
ALTER TABLE "Setting" ADD COLUMN "cardTaglineFontId" TEXT;
ALTER TABLE "Setting" ADD COLUMN "cardContactFontId" TEXT;
