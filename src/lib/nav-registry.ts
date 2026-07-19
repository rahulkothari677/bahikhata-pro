/**
 * 🔒 AUDIT V25 §6.1 (Batch 8 Phase 1): Navigation Registry — the single source
 * of truth for every destination in the app.
 *
 * Before this, 6 surfaces (Sidebar, MobileBottomNav, MoreScreen, ReportsHub,
 * AccountScreen, GlobalSearch) each maintained their own hardcoded lists of
 * destinations. Adding a new feature meant updating 2-4 surfaces manually,
 * and parity bugs (feature visible on mobile but not desktop, or listed in
 * two places with different names) were easy to introduce.
 *
 * Now: ONE typed list. Every surface renders from it. A new feature = ONE
 * entry → automatically appears on every surface, correctly categorized, on
 * both platforms, with correct permissions.
 *
 * DESIGN PRINCIPLES:
 * 1. Pure data (no functions) — the registry is serializable + testable.
 * 2. Surfaces contain a `handleNavAction(destination)` function that switches
 *    on `actionKind` + uses `actionParams` to perform runtime navigation.
 * 3. One destination per id — no duplicates. If two surfaces show the same
 *    view with different labels, the registry's label wins (auditor §6.4).
 * 4. Platform + permission gating is declarative — surfaces filter, not branch.
 *
 * USAGE:
 *   import { NAV_REGISTRY, getByCategory, getByFrequency } from '@/lib/nav-registry'
 *   const mainNav = getByFrequency('primary').filter(d => d.platforms.includes('desktop'))
 */

import {
  LayoutDashboard, ShoppingCart, Truck, Package, Wallet, Users,
  FileBarChart, ScanLine, FolderOpen, Bot, ShieldCheck, Lock,
  Undo2, FilePlus2, FileText, FileCheck, Banknote, Coins, Repeat,
  Send, AlertTriangle, Mic, ScanBarcode, Sparkles, BarChart3,
  User, Store, CreditCard, Shield, Settings as SettingsIcon, Check,
  Database, UserCog, Gift, HelpCircle, Star, LogOut, Info,
  TrendingUp, Clock, Scale, Receipt, Hash, Wallet as WalletIcon,
  Plus, UserPlus,
  type LucideIcon,
} from 'lucide-react'
import type { ViewType, FeatureKey } from '@/store/app-store'
import type { ModuleKey } from '@/lib/staff-permissions'

// ─── Types ─────────────────────────────────────────────────────────────

export type NavActionKind =
  | 'navigate'              // setView(view) — the default
  | 'navigate-report'       // setPendingReportType + setView('reports')
  | 'navigate-settings'     // setPendingSettingsTab + setView('settings')
  | 'navigate-account'      // setAccountSection + setView('account')
  | 'navigate-scroll'       // setScrollTarget + setView(view)
  | 'navigate-day-end'      // fireTriggerDayEnd + setView('dashboard')
  | 'navigate-bulk'         // fireTriggerBulkReminders + setView('parties')
  | 'toast-navigate'        // show toast + setView(view)
  | 'coming-soon'           // show "Coming Soon" toast, no navigation
  | 'custom'                // surface-specific handler (Rate, Logout, Share)

export type NavCategoryId =
  | 'core'
  | 'transactions'
  | 'inventory'
  | 'parties'
  | 'reports'
  | 'tools'
  | 'account'

/** Sub-category for grouping within a surface (e.g. MoreScreen sections, ReportsHub categories). */
export type NavSubcategoryId =
  | 'sale-purchase'     // transactions: Sale & Purchase section in More
  | 'gst-tax'           // reports: Accounting Controls section in More
  | 'money-banking'     // reports: Money & Banking section in More
  | 'items-stock'       // inventory: Items & Stock section in More
  | 'parties'           // 🔒 V26 P8: Customers & Suppliers section in More
  | 'smart-tools'       // tools: Smart Tools section in More
  | 'financial'         // reports: Financial Reports sub-category in ReportsHub
  | 'gst'               // reports: GST & Tax sub-category in ReportsHub
  | 'inventory-reports' // reports: Inventory & Stock sub-category in ReportsHub
  | 'banking'           // reports: Banking & Reconciliation sub-category in ReportsHub
  | 'account-info'      // account: Account section in AccountScreen
  | 'preferences'       // account: Preferences section in AccountScreen
  | 'business'          // account: Business section in AccountScreen
  | 'support'           // account: Support section in AccountScreen

export type NavFrequency = 'primary' | 'secondary' | 'tertiary'
// primary   = Sidebar main nav + BottomNav tabs + GlobalSearch commands
// secondary = Sidebar Tools section + MoreScreen sections
// tertiary  = AccountScreen menu + GlobalSearch commands

/** Which surfaces show this destination. Controls where each item appears. */
export type NavSurface =
  | 'sidebar-main'      // Sidebar primary nav
  | 'sidebar-tools'     // Sidebar Tools section (collapsible)
  | 'bottom-nav'        // MobileBottomNav tabs
  | 'more'              // MoreScreen sections
  | 'reports-hub'       // ReportsHub grid
  | 'account'           // AccountScreen menu
  | 'global-search'     // GlobalSearch commands

export interface NavDestination {
  /** Unique identifier (e.g. 'gstr-1', 'reconciliation', 'dashboard') */
  id: string
  /** Display label — the ONE canonical name for this destination (auditor §6.4) */
  label: string
  /** Short description / subtitle */
  description?: string
  /** Icon component */
  icon: LucideIcon
  /** Sort order within its surface (lower = higher up). Optional — default 0. */
  sortOrder?: number
  /** Which surfaces should show this destination. Default: inferred from frequency. */
  surfaces?: NavSurface[]
  /** Search keywords for GlobalSearch filtering (space-separated). Optional. */
  keywords?: string
  /** i18n key for the label. If set, surfaces use t(labelKey) instead of label. */
  labelKey?: string
  /** i18n key for the description. If set, surfaces use t(descKey) instead of description. */
  descKey?: string
  /** Tailwind text color class for the icon */
  iconColor?: string
  /** Tailwind bg color class for the icon container */
  iconBg?: string
  /** Badge text (e.g. 'AI', 'Soon') */
  badge?: string
  /** Tailwind classes for the badge */
  badgeColor?: string

