-- The shop's own payment QR, as an uploaded image.
--
-- Additive only: one nullable column. Nothing is renamed and nothing is
-- removed. In particular `docShareLink` and the BillShare table are left
-- exactly as they are, even though the shareable bill link was withdrawn in
-- the same change — a shopkeeper's minted links are their record, and a
-- feature being removed is not a reason to erase their rows.

ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "paymentQrUrl" TEXT;
