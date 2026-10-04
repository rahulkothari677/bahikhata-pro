-- Each bill keeps its place of supply, and where the goods were sent (#114).
--
-- placeOfSupply: the 2-digit state code decided when the bill was saved. GSTR-1,
-- e-invoice and the printed bill used to work it out again from the party's
-- CURRENT state, so editing a party moved an issued bill's place of supply
-- while its CGST/SGST/IGST stayed put.
-- deliveryState / deliveryAddress: goods couriered to another state. IGST Act
-- s.10(1)(a) and (ca) with Circular 209/3/2024-GST: the delivery state is the
-- place of supply; Rule 46(o): the bill shows the delivery address.
--
-- Nullable and not backfilled: older bills fall back to the rule in
-- billPlaceOfSupply() (lib/gst-states.ts). IF NOT EXISTS so a retried deploy
-- cannot fail on the second run.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "placeOfSupply" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "deliveryState" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "deliveryAddress" TEXT;
