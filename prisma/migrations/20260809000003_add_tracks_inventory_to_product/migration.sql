-- Does this product have a stock level at all?
--
-- WHY. The app assumed every product was a countable good. It is not: a tailor
-- sells "Blouse stitching", a salon sells "Haircut", a photographer sells a
-- "Wedding shoot", a tutor sells an hour. None of those has a quantity in a
-- godown, and none of them can be purchased into existence.
--
-- This was not a cosmetic wrong number. The default stock policy is 'block',
-- so a service product sat at currentStock = 0, every sale of it read as
-- overselling, and the shop's FIRST EVER INVOICE was refused outright with
-- "Not enough stock - record a purchase or enable overselling in Settings".
-- Neither escape works: there is no purchase to record, and disabling
-- overselling protection shop-wide throws away the guard on any real goods the
-- same shop sells. An entire class of business could not use the app.
--
-- DEFAULT TRUE, AND NOT NULL. Every row that exists today is a good - a
-- service could not be sold at all before this - so the default preserves
-- current behaviour exactly and no backfill is needed. NOT NULL is deliberate:
-- a nullable flag would make "unknown" a third state that every one of the
-- five stock write paths would have to interpret, and they would eventually
-- interpret it differently. One meaning, decided here.
--
-- The read side is lib/inventory-tracking.ts, which is the ONLY place that
-- decides what this column means; a guard test fails the build if a stock
-- write appears anywhere that does not consult it.
ALTER TABLE "Product" ADD COLUMN "tracksInventory" BOOLEAN NOT NULL DEFAULT true;

-- Products already carrying a SAC code are services by definition: every SAC
-- begins 99 and goods HSN chapters run 01-98. These rows were entered by
-- someone describing a service the app then refused to sell, so flipping them
-- is a correction, not a guess.
--
-- Narrowed to rows that never moved (currentStock = 0 AND openingStock = 0).
-- If a product has stock, someone is genuinely counting it whatever its code
-- says, and stranding that count would be worse than a mislabelled row.
UPDATE "Product"
SET "tracksInventory" = false
WHERE "hsn" ~ '^99[0-9]{2,6}$'
  AND "currentStock" = 0
  AND "openingStock" = 0;
