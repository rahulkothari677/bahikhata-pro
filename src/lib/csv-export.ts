/**
 * CSV export utility for reports.
 * Handles proper escaping (quotes, commas, newlines) per RFC 4180.
 * Uses Capacitor Share plugin on native (Android) to save/share files.
 */

import { Capacitor } from '@capacitor/core'

function escapeCSV(value: any): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n\r]/.test(str) || /^\s|\s$/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function exportCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const csv = [
    headers.map(escapeCSV).join(','),
    ...rows.map((row) => row.map(escapeCSV).join(',')),
  ].join('\n')

  const cleanFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`
  await shareOrDownload(csv, cleanFilename, 'text/csv')
}

/**
 * Universal file save/share — works on both mobile and desktop.
 * On mobile: creates Blob → FileReader to base64 → Filesystem → Share sheet
 * On desktop: downloads file directly
 * 
 * Uses the SAME approach as PDF sharing (which works perfectly).
 */
export async function shareOrDownload(content: string, filename: string, mimeType: string = 'text/plain') {
  // Check if running on Capacitor (native Android app)
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
      const { Share } = await import('@capacitor/share')

      // Step 1: Create a Blob from the string content (handles Unicode/₹ correctly)
      const blob = new Blob([content], { type: mimeType })

      // Step 2: Convert Blob to base64 using FileReader (same as PDF sharing)
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          const base64 = result.split(',')[1]
          resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })

      // Step 3: Write to temp cache directory with base64 encoding
      const fileResult = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
        encoding: Encoding.Base64,
      })

      // Step 4: Open Android share sheet
      await Share.share({
        title: filename,
        url: fileResult.uri,
        dialogTitle: 'Save or Share',
      })
      return
    } catch (err: any) {
      if (err?.name === 'AbortError' || String(err?.message || '').includes('cancel')) return
      throw new Error(`Export failed: ${err?.message || err}`)
    }
  }

  // Web browser fallback (desktop)
  const blob = new Blob([content], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Export P&L report data to CSV.
 */
export async function exportPLReportCSV(data: any, periodLabel: string) {
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
  await exportCSV(`PnL_Report_${periodLabel.replace(/\s+/g, '_')}`, headers, rows)
}

/**
 * Export GST report data to CSV.
 */
export async function exportGSTReportCSV(data: any, periodLabel: string) {
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
  await exportCSV(`GST_Report_${periodLabel.replace(/\s+/g, '_')}`, headers, rows)
}

/**
 * Export Stock report data to CSV.
 */
export async function exportStockReportCSV(data: any) {
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
  await exportCSV('Stock_Report', headers, rows)
}

/**
 * Export Party-wise report data to CSV.
 */
export async function exportPartyReportCSV(data: any) {
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
  await exportCSV('Party_Report', headers, rows)
}