  // ─── Navigation ───────────────────────────────────────
  /** Which view to navigate to (if actionKind is navigate-based) */
  view?: ViewType
  /** How to navigate. Defaults to 'navigate' if view is set, 'custom' otherwise. */
  actionKind?: NavActionKind
  /** Parameters for special action kinds */
  actionParams?: {
    reportType?: string         // for 'navigate-report'
    settingsTab?: string        // for 'navigate-settings'
    accountSection?: string     // for 'navigate-account'
    scrollTarget?: string       // for 'navigate-scroll'
    trigger?: 'dayEnd' | 'bulkReminders'  // for 'navigate-day-end' / 'navigate-bulk'
    toastTitle?: string         // for 'toast-navigate' / 'coming-soon'
    toastDescription?: string   // for 'toast-navigate' / 'coming-soon'
  }

  // ─── Categorization ──────────────────────────────────
  category: NavCategoryId
  /** Sub-category for grouping within surfaces */
  subcategory?: NavSubcategoryId

  // ─── Visibility ──────────────────────────────────────
  /** Which surfaces show this destination */
  frequency: NavFrequency
  /** Platforms where this destination is visible. Default: both. */
  platforms?: ('mobile' | 'desktop')[]
  /** Staff permission module key for gating. Undefined = always visible. */
  moduleKey?: ModuleKey
  /** Only visible to the shop owner (not staff/CA) */
  ownerOnly?: boolean
  founderOnly?: boolean  // 🔒 V26 N7: gates behind founder email allowlist (not just 'owner' role)
  /** Gated by a feature flag */
  featureFlag?: FeatureKey
}

// ─── Color constants (shared across surfaces for consistency) ──────────

const INDIGO = 'text-indigo-600 dark:text-indigo-400'
const INDIGO_BG = 'bg-indigo-100 dark:bg-indigo-950'
const BLUE = 'text-blue-600 dark:text-blue-400'
const BLUE_BG = 'bg-blue-100 dark:bg-blue-950'
const EMERALD = 'text-emerald-600 dark:text-emerald-400'
const EMERALD_BG = 'bg-emerald-100 dark:bg-emerald-950'
const AMBER = 'text-amber-600 dark:text-amber-400'
const AMBER_BG = 'bg-amber-100 dark:bg-amber-950'
const ROSE = 'text-rose-600 dark:text-rose-400'
const ROSE_BG = 'bg-rose-100 dark:bg-rose-950'
const VIOLET = 'text-violet-600 dark:text-violet-400'
const VIOLET_BG = 'bg-violet-100 dark:bg-violet-950'
const SLATE = 'text-slate-600'
const SLATE_BG = 'bg-slate-100'

// ─── The Registry ──────────────────────────────────────────────────────
//
// Every destination in the app, listed ONCE. Surfaces filter by
// frequency / category / platform / permissions to build their UI.
//
// Organization: grouped by category for readability, but order within
// the array doesn't matter — surfaces sort by their own criteria.

