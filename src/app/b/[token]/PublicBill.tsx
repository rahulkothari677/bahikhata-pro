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

import { QRCodeSVG } from 'qrcode.react'
import type { InvoiceDocument } from '@/lib/invoice-document'
import { getInvoiceTheme } from '@/lib/invoice-themes'

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function PublicBill({ doc, themeId }: { doc: InvoiceDocument; themeId?: string | null }) {
  const isDue = doc.due > 0
  /*
   * The same theme the picture and the PDF use, so a shop's bill and its
   * payment page are recognisably one business. Applied as inline styles rather
   * than Tailwind classes because the palette is data — a class name cannot be
   * computed from a database column without a safelist for every theme.
   */
  const theme = getInvoiceTheme(themeId)

  return (
    <main className="min-h-screen bg-slate-100 pb-28">
      <div className="mx-auto max-w-lg bg-white shadow-sm">
        {/* ── who is billing ─────────────────────────────────────────── */}
        <header className="px-5 py-6" style={{ background: theme.headerBg, color: theme.headerText }}>
          <div className="flex items-start gap-3">
            {doc.shop.logoUrl && (
              <img
                src={doc.shop.logoUrl}
                alt=""
                className="w-12 h-12 object-contain bg-white rounded p-1 flex-none"
              />
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight">{doc.shop.name}</h1>
              <p className="text-xs mt-1" style={{ color: theme.headerMuted }}>
                {[doc.shop.phone, doc.shop.gstin && `GSTIN ${doc.shop.gstin}`].filter(Boolean).join('  ·  ')}
              </p>
              {doc.shop.address && (
                <p className="text-xs mt-0.5" style={{ color: theme.headerMuted }}>
                  {doc.shop.address}
                </p>
              )}
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
              <tr className="text-2xs text-slate-500 border-b-2" style={{ borderColor: theme.accent }}>
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
            {/* The accent on the grand total, matching the picture and the PDF. */}
            <Row label="Total" value={money(doc.total)} bold accentColor={theme.accent} />
            {doc.paid > 0 && <Row label="Paid" value={money(doc.paid)} className="text-green-700" />}
          </dl>

          <p className="mt-4 text-2xs text-slate-500">{doc.totalInWords}</p>

          {/*
            * e-invoice block. Rule 48(4) requires the IRN and the SIGNED QR
            * from the portal to appear on the invoice — an invoice without them
            * counts as non-issuance, with penalties under Section 122 and the
            * buyer's input credit at risk.
            *
            * The QR must carry the SIGNED string exactly as the portal returned
            * it. It is what a GST officer's app scans and verifies against the
            * government's own record; re-encoding anything else would produce a
            * QR that looks right and fails verification.
            *
            * Absent for the great majority of shops, who are below the ₹5 crore
            * threshold and correctly have no IRN.
            */}
          {doc.irn && (
            <div className="mt-5 pt-4 border-t border-slate-200 flex items-start gap-3">
              {/*
                * Rendered LOCALLY with qrcode.react, never via an image service.
                * The signed QR is the government's cryptographic attestation of
                * this invoice; posting it to a third-party generator would hand
                * a stranger every bill the shop issues, and would leave the
                * legally required element blank whenever that service is down or
                * the phone is offline.
                */}
              {doc.signedQR && (
                <div className="flex-shrink-0">
                  <QRCodeSVG value={doc.signedQR} size={80} level="M" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-2xs font-semibold text-slate-700">e-Invoice</p>
                <p className="text-3xs text-slate-500 break-all font-mono mt-0.5">IRN: {doc.irn}</p>
              </div>
            </div>
          )}

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
          {/*
            🐛 2026-08-06. Rahul: "there is no pay now button in both the link."

            The button is gated on the shop having a UPI ID, and his shop has
            none — `buildUpiLink` returns null without one, because a Pay button
            that opens a UPI app and then fails is worse than no button.

            But hiding it silently was the wrong answer. The customer was left
            looking at money owed with no way to act, and the shopkeeper had no
            idea why. So there is ALWAYS an action now: pay by UPI when the shop
            can accept it, and call the shop when it cannot.
          */}
          {isDue && doc.upiLink ? (
            <a
              href={doc.upiLink}
              className="flex-none rounded-xl px-5 py-3 text-sm font-semibold text-white"
              style={{ background: theme.accent }}
            >
              Pay now
            </a>
          ) : isDue && doc.shop.phone ? (
            <a
              href={`tel:${doc.shop.phone.replace(/[^\d+]/g, '')}`}
              className="flex-none rounded-xl border border-slate-300 text-slate-800 px-5 py-3 text-sm font-semibold"
            >
              Call shop
            </a>
          ) : null}
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
  accentColor,
}: {
  label: string
  value: string
  bold?: boolean
  className?: string
  accentColor?: string
}) {
  return (
    <div className="flex justify-between">
      <dt className={bold ? 'font-bold text-slate-900' : 'text-slate-500'}>{label}</dt>
      <dd
        className={`${bold ? 'font-bold text-slate-900' : 'text-slate-700'} ${className}`}
        style={accentColor ? { color: accentColor } : undefined}
      >
        {value}
      </dd>
    </div>
  )
}
