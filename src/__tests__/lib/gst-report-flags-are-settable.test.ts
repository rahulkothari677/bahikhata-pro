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

/**
 * Every app source file, read once.
 *
 * Needed because "settable" is too narrow a question. Some columns a return
 * reads are deliberately NOT client-settable — cgst, sgst and igst are derived
 * from the line items, and accepting them from a request would let a caller
 * state their own tax. The real question is whether ANYTHING writes them.
 */
function allSource(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      allSource(full, out)
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(fs.readFileSync(full, 'utf8'))
    }
  }
  return out
}
const APP_SOURCE = allSource(path.join(ROOT, 'src'))

/**
 * Columns a GST return SELECTS — `field: true` inside a Prisma select.
 *
 * WHY THIS EXISTS (2026-08-07). The FLAG_FILTER above was written after
 * Transaction.isReverseCharge turned out to be read by GSTR-3B and written by
 * nothing. I scoped it to `isX: true|false`, which caught that one instance and
 * was blind to every other shape it could take.
 *
 * TransactionItem.hsn then failed in exactly the same way and walked straight
 * past this guard: a STRING column, read by GSTR-1 Table 12, by the HSN summary
 * and by the e-invoice IRN builder, and written by nothing but a backup
 * restore. Every invoice the app had ever produced carried a blank HSN, so
 * Table 12 returned zero rows against ₹9,938.90 of reported sales — a GSTR-1
 * that cannot be filed, and an e-invoice the NIC portal would reject.
 *
 * Twice is a pattern, and the pattern was mine: drawing the class around the
 * single instance in front of me. A column a return depends on needs a write
 * path whatever its type — boolean, string or number.
 */
const SELECTED_COLUMN = /\b(\w+)\s*:\s*true\b/g

/** Prisma query plumbing that looks like a column but is not one. */
const NOT_A_COLUMN = new Set<string>([
  'select', 'include', 'where', 'orderBy', 'take', 'skip', 'distinct',
  'by', 'having', 'cursor', '_sum', '_count', '_avg', '_min', '_max',
])

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
const SERVER_DERIVED = new Set<string>([
  /*
   * isInterState — added 2026-08-08, its first genuine entry.
   *
   * Whether a supply crosses a state line is not the shop's opinion. It is
   * determined from the two GSTINs' state codes, and letting a client assert it
   * would let a caller choose IGST over CGST+SGST — sending tax to the wrong
   * government and breaking the customer's input credit. Correctly derived on
   * the server and correctly absent from createTransactionSchema.
   *
   * The guard flagged it only after the Table 13 work built a plain object
   * containing `isInterState: false` as DATA, which the FLAG_FILTER regex
   * cannot distinguish from a Prisma where-clause. So this entry records two
   * things: that the flag is legitimately server-derived, and that the guard
   * reads literals rather than semantics — the limit of a source scan, and the
   * reason this allowlist has to exist rather than the check being tightened
   * into something that silently stops catching the real fault.
   */
  'isInterState',
])

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
