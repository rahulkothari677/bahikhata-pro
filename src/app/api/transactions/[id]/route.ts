import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContext, assertCanWrite } from '@/lib/get-auth'
import { canAccessModule, type ModuleKey } from '@/lib/staff-permissions'
import { shouldHideProfit, stripTransactionProfit } from '@/lib/profit-visibility'
import { roundMoney, toMoney } from '@/lib/money'
import { deriveInterStateStatus } from '@/lib/gst'
import { validateBody, updateTransactionSchema } from '@/lib/validation'
import { computeLineItems } from '@/lib/line-items'
import { normalizeToUnit } from '@/lib/units'
import { apiError } from '@/lib/api-error'
import { assertPeriodNotLocked, PeriodLockedError } from '@/lib/period-lock'
import { logFieldChanges, TRACKED_TRANSACTION_FIELDS } from '@/lib/field-audit'
import { resolveFinalPaid, isNoteType } from '@/lib/paid-amount'
import { validateNoteAgainstOriginal } from '@/lib/note-validation'
import { checkLinkedNotesCap } from '@/lib/linked-notes-guard'

// GET /api/transactions/[id] - get single transaction with all details
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 🔒 FIX H1: Use getAuthContext for staff permission check
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    const { id } = await params
    const transaction = await db.transaction.findFirst({
      where: { id, userId, deletedAt: null },
      include: {
        items: true,
        party: true,
        createdBy: { select: { id: true, name: true, role: true } },  // 🔒 V13 L4: staff accountability
        // 🔒 V17 Audit §1: Fetch linked credit/debit notes (reversalTransactions)
        // so the TransactionDetail UI can show "Credit notes issued against this sale".
        // Only fetch non-deleted reversals (voided credit notes shouldn't appear).
        reversalTransactions: {
          where: { deletedAt: null },
          select: {
            id: true,
            invoiceNo: true,
            type: true,
            noteType: true,
            noteReason: true,
            date: true,
            totalAmount: true,
            grossProfit: true,
            paidAmount: true,
            affectsStock: true,
          },
          orderBy: { date: 'desc' },
        },
        // Also fetch the original transaction if this IS a credit/debit note
        originalTransaction: {
          select: {
            id: true,
            invoiceNo: true,
            type: true,
            date: true,
            totalAmount: true,
          },
        },
      },
    })
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    // 🔒 FIX H1: Check staff permission based on transaction type
    const moduleKey: ModuleKey = transaction.type === 'purchase' ? 'purchases' : transaction.type === 'income' || transaction.type === 'expense' ? 'incomeExpense' : 'sales'
    if (!canAccessModule(authCtx.role, authCtx.permissions, moduleKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 🔒 FIX H2: Strip grossProfit if hideProfit is on and caller is staff
    const hideProfit = await shouldHideProfit(userId, authCtx.role)
    return NextResponse.json({
      transaction: hideProfit ? stripTransactionProfit(transaction) : transaction,
    })
  } catch (error) {
    return apiError(error, 'Failed to fetch transaction', 500)
  }
}

