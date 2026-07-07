import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { roundMoney } from '@/lib/money'
import { apiError } from '@/lib/api-error'

// POST /api/whatsapp-reminder - generate WhatsApp reminder link for outstanding dues
export async function POST(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('parties')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { partyId } = await req.json()

    const party = await db.party.findFirst({
      where: { id: partyId, userId },
      include: {
        transactions: {
          where: { type: 'sale' },
          orderBy: { date: 'desc' },
        },
      },
    })

    if (!party) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // 💰 MONEY (Audit fix Phase 8): roundMoney on balance calculation
    const salesOutstanding = roundMoney(party.transactions.reduce((s, t) => s + (t.totalAmount - t.paidAmount), 0))
    const balance = roundMoney(party.openingBalance + salesOutstanding)

    if (balance <= 0) {
      return NextResponse.json({ error: 'No outstanding dues for this customer' }, { status: 400 })
    }

    const setting = await db.setting.findUnique({ where: { userId } })

    const unpaidTxns = party.transactions
      .filter(t => t.totalAmount - t.paidAmount > 0)
      .sort((a, b) => a.date.getTime() - b.date.getTime())

    const oldestUnpaid = unpaidTxns[0]
    const daysOverdue = oldestUnpaid
      ? Math.floor((Date.now() - oldestUnpaid.date.getTime()) / 86400000)
      : 0

    const lines: string[] = []
    lines.push(`Namaste ${party.name} 🙏`)
    lines.push('')
    lines.push(`This is a friendly reminder from ${setting?.shopName || 'our shop'}.`)
    lines.push('')
    lines.push(`* Outstanding Amount: ₹${balance.toFixed(2)} *`)
    
    if (daysOverdue > 0) {
      lines.push(`Oldest unpaid: ${daysOverdue} days ago`)
    }

    if (unpaidTxns.length > 0) {
      lines.push('')
      lines.push('Unpaid invoices:')
      unpaidTxns.slice(0, 5).forEach((t, i) => {
        const due = t.totalAmount - t.paidAmount
        lines.push(`${i + 1}. ${t.invoiceNo || 'Bill'} - ₹${due.toFixed(2)}`)
      })
      if (unpaidTxns.length > 5) {
        lines.push(`...and ${unpaidTxns.length - 5} more`)
      }
    }

    lines.push('')
    lines.push('Please clear the payment at your earliest convenience.')
    lines.push('Thank you for your business! 🙏')
    lines.push('')
    lines.push(`- ${setting?.ownerName || setting?.shopName || 'Shop Owner'}`)
    if (setting?.phone) lines.push(`📞 ${setting.phone}`)

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
      unpaidCount: unpaidTxns.length,
      daysOverdue,
    })
  } catch (error) {
    return apiError(error, 'Failed to generate reminder', 500)
  }
}