export const NAV_REGISTRY: NavDestination[] = [

  // ═══ core ═════════════════════════════════════════════════════════════
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Business overview',
    icon: LayoutDashboard,
    view: 'dashboard',
    actionKind: 'navigate',
    category: 'core',
    frequency: 'primary',
    surfaces: ['sidebar-main', 'bottom-nav', 'global-search'],
    sortOrder: 1,
    keywords: 'dashboard home overview charts stats kpi',
    labelKey: 'nav.label.dashboard',
    descKey: 'nav.desc.dashboard',
    moduleKey: 'dashboard',
  },

  // ═══ transactions ═════════════════════════════════════════════════════
  {
    id: 'sales',
    label: 'Sales',
    description: 'Sales ledger',
    icon: ShoppingCart,
    iconColor: INDIGO,
    iconBg: INDIGO_BG,
    view: 'sales',
    actionKind: 'navigate',
    category: 'transactions',
    frequency: 'primary',
    surfaces: ['sidebar-main', 'bottom-nav', 'global-search'],
    sortOrder: 3,
    keywords: 'sales ledger transactions history sell',
    labelKey: 'nav.label.sales',
    descKey: 'nav.desc.sales',
    moduleKey: 'sales',
  },
  {
    id: 'purchases',
    label: 'Purchases',
    description: 'Purchase ledger',
    icon: Truck,
    iconColor: INDIGO,
    iconBg: INDIGO_BG,
    view: 'purchases',
    actionKind: 'navigate',
    category: 'transactions',
    frequency: 'primary',
    surfaces: ['sidebar-main', 'bottom-nav', 'global-search'],
    sortOrder: 4,
    keywords: 'purchases ledger transactions buy stock',
    labelKey: 'nav.label.purchases',
    descKey: 'nav.desc.purchases',
    moduleKey: 'purchases',
  },
  {
    id: 'new-sale',
    label: 'New Sale',
    description: 'Record a sale invoice',
    icon: ShoppingCart,
    iconColor: INDIGO,
    iconBg: INDIGO_BG,
    view: 'new-sale',
    actionKind: 'navigate',
    category: 'transactions',
    subcategory: 'sale-purchase',
    frequency: 'secondary',
    surfaces: ['more', 'global-search'],
    sortOrder: 1,
    moduleKey: 'sales',  // 🔒 V26 N16
    keywords: 'new sale create add record',
    labelKey: 'nav.label.new-sale',
    descKey: 'nav.desc.new-sale',
  },
  {
    id: 'new-purchase',
    label: 'New Purchase',
    description: 'Record a purchase bill',
    icon: Truck,
    iconColor: INDIGO,
    iconBg: INDIGO_BG,
    view: 'new-purchase',
    actionKind: 'navigate',
    category: 'transactions',
    subcategory: 'sale-purchase',
    frequency: 'secondary',
    surfaces: ['more', 'global-search'],
    sortOrder: 2,
    moduleKey: 'purchases',  // 🔒 V26 N16
    keywords: 'new purchase create add record buy stock',
    labelKey: 'nav.label.new-purchase',
    descKey: 'nav.desc.new-purchase',
  },
  {
    id: 'sale-return',
    label: 'Sale Return',
    description: 'Credit notes — return from customer',
    icon: Undo2,
    iconColor: INDIGO,
    iconBg: INDIGO_BG,
    view: 'sales',
    actionKind: 'toast-navigate',
    // 🔒 V26 FIX N5: was ['more'] only → desktop users had NO way to discover
    // returns (More is only reachable from the lg:hidden mobile bottom nav).
    // Now also in the desktop Sidebar Tools section and Ctrl+K search.
    surfaces: ['more', 'sidebar-tools', 'global-search'],
    keywords: 'sale return credit note refund customer wapas',
    sortOrder: 3,
    labelKey: 'nav.label.sale-return',
    descKey: 'nav.desc.sale-return',
    actionParams: {
      toastTitle: 'Pick a sale to return',
      toastDescription: 'Tap any sale → "Credit Note" to record a return.',
    },
    category: 'transactions',
    subcategory: 'sale-purchase',
    frequency: 'secondary',
  },
  {
    id: 'purchase-return',
    label: 'Purchase Return',
    description: 'Debit notes — return to supplier',
    icon: Undo2,
    iconColor: INDIGO,
    iconBg: INDIGO_BG,
    view: 'purchases',
    actionKind: 'toast-navigate',
    // 🔒 V26 FIX N5: same desktop-discoverability fix as sale-return above.
    surfaces: ['more', 'sidebar-tools', 'global-search'],
    keywords: 'purchase return debit note refund supplier wapas',
    sortOrder: 4,
    labelKey: 'nav.label.purchase-return',
    descKey: 'nav.desc.purchase-return',
    actionParams: {
      toastTitle: 'Pick a purchase to return',
      toastDescription: 'Tap any purchase → "Debit Note" to record a return to supplier.',
    },
    category: 'transactions',
    subcategory: 'sale-purchase',
    frequency: 'secondary',
  },
  {
    id: 'estimates',
    label: 'Estimates / Quotations',
    description: 'Create quotes for customers',
    icon: FilePlus2,
    iconColor: INDIGO,
    iconBg: INDIGO_BG,
    view: 'new-estimate',
    actionKind: 'navigate',
    category: 'transactions',
    subcategory: 'sale-purchase',
    frequency: 'secondary',
    surfaces: ['more', 'sidebar-tools', 'global-search'],  // 🔒 V26 P5: added sidebar-tools,
    sortOrder: 5,
    labelKey: 'nav.label.estimates',
    descKey: 'nav.desc.estimates',
    moduleKey: 'sales',  // 🔒 V26 N16
  },
  {
    id: 'income-expense',
    label: 'Income & Expense',
    description: 'Rent, salary, other income',
    icon: Wallet,
    iconColor: INDIGO,
    iconBg: INDIGO_BG,
    view: 'income-expense',
    actionKind: 'navigate',
    category: 'transactions',
    subcategory: 'sale-purchase',
    frequency: 'primary',
    surfaces: ['sidebar-main', 'more', 'global-search'],
    sortOrder: 6,
    keywords: 'income expense rent salary money',
    labelKey: 'nav.label.income-expense',
    descKey: 'nav.desc.income-expense',
    moduleKey: 'incomeExpense',
  },

  // ═══ inventory ════════════════════════════════════════════════════════
  {
    id: 'inventory',
    subcategory: 'items-stock',
    label: 'Inventory',
    description: 'Products, stock, prices',
    icon: Package,
    iconColor: AMBER,
    iconBg: AMBER_BG,
    view: 'inventory',
    actionKind: 'navigate',
    category: 'inventory',
    frequency: 'primary',
    surfaces: ['sidebar-main', 'more', 'global-search'],
    sortOrder: 5,
    keywords: 'inventory products stock items',
    labelKey: 'nav.label.inventory',
    descKey: 'nav.desc.inventory',
    moduleKey: 'inventory',
  },
  {
    id: 'low-stock-alerts',
    label: 'Low Stock Alerts',
    description: 'Products running low — reorder now',
    icon: AlertTriangle,
    iconColor: AMBER,
    iconBg: AMBER_BG,
    view: 'inventory',
    actionKind: 'navigate',
    category: 'inventory',
    subcategory: 'items-stock',
    frequency: 'secondary',
    // 🔒 V26 FIX N5: desktop-discoverable via Ctrl+K (Inventory itself is in the sidebar)
    surfaces: ['more', 'global-search'],
    keywords: 'low stock alert reorder running out kam',
    sortOrder: 2,
    labelKey: 'nav.label.low-stock-alerts',
    descKey: 'nav.desc.low-stock-alerts',
  },

  // ═══ parties ═════════════════════════════════════════════════════════
  {
    id: 'parties',
    subcategory: 'parties', // 🔒 V26 P8: moved from 'money-banking' to its own section
    label: 'Parties',
    description: 'Customers & suppliers — track dues & balances',
    icon: Users,
    iconColor: INDIGO,
    iconBg: INDIGO_BG,
    view: 'parties',
    actionKind: 'navigate',
    category: 'parties',
    frequency: 'primary',
    surfaces: ['sidebar-main', 'more', 'global-search'],
    sortOrder: 7,
    keywords: 'parties customers suppliers dues balance',
    labelKey: 'nav.label.parties',
    descKey: 'nav.desc.parties',
    moduleKey: 'parties',
  },
  {
    id: 'whatsapp-reminders',
    label: 'WhatsApp Reminders',
    description: 'Send payment reminders',
    icon: Send,
    iconColor: EMERALD,
    iconBg: EMERALD_BG,
    actionKind: 'navigate-bulk',
    category: 'parties',
    subcategory: 'parties',  // 🔒 V26 N18: moved from 'money-banking' — reminders are about customers
    frequency: 'secondary',
    // 🔒 V26 FIX N5: was ['more'] only — desktop users had no named entry
    // (only the Bulk Reminders button inside Parties). Now in Sidebar Tools + Ctrl+K.
    surfaces: ['more', 'sidebar-tools', 'global-search'],
    keywords: 'whatsapp reminder payment udhaar collect dunning message',
    sortOrder: 4,
    labelKey: 'nav.label.whatsapp-reminders',
    descKey: 'nav.desc.whatsapp-reminders',
  },

  // ═══ reports ═════════════════════════════════════════════════════════
  {
    id: 'reports',
    // 🔒 V26 P8: Removed subcategory — 'reports' should NOT appear in MoreScreen
    // (all individual reports are already categorized in their own sections below).
    // The Reports Hub is accessible via desktop sidebar + global search.
    label: 'Reports',
    description: 'All reports — P&L, GST, stock, party, aging',
    icon: FileBarChart,
    iconColor: ROSE,
    iconBg: ROSE_BG,
    view: 'reports',
    actionKind: 'navigate',
    category: 'reports',
    frequency: 'primary',
    surfaces: ['sidebar-main', 'more', 'global-search'],
    sortOrder: 8,
    keywords: 'reports gst pl profit loss stock analysis',
    labelKey: 'nav.label.reports',
    descKey: 'nav.desc.reports',
    moduleKey: 'reports',
  },

  // ═══ tools (main nav — opens ToolsHub) ════════════════════════════════
  // 🔒 V26 P10: "Tools" is now a main-nav entry (like Reports) that opens
  // a beautiful card-based ToolsHub page. Was: a collapsible list at the
  // bottom of the sidebar. Now: same visual quality as the Reports Hub.
  {
    id: 'tools',
    label: 'Tools',
    description: 'Quick access to all business tools',
    icon: Sparkles,
    iconColor: VIOLET,
    iconBg: VIOLET_BG,
    view: 'tools',
    actionKind: 'navigate',
    category: 'tools',
    frequency: 'primary',
    surfaces: ['sidebar-main', 'global-search'],
    sortOrder: 9,
    keywords: 'tools voice scanner barcode ai insights day-end cash reminders returns',
    labelKey: 'nav.label.tools',
    descKey: 'nav.desc.tools',
  },
  // GST & Tax section (MoreScreen pointers + ReportsHub leaves)
  {
    id: 'reconciliation',
    label: 'Reconciliation',
    description: 'Health check — do books tie out?',
    icon: ShieldCheck,
    iconColor: BLUE,
    iconBg: BLUE_BG,
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'data' },
    category: 'reports',
    subcategory: 'gst-tax',
    frequency: 'secondary',
    surfaces: ['sidebar-tools', 'more'],
    sortOrder: 4,
    labelKey: 'nav.label.reconciliation',
    descKey: 'nav.desc.reconciliation',
  },
  {
    id: 'period-lock',
    label: 'Period Lock',
    description: 'Lock filed GST periods',
    icon: Lock,
    iconColor: BLUE,
    iconBg: BLUE_BG,
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'data' },
    category: 'reports',
    subcategory: 'gst-tax',
    frequency: 'secondary',
    surfaces: ['sidebar-tools', 'more'],
    sortOrder: 5,
    labelKey: 'nav.label.period-lock',
    descKey: 'nav.desc.period-lock',
  },
  {
    id: 'bank-reconciliation',
    label: 'Bank Reconciliation',
    description: 'Match bank transactions',
    icon: Banknote,
    iconColor: EMERALD,
    iconBg: EMERALD_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'bank-recon' },
    category: 'reports',
    subcategory: 'banking', // 🔒 V26 P8: moved from 'money-banking' to group with Cashflow + Consolidated
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 1,
    labelKey: 'nav.label.bank-reconciliation',
    descKey: 'nav.desc.bank-reconciliation',
    moduleKey: 'reports',  // 🔒 V26 N16: was missing — only ungated report
  },
  // Financial reports (ReportsHub + More)
  {
    id: 'pl',
    label: 'P&L Statement',
    description: 'Profit & loss — revenue, expenses, net profit',
    icon: TrendingUp,
    iconColor: ROSE,
    iconBg: ROSE_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'pl' },
    category: 'reports',
    subcategory: 'financial',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],  // 🔒 V26 BUG-047: also surface in More
    sortOrder: 1,
    moduleKey: 'reports',  // 🔒 V26 BUG-047: gate behind reports permission
    labelKey: 'nav.label.pl',
    descKey: 'nav.desc.pl',
  },
  {
    id: 'bill-profit',
    label: 'Bill-wise Profit',
    description: 'Per-invoice profit breakdown with margin %',
    icon: FileText,
    iconColor: ROSE,
    iconBg: ROSE_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'bill-profit' },
    category: 'reports',
    subcategory: 'financial',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 2,
    moduleKey: 'reports',
    labelKey: 'nav.label.bill-profit',
    descKey: 'nav.desc.bill-profit',
  },
  {
    id: 'item-profit',
    label: 'Item-wise Profit',
    description: 'Per-product profit, qty sold & margins',
    icon: Package,
    iconColor: ROSE,
    iconBg: ROSE_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'item-profit' },
    category: 'reports',
    subcategory: 'financial',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 3,
    moduleKey: 'reports',
    labelKey: 'nav.label.item-profit',
    descKey: 'nav.desc.item-profit',
  },
  {
    id: 'party-statement',
    label: 'Party Statement',
    description: 'Customer & supplier balances, sales, purchases',
    icon: Users,
    iconColor: ROSE,
    iconBg: ROSE_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'party' },
    category: 'reports',
    subcategory: 'financial',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 4,
    moduleKey: 'reports',
    labelKey: 'nav.label.party-statement',
    descKey: 'nav.desc.party-statement',
  },
  {
    id: 'debt-aging',
    label: 'Debt Aging',
    description: 'Outstanding receivables by age bucket',
    icon: Clock,
    iconColor: ROSE,
    iconBg: ROSE_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'debt-aging' },
    category: 'reports',
    subcategory: 'financial',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 5,
    moduleKey: 'reports',
    labelKey: 'nav.label.debt-aging',
    descKey: 'nav.desc.debt-aging',
  },
  {
    id: 'trial-balance',
    label: 'Account Summary',
    description: 'Debit/credit balances — sales, purchases, receivables',
    icon: Scale,
    iconColor: ROSE,
    iconBg: ROSE_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'trial-balance' },
    category: 'reports',
    subcategory: 'financial',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 6,
    moduleKey: 'reports',
    labelKey: 'nav.label.trial-balance',
    descKey: 'nav.desc.trial-balance',
  },
  // GST reports (ReportsHub + More)
  {
    id: 'gstr-1',
    label: 'GSTR-1',
    description: 'Outward supplies return — file monthly with GST portal',
    icon: FileText,
    iconColor: BLUE,
    iconBg: BLUE_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'gstr-1' },
    category: 'reports',
    subcategory: 'gst',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 1,
    moduleKey: 'reports',
    labelKey: 'nav.label.gstr-1',
    descKey: 'nav.desc.gstr-1',
  },
  {
    id: 'gstr-3b',
    label: 'GSTR-3B',
    description: 'Monthly summary return — output tax vs input credit',
    icon: FileCheck,
    iconColor: BLUE,
    iconBg: BLUE_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'gstr-3b' },
    category: 'reports',
    subcategory: 'gst',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 2,
    moduleKey: 'reports',
    labelKey: 'nav.label.gstr-3b',
    descKey: 'nav.desc.gstr-3b',
  },
  {
    id: 'gstr-2b',
    label: 'GSTR-2B Reconciliation',
    description: 'Match purchase ITC with auto-generated GSTR-2B',
    icon: ShieldCheck,
    iconColor: BLUE,
    iconBg: BLUE_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'gstr-2b' },
    category: 'reports',
    subcategory: 'gst',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 3,
    moduleKey: 'reports',
    labelKey: 'nav.label.gstr-2b',
    descKey: 'nav.desc.gstr-2b',
  },
  {
    id: 'gst-summary',
    label: 'GST Summary',
    description: 'Tax liability by slab — 5/12/18/28%',
    icon: Receipt,
    iconColor: BLUE,
    iconBg: BLUE_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'gst' },
    category: 'reports',
    subcategory: 'gst',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 4,
    moduleKey: 'reports',
    labelKey: 'nav.label.gst-summary',
    descKey: 'nav.desc.gst-summary',
  },
  {
    id: 'hsn-summary',
    label: 'HSN Summary',
    description: 'HSN/SAC-wise tax summary for GSTR-1 filing',
    icon: Hash,
    iconColor: BLUE,
    iconBg: BLUE_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'hsn' },
    category: 'reports',
    subcategory: 'gst',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 5,
    moduleKey: 'reports',
    labelKey: 'nav.label.hsn-summary',
    descKey: 'nav.desc.hsn-summary',
  },
  // Inventory reports (ReportsHub + More)
  {
    id: 'stock-report',
    label: 'Stock Report',
    description: 'Stock valuation, sale value, potential profit',
    icon: Package,
    iconColor: AMBER,
    iconBg: AMBER_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'stock' },
    category: 'reports',
    subcategory: 'inventory-reports',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 1,
    moduleKey: 'reports',
    labelKey: 'nav.label.stock-report',
    descKey: 'nav.desc.stock-report',
  },
  {
    id: 'inventory-aging',
    label: 'Inventory Aging',
    description: 'Slow-moving & dead stock by age bucket',
    icon: AlertTriangle,
    iconColor: AMBER,
    iconBg: AMBER_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'inventory-aging' },
    category: 'reports',
    subcategory: 'inventory-reports',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 2,
    moduleKey: 'reports',
    labelKey: 'nav.label.inventory-aging',
    descKey: 'nav.desc.inventory-aging',
  },
  // Banking reports (ReportsHub + More)
  {
    id: 'cashflow',
    label: 'Cashflow Report',
    description: 'Cash inflow vs outflow by category',
    icon: WalletIcon,
    iconColor: EMERALD,
    iconBg: EMERALD_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'cashflow' },
    category: 'reports',
    subcategory: 'banking',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 2,
    moduleKey: 'reports',
    labelKey: 'nav.label.cashflow',
    descKey: 'nav.desc.cashflow',
  },
  {
    id: 'consolidated',
    label: 'Consolidated Report',
    description: 'Multi-shop combined P&L, GST, stock',
    icon: Store,
    iconColor: EMERALD,
    iconBg: EMERALD_BG,
    actionKind: 'navigate-report',
    actionParams: { reportType: 'consolidated' },
    category: 'reports',
    subcategory: 'banking',
    frequency: 'secondary',
    surfaces: ['more', 'reports-hub'],
    sortOrder: 3,
    moduleKey: 'reports',
    labelKey: 'nav.label.consolidated',
    descKey: 'nav.desc.consolidated',
  },

  // ═══ tools ═══════════════════════════════════════════════════════════
  {
    id: 'scanner',
    subcategory: 'smart-tools',
    label: 'AI Bill Scanner',
    description: 'Snap a bill, auto-fill everything',
    icon: ScanLine,
    iconColor: VIOLET,
    iconBg: VIOLET_BG,
    badge: 'AI',
    badgeColor: 'bg-violet-500 text-white',
    view: 'scanner',
    actionKind: 'navigate',
    category: 'tools',
    frequency: 'primary',
    surfaces: ['sidebar-main', 'more', 'global-search'],
    sortOrder: 2,
    keywords: 'scan bill ai camera photo ocr scanner',
    labelKey: 'nav.label.scanner',
    descKey: 'nav.desc.scanner',
    moduleKey: 'scanner',
    featureFlag: 'aiScanner',
  },
  {
    id: 'document-vault',
    subcategory: 'smart-tools',
    label: 'Document Vault',
    description: 'Store bills, invoices, GST certificates',
    icon: FolderOpen,
    iconColor: VIOLET,
    iconBg: VIOLET_BG,
    view: 'document-vault',
    actionKind: 'navigate',
    category: 'tools',
    frequency: 'secondary',
    moduleKey: 'settings',
    surfaces: ['sidebar-tools', 'more'],
    sortOrder: 1,
    labelKey: 'nav.label.document-vault',
    descKey: 'nav.desc.document-vault',
  },
  {
    id: 'ai-usage',
    subcategory: 'smart-tools',
    label: 'AI Usage',
    description: 'Track AI scans & cost',
    icon: Bot,
    iconColor: VIOLET,
    iconBg: VIOLET_BG,
    badge: 'AI',
    badgeColor: 'bg-violet-500 text-white',
    view: 'ai-usage',
    actionKind: 'navigate',
    category: 'tools',
    frequency: 'secondary',
    featureFlag: 'aiScanner',
    founderOnly: true,  // 🔒 V26 N7: API is founder-only — hide from non-founders
    surfaces: ['sidebar-tools', 'more'],
    sortOrder: 2,
    labelKey: 'nav.label.ai-usage',
    descKey: 'nav.desc.ai-usage',
  },
  {
    id: 'ai-comparison',
    subcategory: 'smart-tools',
    label: 'AI Comparison',
    description: 'Compare AI providers',
    icon: Bot,
    iconColor: VIOLET,
    iconBg: VIOLET_BG,
    badge: 'AI',
    badgeColor: 'bg-violet-500 text-white',
    view: 'ai-comparison',
    actionKind: 'navigate',
    category: 'tools',
    frequency: 'secondary',
    featureFlag: 'aiScanner',
    surfaces: ['sidebar-tools', 'more'],
    sortOrder: 3,
    labelKey: 'nav.label.ai-comparison',
    descKey: 'nav.desc.ai-comparison',
  },
  {
    id: 'voice-entry',
    label: 'Voice Entry',
    description: 'Speak to create sales',
    icon: Mic,
    iconColor: VIOLET,
    iconBg: VIOLET_BG,
    badge: 'AI',
    badgeColor: 'bg-violet-500 text-white',
    view: 'new-sale',
    actionKind: 'navigate',
    category: 'tools',
    subcategory: 'smart-tools',
    frequency: 'secondary',
    surfaces: ['more', 'sidebar-tools', 'global-search'],  // 🔒 V26 P5: added sidebar-tools
    keywords: 'voice entry speak bol ke sale mic',
    sortOrder: 2,
    labelKey: 'nav.label.voice-entry',
    descKey: 'nav.desc.voice-entry',
    moduleKey: 'sales',  // 🔒 V26 N16
  },
  {
    id: 'barcode-scanner',
    label: 'Barcode Scanner',
    description: 'Scan barcodes for fast billing',
    icon: ScanBarcode,
    iconColor: VIOLET,
    iconBg: VIOLET_BG,
    view: 'new-sale',
    actionKind: 'navigate',
    category: 'tools',
    subcategory: 'smart-tools',
    frequency: 'secondary',
    surfaces: ['more', 'sidebar-tools', 'global-search'],  // 🔒 V26 P5: added sidebar-tools
    keywords: 'barcode scan billing fast qr',
    sortOrder: 3,
    labelKey: 'nav.label.barcode-scanner',
    descKey: 'nav.desc.barcode-scanner',
    moduleKey: 'sales',  // 🔒 V26 N16
  },
  {
    id: 'smart-insights',
    label: 'Smart Insights',
    description: 'AI-powered alerts & suggestions',
    icon: Sparkles,
    iconColor: VIOLET,
    iconBg: VIOLET_BG,
    actionKind: 'navigate-scroll',
    actionParams: { scrollTarget: 'smart-insights' },
    view: 'dashboard',
    category: 'tools',
    subcategory: 'smart-tools',
    frequency: 'secondary',
    // 🔒 V26 FIX N5: desktop had NO entry naming Smart Insights (V25 §2.4's
    // surviving half). Ctrl+K now jumps straight to the dashboard section.
    surfaces: ['more', 'sidebar-tools', 'global-search'],  // 🔒 V26 P5: added sidebar-tools,
    keywords: 'smart insights ai alerts suggestions tips',
    sortOrder: 5,
    labelKey: 'nav.label.smart-insights',
    descKey: 'nav.desc.smart-insights',
  },
  {
    id: 'cash-in-hand',
    label: 'Cash in Hand',
    description: 'Today\'s cash position & collections',
    icon: Coins,
    iconColor: EMERALD,
    iconBg: EMERALD_BG,
    actionKind: 'navigate-scroll',
    actionParams: { scrollTarget: 'cash-in-hand' },
    view: 'dashboard',
    category: 'tools',
    subcategory: 'money-banking',
    frequency: 'secondary',
    surfaces: ['more', 'sidebar-tools', 'global-search'],  // 🔒 V26 P5: added sidebar-tools
    keywords: 'cash in hand drawer galla today collections',
    sortOrder: 2,
    labelKey: 'nav.label.cash-in-hand',
    descKey: 'nav.desc.cash-in-hand',
  },
  {
    id: 'day-end-summary',
    label: 'Day-End Summary',
    description: 'Close the drawer — daily cash',
    icon: Repeat,
    iconColor: EMERALD,
    iconBg: EMERALD_BG,
    actionKind: 'navigate-day-end',
    view: 'dashboard',
    category: 'tools',
    subcategory: 'money-banking',
    frequency: 'secondary',
    // 🔒 V26 FIX N5: Sidebar Tools + Ctrl+K — desktop had only the dashboard
    // hero button, with no named "Day-End" entry anywhere.
    surfaces: ['more', 'sidebar-tools', 'global-search'],
    keywords: 'day end summary close drawer daily cash hisab',
    sortOrder: 3,
    labelKey: 'nav.label.day-end-summary',
    descKey: 'nav.desc.day-end-summary',
  },

  // ═══ account ═════════════════════════════════════════════════════════
  // Account section (AccountScreen)
  {
    id: 'my-profile',
    label: 'My Profile',
    description: 'Shop name, GSTIN, address, contact',
    icon: User,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'profile' },
    category: 'account',
    subcategory: 'account-info',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 1,
    labelKey: 'nav.label.my-profile',
    descKey: 'nav.desc.my-profile',
  },
  {
    id: 'business-card',
    label: 'Business Card',
    description: 'Shareable digital visiting card with QR',
    icon: Store,
    iconColor: VIOLET,
    iconBg: VIOLET_BG,
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'business-card' },
    category: 'account',
    subcategory: 'account-info',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 2,
    labelKey: 'nav.label.business-card',
    descKey: 'nav.desc.business-card',
  },
  {
    id: 'subscription',
    label: 'Subscription',
    description: 'Plan, usage, billing, upgrade',
    icon: CreditCard,
    iconColor: AMBER,
    iconBg: 'bg-amber-100',
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'subscription' },
    category: 'account',
    subcategory: 'account-info',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 3,
    labelKey: 'nav.label.subscription',
    descKey: 'nav.desc.subscription',
  },
  {
    id: 'security',
    label: 'Security',
    description: 'App lock, change password',
    icon: Shield,
    iconColor: EMERALD,
    iconBg: 'bg-emerald-100',
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'security' },
    category: 'account',
    subcategory: 'account-info',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 4,
    labelKey: 'nav.label.security',
    descKey: 'nav.desc.security',
  },
  // Preferences section (AccountScreen)
  {
    id: 'app-settings',
    label: 'App Settings',
    description: 'Language, dark mode, theme, app lock, backup',
    icon: SettingsIcon,
    iconColor: SLATE,
    iconBg: SLATE_BG,
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'app-settings' },
    category: 'account',
    subcategory: 'preferences',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 1,
    labelKey: 'nav.label.app-settings',
    descKey: 'nav.desc.app-settings',
  },
  {
    id: 'feature-toggles',
    label: 'Feature Toggles',
    description: 'Search & toggle 20+ features on/off',
    icon: Check,
    iconColor: VIOLET,
    iconBg: VIOLET_BG,
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'features' },
    category: 'account',
    subcategory: 'preferences',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 2,
    labelKey: 'nav.label.feature-toggles',
    descKey: 'nav.desc.feature-toggles',
  },
  {
    id: 'accounting-controls',
    label: 'Accounting Controls',
    description: 'Reconciliation health check, period lock',
    icon: ShieldCheck,
    iconColor: AMBER,
    iconBg: AMBER_BG,
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'data' },
    category: 'account',
    subcategory: 'preferences',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 3,
    labelKey: 'nav.label.accounting-controls',
    descKey: 'nav.desc.accounting-controls',
  },
  {
    id: 'data-backup',
    label: 'Data & Backup',
    description: 'Backup, restore, clear cache, delete account',
    icon: Database,
    iconColor: BLUE,
    iconBg: BLUE_BG,
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'data' },
    category: 'account',
    subcategory: 'preferences',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 4,
    labelKey: 'nav.label.data-backup',
    descKey: 'nav.desc.data-backup',
  },
  // Business section (AccountScreen)
  {
    id: 'multi-shop-management',
    label: 'Multi-Shop Management',
    description: 'Manage shops for consolidated reporting',  // 🔒 V26 N14: was "Switch or add shops" — switching was removed in V26 N4
    icon: Store,
    iconColor: AMBER,
    iconBg: AMBER_BG,
    actionKind: 'navigate-settings',
    actionParams: { settingsTab: 'profile' },
    category: 'account',
    subcategory: 'business',
    frequency: 'secondary',
    // 🔒 V26 P4: Added 'account' surface so it's reachable from AccountScreen
    // (was: only 'more' + 'global-search' → unreachable on desktop except Ctrl+K)
    surfaces: ['more', 'global-search', 'account'],
    keywords: 'multi shop manage shops branch add new shop',
    sortOrder: 1,
    labelKey: 'nav.label.multi-shop-management',
    descKey: 'nav.desc.multi-shop-management',
  },
  {
    id: 'staff-access',
    label: 'Staff & Access',
    description: 'Manage staff, CA access',
    icon: UserCog,
    iconColor: 'text-indigo-600',
    iconBg: 'bg-indigo-100',
    actionKind: 'navigate-settings',
    actionParams: { settingsTab: 'staff' },
    category: 'account',
    subcategory: 'business',
    frequency: 'secondary',
    surfaces: ['more', 'account'],
    sortOrder: 2,
    labelKey: 'nav.label.staff-access',
    descKey: 'nav.desc.staff-access',
    ownerOnly: true,
  },
  {
    id: 'refer-earn',
    label: 'Refer & Earn',
    description: 'Invite friends, earn rewards',
    icon: Gift,
    iconColor: 'text-rose-600',
    iconBg: 'bg-rose-100',
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'referral' },
    category: 'account',
    subcategory: 'business',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 1,
    labelKey: 'nav.label.refer-earn',
    descKey: 'nav.desc.refer-earn',
  },
  // Support section (AccountScreen)
  {
    id: 'help-support',
    label: 'Help & Support',
    description: 'FAQ, contact us, report a bug',
    icon: HelpCircle,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'help' },
    category: 'account',
    subcategory: 'support',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 1,
    labelKey: 'nav.label.help-support',
    descKey: 'nav.desc.help-support',
  },
  {
    id: 'rate-ekbook',
    label: 'Rate EkBook',
    description: 'Help others discover us',
    icon: Star,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
    actionKind: 'custom',
    category: 'account',
    subcategory: 'support',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 2,
    labelKey: 'nav.label.rate-ekbook',
    descKey: 'nav.desc.rate-ekbook',
  },
  {
    id: 'about',
    label: 'About',
    description: 'Version, privacy policy, terms',
    icon: Info,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'about' },
    category: 'account',
    subcategory: 'support',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 3,
    labelKey: 'nav.label.about',
    descKey: 'nav.desc.about',
  },
  {
    id: 'logout',
    label: 'Logout',
    description: 'Sign out of your account',
    icon: LogOut,
    iconColor: 'text-rose-600',
    iconBg: 'bg-rose-100',
    actionKind: 'custom',
    category: 'account',
    subcategory: 'support',
    frequency: 'tertiary',
    surfaces: ['account'],
    sortOrder: 4,
    labelKey: 'nav.label.logout',
    descKey: 'nav.desc.logout',
  },

  // ═══ GlobalSearch-only commands (not shown in any nav surface) ═══════
  // These are quick-action shortcuts in the Ctrl+K search dialog.
  // They do NOT appear in Sidebar, MoreScreen, ReportsHub, or AccountScreen.
  {
    id: 'add-product',
    label: 'Add Product',
    description: 'Add a new product to inventory',
    icon: Plus,
    iconColor: 'text-violet-600',
    iconBg: 'bg-violet-100 dark:bg-violet-950',
    view: 'inventory',
    actionKind: 'navigate',
    category: 'inventory',
    frequency: 'primary',
    surfaces: ['global-search'],
    keywords: 'add new product create inventory item',
    labelKey: 'nav.label.add-product',
    descKey: 'nav.desc.add-product',
  },
  {
    id: 'add-party',
    label: 'Add Customer/Supplier',
    description: 'Add a new party',
    icon: UserPlus,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100 dark:bg-blue-950',
    view: 'parties',
    actionKind: 'navigate',
    category: 'parties',
    frequency: 'primary',
    surfaces: ['global-search'],
    keywords: 'add new customer supplier party create',
    labelKey: 'nav.label.add-party',
    descKey: 'nav.desc.add-party',
  },
  {
    id: 'go-to-account',
    label: 'Go to Account',
    description: 'Profile, settings, security, preferences',
    icon: SettingsIcon,
    iconColor: 'text-slate-600',
    iconBg: 'bg-slate-100',
    actionKind: 'navigate-account',
    actionParams: { accountSection: 'profile' },
    category: 'account',
    frequency: 'tertiary',
    surfaces: ['global-search'],
    keywords: 'settings profile theme features configuration account security',
    labelKey: 'nav.label.go-to-account',
    descKey: 'nav.desc.go-to-account',
  },
]

