/**
 * Search finds every screen by its name (#198, Phase 5f-1).
 *
 * Search looked only at entries marked 'global-search', so none of the 17
 * reports and none of the settings could be found: "stock report" gave "No
 * results". And it matched the whole query as one piece of text in registry
 * order, so "stock" listed New Purchase before the Stock Report.
 *
 * Now: every report and every settings entry is searchable too (one rule,
 * not a second list of ids), each query word may match the start of any word
 * of the name, its keywords or its description — English or the shop's
 * language — and the results are ranked by how well the NAME matches.
 */
import type { NavDestination } from './nav-registry'

/**
 * Every place a shopkeeper can open from anywhere in the app — screens, reports,
 * settings sections, tools in More — is findable by name. Only an entry whose
 * action is custom code (Rate EkBook, Logout) is left out: the search box cannot
 * run it, and a row that does nothing is worse than no row. Permissions, flags
 * and the shop's GST status still filter the list where it is used.
 */
export function searchableDestinations(all: NavDestination[]): NavDestination[] {
  return all.filter((d) => d.actionKind !== 'custom' && (d.surfaces?.length ?? 0) > 0)
}

const norm = (s: string | undefined | null) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const words = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * How well a destination answers a query: 0 = not at all. Higher is better.
 * 100 the name exactly · 80 the name starts with it · 60 every word starts a word of the name ·
 * 40 every word starts a word of the name or keywords · 20 every word is somewhere in name, keywords or description.
 */
export function navScore(d: NavDestination, query: string, t?: (k: string) => string): number {
  const q = norm(query)
  if (!q) return 0
  // Its names: the label, its translation, and the short name the bar, tiles and headers show
  // ("Items & stock", "Cashbook") — people search for what they see.
  const names = [d.label, d.labelKey && t ? t(d.labelKey) : '', d.shortLabelKey && t ? t(d.shortLabelKey) : ''].map(norm).filter(Boolean)
  const descs = [d.description, d.descKey && t ? t(d.descKey) : ''].map(norm).filter(Boolean)
  const qw = words(q)
  if (qw.length === 0) return 0
  const nameWords = names.flatMap(words)
  const keyWords = words(d.keywords ?? '')
  const descWords = descs.flatMap(words)
  const starts = (pool: string[]) => qw.every((w) => pool.some((p) => p.startsWith(w)))
  if (names.some((n) => n === q)) return 100
  if (names.some((n) => n.startsWith(q))) return 80
  if (starts(nameWords)) return 60
  if (starts([...nameWords, ...keyWords])) return 40
  // A word typed inside a longer word (Hindi often joins them) still finds it, ranked last.
  const all = [...names, norm(d.keywords), ...descs].join(' ')
  if (starts([...nameWords, ...keyWords, ...descWords]) || qw.every((w) => all.includes(w))) return 20
  return 0
}

/** The destinations that match, best name match first, then the registry's own order. */
export function searchDestinations(dests: NavDestination[], query: string, t?: (k: string) => string): NavDestination[] {
  return dests
    .map((d, i) => ({ d, i, s: navScore(d, query, t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (a.d.sortOrder ?? 0) - (b.d.sortOrder ?? 0) || a.i - b.i)
    .map((x) => x.d)
}
