import { db } from './db'
import {
  snapshotCustomValues,
  MAX_FIELDS_PER_ENTITY,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldValue,
} from './custom-fields'

/**
 * Turning what a shopkeeper typed into what gets stored.
 *
 * 📄 Phase 5 part 2 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * ONE helper, used by the transaction route and the party route both. Written
 * as a shared function rather than copied into each because two routes that
 * each decide how to validate and snapshot custom values will disagree about
 * a required field within a release — which is GATE 2's one-vocabulary rule
 * and the longest list of causes in CLAUDE.md.
 *
 * The COERCION and the TYPING happen here, on the server, against the shop's
 * own definitions. The client sends `{ batch: "A-118" }` and gets no say in
 * what type that is or whether it was required.
 */

/** The shop's live definitions for one entity, ordered. */
export async function loadFieldDefs(
  userId: string,
  entity: CustomFieldEntity,
): Promise<CustomFieldDef[]> {
  const rows = await db.customFieldDef.findMany({
    where: { userId, entity, deletedAt: null },
    orderBy: { order: 'asc' },
    // Bounded at the true maximum — the cap is enforced on create, so this
    // can never truncate. See the same note on /api/custom-fields.
    take: MAX_FIELDS_PER_ENTITY,
  })
  return rows.map(r => ({
    id: r.id,
    entity: r.entity as CustomFieldEntity,
    key: r.key,
    label: r.label,
    type: r.type as CustomFieldDef['type'],
    showOnInvoice: r.showOnInvoice,
    required: r.required,
    order: r.order,
  }))
}

/**
 * Validate and snapshot one record's custom values.
 *
 * Returns `null` when the shop has defined no fields for this entity — which
 * is almost every shop, and means the record stores a NULL column rather than
 * an empty array. That matters at scale: an empty `[]` on ten million rows is
 * ten million JSON allocations for nothing.
 *
 * Throws `CustomFieldError` so callers can turn it into a 400 with the
 * shopkeeper's own words in it. A required batch number that is missing must
 * stop the sale — a pharmacy bill without one is the record a Drug Inspector
 * asks for.
 */
export class CustomFieldError extends Error {}

export async function buildCustomValues(
  userId: string,
  entity: CustomFieldEntity,
  raw: unknown,
  /** Pre-loaded definitions, when the caller already has them (item lines). */
  preloaded?: CustomFieldDef[],
): Promise<CustomFieldValue[] | null> {
  const defs = preloaded ?? await loadFieldDefs(userId, entity)
  if (!defs.length) return null

  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const result = snapshotCustomValues(defs, input)
  if (!result.ok) throw new CustomFieldError(result.error)

  // Null rather than [] — see the note above.
  return result.values.length ? result.values : null
}
