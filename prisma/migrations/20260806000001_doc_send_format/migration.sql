-- How this shop sends its bills: 'smart' | 'image' | 'pdf'.
--
-- 'smart' picks by bill length. A short bill goes as a picture, which opens
-- straight in a WhatsApp chat; a long one goes as a PDF, because WhatsApp
-- downsamples every image to about 1600px on its longest side and a tall bill
-- comes out too narrow to read — measured at 636px wide for 15 items.
--
-- Additive with a default, so no existing row is rewritten and every shop
-- starts on the behaviour that suits its own bills.
ALTER TABLE "Setting" ADD COLUMN "docSendFormat" TEXT NOT NULL DEFAULT 'smart';
