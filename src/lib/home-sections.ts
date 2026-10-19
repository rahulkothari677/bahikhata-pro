/**
 * Customise Home (Phase 5b-6, ledger model §7): which Home sections show.
 *
 * Saved on this device only (localStorage), as decided in the build plan —
 * no database change in Phase 5. The Today card always shows: it is the
 * one place a sale starts and today's money is checked.
 *
 * Storage is untrusted input: a corrupted or old value, an unknown id or a
 * blocked localStorage must never hide Home or crash it, so reading falls
 * back to "show everything".
 */
export const HOME_SECTIONS = [
  { id: 'tiles', key: 'home.sec.tiles' },
  { id: 'collect', key: 'home.sec.collect' },
  { id: 'goal', key: 'home.sec.goal' },
  { id: 'overview', key: 'home.sec.overview' },
  { id: 'trends', key: 'home.sec.trends' },
  { id: 'top', key: 'home.sec.top' },
  { id: 'stock', key: 'home.sec.stock' },
  { id: 'recent', key: 'home.sec.recent' },
  { id: 'health', key: 'home.sec.health' },
] as const

export type HomeSectionId = (typeof HOME_SECTIONS)[number]['id']

export const HOME_SECTIONS_KEY = 'ekbook:home-hidden:v1'

const IDS = new Set<string>(HOME_SECTIONS.map((s) => s.id))

/** The hidden section ids from a stored value; anything unreadable means none hidden. */
export function parseHidden(raw: string | null | undefined): HomeSectionId[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return [...new Set(v.filter((x): x is HomeSectionId => typeof x === 'string' && IDS.has(x)))]
  } catch {
    return []
  }
}

export function readHidden(): HomeSectionId[] {
  try {
    return parseHidden(typeof window === 'undefined' ? null : window.localStorage.getItem(HOME_SECTIONS_KEY))
  } catch {
    return []
  }
}

export function writeHidden(hidden: HomeSectionId[]): void {
  try {
    window.localStorage.setItem(HOME_SECTIONS_KEY, JSON.stringify(hidden))
  } catch {
    // Private mode or blocked storage: the choice lasts until reload.
  }
}
