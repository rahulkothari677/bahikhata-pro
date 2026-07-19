'use client'

/**
 * 🔒 V22-9 (Phase 7) — HSN Summary Report
 *
 * Shows HSN/SAC-wise summary for GSTR-1 filing: HSN code, description, qty,
 * taxable value, CGST, SGST, IGST, total tax.
 *
 * Required for GSTR-1 if turnover > ₹1.5 crore (but useful for all businesses).
 * Self-contained: receives data as prop from Reports.tsx.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatINR, cn } from '@/lib/utils'
import { Hash } from 'lucide-react'

interface HsnSummaryProps {
  data: any
}

export function HsnSummary({ data }: HsnSummaryProps) {
  const summary = data?.summary || { totalHsnCodes: 0, totalTaxableValue: 0, totalTax: 0 }
  const hsnSummary = data?.hsnSummary || []

  return (
    <div className="space-y-4">
      {/* Summary stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl bg-card border border-border/60 shadow-card p-4">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-2 bg-blue-100 dark:bg-blue-950">
            <Hash className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-3xs text-muted-foreground uppercase tracking-wide font-semibold">HSN Codes</p>
          <p className="text-lg font-bold tabular-nums mt-0.5 text-blue-600 dark:text-blue-400">{summary.totalHsnCodes}</p>
        </div>
        <div className="rounded-2xl bg-card border border-border/60 shadow-card p-4">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-2 bg-amber-100 dark:bg-amber-950">
            <Hash className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="text-3xs text-muted-foreground uppercase tracking-wide font-semibold">Total Taxable Value</p>
          <p className="text-lg font-bold tabular-nums mt-0.5 text-amber-600 dark:text-amber-400">{formatINR(summary.totalTaxableValue)}</p>
        </div>
        <div className="rounded-2xl bg-card border border-border/60 shadow-card p-4">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-2 bg-violet-100 dark:bg-violet-950">
            <Hash className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          </div>
          <p className="text-3xs text-muted-foreground uppercase tracking-wide font-semibold">Total Tax</p>
          <p className="text-lg font-bold tabular-nums mt-0.5 text-violet-600 dark:text-violet-400">{formatINR(summary.totalTax)}</p>
        </div>
      </div>

      {/* HSN table */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Hash className="w-4 h-4 text-primary" />
            HSN/SAC-wise Summary
          </CardTitle>
          <p className="text-xs text-muted-foreground">For GSTR-1 filing — outward supplies by HSN code</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-2 font-medium text-muted-foreground">HSN/SAC</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground">Description</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Qty</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-center">GST Rate</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Taxable Value</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">CGST</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">SGST</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">IGST</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Total Tax</th>
                </tr>
              </thead>
              <tbody>
                {hsnSummary.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-muted-foreground">
                      No HSN-coded items in sales for this period. Add HSN codes to your products to see this report.
                    </td>
                  </tr>
                ) : (
                  hsnSummary.map((row: any) => (
                    <tr key={row.hsn} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-2 font-mono font-medium">{row.hsn}</td>
                      <td className="py-2 px-2 truncate max-w-[200px]">{row.description}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{row.totalQty} {row.unit}</td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant="outline" className="text-3xs">{row.gstRate}%</Badge>
                      </td>
                      <td className="py-2 px-2 text-right font-medium">{formatINR(row.taxableValue)}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{row.cgst > 0 ? formatINR(row.cgst) : '—'}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{row.sgst > 0 ? formatINR(row.sgst) : '—'}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{row.igst > 0 ? formatINR(row.igst) : '—'}</td>
                      <td className="py-2 px-2 text-right font-semibold text-violet-600 dark:text-violet-400">{formatINR(row.totalTax)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {hsnSummary.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-2 px-2" colSpan={4}>Total</td>
                    <td className="py-2 px-2 text-right">{formatINR(summary.totalTaxableValue)}</td>
                    <td colSpan={3}></td>
                    <td className="py-2 px-2 text-right text-violet-600 dark:text-violet-400">{formatINR(summary.totalTax)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
