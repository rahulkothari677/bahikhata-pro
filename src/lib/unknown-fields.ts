/**
 * Reject a field we do not understand, instead of ignoring it.
 *
 * THE BUG. Creating a product with `{ name: 'Rice', stock: 100 }` returned 200
 * and created the product with **zero** stock. The real field is
 * `openingStock`; `stock` was silently dropped by zod, which ignores unknown
 * keys by default. No error, no warning, and a success response.
 *
 * That is the worst possible shape for a mistake. A 400 is a five-second fix.
 * A silent success means the shopkeeper finds out when the till says they have
 * nothing to sell, and whoever wrote the integration has no reason to look at
 * the line of code that caused it — the API said it worked.
 *
 * WHY NOT JUST .strict() ON EVERY SCHEMA. Because the app's own clients
 * legitimately send fields the schema does not declare: `confirmOversell` on a
 * sale, `isInterState` on an invoice, `updatedAt` for the concurrent-edit
 * check. Those are read straight off the body by the route rather than through
 * zod. Turning on .strict() everywhere would start rejecting the app's own
 * traffic — trading a silent failure for a loud outage.
 *
 * So the allowed extras are named, per route, at the call site. That list is
 * the documentation of what a route accepts beyond its schema, and it has to
 * be written down deliberately rather than inherited by accident.
 *
 * THE "DID YOU MEAN" IS THE POINT. Being told `stock` is unknown is useful.
 * Being told `stock` is unknown *and the field is called openingStock* is the
 * difference between a five-second fix and twenty minutes reading source.
 */

/**
 * Edit distance, capped — we only care whether two names are CLOSE, and the
 * strings here are short field names. Standard Levenshtein, two rows.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = curr
  }
  return prev[b.length]
}

/**
 * The closest known field to `unknown`, or null when nothing is close enough.
 *
 * Two ways to be "close", because typos and wrong-names fail differently:
 *   - a near-miss spelling ("gstRat" for "gstRate")
 *   - a shorter name contained in the right one ("stock" in "openingStock"),
 *     which is the actual reported bug and is far apart by edit distance
 */
export function didYouMean(unknown: string, known: readonly string[]): string | null {
  const lower = unknown.toLowerCase()

  // Containment first — it is the stronger signal when it fires.
  const contained = known
    .filter(k => {
      const kl = k.toLowerCase()
      return kl !== lower && (kl.includes(lower) || lower.includes(kl))
    })
    .sort((a, b) => a.length - b.length)
  if (contained.length > 0) return contained[0]

  // Then spelling. The threshold scales with length so short names are not
  // matched to everything: "id" must not suggest "hsn".
  const threshold = Math.max(1, Math.floor(unknown.length / 3))
  let best: string | null = null
  let bestScore = Infinity
  for (const k of known) {
    const d = editDistance(lower, k.toLowerCase())
    if (d <= threshold && d < bestScore) {
      bestScore = d
      best = k
    }
  }
  return best
}

export interface UnknownFieldReport {
  /** Field names the route does not understand. Empty when the body is clean. */
  unknown: string[]
  /** unknown field -> the field they probably meant, where one is obvious. */
  suggestions: Record<string, string>
  /** A ready-to-send message naming the fields and the likely intent. */
  message: string
}

/**
 * Compare a request body against the field names a route accepts.
 *
 * @param body        the parsed JSON body
 * @param known       every field the schema declares
 * @param allowExtra  fields the ROUTE reads directly off the body, outside the
 *                    schema. Named per call site on purpose — see the note at
 *                    the top of this file.
 */
export function findUnknownFields(
  body: unknown,
  known: readonly string[],
  allowExtra: readonly string[] = [],
): UnknownFieldReport | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null

  const accepted = new Set([...known, ...allowExtra])
  const unknown = Object.keys(body as Record<string, unknown>).filter(k => !accepted.has(k))
  if (unknown.length === 0) return null

  const suggestions: Record<string, string> = {}
  for (const u of unknown) {
    const guess = didYouMean(u, known)
    if (guess) suggestions[u] = guess
  }

  const parts = unknown.map(u =>
    suggestions[u] ? `"${u}" (did you mean "${suggestions[u]}"?)` : `"${u}"`,
  )
  const message =
    unknown.length === 1
      ? `This request contains a field this endpoint does not understand: ${parts[0]}. It was previously ignored in silence, which meant the value never reached your data.`
      : `This request contains fields this endpoint does not understand: ${parts.join(', ')}. They were previously ignored in silence, which meant the values never reached your data.`

  return { unknown, suggestions, message }
}

/** The declared field names of a zod object schema, for `known` above. */
export function schemaFields(schema: { shape?: Record<string, unknown> }): string[] {
  return schema.shape ? Object.keys(schema.shape) : []
}