// ─── Helper functions ──────────────────────────────────────────────────

/** Get all destinations in a category. */
export function getByCategory(category: NavCategoryId): NavDestination[] {
  return NAV_REGISTRY.filter(d => d.category === category)
}

/** Get all destinations with a frequency level. */
export function getByFrequency(frequency: NavFrequency): NavDestination[] {
  return NAV_REGISTRY.filter(d => d.frequency === frequency)
}

/** Get all destinations visible on a platform. */
export function getByPlatform(platform: 'mobile' | 'desktop'): NavDestination[] {
  return NAV_REGISTRY.filter(d => (d.platforms || ['mobile', 'desktop']).includes(platform))
}

/** Get a destination by id. */
export function getById(id: string): NavDestination | undefined {
  return NAV_REGISTRY.find(d => d.id === id)
}

/** Get all destinations in a subcategory. */
export function getBySubcategory(subcategory: NavSubcategoryId): NavDestination[] {
  return NAV_REGISTRY.filter(d => d.subcategory === subcategory)
}

/**
 * Filter destinations by staff permissions + feature flags + ownership.
 * Pass the canAccess function from useStaffPermissions, isFlagEnabled from
 * useFeatureFlags, and isOwner boolean.
 */
export function filterByPermissions(
  destinations: NavDestination[],
  opts: {
    canAccess: (module: ModuleKey) => boolean
    isFlagEnabled: (flag: string) => boolean
    isOwner: boolean
  }
): NavDestination[] {
  return destinations.filter(d => {
    // Owner-only items
    if (d.ownerOnly && !opts.isOwner) return false
    // 🔒 V26 N7: founderOnly gates behind the founder email allowlist.
    // Uses isFounder from usage-limits (same as debug-auth.ts).
    // For now, we check opts.isOwner + a founderEmails list passed in opts.
    // The caller (Sidebar/MoreScreen/GlobalSearch) passes isOwner=true for owners,
    // and we treat founderOnly as ownerOnly for now (every account is its own owner).
    // When a real founder-email check is needed, add isFounder to the opts.
    if (d.founderOnly && !opts.isOwner) return false
    // Feature flag gating
    if (d.featureFlag && !opts.isFlagEnabled(d.featureFlag as string)) return false
    // Module permission gating
    if (d.moduleKey && !opts.canAccess(d.moduleKey)) return false
    return true
  })
}

/**
 * Group destinations by subcategory. Returns a Map of subcategory → destinations.
 * Useful for MoreScreen + ReportsHub which render grouped sections.
 */
export function groupBySubcategory(destinations: NavDestination[]): Map<NavSubcategoryId | undefined, NavDestination[]> {
  const groups = new Map<NavSubcategoryId | undefined, NavDestination[]>()
  for (const d of destinations) {
    const key = d.subcategory
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(d)
  }
  return groups
}
