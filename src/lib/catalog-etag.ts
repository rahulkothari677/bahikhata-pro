/**
 * Phase 7a (#297) — the version tag of a shop's item list.
 *
 * The bill screen used to download the whole catalog every time it opened (the
 * August entry study measured 370 KB at 721 items), and /api/products stopped
 * at 5,000 items without saying so. Now every item is sent, and the phone keeps
 * its copy: this tag changes whenever the list could have changed, so the
 * server answers "304, nothing changed" with no body otherwise.
 *
 * What changes it:
 *  - an item added or deleted → the count;
 *  - any edit, including every stock change → the newest updatedAt (Prisma sets
 *    @updatedAt on update AND updateMany — checked on the local database
 *    22 Oct; there is no raw SQL that writes Product);
 *  - who is asking: staff who may not see profit get the list without cost;
 *  - whose list it is: the phone keeps one copy per address, so two accounts
 *    signed in on one phone must never answer each other's 304.
 */
export function catalogEtag(
  shopKey: string,
  count: number,
  newestChange: Date | null | undefined,
  hideProfit: boolean,
  /** Phase 7b: the shop's brands — a rename or a deleted brand changes the list too. */
  families?: { count: number; newest: Date | null | undefined },
): string {
  const fam = families ? `-f${families.count}.${families.newest ? families.newest.getTime() : 0}` : ''
  return `W/"items-${shopKey}-${count}-${newestChange ? newestChange.getTime() : 0}${fam}-${hideProfit ? 'nocost' : 'full'}"`
}

/** Revalidate every time; never serve a stale stock figure without asking. */
export const CATALOG_CACHE_CONTROL = 'private, no-cache'

/**
 * The declared limit on items sent to the phone (#71: "the fuse stays, the
 * silence goes"). The plan's speed budget is 10,000 items searched on the
 * phone; a shop past this sees "first 20,000 of N" on the bill screen.
 */
export const CATALOG_FUSE = 20_000
