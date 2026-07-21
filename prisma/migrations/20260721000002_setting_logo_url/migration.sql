-- 🔒 PDF Redesign Spec Part 3 §2: Shop logo URL for invoice PDF brand band.
-- Rendered at 18×18 mm in the brand band of every invoice PDF. null = no logo.
-- The logo is uploaded via /api/settings/logo (Cloudinary) and stored here so
-- it appears on every invoice without re-uploading.
ALTER TABLE "Setting" ADD COLUMN "logoUrl" TEXT;
