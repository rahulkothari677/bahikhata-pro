import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import {
  reservedLabelError,
  keyFromLabel,
  MAX_FIELDS_PER_ENTITY,
  type CustomFieldEntity,
  type CustomFieldType,
} from '@/lib/custom-fields'

/**
 * The shop's own field definitions.
 *
 * 📄 Phase 5 of docs/INVOICE-ENGINE-PLAN.md. The VALUES are written with the
 * record they belong to (a bill saves its own custom fields); this route only
 * manages what fields exist.
 */

const ENTITIES: CustomFieldEntity[] = ['party', 'invoice', 'item']
const TYPES: CustomFieldType[] = ['text', 'number', 'date', 'money']

/** GET /api/custom-fields?entity=item — or all three when entity is absent. */
export async function GET(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const entity = req.nextUrl.searchParams.get('entity')
    if (entity && !ENTITIES.includes(entity as CustomFieldEntity)) {
      return NextResponse.json({ error: 'Unknown entity' }, { status: 400 })
    }

    const fields = await db.customFieldDef.findMany({
      where: { userId, deletedAt: null, ...(entity ? { entity } : {}) },
      orderBy: [{ entity: 'asc' }, { order: 'asc' }],
      /*
       * Bounded, and CANNOT truncate.
       *
       * Three entities × the per-entity cap is the most a shop can possibly
       * have, and the cap is enforced on the way in (see POST). So this take
       * is defence in depth rather than a limit anyone can reach — which
       * matters, because CLAUDE.md is right that a silent cap is a lie with a
       * number on it. Set it to the true maximum and it can never lie.
       */
      take: MAX_FIELDS_PER_ENTITY * ENTITIES.length,
    })
    return NextResponse.json({ fields })
  } catch (error) {
    return apiError(error, 'Failed to load your custom fields')
  }
}

/** POST — create one. */
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const entity = String(body.entity || '')
    const label = String(body.label || '').trim()
    const type = String(body.type || 'text')

    if (!ENTITIES.includes(entity as CustomFieldEntity)) {
      return NextResponse.json({ error: 'Unknown entity' }, { status: 400 })
    }
    if (!TYPES.includes(type as CustomFieldType)) {
      return NextResponse.json({ error: 'Unknown field type' }, { status: 400 })
    }

    /*
     * 🔒 §0 — a custom field may not impersonate a Rule 46 particular.
     *
     * A bill carrying two GSTINs that disagree is worse than one carrying
     * none: it looks authoritative and is wrong. Refused with a reason,
     * because the shopkeeper is one tap from invalidating their own invoice
     * and deserves to know why rather than to wonder where their field went.
     */
    const reserved = reservedLabelError(label)
    if (reserved) return NextResponse.json({ error: reserved }, { status: 400 })

    /*
     * The cap. Without one, a bill grows columns until it no longer fits the
     * page, and the person who finds the limit is a shopkeeper mid-sale.
     */
    const existing = await db.customFieldDef.count({ where: { userId, entity, deletedAt: null } })
    if (existing >= MAX_FIELDS_PER_ENTITY) {
      return NextResponse.json(
        { error: `You can have up to ${MAX_FIELDS_PER_ENTITY} extra fields here. Remove one first.` },
        { status: 400 },
      )
    }

    const key = keyFromLabel(label)
    const clash = await db.customFieldDef.findFirst({ where: { userId, entity, key } })
    if (clash) {
      /*
       * Includes the soft-deleted ones deliberately: reviving is safer than
       * creating a second definition with the same key, which would make two
       * fields fight over one slot in every record's JSON.
       */
      if (!clash.deletedAt) {
        return NextResponse.json({ error: `You already have a field called "${label}".` }, { status: 400 })
      }
      const revived = await db.customFieldDef.update({
        where: { id: clash.id },
        data: { deletedAt: null, label, type, showOnInvoice: body.showOnInvoice !== false, required: !!body.required },
      })
      return NextResponse.json({ field: revived })
    }

    const field = await db.customFieldDef.create({
      data: {
        userId, entity, key, label, type,
        showOnInvoice: body.showOnInvoice !== false,
        required: !!body.required,
        order: existing,
      },
    })
    return NextResponse.json({ field })
  } catch (error) {
    return apiError(error, 'Failed to add the field')
  }
}

/** PATCH — rename, retype, or change where it shows. */
export async function PATCH(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const owned = await db.customFieldDef.findFirst({ where: { id, userId } })
    if (!owned) return NextResponse.json({ error: 'Field not found' }, { status: 404 })

    const data: Record<string, unknown> = {}
    if (body.label !== undefined) {
      const label = String(body.label).trim()
      const reserved = reservedLabelError(label)
      if (reserved) return NextResponse.json({ error: reserved }, { status: 400 })
      /*
       * The LABEL changes; the KEY does not, ever.
       *
       * Bills already issued are keyed on it, and they carry the old label in
       * their own snapshot — so renaming "Batch" to "Lot No." affects new
       * bills only, and last year's invoice still prints "Batch". That is the
       * point of storing the label with the value.
       */
      data.label = label
    }
    if (body.type !== undefined) {
      if (!TYPES.includes(String(body.type) as CustomFieldType)) {
        return NextResponse.json({ error: 'Unknown field type' }, { status: 400 })
      }
      data.type = body.type
    }
    if (body.showOnInvoice !== undefined) data.showOnInvoice = !!body.showOnInvoice
    if (body.required !== undefined) data.required = !!body.required
    if (body.order !== undefined) data.order = Number(body.order) || 0

    const field = await db.customFieldDef.update({ where: { id }, data })
    return NextResponse.json({ field })
  } catch (error) {
    return apiError(error, 'Failed to update the field')
  }
}

/**
 * DELETE — retires a field. SOFT, always.
 *
 * Bills already issued carry values for it, and those must keep printing:
 * a customer holding a pharmacy bill needs its batch number to still be on
 * the shop's copy. Removing the definition only stops the field being offered
 * on NEW records. This is the same rule as everywhere else here — a deleted
 * record stays deleted, and a shopkeeper's data is never removed to tidy up.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const { count } = await db.customFieldDef.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
    if (!count) return NextResponse.json({ error: 'Field not found' }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return apiError(error, 'Failed to remove the field')
  }
}
