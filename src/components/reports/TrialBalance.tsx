'use client'

/**
 * 🔒 V22-9 (Phase 7) — Trial Balance Report
 *
 * Shows debit/credit balances for all accounts (Sales, Purchases, Expenses,
 * Income, Receivable, Payable). Includes a "Balanced" indicator.
 *
 * Used by CAs for accounting verification.
 * Self-contained: receives data as prop from Reports.tsx.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatINR, cn } from '@/lib/utils'
import { CheckCircle2, Scale } from 'lucide-react'

interface TrialBalanceProps {
  data: any
}

export function TrialBalance({ data }: TrialBalanceProps) {
  const summary = data?.summary || { totalDebit: 0, totalCredit: 0, difference: 0, isBalanced: true }
  const accounts = data?.accounts || []

  return (
    <div className="space-y-4">
      {/* Balance status banner */}
      {/* 🔒 AUDIT V23 FIX §2: Removed "Balanced/Out of Balance" banner.
          The Trial Balance structurally cannot balance because it's missing
          Cash/Bank, GST payable/receivable, and capital accounts. Showing
          "Out of Balance" to virtually every user destroys CA trust.
          Reframed as "Account Summary" — still shows debit/credit columns
          but no false "your books are broken" claim. A proper double-entry
          TB will be built in a future round. */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10 overflow-hidden">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-blue-100 dark:bg-blue-950">
                <Scale className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Account Summary</p>
                <p className="text-lg font-bold text-foreground">
                  Debit: {formatINR(summary.totalDebit)} · Credit: {formatINR(summary.totalCredit)}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accounts table */}
      <Card className="shadow-card border-border/60 border-t-2 border-t-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="w-4 h-4 text-primary" />
            Account-wise Balances
          </CardTitle>
          <p className="text-xs text-muted-foreground">Debit (assets/expenses) vs Credit (income/liabilities)</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border text-left">
                  <th className="py-2 px-2 font-medium text-muted-foreground">Account Name</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Debit</th>
                  <th className="py-2 px-2 font-medium text-muted-foreground text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-muted-foreground">No transactions in this period</td>
                  </tr>
                ) : (
                  accounts.map((account: any, i: number) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-2 font-medium">{account.name}</td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {account.debit > 0 ? (
                          <span className="text-amber-600 dark:text-amber-400 font-medium">{formatINR(account.debit)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {account.credit > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">{formatINR(account.credit)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {accounts.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border font-bold">
                    <td className="py-3 px-2">Total</td>
                    <td className="py-3 px-2 text-right text-amber-600 dark:text-amber-400 tabular-nums">
                      {formatINR(summary.totalDebit)}
                    </td>
                    <td className="py-3 px-2 text-right text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {formatINR(summary.totalCredit)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Note */}
      <div className="rounded-lg bg-muted/50 border border-border/60 p-3 text-xs text-muted-foreground">
        <p className="font-medium mb-1">Note:</p>
        <ul className="space-y-1 ml-4 list-disc">
          <li><strong>Sales &amp; Income</strong> are credits (money earned).</li>
          <li><strong>Purchases &amp; Expenses</strong> are debits (money spent).</li>
          <li><strong>Receivable</strong> (debit) = customers owe you (all-time outstanding).</li>
          <li><strong>Payable</strong> (credit) = you owe suppliers (all-time outstanding).</li>
          <li>This is an Account Summary, not a full double-entry Trial Balance. Cash, Bank, and GST accounts are not yet included — a complete Trial Balance will be available in a future update.</li>
        </ul>
      </div>
    </div>
  )
}
