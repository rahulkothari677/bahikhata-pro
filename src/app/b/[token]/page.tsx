/**
 * The public bill page — what a customer sees when they tap the link.
 *
 * 📄 Phase 4 of docs/DOCUMENT-ENGINE-PLAN.md.
 *
 * NO LOGIN, by design: the reader is a customer with no account. The token in
 * the URL is the entire credential, which is why it is 192 bits of CSPRNG
 * output and why this page is `noindex`.
 *
 * WHAT IS DELIBERATELY NOT ON IT. A tax invoice under Rule 46 must name the
 * recipient and carry their GSTIN and address — a customer claiming input tax
 * credit needs them — so those are here. The party's PHONE NUMBER is not: it
 * is not required by Rule 46, it is the most sensitive field on the record, and
 * anyone holding the link can read this page. The bill loses nothing by leaving
 * it off, and a link forwarded to a group chat stops being a phone number leak.
 */

import type { Metadata, Viewport } from 'next'
import { db } from '@/lib/db'
import { isWellFormedToken, isShareLinkUsable, DEAD_LINK_MESSAGE } from '@/lib/bill-share'
import { buildInvoiceDocument, invoiceShopFromSetting } from '@/lib/invoice-document'
import { computePartyBalance } from '@/lib/party-balance'
import { PublicBill } from './PublicBill'

/**
 * Never indexed.
 *
 * A link pasted into a public WhatsApp group would otherwise be crawled and a
 * customer's bill would end up in a search engine — the failure that turns a
 * convenience into a data breach.
 */
export const metadata: Metadata = {
  title: 'Bill',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * This page declares its OWN viewport, and deliberately differs from the app's.
 *
 * 🐛 2026-08-06. Rahul opened a bill link on his phone and it rendered as a
 * narrow column in the middle of the screen. The served HTML carried NO viewport
 * meta at all, so the browser fell back to its ~980px desktop default and then
 * shrank everything to fit — the page was not too narrow, the viewport was too
 * wide.
 *
 * `userScalable` is TRUE here, where the app sets it false. That is right for an
 * app, whose layout is fixed and where a stray pinch is an accident. It is wrong
 * for a DOCUMENT: someone checking a figure on a bill should be able to zoom
 * into it, and a customer with poor eyesight should not be locked out of reading
 * what they owe.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  userScalable: true,
}

// Always fresh: a bill that has been part-paid since it was sent must say so.
// That is the whole advantage a link has over a PDF, and caching would remove it.
export const dynamic = 'force-dynamic'

