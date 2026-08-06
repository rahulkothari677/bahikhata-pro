-- Shareable links to a bill, and the toggle that turns them on.
--
-- A long bill cannot be sent as a readable picture (WhatsApp downsamples to
-- ~1600px on the longest side) and a PDF arrives as a grey card nobody opens.
-- A link is the third option: any length, payable, always current, and it
-- reports whether the customer opened it.
--
-- ⚠️ A BillShare row is a CAPABILITY. Anyone holding the token can read that
-- bill — there is no login, because the recipient is a customer with no
-- account. The security is entirely in the token, so it is 32 random URL-safe
-- characters from a CSPRNG, never a sequential id, and the row carries an
-- expiry and a revocation so a link shared by mistake can be withdrawn.
--
-- The toggle is OFF by default: putting a customer's bill on the public
-- internet is a choice a shopkeeper makes, not one made for them.

ALTER TABLE "Setting" ADD COLUMN "docShareLink" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BillShare" (
    "id"            TEXT NOT NULL,
    "token"         TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"     TIMESTAMP(3),
    "revokedAt"     TIMESTAMP(3),
    "viewCount"     INTEGER NOT NULL DEFAULT 0,
    "firstViewedAt" TIMESTAMP(3),
    "lastViewedAt"  TIMESTAMP(3),
    CONSTRAINT "BillShare_pkey" PRIMARY KEY ("id")
);

-- Unique because the token IS the credential; a duplicate would hand two bills
-- the same key.
CREATE UNIQUE INDEX "BillShare_token_key" ON "BillShare"("token");
CREATE INDEX "BillShare_userId_createdAt_idx" ON "BillShare"("userId", "createdAt");
CREATE INDEX "BillShare_transactionId_idx" ON "BillShare"("transactionId");

-- Cascade: when a shop or a bill goes, its links must not outlive it and keep
-- serving a page.
ALTER TABLE "BillShare" ADD CONSTRAINT "BillShare_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillShare" ADD CONSTRAINT "BillShare_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
