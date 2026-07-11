import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthContextForWrite } from '@/lib/get-auth'
import { roundMoney } from '@/lib/money'
import { apiError } from '@/lib/api-error'
import { computePartyBalance } from '@/lib/party-balance'
import { generateUpiLink } from '@/lib/upi-link'

// POST /api/whatsapp-reminder - generate WhatsApp reminder link for outstanding dues
export async function POST(req: NextRequest) {
  try {
    // 🔒 V17-Ext Tier 3 Step 3: getAuthContextForWrite blocks CAs (read-only).
    // WhatsApp reminders are an owner/staff action — CAs view but don't send.
    const authCtx = await getAuthContextForWrite('parties')
    if (authCtx.error || !authCtx.userId) return authCtx.error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = authCtx.userId

    const { partyId } = await req.json()

    const party = await db.party.findFirst({
      // 🔒 V16 C3: Filter deletedAt: null on Party — was missing, so a
      // soft-deleted party could still receive a reminder if the user
      // navigated to its reminder button somehow.
      where: { id: partyId, userId, deletedAt: null },
      include: {
        transactions: {
          // 🔒 V16 C3: Filter deletedAt: null on Transaction — was missing,
          // so soft-deleted invoices appeared in the "Unpaid invoices" list
          // of the WhatsApp message, demanding payment for invoices the
          // shopkeeper had already voided. Same bug class as V15 §1 Site 3
          // (party-detail statement) which IS filtered; this site was missed.
          // 🔒 V17 Audit Phase 5 (Bug H): Include credit notes so the per-invoice
          // breakdown shows returns. Was: type: 'sale' only → a customer who
          // returned goods saw their original invoices at full amount with no
          // credit note listed → the per-invoice sum > actual balance.
          where: { type: { in: ['sale', 'credit-note'] }, deletedAt: null },
          orderBy: { date: 'desc' },
        },
      },
    })

    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // 🔒 FIX V15 §1: Use computePartyBalance() — the single source of truth
    // that includes standalone payments AND purchases. Was: inline math that
    // only counted sales outstanding (no purchases, no payments), so the
    // reminder demanded money the customer had already paid.
    const partyBalance = await computePartyBalance(userId, partyId)
    const balance = partyBalance.balance

    if (balance <= 0) {
      return NextResponse.json({ error: 'No outstanding dues for this customer' }, { status: 400 })
    }

    const setting = await db.setting.findUnique({ where: { userId } })

    // 🔒 V17 Audit Phase 5 (Bug H): Separate sales (outstanding > 0) from
    // credit notes (which reduce the balance). Was: filtered all to
    // `totalAmount - paidAmount > 0` which excluded credit notes entirely.
    // Now: sales with outstanding are "invoices", credit notes are "credits".
    const unpaidSales = party.transactions
      .filter(t => t.type === 'sale' && (t.totalAmount - t.paidAmount) > 0.01)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
    const creditNotes = party.transactions
      .filter(t => t.type === 'credit-note')
      .sort((a, b) => a.date.getTime() - b.date.getTime())

    const oldestUnpaid = unpaidSales[0]
    const daysOverdue = oldestUnpaid
      ? Math.floor((Date.now() - oldestUnpaid.date.getTime()) / 86400000)
      : 0

    // V17-Ext 5.4: Generate UPI deep-link for one-tap payment.
    // If the shopkeeper has configured their UPI VPA (Setting.upiId), the
    // reminder includes a upi://pay?... link that opens the customer's UPI
    // app with the amount pre-filled. The customer pays, then the shopkeeper
    // confirms via "Settle Payment" in the app.
    const upiId = setting?.upiId || null
    const upiLink = upiId
      ? generateUpiLink(
          upiId,
          setting?.shopName || 'Shop',
          balance,
          `Payment to ${setting?.shopName || 'shop'}`,
        )
      : null

    const lines: string[] = []
    lines.push(`Namaste ${party.name} 🙏`)
    lines.push('')
    lines.push(`This is a friendly reminder from ${setting?.shopName || 'our shop'}.`)
    lines.push('')
    lines.push(`* Outstanding Amount: Rs. ${balance.toFixed(2)} *`)

    if (daysOverdue > 0) {
      lines.push(`Oldest unpaid: ${daysOverdue} days ago`)
    }

    // V17-Ext 5.4: Add UPI pay link if configured
    if (upiLink) {
      lines.push('')
      lines.push('Tap to pay via UPI:')
      lines.push(upiLink)
    }

    if (unpaidSales.length > 0) {
      lines.push('')
      lines.push('Unpaid invoices:')
      unpaidSales.slice(0, 5).forEach((t, i) => {
        const due = t.totalAmount - t.paidAmount
        lines.push(`${i + 1}. ${t.invoiceNo || 'Bill'} - Rs. ${due.toFixed(2)}`)
      })
      if (unpaidSales.length > 5) {
        lines.push(`...and ${unpaidSales.length - 5} more`)
      }
    }

    // 🔒 V17 Audit Phase 5 (Bug H): Show credit notes (returns) so the customer
    // sees the true net outstanding. Without this, the invoice list sum > balance.
    if (creditNotes.length > 0) {
      lines.push('')
      lines.push('Credit notes (returns):')
      creditNotes.slice(0, 3).forEach((t, i) => {
        lines.push(`${i + 1}. ${t.invoiceNo || 'CN'} - Rs. ${t.totalAmount.toFixed(2)}`)
      })
      if (creditNotes.length > 3) {
        lines.push(`...and ${creditNotes.length - 3} more`)
      }
    }

    lines.push('')
    lines.push('Please clear the payment at your earliest convenience.')
    lines.push('Thank you for your business! 🙏')
    lines.push('')
    lines.push(`- ${setting?.ownerName || setting?.shopName || 'Shop Owner'}`)
    if (setting?.phone) lines.push(`Phone: ${setting.phone}`)

    const message = encodeURIComponent(lines.join('\n'))

    let whatsappUrl: string
    if (party.phone) {
      let phone = party.phone.replace(/\D/g, '')
      if (phone.length === 10) phone = '91' + phone
      whatsappUrl = `https://wa.me/${phone}?text=${message}`
    } else {
      whatsappUrl = `https://wa.me/?text=${message}`
    }

    return NextResponse.json({
      success: true,
      whatsappUrl,
      balance,
      unpaidCount: unpaidSales.length,  // 🔒 V17 Audit Phase 5: was unpaidTxns (renamed)
      daysOverdue,
      upiLink, // V17-Ext 5.4: returned so the UI can show a "Copy UPI Link" button
      upiId: upiId, // returned so the UI knows whether UPI is configured
    })
  } catch (error) {
    return apiError(error, 'Failed to generate reminder', 500)
  }
}
