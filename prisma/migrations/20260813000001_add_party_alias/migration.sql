-- C2c: what THIS shop calls a party.
--
-- Written by hand rather than generated, because this machine has no database
-- credentials. It is deliberately ADDITIVE ONLY — a new table, no column
-- changed, nothing dropped — so it cannot damage existing data, and the build
-- applies it automatically on deploy.
--
-- Rolling it back is `DROP TABLE "PartyAlias";` and nothing else breaks: no
-- existing query reads it.

CREATE TABLE "PartyAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    -- Normalised: lower-cased, honorifics dropped, spelling folded. Stored in
    -- the form resolve-name compares with, so a lookup is an exact match and
    -- cannot drift from the comparison rules.
    "alias" TEXT NOT NULL,
    -- What they actually typed. Shown back to them on the party screen —
    -- "Chhota Ramesh" reads better than "chota ramesh".
    "saidAs" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyAlias_pkey" PRIMARY KEY ("id")
);

-- ONE ALIAS MEANS ONE PARTY, per shop. Without this, teaching the app twice
-- would create the very ambiguity aliases exist to remove, and the second
-- lesson would silently disagree with the first.
CREATE UNIQUE INDEX "PartyAlias_userId_alias_key" ON "PartyAlias"("userId", "alias");

-- Reading a party's aliases to show on its screen.
CREATE INDEX "PartyAlias_userId_partyId_idx" ON "PartyAlias"("userId", "partyId");

-- Deleting a shop or a party takes its aliases with it. An alias pointing at a
-- deleted party would resolve a name to a customer who no longer exists.
ALTER TABLE "PartyAlias" ADD CONSTRAINT "PartyAlias_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartyAlias" ADD CONSTRAINT "PartyAlias_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
