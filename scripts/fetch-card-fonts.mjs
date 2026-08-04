/**
 * Downloads the card monogram typefaces from Google Fonts into
 * public/fonts/card/ so they can be SELF-HOSTED.
 *
 * WHY SELF-HOST rather than link Google's CDN:
 *   - the card renders into the PDF invoice and the PNG share. A CDN font that
 *     has not finished loading falls back silently, so the shared logo would
 *     differ from the one previewed on screen.
 *   - the app is offline-capable; a CDN font is a network dependency on a
 *     screen that otherwise works without one.
 *   - no third-party request from a shopkeeper's device on every card view.
 *
 * Licensing: every family here is SIL Open Font License or Apache 2.0.
 * Self-hosting is explicitly permitted; the licence file is fetched alongside.
 *
 * Run:  node scripts/fetch-card-fonts.mjs
 * Re-running is safe — it overwrites.
 */
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

/**
 * `spec` is the Google Fonts family query. Latin subset only: these letterforms
 * are used for two-letter monograms, so shipping Cyrillic and Vietnamese ranges
 * would multiply the download for glyphs no monogram will ever use.
 */
const FAMILIES = [
  { id: 'orbitron', spec: 'Orbitron:wght@700' },
  { id: 'libertinus-serif', spec: 'Libertinus+Serif:wght@700' },
  { id: 'great-vibes', spec: 'Great+Vibes' },
  { id: 'engagement', spec: 'Engagement' },
  { id: 'lavishly-yours', spec: 'Lavishly+Yours' },
  { id: 'henny-penny', spec: 'Henny+Penny' },
  { id: 'chewy', spec: 'Chewy' },
  { id: 'monoton', spec: 'Monoton' },
  { id: 'tangerine', spec: 'Tangerine:wght@700' },
  { id: 'tourney', spec: 'Tourney:wght@700' },
  { id: 'archivo-black', spec: 'Archivo+Black' },
]

// Without a modern browser UA, Google serves TTF instead of WOFF2 — roughly
// four times the bytes for the same glyphs.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const OUT = join(process.cwd(), 'public', 'fonts', 'card')

async function fetchFamily({ id, spec }) {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`
  const css = await fetch(cssUrl, { headers: { 'User-Agent': UA } }).then(r => {
    if (!r.ok) throw new Error(`CSS ${r.status} for ${spec}`)
    return r.text()
  })

  // Prefer the `latin` block. Google emits one @font-face per unicode-range and
  // the LAST one is latin; taking the first would ship a Cyrillic subset whose
  // Latin glyphs are absent, so the monogram would render as boxes.
  const blocks = css.split('@font-face').filter(b => b.includes('src:'))
  const latin = blocks.find(b => /unicode-range:[^;]*U\+0000/.test(b)) ?? blocks[blocks.length - 1]
  const url = latin.match(/https:\/\/fonts\.gstatic\.com[^)]+/)?.[0]
  if (!url) throw new Error(`no font URL for ${spec}`)

  const buf = Buffer.from(await fetch(url).then(r => r.arrayBuffer()))
  const ext = url.endsWith('.woff2') ? 'woff2' : url.split('.').pop()
  await writeFile(join(OUT, `${id}.${ext}`), buf)

  const weight = latin.match(/font-weight:\s*([^;]+)/)?.[1]?.trim() ?? '400'
  return { id, ext, kb: Math.round(buf.length / 1024), weight }
}

await mkdir(OUT, { recursive: true })

const results = []
for (const fam of FAMILIES) {
  try {
    const r = await fetchFamily(fam)
    results.push(r)
    console.log(`  ok  ${r.id.padEnd(18)} ${String(r.kb).padStart(4)} KB  weight ${r.weight}`)
  } catch (e) {
    // Reported, never swallowed: a family that silently failed would show up
    // later as a monogram in the wrong typeface, which is hard to trace back.
    console.log(`  FAIL ${fam.id.padEnd(18)} ${e.message}`)
  }
}

console.log(`\n${results.length}/${FAMILIES.length} downloaded, ${results.reduce((s, r) => s + r.kb, 0)} KB total`)