export default async function BillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  // Rejected before a database round trip. A malformed token is either a typo
  // or someone probing, and neither deserves a query.
  if (!isWellFormedToken(token)) return <DeadLink />

  /*
   * ⚠️ TWO QUERIES, AND THE SECOND ONE IS NOT OPTIONAL.
   *
   * The obvious version of this — one `billShare.findUnique` with the
   * transaction and its items included — SHIPPED, and every amount on the page
   * came out 100× too large. A ₹600 bill read as ₹60,000.
   *
   * Money is stored as integer paise and converted to rupees by a Prisma client
   * extension. That extension only intercepts models it has a hand-written
   * handler for, and `BillShare` has none — so nothing in a query rooted at
   * BillShare is converted, however deeply nested. Registering the relation
   * would not have helped: with no handler, the extension never sees the query
   * at all.
   *
   * So the bill is fetched through `db.transaction`, which IS intercepted. The
   * share row is used for nothing but the token, the expiry and the counter —
   * none of which are money.
   */
  const share = await db.billShare.findUnique({
    where: { token },
    select: {
      id: true,
      userId: true,
      transactionId: true,
      expiresAt: true,
      revokedAt: true,
      token: true,
      firstViewedAt: true,
    },
  })

  if (!share || !isShareLinkUsable(share)) return <DeadLink />

  /*
   * 🔒 A DELETED BILL IS NOT VIEWABLE, even through a link minted while it was
   * live. Deleting a bill has to mean it stops being served — otherwise the
   * link is a copy that outlives the delete, which the shopkeeper could not
   * undo. `deletedAt: null` in the WHERE, so a deleted bill simply is not found.
   */
  const txn = await db.transaction.findFirst({
    where: { id: share.transactionId, deletedAt: null },
    // 📄 Phase 4: the product notes ride along for the item-description toggle.
    include: { items: { include: { product: { select: { notes: true } } } }, party: true },
  })
  if (!txn) return <DeadLink />

  const settingRow = await db.setting.findFirst({ where: { userId: share.userId } })
  const setting = settingRow

  /*
   * 📄 Phase 4 — the customer's total outstanding, only if the shop asked.
   *
   * Gated on the setting for the same reason as the API route: this is six
   * aggregates over the party's whole history, and running it for every
   * opened link to serve a toggle that is off by default is a cost with no
   * reader. `share.userId`, never a value from the URL — the token proves
   * which bill, it does not get to choose whose books are read.
   */
  const partyBalance = setting?.showPartyBalance && txn.partyId
    ? (await computePartyBalance(share.userId, txn.partyId)).balance
    : null

  /*
   * Counting the view is the point of the link — sent, then opened, then paid
   * is what a shopkeeper chasing money wants to know.
   *
   * No IP, user agent or device data is stored with it. Knowing the bill was
   * opened is useful to the shop; building a profile of the customer who opened
   * it is not ours to do, and under the DPDP Act it would need a purpose we do
   * not have. `updateMany` rather than `update` so a link revoked between the
   * read above and this write simply updates nothing.
   */
  const now = new Date()
  await db.billShare
    .updateMany({
      where: { id: share.id },
      data: {
        viewCount: { increment: 1 },
        lastViewedAt: now,
        ...(share.firstViewedAt ? {} : { firstViewedAt: now }),
      },
    })
    .catch(() => {
      // A failed counter must never cost the customer their bill.
    })

  const doc = buildInvoiceDocument(
    {
      invoiceNo: txn.invoiceNo,
      date: txn.date,
      type: txn.type,
      // Rule 48(4): both must appear on an e-invoice. This mapping is explicit,
      // so a field added to InvoiceSource does NOT arrive here on its own —
      // which is precisely how TransactionItem.hsn stayed blank for a year.
      irn: txn.irn,
      signedQR: txn.signedQR,
      party: txn.party
        ? {
            name: txn.party.name,
            // Phone deliberately omitted — see the note at the top.
            gstin: txn.party.gstin,
            address: txn.party.address,
            state: txn.party.state,
          }
        : null,
      items: txn.items.map(i => ({
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        gstRate: i.gstRate,
        total: i.total,
        unit: i.unit ?? undefined,
        hsn: i.hsn,
        // 📄 Phase 4. Listed explicitly, like everything else here: the note
        // above is right that a field arriving on its own is how HSN stayed
        // blank for a year, so these three are named rather than spread.
        description: i.product?.notes ?? null,
        enteredQuantity: i.enteredQuantity,
        enteredUnit: i.enteredUnit,
      })),
      subtotal: txn.subtotal,
      discountAmount: txn.discountAmount,
      cgst: txn.cgst,
      sgst: txn.sgst,
      igst: txn.igst,
      totalAmount: txn.totalAmount,
      roundOff: txn.roundOff ?? 0,
      paidAmount: txn.paidAmount,
      paymentMode: txn.paymentMode,
      isInterState: txn.isInterState ?? false,
      partyBalance,
    } as never,
    // 📄 Phase 4: the same mapper the app's own screens use, so the page the
    // customer opens carries the shop's choices rather than a subset of them.
    // This call site previously passed nine fields and silently dropped the
    // terms, the bank block and the signature that Phase 3 added.
    invoiceShopFromSetting(setting),
  )

  return <PublicBill doc={doc} themeId={setting?.invoiceTheme} />
}

/**
 * The same page for expired, revoked and never-existed.
 *
 * Telling a holder of a dead token that the bill "was withdrawn" confirms the
 * bill and the shop exist. The shopkeeper sees the real status in their own app.
 */
function DeadLink() {
  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-slate-200 grid place-items-center mb-4">
          <span className="text-2xl" aria-hidden>🧾</span>
        </div>
        <h1 className="text-lg font-semibold text-slate-800 mb-2">Bill not available</h1>
        <p className="text-sm text-slate-600">{DEAD_LINK_MESSAGE}</p>
      </div>
    </main>
  )
}
