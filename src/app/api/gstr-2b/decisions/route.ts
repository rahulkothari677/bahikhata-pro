import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContextForWrite } from '@/lib/get-auth'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import { DECISION_KINDS, type DecisionKind } from '@/lib/gstr2b-match'

/**
 * POST   /api/gstr-2b/decisions  { supplierGstin, documentNumber, docType?, decision, purchaseId? }
 * DELETE /api/gstr-2b/decisions  (same body) — undo one answer
 *
 * 9a-2: the shop's answer about one 2B document — "same bill" (this 2B bill IS that
 * purchase, number written differently), "different bills" (it is not that purchase),
 * or "not mine" (rejected on the portal). Kept by supplier GSTIN + document number, so
 * it survives a re-import of the month (lib/gstr2b-match.ts reads it).
 *
 * A "same bill" answer links a 2B bill to a purchase, and GSTR-3B then claims that
 * purchase's credit through it — so the server checks the purchase is this shop's,
 * is a live purchase, and is FROM THAT SUPPLIER (its party's GSTIN). Anything else is
 * refused: a wrong link would put credit on the wrong bill.
 */
interface Body { supplierGstin?: unknown; documentNumber?: unknown; docType?: unknown; decision?: unknown; purchaseId?: unknown }

const GSTIN = /^[0-9A-Z]{15}$/
const DOC_TYPES = ['invoice', 'credit-note', 'debit-note']

/** The answer, read and checked; a string when it cannot be stored. */
function readBody(b: Body): { supplierGstin: string; documentNumber: string; docType: string; decision: DecisionKind; purchaseId: string } | string {
  const supplierGstin = String(b.supplierGstin ?? '').trim().toUpperCase()
  const documentNumber = String(b.documentNumber ?? '').trim()
  const docType = String(b.docType ?? 'invoice')
  const decision = String(b.decision ?? '') as DecisionKind
  const purchaseId = String(b.purchaseId ?? '').trim()
  if (!GSTIN.test(supplierGstin)) return 'supplierGstin must be a 15-character GSTIN'
  if (!documentNumber || documentNumber.length > 64) return 'documentNumber is required (up to 64 characters)'
  if (!DOC_TYPES.includes(docType)) return 'docType must be invoice, credit-note or debit-note'
  if (!DECISION_KINDS.includes(decision)) return `decision must be one of: ${DECISION_KINDS.join(', ')}`
  if (decision === 'not-mine' && purchaseId) return '"not mine" is about the 2B bill alone — no purchase'
  if (decision !== 'not-mine' && !purchaseId) return `"${decision}" needs the purchase it is about`
  return { supplierGstin, documentNumber, docType, decision, purchaseId }
}

export async function POST(req: NextRequest) {
  try {
    // Module permission (reports) and the CA read-only block, in one shared check.
    const a = await getAuthContextForWrite('reports')
    if (a.error || !a.userId) return a.error ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = a.userId
    const parsed = readBody(await req.json().catch(() => ({})))
    if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })

    if (parsed.purchaseId) {
      // 9a-4: a supplier's credit note pairs with the shop's return-to-supplier entry; a bill or a
      // supplier's debit note with a purchase.
      const entryType = parsed.docType === 'credit-note' ? 'debit-note' : 'purchase'
      const purchase = await db.transaction.findFirst({
        where: { id: parsed.purchaseId, userId, type: entryType, deletedAt: null },
        select: { id: true, party: { select: { gstin: true } } },
      })
      if (!purchase) return NextResponse.json({ error: entryType === 'debit-note' ? 'Return to supplier not found' : 'Purchase not found' }, { status: 404 })
      if ((purchase.party?.gstin ?? '').trim().toUpperCase() !== parsed.supplierGstin) {
        return NextResponse.json({ error: 'That purchase is from a different supplier', message: 'A 2B bill can only be the same bill as a purchase from the supplier with that GSTIN.' }, { status: 409 })
      }
    }

    const doc = { userId, supplierGstin: parsed.supplierGstin, docType: parsed.docType, documentNumber: parsed.documentNumber }
    await db.$transaction(async (tx) => {
      // One answer per document: "same bill" and "not mine" replace each other and any
      // "different bills" about the same purchase; several "different bills" may stand.
      if (parsed.decision === 'same-bill' || parsed.decision === 'not-mine') {
        await tx.gstr2bDecision.deleteMany({ where: { ...doc, decision: { in: ['same-bill', 'not-mine'] } } })
      }
      if (parsed.decision === 'same-bill') {
        await tx.gstr2bDecision.deleteMany({ where: { ...doc, decision: 'different-bills', purchaseId: parsed.purchaseId } })
      }
      if (parsed.decision === 'different-bills') {
        await tx.gstr2bDecision.deleteMany({ where: { ...doc, decision: 'same-bill', purchaseId: parsed.purchaseId } })
      }
      await tx.gstr2bDecision.upsert({
        where: { userId_supplierGstin_docType_documentNumber_decision_purchaseId: { ...doc, decision: parsed.decision, purchaseId: parsed.purchaseId } },
        create: { ...doc, decision: parsed.decision, purchaseId: parsed.purchaseId },
        update: {},
      })
    })
    await logAudit({ userId, action: 'gstr2b.decision', entityType: 'gstr2bDecision', entityId: `${parsed.supplierGstin}|${parsed.documentNumber}`, req, metadata: { ...parsed } })
    return NextResponse.json({ success: true, decision: parsed })
  } catch (err) {
    return apiError(err, 'Failed to save the answer', 500)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // Module permission (reports) and the CA read-only block, in one shared check.
    const a = await getAuthContextForWrite('reports')
    if (a.error || !a.userId) return a.error ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = a.userId
    const parsed = readBody(await req.json().catch(() => ({})))
    if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
    const { count } = await db.gstr2bDecision.deleteMany({
      where: { userId, supplierGstin: parsed.supplierGstin, docType: parsed.docType, documentNumber: parsed.documentNumber, decision: parsed.decision, purchaseId: parsed.purchaseId },
    })
    await logAudit({ userId, action: 'gstr2b.decision_undone', entityType: 'gstr2bDecision', entityId: `${parsed.supplierGstin}|${parsed.documentNumber}`, req, metadata: { ...parsed, removed: count } })
    return NextResponse.json({ success: true, removed: count })
  } catch (err) {
    return apiError(err, 'Failed to undo the answer', 500)
  }
}
