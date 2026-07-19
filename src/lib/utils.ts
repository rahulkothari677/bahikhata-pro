// EkBook - shared utility functions
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Indian Rupee formatting — full amount with proper grouping
// e.g. ₹1,23,456.78 (Indian numbering: lakhs, not millions)
export function formatINR(amount: number, withSymbol = true): string {
  // 🔒 V26 Phase 6 §1.5: Fintech convention — integers show whole (₹500),
  // non-integers always show 2 decimals (₹499.99, not ₹499.9 or ₹500).
  // Was: minimumFractionDigits:0 + maximumFractionDigits:2 → could produce
  // ₹1,234.5 (one decimal), and lists could mix ₹500 / ₹499.99 / ₹1,234.5.
  const isWhole = Math.round(amount * 100) % 100 === 0
  const fractionDigits = isWhole ? 0 : 2
  const formatter = new Intl.NumberFormat('en-IN', {
    style: withSymbol ? 'currency' : 'decimal',
    currency: 'INR',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
  return formatter.format(amount)
}

// Compact Indian format for charts/tooltips/badges
// e.g. ₹84, ₹1.2K, ₹12.5L, ₹1.5Cr
// Removes trailing zeros for cleaner display (₹1.2K not ₹1.20K)
export function formatINRCompact(amount: number): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs === 0) return '₹0'
  if (abs >= 10000000) {
    const val = abs / 10000000
    return `${sign}₹${val.toFixed(val >= 10 ? 1 : 2).replace(/\.?0+$/, '')}Cr`
  }
  if (abs >= 100000) {
    const val = abs / 100000
    return `${sign}₹${val.toFixed(val >= 10 ? 1 : 2).replace(/\.?0+$/, '')}L`
  }
  if (abs >= 1000) {
    const val = abs / 1000
    return `${sign}₹${val.toFixed(val >= 10 ? 1 : 2).replace(/\.?0+$/, '')}K`
  }
  return `${sign}₹${abs.toFixed(0)}`
}

// Format date as dd/mm/yyyy
export function formatDate(date: Date | string): string {
  const d = new Date(date)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

export function formatDateTime(date: Date | string): string {
  const d = new Date(date)
  const dateStr = formatDate(d)
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${dateStr}, ${time}`
}

export function relativeTime(date: Date | string): string {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 30) return formatDate(d)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}

// 🔒 FIX L4: Deleted legacy calculateGST — it bypassed roundMoney's 1e-9 epsilon
// fix (V9 §2.3). Any future import of calculateGST from utils would silently
// reintroduce the 1.005 → 1.00 boundary bug. Use calculateGst + splitGst from
// @/lib/money instead.

// Get start of today, this week, this month
export function startOfDay(date: Date = new Date()): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function startOfMonth(date: Date = new Date()): Date {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

export function startOfWeek(date: Date = new Date()): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day // Sunday = 0
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

// Compute current stock for a product
export function computeProductStock(productId: string, openingStock: number, transactions: any[]): number {
  let stock = openingStock
  for (const t of transactions) {
    for (const item of t.items || []) {
      if (item.productId === productId) {
        if (t.type === 'purchase') stock += item.quantity
        else if (t.type === 'sale') stock -= item.quantity
      }
    }
  }
  return stock
}

// Truncate text
export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

// Initials for avatar
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

// Validate Indian GSTIN
export function isValidGSTIN(gstin: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)
}

// Validate Indian phone
export function isValidPhone(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone.replace(/\D/g, ''))
}
