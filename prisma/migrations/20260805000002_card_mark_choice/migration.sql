-- Which mark the business card prints: the uploaded logo, or the initials.
--
-- The artwork has one slot for a mark, so this is either/or. It is a CARD-ONLY
-- preference on purpose: Setting.logoUrl is shared with the invoice PDF, and
-- letting the card's choice be "is there a logo" would mean a shopkeeper who
-- prefers letters on their visiting card had to delete the logo — silently
-- stripping it from every invoice they issue.
--
-- 'auto' is the default and means "logo if one exists, otherwise initials",
-- which is exactly today's behaviour, so no existing card changes.

ALTER TABLE "Setting" ADD COLUMN "cardMark" TEXT NOT NULL DEFAULT 'auto';
