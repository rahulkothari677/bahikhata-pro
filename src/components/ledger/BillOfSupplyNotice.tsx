'use client'

/**
 * A composition dealer's bill is a Bill of Supply, and must say so.
 *
 * WHY (2026-08-09). A composition dealer may not collect GST, so they may not
 * issue a tax invoice at all. Their document carries no tax lines and must
 * state on its face that the customer cannot claim credit from it — without
 * that line the customer has no way to know, and may try to claim input credit
 * they are not entitled to.
 *
 * Shown on the shop's own sale screens so the shopkeeper sees the same thing
 * their customer will. Silent for a regular shop, which is almost everyone.
 */

import { FileText } from 'lucide-react'
import { saleDocumentKind } from '@/lib/composition-scheme'
import { Notice } from '@/components/ui/notice'

export function BillOfSupplyNotice({
  compositionCategory,
  type,
}: {
  compositionCategory?: string | null
  type?: string
}) {
  if (type && type !== 'sale') return null
  const doc = saleDocumentKind(compositionCategory)
  // A regular shop issues a tax invoice; nothing to say.
  if (doc.showsTax || !doc.declaration) return null

  // Phase 4b: the one warning box. The prescribed wording stays on screen,
  // verbatim — a friendlier paraphrase would not do its job at an
  // assessment. The explanation of WHY moves behind ⓘ.
  return (
    <Notice
      level="note"
      icon={FileText}
      title={doc.title}
      info="You are on the composition scheme, so this bill carries no GST and your customer cannot claim input credit from it. You pay tax on your turnover in CMP-08 each quarter."
    >
      {doc.declaration}
    </Notice>
  )
}