// PUT /api/transactions/[id] - update transaction
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 🔒 FIX H1: Use getAuthContext for staff permission check
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    const { id } = await params
    const existing = await db.transaction.findFirst({ where: { id, userId, deletedAt: null } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // 🔒 FIX H1: Check staff permission based on transaction type
    // V17-Ext Tier 3: credit-note maps to sales, debit-note maps to purchases
    const moduleKey: ModuleKey = existing.type === 'purchase' || existing.type === 'debit-note' ? 'purchases' : existing.type === 'income' || existing.type === 'expense' ? 'incomeExpense' : 'sales'
    if (!canAccessModule(authCtx.role, authCtx.permissions, moduleKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 🔒 V17-Ext Tier 3 Step 3: CAs are read-only — block transaction edits
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

    const body = await req.json()

    // 🔒 AUDIT FIX H7: Validate request body with zod
    const validation = validateBody(updateTransactionSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', detail: validation.error }, { status: 400 })
    }

    const { type, partyId, date, items, discountAmount, paymentMode, notes, invoiceNo, category, paidAmount, originalTransactionId, noteType, noteReason, affectsStock } = validation.data as any

    // 🔒 AUDIT FIX N6 (v3): Forbid changing transaction type.
    // Was: editing a sale→income would orphan items and leak stock (no reversal).
    // Now: reject type changes with a clear error. Users must delete and re-create
    // if they need a different type (the delete path handles stock reversal correctly).
    if (existing.type !== type) {
      return NextResponse.json({
        error: 'Cannot change transaction type',
        message: `This transaction is a ${existing.type}. To convert it to a ${type}, please delete this transaction and create a new one.`,
      }, { status: 400 })
    }

    // 🔒 V17-Ext §5.1: Period lock check (TWO dates to check for PUT):
    //   1. The EXISTING transaction's date — you can't edit a transaction that's
    //      already in a locked period (protects filed GST from alteration).
    //   2. The NEW date (if provided) — you can't move a transaction INTO a
    //      locked period (would alter the locked period's totals retroactively).
    // Both must pass. If either is locked, the edit is blocked with a 403.
    try {
      await assertPeriodNotLocked(userId, existing.date)
      if (date) {
        await assertPeriodNotLocked(userId, date)
      }
    } catch (e) {
      if (e instanceof PeriodLockedError) {
        return NextResponse.json({ error: e.message, code: 'PERIOD_LOCKED' }, { status: 403 })
      }
      throw e
    }

    // 🔒 GST CORRECTNESS (Audit fix H3 v2): Derive isInterState server-side
    // using the shared helper — same logic as POST. Was: trusted the client
    // isInterState flag (user could flip CGST/SGST ↔ IGST → wrong GST return).
    // Now: client flag is IGNORED, server derives from shop state vs party state.
    // 🔒 V26 Phase 8 R10-1: When indeterminate (state missing), honor client override.
    const { isInterState: derivedIsInterState, party, indeterminate } = await deriveInterStateStatus(userId, partyId)
    const clientIsInterState = typeof body.isInterState === 'boolean' ? body.isInterState : undefined
    const isInterState = indeterminate && clientIsInterState !== undefined ? clientIsInterState : derivedIsInterState
    if (partyId && !party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // For income/expense - simple update
    if (type === 'income' || type === 'expense') {
      // 🔒 FIX M5: Was `parseFloat(body.totalAmount)` — use validated value.
      const amount = validation.data.totalAmount || 0
      const transaction = await db.transaction.update({
        where: { id },
        data: {
          category: category || null,
          date: new Date(date || new Date()),
          subtotal: amount,
          totalAmount: amount,
          paidAmount: amount,
          paymentMode: paymentMode || 'cash',
          notes: notes || null,
          invoiceNo: invoiceNo || null,
        },
        include: { items: true, party: true },
      })
      // V17-Ext 5.1: Log field-level changes for audit trail
      await logFieldChanges({
        userId,
        entityType: 'transaction',
        entityId: id,
        oldValues: existing,
        newValues: transaction,
        fieldsToTrack: TRACKED_TRANSACTION_FIELDS,
        changedByUserId: authCtx.actingUserId,
      })
      return NextResponse.json({ transaction })
    }

    // For sale/purchase - recompute from items
    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
    }

    const productIds = items.map((i: any) => i.productId).filter(Boolean)
    const products = productIds.length > 0 ? await db.product.findMany({ where: { id: { in: productIds }, userId } }) : []
    const productMap = new Map(products.map(p => [p.id, p]))

    // 🔒 V11 STOCK POLICY: Fetch the shop's stock policy + roundOffEnabled early.
    // Also fetch old items BEFORE the $transaction so we can compute the NET
    // stock impact (old items reversed + new items applied) and block/warn.
    const [setting, oldItems] = await Promise.all([
      db.setting.findUnique({
        where: { userId },
        select: { roundOffEnabled: true, stockPolicy: true },
      }),
      db.transactionItem.findMany({ where: { transactionId: id } }),
    ])
    const stockPolicy = setting?.stockPolicy || 'block'

    // 🔒 R11-4 COMPLETION (2026-07-21): resolve affectsStock BEFORE the stock
    // direction is computed.
    //
    // The R11-4 fix applied this same fallback ONLY in the update payload
    // (`data: { affectsStock: ... }`), so the STORED flag came out right while
    // the STOCK MOVEMENT below still read the raw, un-defaulted value. That
    // left the exact corruption the fix set out to prevent:
    //
    //   Edit a credit note that had affectsStock = true
    //     existingShouldIncrement = true   (from existing.affectsStock)
    //       -> reversal SUBTRACTS the stock
    //     shouldIncrementStock    = false  (client omits the field -> zod false)
    //       -> new impact is never applied
    //     net: stock silently DROPS by the note quantity, every edit.
    //
    // The edit dialog does not expose these note fields, so `undefined` here
    // means "unchanged", never "set to false".
    const resolvedAffectsStock = affectsStock !== undefined
      ? affectsStock
      : (existing.affectsStock ?? false)

    // V17-Ext Tier 3: Stock direction (same logic as POST)
    const shouldDecrementStock = type === 'sale' || (type === 'debit-note' && resolvedAffectsStock)
    const shouldIncrementStock = type === 'purchase' || (type === 'credit-note' && resolvedAffectsStock)
    const shouldAffectStock = shouldDecrementStock || shouldIncrementStock
    // For reversal: check the EXISTING transaction's affectsStock flag
    const existingShouldDecrement = existing.type === 'sale' || (existing.type === 'debit-note' && existing.affectsStock)
    const existingShouldIncrement = existing.type === 'purchase' || (existing.type === 'credit-note' && existing.affectsStock)
    const existingAffectsStock = existingShouldDecrement || existingShouldIncrement

    // 🔒 V11 STOCK POLICY: For ALL stock-affecting edits, compute the NET stock
    // impact per product.
    //
    // 🔒 V19-006 FIX: Previously only ran for sale→sale edits. Now runs for ALL
    // stock-affecting transaction types (sale, purchase, credit-note w/ stock,
    // debit-note w/ stock). The net change is:
    //   - Old items: reversed (if old decremented, add back; if old incremented, remove)
    //   - New items: applied (if new decrements, subtract; if new increments, add)
    //
    // If any product's resulting stock < 0:
    //   - 'block' mode → return 400 (reject the edit)
    //   - 'allow' mode → add to stockWarnings (edit goes through with warning)
    const stockWarnings: Array<{
      productId: string
      productName: string
      currentStock: number
      requestedQuantity: number
      resultingStock: number
    }> = []

    // Only check if either old or new transaction affects stock
    if ((existingAffectsStock || shouldAffectStock) && !body.confirmOversell) {
      const netChangeMap = new Map<string, number>()

      // Old items: reverse their stock impact
      if (existingAffectsStock) {
        for (const oldItem of oldItems) {
          if (!oldItem.productId) continue
          const product = productMap.get(oldItem.productId)
          const oldQty = product?.unit
            ? normalizeToUnit(Number(oldItem.quantity) || 0, oldItem.unit || product.unit, product.unit).quantity
            : Number(oldItem.quantity) || 0
          // If old transaction DECREMENTED stock (sale/debit-note), reversal ADDS back (+)
          // If old transaction INCREMENTED stock (purchase/credit-note), reversal REMOVES (-)
          const reversalSign = existingShouldDecrement ? 1 : -1
          netChangeMap.set(oldItem.productId, (netChangeMap.get(oldItem.productId) || 0) + (oldQty * reversalSign))
        }
      }

      // New items: apply their stock impact
      if (shouldAffectStock) {
        for (const item of items) {
          if (!item.productId) continue
          const product = productMap.get(item.productId)
          if (!product) continue
          const newQty = normalizeToUnit(
            Number(item.quantity) || 0,
            item.unit || product.unit,
            product.unit,
          ).quantity
          // If new transaction DECREMENTS stock (sale/debit-note), subtract (-)
          // If new transaction INCREMENTS stock (purchase/credit-note), add (+)
          const newSign = shouldDecrementStock ? -1 : 1
          netChangeMap.set(item.productId, (netChangeMap.get(item.productId) || 0) + (newQty * newSign))
        }
      }

      // Check each affected product
      for (const [productId, netChange] of netChangeMap.entries()) {
        const product = productMap.get(productId)
        if (!product) continue
        const resultingStock = roundMoney(product.currentStock + netChange)
        if (resultingStock < 0) {
          stockWarnings.push({
            productId: product.id,
            productName: product.name,
            currentStock: product.currentStock,
            requestedQuantity: -netChange,  // the net qty being removed
            resultingStock,
          })
        }
      }

      // Block mode: reject if any product would go negative
      if (stockPolicy === 'block' && stockWarnings.length > 0) {
        const lines = stockWarnings.map(w =>
          `• ${w.productName}: have ${w.currentStock}, would go to ${w.resultingStock}`
        ).join('\n')
        return NextResponse.json({
          error: 'Not enough stock',
          message: `This edit would push stock below zero:\n${lines}\n\nRecord a purchase first, or enable "Allow overselling" in Settings.`,
          stockWarnings,
          hint: 'To allow overselling, go to Settings and turn on "Allow overselling (kirana mode)".',
        }, { status: 400 })
      }
    }

    // 🔒 V12: Same centralized line-item math as POST (computeLineItems) — unit
    // normalization + GST-inclusive + proportional discount, single source of
    // truth so edit and create can never drift apart.
    const orderDiscount = toMoney(discountAmount)

    // 🔒 AUDITOR FIX: Was a duplicated preSubtotal block (same as POST). Now:
    // call computeLineItems FIRST, then use computed.subtotal for the
    // over-discount check. Same pattern, same guarantee — no drift possible.
    const computed = computeLineItems({ items, productMap, isInterState, orderDiscount, type })
    const txItems = computed.txItems
    const subtotal = computed.subtotal
    const cgst = computed.cgst
    const sgst = computed.sgst
    const igst = computed.igst
    const grossProfit = computed.grossProfit
    const discount = orderDiscount

    // 🔒 V11 §4.3: Reject over-discount (discount > subtotal). Keep the
    // rejection (return 400) — don't silently clamp.
    if (orderDiscount > computed.subtotal) {
      return NextResponse.json({
        error: 'Discount cannot exceed subtotal',
        message: `The discount (₹${orderDiscount.toFixed(2)}) is greater than the subtotal (₹${computed.subtotal.toFixed(2)}). Please reduce the discount and try again.`,
      }, { status: 400 })
    }

    // 🔒 V12: Invoice round-off (nearest rupee) when enabled.
    // 🔒 V11: `setting` was fetched earlier (with stockPolicy). Reuse it here.
    let totalAmount = computed.totalBeforeRoundOff
    let roundOff = 0
    if (setting?.roundOffEnabled) {
      const rounded = Math.round(totalAmount)
      roundOff = roundMoney(rounded - totalAmount)
      totalAmount = rounded
    }

    // 🔒 AUDIT V24 §1: Shared resolution with POST — for credit/debit notes a
    // missing paidAmount defaults to 0 (khata adjustment), not totalAmount.
    // Includes the FIX M3 snap-to-total clamp for explicit values.
    const finalPaid = resolveFinalPaid(type, paidAmount, totalAmount)

    // 🔒 AUDIT V25 FIX §6.2 (Batch 7): Block credit/debit notes without a party
    // on edit too (same check as POST). A note without a party is a silent no-op.
    if (isNoteType(type) && !partyId) {
      return NextResponse.json({
        error: 'Credit/debit notes require a party',
        message: 'A return must be linked to a customer or supplier so their balance can be adjusted.',
      }, { status: 400 })
    }

    // 🔒 AUDIT V24 §2: Same note-vs-original validation as POST, excluding this
    // note itself from the cumulative cap (we're replacing its old value).
    // 🔒 V26 R5 (Phase 5): These checks were previously OUTSIDE the $transaction
    // → READ COMMITTED meant two concurrent note-edits both passed the cap.
    // Now: they run INSIDE the $transaction (after the FOR UPDATE lock on the
    // original row that validateNoteAgainstOriginal now acquires). The pre-tx
    // fetches below are kept as a fast-path early reject for the common case;
    // the authoritative check is inside the tx. If the inside-tx check fails,
    // it throws NOTE_VALIDATION_FAILED → outer catch returns the 400 body.
    if (isNoteType(type) && originalTransactionId) {
      const noteCheck = await validateNoteAgainstOriginal(db, {
        userId,
        type,
        partyId: partyId || null,
        originalTransactionId,
        noteTotal: totalAmount,
        excludeNoteId: id,
      })
      if (!noteCheck.ok) {
        return NextResponse.json({ error: noteCheck.error, message: noteCheck.message }, { status: noteCheck.status })
      }
    }

    // 🔒 V26 N3: Re-validate original-invoice edits against its linked notes.
    // The cap Σ(notes) ≤ original.totalAmount is enforced on note create/edit
    // and on original DELETE, but was missing on original PUT — so editing a
    // ₹1,000 invoice (with a ₹800 CN against it) down to ₹300 produced a
    // phantom −₹500 party balance and over-reversed GST liability.
    // 🔒 V26 R5: This check also runs INSIDE the $transaction below (after the
    // FOR UPDATE lock) to close the concurrent note-create race. The pre-tx
    // call here is the fast path.
    const linkedNotesCheck = await checkLinkedNotesCap(db, id, totalAmount, type)
    if (!linkedNotesCheck.ok) {
      return NextResponse.json(
        { error: linkedNotesCheck.error, message: linkedNotesCheck.message },
        { status: linkedNotesCheck.status },
      )
    }

    // 🔒 ATOMICITY (Audit fix C3) + STOCK (Audit fix H1):
    // Wrap delete + update + stock adjustments in $transaction.
    // Step 1: Reverse old items' stock impact (add back sales, subtract purchases)
    // Step 2: Delete old items
    // Step 3: Update transaction + create new items
    // Step 4: Apply new items' stock impact (decrement sales, increment purchases)
    const transaction = await db.$transaction(async (tx) => {
      // 🔒 V26 R4 (Phase 5): Lock the transaction row + re-check inside the tx.
      // Was: oldItems snapshot taken before the $transaction; comment at the
      // old :391-393 admitted "no concurrent writes to the same transaction ID,
      // so the snapshot is still valid" — but nothing enforced it.
      // Interleaving that broke it: A and B both PUT, both snapshot oldItems=
      // [10×X]. A's tx reverses +10, deletes A's items, writes 8×X, commits.
      // B's tx reverses the SAME original +10 again (stale snapshot), deletes
      // A's just-created items, writes 12×X, commits. Stock now wrong by +2.
      // Also: PUT could update a concurrently soft-deleted row (the
      // tx.transaction.update where:{id} didn't re-check deletedAt).
      //
      // Fix: SELECT...FOR UPDATE serializes edits to one transaction row.
      // Re-check deletedAt (a concurrent DELETE may have soft-deleted it).
      // Re-read oldItems INSIDE the lock — this is the authoritative snapshot
      // for reversal (the pre-tx fetch stays for the stock-policy warning
      // computation, which is best-effort and doesn't need to be exact).
      await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`
      const fresh = await tx.transaction.findFirst({ where: { id, userId, deletedAt: null } })
      if (!fresh) {
        const err: any = new Error('EDIT_GONE')
        err.code = 'EDIT_GONE'
        throw err
      }
      const lockedOldItems = await tx.transactionItem.findMany({ where: { transactionId: id } })

      // 🔒 V26 R5 (Phase 5): Re-run note-cap checks INSIDE the tx (after the
      // FOR UPDATE lock). The pre-tx checks at :362 and :384 are the fast path
      // for the common case; these are the authoritative checks that close the
      // concurrent note-create race. If either fails, throw NOTE_VALIDATION_FAILED
      // → outer catch returns the 400 body (same shape as the pre-tx checks).
      if (isNoteType(type) && originalTransactionId) {
        const noteCheck = await validateNoteAgainstOriginal(tx, {
          userId,
          type,
          partyId: partyId || null,
          originalTransactionId,
          noteTotal: totalAmount,
          excludeNoteId: id,
        })
        if (!noteCheck.ok) {
          const err: any = new Error('NOTE_VALIDATION_FAILED')
          err.status = noteCheck.status
          err.error = noteCheck.error
          err.userMessage = noteCheck.message
          throw err
        }
      }
      // 🔒 V26 R5: Re-run the linked-notes cap inside the tx (the original
      // invoice is being edited; a concurrent note-create would have to wait
      // for our FOR UPDATE to release).
      const linkedNotesLockedCheck = await checkLinkedNotesCap(tx, id, totalAmount, type)
      if (!linkedNotesLockedCheck.ok) {
        const err: any = new Error('NOTE_VALIDATION_FAILED')
        err.status = linkedNotesLockedCheck.status
        err.error = linkedNotesLockedCheck.error
        err.userMessage = linkedNotesLockedCheck.message
        throw err
      }

      // Step 1: Reverse old items' stock impact (using the LOCKED snapshot)
      // 🔒 V9 2.1 FIX: Scope by userId (same as POST)
      for (const oldItem of lockedOldItems) {
        if (oldItem.productId) {
          if (existingShouldDecrement) {
            // Reverse a decrement (sale or debit-note with affectsStock): add stock back
            await tx.product.updateMany({
              where: { id: oldItem.productId, userId },
              data: { currentStock: { increment: oldItem.quantity } },
            })
          } else if (existingShouldIncrement) {
            // Reverse an increment (purchase or credit-note with affectsStock): subtract stock
            // 🔒 V26 H2 FIX: Add currentStock gte guard to prevent negative stock.
            // Was: unconditional decrement — if stock was depleted since the original
            // purchase, the reversal would push stock negative silently.
            const reverseResult = await tx.product.updateMany({
              where: { id: oldItem.productId, userId, currentStock: { gte: oldItem.quantity } },
              data: { currentStock: { decrement: oldItem.quantity } },
            })
            if (reverseResult.count === 0) {
              // Stock insufficient for reversal — allow it but clamp at 0.
              // Reversals are corrections, not new transactions — blocking them
              // would trap the user in an un-editable state. Clamp is the safe fallback.
              await tx.product.updateMany({
                where: { id: oldItem.productId, userId },
                data: { currentStock: 0 },
              })
            }
          }
        }
      }

      // Step 2: Delete old items
      await tx.transactionItem.deleteMany({ where: { transactionId: id } })

      // Step 3: Update transaction + create new items
      // 🔒 R11-4 (Round 11): For credit/debit note fields (originalTransactionId,
      // noteType, noteReason, affectsStock), fall back to the EXISTING values
      // when the client doesn't send them. The EditTransactionDialog doesn't
      // show these fields (they're set at creation time), so they arrive as
      // undefined → zod default (false/null). Without this fallback, editing a
      // credit note that had affectsStock=true would silently set affectsStock=false,
      // and the stock-reversal logic above would compute the wrong net change
      // (existing increments stock, new doesn't → stock decreases by the note
      // amount → corrupted stock).
      const txn = await tx.transaction.update({
        where: { id },
        data: {
          type,
          partyId: partyId || null,
          date: new Date(date || new Date()),
          subtotal: roundMoney(subtotal),
          discountAmount: roundMoney(discount),
          cgst: roundMoney(cgst),
          sgst: roundMoney(sgst),
          igst: roundMoney(igst),
          totalAmount,
          roundOff: roundMoney(roundOff),  // 🔒 V12
          paidAmount: roundMoney(finalPaid),
          paymentMode: paymentMode || 'cash',
          isInterState: !!isInterState,
          notes: notes || null,
          invoiceNo: invoiceNo || null,
          grossProfit: roundMoney(grossProfit),
          // V17-Ext Tier 3: Credit/Debit Notes fields — preserve existing
          // values when the client doesn't send them (edit dialog omits them).
          originalTransactionId: originalTransactionId !== undefined ? (originalTransactionId || null) : existing.originalTransactionId,
          noteType: noteType !== undefined ? noteType : existing.noteType,
          noteReason: noteReason !== undefined ? (noteReason || null) : existing.noteReason,
          // Uses the SAME resolved value the stock logic above used, so the
          // stored flag and the stock movement can never disagree.
          affectsStock: resolvedAffectsStock,
          items: { create: txItems },
        },
        include: { items: true, party: true },
      })

      // Step 4: Apply new items' stock impact
      // V17-Ext Tier 3: Uses direction variables (same pattern as POST)
      if (shouldDecrementStock && stockPolicy === 'block') {
        for (const item of txItems) {
          if (!item.productId) continue
          const qty = item.quantity || 0
          const result = await tx.product.updateMany({
            where: { id: item.productId, userId, currentStock: { gte: qty } },
            data: { currentStock: { decrement: qty } },
          })
          if (result.count === 0) {
            const err: any = new Error('STOCK_BLOCK')
            err.code = 'STOCK_BLOCK'
            err.productName = item.productName
            err.requestedQty = qty
            throw err
          }
        }
      } else if (shouldAffectStock) {
        await Promise.all(txItems.filter(i => i.productId).map(item => {
          const qty = item.quantity || 0
          if (shouldDecrementStock) {
            return tx.product.updateMany({
              where: { id: item.productId!, userId },
              data: { currentStock: { decrement: qty } },
            })
          } else {
            return tx.product.updateMany({
              where: { id: item.productId!, userId },
              data: { currentStock: { increment: qty } },
            })
          }
        }))
      }

      return txn
    })

    // 🔒 FIX M-NEW-1: Check for potential double-counting. If the party has
    // standalone Payments AND the invoice's paidAmount > 0, warn the user.
    //
    // 🔒 V16 C4: Filter deletedAt: null on the payment count — was counting
    // soft-deleted payments (V15 M-3) as if they were active, which caused
    // spurious double-count warnings on every invoice edit for a party that
    // V17-Ext 5.1: Log field-level changes for audit trail.
    // `existing` was fetched at the top of PUT (before any changes).
    // `transaction` is the updated record returned by the $transaction.
    // The helper diffs each tracked field and creates a FieldChangeLog row
    // for each one that changed. Fire-and-forget — never throws.
    await logFieldChanges({
      userId,
      entityType: 'transaction',
      entityId: id,
      oldValues: existing,
      newValues: transaction,
      fieldsToTrack: TRACKED_TRANSACTION_FIELDS,
      changedByUserId: authCtx.actingUserId,
    })

    // had any historical (now-deleted) payment. Same alert-fatigue failure
    // mode as the original M-NEW-1 heuristic, just via a different path.
    let warning: string | null = null
    if (partyId && finalPaid > 0) {
      const paymentCount = await db.payment.count({
        where: { userId, partyId, deletedAt: null },
      })
      if (paymentCount > 0) {
        warning = `This party has ${paymentCount} standalone payment(s) recorded. If those payments include what you're entering as "paid amount" here, the balance will be reduced twice. To avoid double-counting, either edit the invoice's paid amount OR use "Settle Payment" — not both.`
      }
    }

    return NextResponse.json({ transaction, warning })
  } catch (error: any) {
    // 🔒 FIX H1: Catch the STOCK_BLOCK error from inside the $transaction.
    if (error?.code === 'STOCK_BLOCK') {
      return NextResponse.json({
        error: 'Not enough stock',
        message: `Another sale just took the last ${error.requestedQty} units of ${error.productName}. Please try again or record a purchase first.`,
        hint: 'To allow overselling, go to Settings and turn on "Allow overselling (kirana mode)".',
      }, { status: 400 })
    }
    // 🔒 V26 R4 (Phase 5): Catch EDIT_GONE — the transaction was deleted by a
    // concurrent request while this PUT was in flight. The pre-tx fetch saw it
    // alive, but the FOR UPDATE inside the tx found deletedAt != null. Return
    // 409 (not 404) so the client knows it was a race, not a wrong URL.
    if (error?.code === 'EDIT_GONE') {
      return NextResponse.json({
        error: 'Transaction was deleted',
        message: 'This transaction was deleted by another request while you were editing it. Please reload and try again.',
      }, { status: 409 })
    }
    // 🔒 V26 R5 (Phase 5): Catch NOTE_VALIDATION_FAILED — the inside-tx note-cap
    // check failed (a concurrent note-create committed between our pre-tx check
    // and the FOR UPDATE lock). Return the same 400 body shape as the pre-tx checks.
    if (error?.message === 'NOTE_VALIDATION_FAILED') {
      return NextResponse.json(
        { error: error.error, message: error.userMessage },
        { status: error.status || 400 },
      )
    }
    return apiError(error, 'Failed to update transaction', 500)
  }
}

// DELETE /api/transactions/[id]
// 🔒 AUDIT FIX M7+N5 (v3): Soft delete + stock reversal, wrapped in $transaction.
// Was: soft-delete and stock reversal were separate awaits (not atomic).
// Now: all operations in a single $transaction — all succeed or all roll back.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 🔒 FIX H1: Use getAuthContext for staff permission check
    const authCtx = await getAuthContext()
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    const { id } = await params
    const existing = await db.transaction.findFirst({ where: { id, userId, deletedAt: null } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // 🔒 FIX H1: Check staff permission based on transaction type
    // V17-Ext Tier 3: credit-note maps to sales, debit-note maps to purchases
    const moduleKey: ModuleKey = existing.type === 'purchase' || existing.type === 'debit-note' ? 'purchases' : existing.type === 'income' || existing.type === 'expense' ? 'incomeExpense' : 'sales'
    if (!canAccessModule(authCtx.role, authCtx.permissions, moduleKey)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 🔒 V17-Ext Tier 3 Step 3: CAs are read-only — block transaction deletion
    const writeError = assertCanWrite(authCtx)
    if (writeError) return writeError

    // 🔒 V17-Ext §5.1: Period lock check. You can't soft-delete (void) a
    // transaction that's in a locked period — voiding changes the period's
    // totals retroactively, which corrupts filed GST returns.
    try {
      await assertPeriodNotLocked(userId, existing.date)
    } catch (e) {
      if (e instanceof PeriodLockedError) {
        return NextResponse.json({ error: e.message, code: 'PERIOD_LOCKED' }, { status: 403 })
      }
      throw e
    }

    // 🔒 V19-004 FIX: Check for linked credit/debit notes before deleting.
    // If a sale has credit notes, deleting the sale would leave the credit
    // notes orphaned — they'd continue to reduce the party balance with no
    // original sale to credit against (double-counted credit).
    const linkedNotes = await db.transaction.findMany({
      where: { originalTransactionId: id, deletedAt: null },
      select: { id: true, invoiceNo: true, type: true, totalAmount: true },
    })
    if (linkedNotes.length > 0) {
      return NextResponse.json({
        error: 'Cannot delete — linked credit/debit notes exist',
        message: `This transaction has ${linkedNotes.length} linked credit/debit note(s). Please delete them first.`,
        linkedNotes: linkedNotes.map(n => ({ id: n.id, invoiceNo: n.invoiceNo, type: n.type })),
      }, { status: 400 })
    }

    // V17-Ext Tier 3: Compute stock direction for reversal
    const delShouldDecrement = existing.type === 'sale' || (existing.type === 'debit-note' && existing.affectsStock)
    const delShouldIncrement = existing.type === 'purchase' || (existing.type === 'credit-note' && existing.affectsStock)
    const delAffectsStock = delShouldDecrement || delShouldIncrement

    // 🔒 N5: Wrap soft-delete + stock reversal in $transaction
    await db.$transaction(async (tx) => {
      // 🔒 V26 R4 (Phase 5): Lock the row + re-check deletedAt + re-check
      // linkedNotes INSIDE the tx. Was: linkedNotes check ran outside the tx
      // (line 616), so a concurrent CN create (whose own validation read the
      // original as alive) could commit after the check → orphaned CN.
      // Now: FOR UPDATE serializes note-writers + deleters per original invoice.
      await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`
      const fresh = await tx.transaction.findFirst({ where: { id, userId, deletedAt: null } })
      if (!fresh) {
        // Already deleted by a concurrent request — treat as idempotent success.
        // (The offline queue may replay a DELETE after a lost response; the row
        // is already soft-deleted → return success, don't dead-letter.)
        return
      }
      // Re-check linked notes inside the lock.
      const linkedNotesLocked = await tx.transaction.findMany({
        where: { originalTransactionId: id, deletedAt: null },
        select: { id: true, invoiceNo: true, type: true, totalAmount: true },
      })
      if (linkedNotesLocked.length > 0) {
        const err: any = new Error('LINKED_NOTES_EXIST')
        err.code = 'LINKED_NOTES_EXIST'
        err.linkedNotes = linkedNotesLocked
        throw err
      }

      // Step 1: Soft delete
      await tx.transaction.update({
        where: { id },
        data: { deletedAt: new Date() },
      })

      // Step 2: Reverse stock impact (items read INSIDE the lock — fresh snapshot)
      // V17-Ext Tier 3: Handles credit-note (reverse increment) and debit-note (reverse decrement)
      if (delAffectsStock) {
        const items = await tx.transactionItem.findMany({ where: { transactionId: id } })
        for (const item of items) {
          if (item.productId) {
            if (delShouldDecrement) {
              // Reverse a decrement (sale or debit-note): add stock back
              await tx.product.updateMany({
                where: { id: item.productId, userId },
                data: { currentStock: { increment: item.quantity } },
              })
            } else {
              // Reverse an increment (purchase or credit-note): subtract stock
              // 🔒 V26 H2 FIX: Same gte guard + clamp-at-0 as PUT reversal.
              const delReverseResult = await tx.product.updateMany({
                where: { id: item.productId, userId, currentStock: { gte: item.quantity } },
                data: { currentStock: { decrement: item.quantity } },
              })
              if (delReverseResult.count === 0) {
                await tx.product.updateMany({
                  where: { id: item.productId, userId },
                  data: { currentStock: 0 },
                })
              }
            }
          }
        }
      }
    })

    return NextResponse.json({ success: true, message: 'Transaction deleted (soft delete — can be restored)' })
  } catch (error: any) {
    // 🔒 V26 R4 (Phase 5): Catch LINKED_NOTES_EXIST — a linked note was created
    // by a concurrent request between the pre-tx check and the FOR UPDATE lock.
    // Return the same 400 body as the pre-tx check would have.
    if (error?.code === 'LINKED_NOTES_EXIST') {
      return NextResponse.json({
        error: 'Cannot delete — linked credit/debit notes exist',
        message: `This transaction has ${error.linkedNotes.length} linked credit/debit note(s). Please delete them first.`,
        linkedNotes: error.linkedNotes.map((n: any) => ({ id: n.id, invoiceNo: n.invoiceNo, type: n.type })),
      }, { status: 400 })
    }
    return apiError(error, 'Failed to delete transaction', 500)
  }
}
