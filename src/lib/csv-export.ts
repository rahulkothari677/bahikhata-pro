/**
 * CSV export utility for reports.
 * Handles proper escaping (quotes, commas, newlines) per RFC 4180.
 */

function escapeCSV(value: any): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  // Quote if contains comma, quote, newline, or leading/trailing whitespace
  if (/[",\n\r]/.test(str) || /^\s|\s$/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function exportCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const csv = [
    headers.map(escapeCSV).join(','),
    ...rows.map((row) => row.map(escapeCSV).join(',')),
  ].join('\n')

  // Prepend BOM so Excel detects UTF-8 (handles ₹ symbol correctly)
  // Use 'application/octet-stream' to force download on mobile browsers
  // (some mobile browsers try to open 'text/csv' in a new tab instead of downloading)
  const blob = new Blob(['\uFEFF' + csv], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  // Append to DOM — required for programmatic download on some mobile browsers
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Export P&L report data to CSV.
 */
export function exportPLReportCSV(data: any, periodLabel: string) {
  const { summary, expensesByCategory, incomeByCategory } = data
  const headers = ['Metric', 'Amount (INR)']
  const rows: (string | number)[][] = [
    ['Report Type', 'Profit & Loss'],
    ['Period', periodLabel],
    [''],
    ['REVENUE & PROFIT', ''],
    ['Revenue (Sales)', summary.totalRevenue],
    ['Gross Profit', summary.grossProfit],
    ['Other Income', summary.otherIncome],
    ['Total Expenses', summary.totalExpenses],
    ['Net Profit', summary.netProfit],
    ['Profit Margin (%)', summary.profitMargin.toFixed(2)],
    [''],
    ['EXPENSES BREAKDOWN', ''],
    ...expensesByCategory.map((e: any) => [e.name, e.value]),
    [''],
    ['OTHER INCOME BREAKDOWN', ''],
    ...incomeByCategory.map((e: any) => [e.name, e.value]),
  ]
  exportCSV(`PnL_Report_${periodLabel.replace(/\s+/g, '_')}`, headers, rows)
}

/**
 * Export GST report data to CSV.
 */
export function exportGSTReportCSV(data: any, periodLabel: string) {
  const { outputSales, inputPurchases, netGSTPayable, totalInvoices } = data
  const headers = ['GST Slab (%)', 'Sales Taxable', 'CGST', 'SGST', 'IGST', 'Purchase Taxable', 'Input CGST', 'Input SGST', 'Input IGST']
  const slabs = [0, 5, 12, 18, 28]
  const rows: (string | number)[][] = [
    ['GST Summary Report', ''],
    ['Period', periodLabel],
    ['Total Invoices', totalInvoices],
    ['Output Tax (Sales)', outputSales.outputTax],
    ['Input Tax (Purchases)', inputPurchases.inputTax],
    ['Net GST Payable', netGSTPayable],
    [''],
    ['SLAB-WISE BREAKDOWN', ''],
    headers,
    ...slabs.map((rate) => {
      const o = outputSales.bySlab.find((s: any) => s.rate === rate)
      const i = inputPurchases.bySlab.find((s: any) => s.rate === rate)
      return [
        `${rate}%`,
        o?.taxable || 0,
        o?.cgst || 0,
        o?.sgst || 0,
        o?.igst || 0,
        i?.taxable || 0,
        i?.cgst || 0,
        i?.sgst || 0,
        i?.igst || 0,
      ]
    }),
  ]
  exportCSV(`GST_Report_${periodLabel.replace(/\s+/g, '_')}`, headers, rows)
}

/**
 * Export Stock report data to CSV.
 */
export function exportStockReportCSV(data: any) {
  const headers = ['Product', 'Category', 'Stock', 'Unit', 'Buy Price', 'Sale Price', 'Stock Value', 'Sale Value', 'Status']
  const rows: (string | number)[][] = (data.products || []).map((p: any) => [
    p.name,
    p.category || '',
    p.currentStock,
    p.unit || '',
    p.purchasePrice,
    p.salePrice,
    p.stockValue,
    p.potentialSaleValue,
    p.isLowStock ? 'Low Stock' : 'OK',
  ])
  exportCSV('Stock_Report', headers, rows)
}

/**
 * Export Party-wise report data to CSV.
 */
export function exportPartyReportCSV(data: any) {
  const headers = ['Party Name', 'Type', 'Sales', 'Purchases', 'Paid', 'Received', 'Balance']
  const rows: (string | number)[][] = (data.parties || []).map((p: any) => [
    p.party.name,
    p.party.type,
    p.totalSales,
    p.totalPurchases,
    p.totalPaid,
    p.totalReceived,
    p.balance,
  ])
  exportCSV('Party_Report', headers, rows)
}
