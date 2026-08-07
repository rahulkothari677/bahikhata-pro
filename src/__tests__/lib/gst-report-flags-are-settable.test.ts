/**
 * Every boolean flag a GST return filters on must be settable by the app.
 *
 * WHY (2026-08-07). `Transaction.isReverseCharge` has existed since V17-Ext.
 * GSTR-3B reads it in six places — it drives section 3.1(d), the tax the shop
 * owes directly when a supplier does not collect it, and the matching credit in
 * 4(A)(3).
 *
 * Nothing in the app could set it. Not the entry form, not the API: it was
 * absent from createTransactionSchema, so even a client that sent it would have
 * had it stripped by validation. The column defaulted to false on every row
 * ever written, so 3.1(d) reported ZERO for every shop, always.
 *
 * A kirana paying a transporter (GTA) owes that tax. Their return did not say
 * so. That is invisible until an audit, which is the worst way to find out.
 *
 * The shape of the fault is what this guards: a column read by a report but
 * unreachable from any write path. Both halves looked complete on their own —
 * the report queried a real column, the form saved real data — and nothing
 * connected them. A schema is not a feature.
 */
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const GST_ROUTES = path.join(ROOT, 'src/app/api')
const VALIDATION = path.join(ROOT, 'src/lib/validation.ts')

/** Every gstr-* route file. */
function gstRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) gstRouteFiles(full, out)
    else if (entry.name === 'route.ts' && /gstr/i.test(full)) out.push(full)
  }
  return out
}

const routes = gstRouteFiles(GST_ROUTES)
const validationSrc = fs.readFileSync(VALIDATION, 'utf8')

/*
 * Boolean flags used as Prisma filters, e.g. `isReverseCharge: true`.
 *
 * Deliberately narrow: only `isX: true|false` in a query position. A wider net
 * would drag in every derived local and produce noise, and a guard that cries
 * wolf gets switched off — which is how the thing it guards comes back.
 */
const FLAG_FILTER = /\b(is[A-Z]\w*)\s*:\s*(?:true|false)\b/g

/**
 * Flags the shop genuinely cannot choose, so their absence from the input
 * schema would be correct rather than a bug.
 *
 * Empty today, and typed rather than inferred: `new Set([])` infers Set<never>,
 * which makes `.has(someString)` a type error the moment anything is checked
 * against it. Left explicit so adding the first entry does not break the build.
 */
const SERVER_DERIVED = new Set<string>([])

describe('the scan is not vacuous', () => {
  it('found the GST return routes', () => {
    expect(routes.length).toBeGreaterThan(1)
  })

  it('found boolean flags being filtered on', () => {
    const all = routes.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(FLAG_FILTER)].map((m) => m[1]))
    expect(all.length).toBeGreaterThan(2)
  })
})

describe('a flag a GST return reads can be set by the app', () => {
  it('holds for every flag the returns filter on', () => {
    const flags = new Set<string>()
    for (const file of routes) {
      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(FLAG_FILTER)) flags.add(m[1])
    }

    const unreachable: string[] = []
    for (const flag of flags) {
      if (SERVER_DERIVED.has(flag)) continue
      // Settable means: the create schema accepts it, so a form can send it.
      const accepted = new RegExp(`\\b${flag}\\s*:`).test(validationSrc)
      if (!accepted) {
        unreachable.push(
          `${flag} — a GST return filters on it, but createTransactionSchema does not accept it, ` +
            'so no screen can ever set it and the return will report zero for that section forever. ' +
            'Either accept it in the schema and give it a control, or stop filtering on it.',
        )
      }
    }

    expect(unreachable).toEqual([])
  })
})
