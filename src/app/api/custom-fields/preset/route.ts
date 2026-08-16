import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { getTradePreset } from '@/lib/trade-presets'
import { keyFromLabel, reservedLabelError, MAX_FIELDS_PER_ENTITY } from '@/lib/custom-fields'

/**
 * Apply a trade preset — "I sell medicines" becomes batch and expiry.
 *
 * 📄 Phase 6 of docs/INVOICE-ENGINE-PLAN.md.
 *
 * ── IT CREATES ORDINARY FIELDS, NOTHING SPECIAL ───────────────────────
 *
 * A preset is a shortcut, not a second kind of field. Everything it makes is
 * an ordinary CustomFieldDef the shopkeeper can rename, retype, stop printing
 * or remove — and every rule from Phase 5 still applies, including the
 * reserved-name refusal and the per-entity cap.
 *
 * Written this way deliberately. A preset that wrote rows by a private path
 * would be a second vocabulary for "a field this shop has", and the two would
 * disagree the first time one of them changed — GATE 2, and the longest list
 * of causes in CLAUDE.md.
 *
 * ── APPLYING TWICE IS SAFE ────────────────────────────────────────────
 *
 * A shopkeeper who taps Medicines, then taps it again wondering whether it
 * worked, must not end up with two Batch No. columns. Existing keys are
 * skipped and reported, never duplicated and never silently overwritten —
 * overwriting would undo a rename they had made on purpose.
 */

export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const preset = getTradePreset(String(body.presetId || ''))
    if (!preset) return NextResponse.json({ error: 'Unknown trade' }, { status: 400 })

    const existing = await db.customFieldDef.findMany({
      where: { userId },
      select: { id: true, entity: true, key: true, deletedAt: true },
      // Bounded at the true maximum a shop can hold; see /api/custom-fields.
      take: MAX_FIELDS_PER_ENTITY * 3,
    })

    const added: string[] = []
    const skipped: string[] = []

    for (const f of preset.fields) {
      const key = keyFromLabel(f.label)

      /*
       * The reserved check runs on preset fields too.
       *
       * It should never fire — these labels are chosen — but a rule that is
       * skipped for "trusted" input is a rule with a hole in it, and the next
       * person adding a preset will not read this comment first.
       */
      if (reservedLabelError(f.label)) { skipped.push(f.label); continue }

      const clash = existing.find(e => e.entity === f.entity && e.key === key)
      if (clash && !clash.deletedAt) {
        // Already theirs. Leave it exactly as they have it.
        skipped.push(f.label)
        continue
      }

      const countForEntity = existing.filter(e => e.entity === f.entity && !e.deletedAt).length
      if (countForEntity >= MAX_FIELDS_PER_ENTITY) { skipped.push(f.label); continue }

      if (clash) {
        // Retired earlier, so revive rather than create a second row on the
        // same key — two definitions would fight over one slot in every
        // record's stored JSON.
        await db.customFieldDef.update({
          where: { id: clash.id },
          data: {
            deletedAt: null, label: f.label, type: f.type,
            required: f.required, showOnInvoice: f.showOnInvoice,
          },
        })
        clash.deletedAt = null
      } else {
        await db.customFieldDef.create({
          data: {
            userId, entity: f.entity, key, label: f.label, type: f.type,
            required: f.required, showOnInvoice: f.showOnInvoice,
            order: countForEntity,
          },
        })
        existing.push({ id: 'new', entity: f.entity, key, deletedAt: null })
      }
      added.push(f.label)
    }

    return NextResponse.json({ ok: true, added, skipped })
  } catch (error) {
    return apiError(error, 'Failed to set up your trade')
  }
}
