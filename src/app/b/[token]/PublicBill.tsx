/**
 * The bill, as a customer reads it on their phone.
 *
 * 📄 Phase 4. Deliberately NOT the WhatsApp image scaled up. The image exists
 * because a chat needs something readable without opening anything; this page
 * exists because a forty-item bill has no readable image, and a page can
 * scroll. So it is a real document: full item list, full tax breakup, and a Pay
 * button that a picture cannot have.
 *
 * Self-contained styling, no app chrome. The reader is not a user of EkBook and
 * should not be shown a nav bar for an app they do not have.
 */

import type { InvoiceDocument } from '@/lib/invoice-document'

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function PublicBill({ doc }: { doc: InvoiceDocument }) {
  const isDue = doc.due > 0

  return (
    <main className="min-h-screen bg-slate-100 pb-28">
      <div className="mx-auto max-w-lg bg-white shadow-sm">
        {/* ── who is billing ─────────────────────────────────────────── */}
        <header className="bg-slate-900 text-white px-5 py-6">
          <div className="flex items-start gap-3">
            {doc.shop.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={doc.shop.logoUrl}
                alt=""
                className="w-12 h-12 object-contain bg-white rounded p-1 flex-none"
              />
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight">{doc.shop.name}</h1>
              <p className="text-xs text-white/75 mt-1">
                {[doc.shop.phone, doc.shop.gstin && `GSTIN ${doc.shop.gstin}`].filter(Boolean).join('  ·  ')}
              </p>
              {doc.shop.address && <p className="text-xs text-white/60 mt-0.5">{doc.shop.address}</p>}
            </div>
          </div>
        </header>

        <div className="px-5 py-5">
          {/* ── which bill ───────────────────────────────────────────── */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">{doc.title}</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                No. {doc.invoiceNo} · {doc.dateLabel}
              </p>
            </div>
            <span
              className={[
                'text-2xs font-bold px-3 py-1 rounded-full text-white',
                doc.status === 'paid' ? 'bg-green-700' : doc.status === 'partial' ? 'bg-amber-600' : 'bg-red-700',
              ].join(' ')}
            >
              {doc.status === 'paid' ? 'PAID' : doc.status === 'partial' ? 'PART PAID' : 'DUE'}
            </span>
          </div>

          {/* ── billed to. No phone number: see the note in page.tsx ── */}
          {doc.party && (
            <div className="mt-5">
              <p className="text-2xs font-semibold text-slate-500 tracking-wide">BILLED TO</p>
              <p className="text-sm font-semibold text-slate-900 mt-1">{doc.party.name}</p>
              {doc.party.gstin && <p className="text-xs text-slate-500">GSTIN {doc.party.gstin}</p>}
              {doc.party.address && <p className="text-xs text-slate-500">{doc.party.address}</p>}
            </div>
          )}

          {/* ── items. A page can scroll, so nothing is truncated ────── */}
          <table className="w-full mt-5 text-sm">
            <thead>
              <tr className="text-2xs text-slate-500 border-b border-slate-200">
                <th className="text-left font-semibold py-2">ITEM</th>
                <th className="text-right font-semibold py-2 w-16">QTY</th>
                <th className="text-right font-semibold py-2 w-24">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((item, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="py-2.5 pr-2">
                    <span className="text-slate-900">{item.name}</span>
                    {(item.hsn || doc.hasTax) && (
                      <span className="block text-2xs text-slate-400">
                        {[item.hsn && `HSN ${item.hsn}`, doc.hasTax && `GST ${item.gstRate}%`]
                          .filter(Boolean)
                          .join('  ·  ')}
                      </span>
                    )}
                    <span className="block text-2xs text-slate-400">@ {money(item.rate)}</span>
                  </td>
                  <td className="py-2.5 text-right text-slate-700 whitespace-nowrap">{item.qty}</td>
                  <td className="py-2.5 text-right font-semibold text-slate-900 whitespace-nowrap">
                    {money(item.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── totals ───────────────────────────────────────────────── */}
          <dl className="mt-4 space-y-1.5 text-sm">
            <Row label="Subtotal" value={money(doc.subtotal)} />
            {doc.discount > 0 && <Row label="Discount" value={`− ${money(doc.discount)}`} />}
            {doc.hasTax &&
              (doc.igst > 0 ? (
                <Row label="IGST" value={money(doc.igst)} />
              ) : (
                <>
                  {doc.cgst > 0 && <Row label="CGST" value={money(doc.cgst)} />}
                  {doc.sgst > 0 && <Row label="SGST" value={money(doc.sgst)} />}
                </>
              ))}
            {doc.roundOff !== 0 && <Row label="Round off" value={money(doc.roundOff)} />}
            <Row label="Total" value={money(doc.total)} bold />
            {doc.paid > 0 && <Row label="Paid" value={money(doc.paid)} className="text-green-700" />}
          </dl>

          <p className="mt-4 text-2xs text-slate-500">{doc.totalInWords}</p>

          <div className="mt-5 pt-4 border-t border-slate-200 text-2xs text-slate-500 flex justify-between">
            {doc.placeOfSupply ? <span>Place of supply: {doc.placeOfSupply}</span> : <span />}
            <span>Payment: {doc.paymentMode}</span>
          </div>
        </div>
      </div>

      {/* ── pay, pinned where a thumb is ───────────────────────────────
          The one thing a picture or a PDF cannot do. Sticky because on a
          forty-item bill the amount due would otherwise be a scroll away. */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 px-5 py-3">
        <div className="mx-auto max-w-lg flex items-center justify-between gap-4">
          <div>
            <p className="text-2xs text-slate-500">{isDue ? 'Amount due' : 'Fully paid'}</p>
            <p className={`text-2xl font-bold ${isDue ? 'text-red-700' : 'text-green-700'}`}>
              {money(isDue ? doc.due : doc.total)}
            </p>
          </div>
          {isDue && doc.upiLink && (
            <a
              href={doc.upiLink}
              className="flex-none rounded-xl bg-slate-900 text-white px-5 py-3 text-sm font-semibold"
            >
              Pay now
            </a>
          )}
        </div>
      </div>
    </main>
  )
}

function Row({
  label,
  value,
  bold,
  className = '',
}: {
  label: string
  value: string
  bold?: boolean
  className?: string
}) {
  return (
    <div className="flex justify-between">
      <dt className={bold ? 'font-bold text-slate-900' : 'text-slate-500'}>{label}</dt>
      <dd className={`${bold ? 'font-bold text-slate-900' : 'text-slate-700'} ${className}`}>{value}</dd>
    </div>
  )
}
