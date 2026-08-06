-- The shop's invoice look.
--
-- One theme drives all three surfaces a bill reaches — the WhatsApp picture,
-- the public link page and the PDF — so a shop that picks "Emerald" does not
-- end up with an invoice and a payment page that look like two businesses.
--
-- Additive with a default, so every existing shop keeps exactly the appearance
-- it has today.
ALTER TABLE "Setting" ADD COLUMN "invoiceTheme" TEXT NOT NULL DEFAULT 'classic';
