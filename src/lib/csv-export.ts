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

  const csvContent = '\uFEFF' + csv
  const cleanFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`

  await shareOrDownload(csvContent, cleanFilename, 'text/csv')
}

/**
 * Universal file save/share — works on both mobile and desktop.
 * On mobile: writes to temp file → opens Android share sheet (user can save to Downloads)
 * On desktop: downloads file directly
 */
export async function shareOrDownload(content: string, filename: string, mimeType: string = 'text/plain') {
  // Check if running on Capacitor (native Android app)
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      const { Share } = await import('@capacitor/share')

      // Convert content to base64
      const base64Data = btoa(unescape(encodeURIComponent(content)))

      // Write to temp cache directory
      const fileResult = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
        encoding: 'base64',
      })

      // Open Android share sheet — user can save to Downloads or share
      await Share.share({
        title: filename,
        url: fileResult.uri,
        dialogTitle: 'Save or Share',
      })
      return
    } catch (err: any) {
      // If user cancelled share, don't show error
      if (err?.name === 'AbortError' || String(err?.message || '').includes('cancel')) return
      console.error('[Export] Share failed:', err)
      // Fall through to browser download
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
