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

  return (
    <div className="rounded-2xl border border-border/60 bg-muted/40 px-4 py-3 flex items-start gap-3">
      <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-medium">{doc.title}</p>
        {/*
          * The prescribed wording, verbatim. A friendlier paraphrase would not
          * do the job it exists for at an assessment.
          */}
        <p className="text-xs text-muted-foreground mt-0.5">{doc.declaration}</p>
        <p className="text-2xs text-muted-foreground mt-1">
          You are on the composition scheme, so this bill carries no GST and your customer cannot
          claim input credit from it. You pay tax on your turnover in CMP-08 each quarter.
        </p>
      </div>
    </div>
  )
}
