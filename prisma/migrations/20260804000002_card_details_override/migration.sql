-- 🎨 Card details, held separately from the shop's profile.
--
-- The profile is the shop's LEGAL identity (the name and address that go on a
-- GST invoice); the card is marketing. A shopkeeper must be able to put a
-- trading name and a mobile number on the card without falsifying the invoice.
--
-- Purely additive and safe on a live table: every column is nullable or has a
-- default, so no row is rewritten and no existing read or write can break.
-- Existing shops land on cardMode='profile', which is exactly today's
-- behaviour — the card tracks the profile.

ALTER TABLE "Setting" ADD COLUMN "cardMode"      TEXT NOT NULL DEFAULT 'profile';
ALTER TABLE "Setting" ADD COLUMN "cardFontId"    TEXT;
ALTER TABLE "Setting" ADD COLUMN "cardShopName"  TEXT;
ALTER TABLE "Setting" ADD COLUMN "cardOwnerName" TEXT;
ALTER TABLE "Setting" ADD COLUMN "cardTagline"   TEXT;
ALTER TABLE "Setting" ADD COLUMN "cardPhone"     TEXT;
ALTER TABLE "Setting" ADD COLUMN "cardEmail"     TEXT;
ALTER TABLE "Setting" ADD COLUMN "cardAddress"   TEXT;
ALTER TABLE "Setting" ADD COLUMN "cardGstin"     TEXT;
