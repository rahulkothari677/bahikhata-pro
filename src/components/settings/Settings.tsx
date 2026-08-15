'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useMemo } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { StaffManagement } from '@/components/settings/StaffManagement'
import { CAAccess } from '@/components/settings/CAAccess'
import { UnsyncedEntries } from '@/components/settings/UnsyncedEntries'
import { SupplierOpeningBalanceReview } from '@/components/settings/SupplierOpeningBalanceReview'
import { ShopLogoUploader } from '@/components/settings/ShopLogoUploader'
import { useShops } from '@/hooks/use-shops'
import { exportBackup } from '@/lib/data-backup'
import { useBusinessGoals } from '@/hooks/use-business-goals'
import { Target, Download, Upload, Calendar, Clock, Coins, PackageX, UserX, FileText} from 'lucide-react'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { toast as sonnerToast } from 'sonner'
import { haptic } from '@/lib/haptic'
import { useAppStore, type FeatureKey } from '@/store/app-store'
import { hasAnalyticsConsent, setAnalyticsConsent, initAnalytics } from '@/lib/analytics'
import { THEME_OPTIONS } from '@/components/providers/ThemeProvider'
import {
  Store, Save, Database, Trash2, AlertTriangle, Moon, Keyboard,
  ShieldCheck, Receipt, Settings as SettingsIcon,
  Search, MessageCircle, Sparkles, Bell, Repeat, FileSpreadsheet, Link2 as LinkIcon,
  Users, Package, ScanLine, TrendingUp, Smartphone, RotateCcw, Palette, Check, Globe, Shield, EyeOff, Plus, Mic, Lock, Loader2, BarChart3, Home, Pencil,
} from 'lucide-react'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { useSetting } from '@/hooks/use-setting'
import { cn, formatINR } from '@/lib/utils'
import { APP_VERSION_LABEL } from '@/lib/app-version'
import { readError } from '@/lib/read-error'
import { INVOICE_THEMES } from '@/lib/invoice-themes'
import { INVOICE_TEMPLATES } from '@/lib/invoice-templates'
import { PAPER_SIZES } from '@/lib/invoice-paper'
import { VISIBILITY_TOGGLES } from '@/lib/invoice-visibility'
import { InfoHint } from '@/components/common/InfoHint'
import { SignatureField } from '@/components/settings/SignatureField'
import { describeRestoreOutcome } from '@/lib/restore-outcome'

const FEATURE_CATEGORIES: { title: string; features: { key: FeatureKey; label: string; description: string; icon: any }[] }[] = [
  {
    title: 'AI Features',
    features: [
      { key: 'aiScanner', label: 'AI Bill Scanner', description: 'Snap bill photos and auto-extract data', icon: ScanLine },
      { key: 'smartInsights', label: 'Smart Insights & Alerts', description: 'AI-powered alerts for stock, dues & profit', icon: Sparkles },
      { key: 'barcodeScanner', label: 'Barcode Scanner', description: 'Scan product barcodes for fast billing', icon: ScanLine },
    ],
  },
  {
    title: 'Business Features',
    features: [
      { key: 'whatsappSharing', label: 'WhatsApp Invoice Sharing', description: 'Send invoices to customers via WhatsApp', icon: MessageCircle },
      { key: 'paymentReminders', label: 'Payment Reminders', description: 'Track outstanding dues and send reminders', icon: Bell },
      { key: 'gstrExport', label: 'GSTR-1 Export', description: 'Export GST returns in portal format', icon: FileSpreadsheet },
      { key: 'recurringEntries', label: 'Recurring Entries', description: 'Auto-create rent, salary entries monthly', icon: Repeat },
      { key: 'customerLoyalty', label: 'Customer Loyalty Tracking', description: 'Track repeat customers & lifetime value', icon: Users },
      { key: 'reorderAlerts', label: 'Reorder Automation', description: 'Auto-suggest purchases when stock is low', icon: Package },
      { key: 'profitTracking', label: 'Profit Tracking', description: 'Auto-calculate profit on every sale', icon: TrendingUp },
      { key: 'lowStockAlerts', label: 'Low Stock Alerts', description: 'Get notified when products run low', icon: AlertTriangle },
      { key: 'businessAnalytics', label: 'Business Analytics', description: 'Best-sellers, dead stock, top customers & reorder patterns', icon: BarChart3 },
      { key: 'repeatLastSale', label: 'Repeat Last Sale', description: 'Show quick "repeat last sale" button on dashboard', icon: Repeat },
    ],
  },
  {
    title: 'Appearance',
    features: [
      // 🔒 AUDIT V25 FIX §3 row 8 (Batch 3): Removed duplicate Dark Mode toggle.
      // V19-034 removed one duplicate but this entry remained. The Appearance
      // tab has its own Dark Mode toggle (the canonical one). Two toggles for
      // the same feature in the same Settings screen was confusing.
      { key: 'keyboardShortcuts', label: 'Keyboard Shortcuts', description: 'Press N/S/I/D/R/A for quick navigation', icon: Keyboard },
      { key: 'globalSearch', label: 'Global Search (Ctrl+K)', description: 'Search products, parties & transactions anywhere', icon: Search },
      { key: 'pwaInstall', label: 'PWA Install Prompt', description: 'Show install as app prompt', icon: Smartphone },
    ],
  },
  {
    title: 'Notifications',
    features: [
      { key: 'dailySummary', label: 'Daily Sales Summary', description: 'Get a daily summary of your sales', icon: Bell },
      { key: 'announcementBanners', label: 'Announcement Banners', description: 'Show important updates from admin', icon: Bell },
    ],
  },
  {
    title: 'Data & Privacy',
    features: [
      { key: 'analyticsTracking', label: 'Anonymous Analytics', description: 'Help improve EkBook with anonymous usage data', icon: Shield },
      { key: 'offlineMode', label: 'Offline Mode', description: 'Use app without internet, sync when online', icon: Database },
      { key: 'autoSaveDrafts', label: 'Auto-Save Drafts', description: 'Automatically save sale/purchase forms while typing', icon: Save },
    ],
  },
]

/**
 * The settings cards this file can render, addressed one at a time.
 *
 * 🎨 2026-08-08. Before this, the Account screen asked for one of five TABS,
 * and a tab was whatever cards happened to be gated on its name. That is how
 * "My Profile" came to hold the AI Bill Scanner language, the AI Voice language
 * and Manage Shops: they were written inside `settingsTab === 'profile'` and
 * nothing said they didn't belong. Naming each card makes the pages composable
 * and makes a card in the wrong place obvious at the call site.
 */
export type SettingsSection =
  | 'shop-profile'    // the shop's identity: name, GSTIN, address, logo, UPI
  | 'manage-shops'    // branches and their GSTINs
  | 'appearance'      // theme, dark mode, app + AI languages
  | 'invoice-design'  // layout + colour
  | 'invoice-sending' // how a bill reaches the customer
  | 'invoice-tax'     // round off + e-invoicing
  | 'invoice-content' // terms, signature, bank, thank-you, due date
  | 'invoice-numbering' // prefix + next number
  | 'invoice-visibility' // extra details the shop can switch on
  | 'preferences'     // landing page, hide profit, goals, stock policy
  | 'notifications'   // which alerts reach the bell
  | 'accounting'      // period lock, reconciliation
  | 'data-backup'     // backup, restore, cache, delete account
  | 'staff'           // staff and CA access
  | 'features'        // feature toggles
  | 'ai-tools'        // AI usage + cost dashboard
  | 'about-card'      // version + replay tour

/**
 * Legacy tab → sections. The full-page /settings view still has a tab bar, so
 * each tab keeps meaning exactly what it meant, expressed as a section list.
 */
const TAB_SECTIONS: Record<string, SettingsSection[]> = {
  profile:    ['shop-profile', 'manage-shops'],
  appearance: ['appearance', 'invoice-design', 'invoice-sending', 'invoice-tax', 'invoice-content', 'invoice-numbering', 'preferences', 'notifications'],
  data:       ['accounting', 'data-backup'],
  staff:      ['staff'],
  features:   ['features', 'ai-tools'],
}

// 🔒 V21-014 (Phase 6): singleTab prop — when set, hides the tab bar and
// locks to that tab. Used by the Account page to render each section as a
// dedicated standalone page (no tab navigation visible).
export function Settings({
  singleTab,
  sections,
  hostTitle,
}: {
  singleTab?: 'profile' | 'features' | 'appearance' | 'data' | 'staff'
  /** Render exactly these cards. Takes precedence over `singleTab`. */
  sections?: SettingsSection[]
  /**
   * The heading the HOST page already shows above these cards.
   *
   * 🐛 2026-08-08. Rahul: "profile section and shop profile is the same."
   * He was reading the Shop Profile page, which said "Shop Profile" in the
   * top bar and then "Shop Profile" again on the card directly beneath it.
   * Every page this split created did the same — Invoices & Bills,
   * Preferences, Notifications, Accounting Controls, Data & Backup.
   *
   * These card titles were correct when the cards were stacked in one long
   * tab and needed to announce themselves. Once each got its own page with
   * its own title bar, the announcement became an echo. Passing the host's
   * title lets a card notice it is about to repeat and stay quiet.
   */
  hostTitle?: string
}) {
  const { confirmDialog, dialog: confirmDialogEl } = useConfirmDialog()
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const { features, setFeature, resetFeatures, themeColor, setThemeColor, language, setLanguage, setView } = useAppStore()
  const isOwner = session?.user?.role === 'owner'
  const isFounder = useAppStore((s) => s.isFounder)
  const [form, setForm] = useState({
    shopName: '', ownerName: '', phone: '', email: '',
    gstin: '', state: '', address: '', upiId: '',
    // 🔒 AUDIT V23 FIX §13.8: Add scanLang/voiceLang to form state.
    // Was missing → selectors always showed 'Original' even after saving.
    scanLang: 'original' as string,
    voiceLang: 'original' as string,
  })
  const [saving, setSaving] = useState(false)

  // useSetting hook — provides hideProfit + updateHideProfit (persists instantly)
  const { hideProfit, updateHideProfit } = useSetting()
  const { shops, activeShop, createShop, renameShop, removeShop } = useShops()
  // 🔒 V26 N20: Removed `switchShop` from destructure — was unused after
  // the V26 N4 removal of the Switch button (copy still references switching
  // but the actual UI no longer offers it; see V26 N14 copy fix).
  const { revenueTarget, expenseBudget, setRevenueTarget, setExpenseBudget } = useBusinessGoals()
  const [newShopOpen, setNewShopOpen] = useState(false)
  const [newShopName, setNewShopName] = useState('')
  // Inline shop rename (audit 2026-08-03).
  const [renameShopId, setRenameShopId] = useState<string | null>(null)
  const [removingShopId, setRemovingShopId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const [revenueGoal, setRevenueGoal] = useState('')
  const [expenseGoal, setExpenseGoal] = useState('')
  // 🔒 V12: Invoice round-off toggle (nearest rupee on sale totals).
  const [roundOffEnabled, setRoundOffEnabled] = useState(false)
  // null = never answered, which is deliberately distinct from false.
  const [eInvoiceApplicable, setEInvoiceApplicable] = useState<boolean | null>(null)
  // 📄 How bills are delivered. See docs/DOCUMENT-ENGINE-PLAN.md.
  const [docSendFormat, setDocSendFormat] = useState<'smart' | 'image' | 'pdf'>('smart')
  const [docShareLink, setDocShareLink] = useState(false)
  const [invoiceTheme, setInvoiceTheme] = useState('classic')
  const [invoiceTemplate, setInvoiceTemplate] = useState('standard')
  const [invoicePaperSize, setInvoicePaperSize] = useState('a4')
  // 📄 Phase 3. One object rather than ten useStates: these are saved together
  // by one button, and ten setters is ten chances to forget one.
  const [billContent, setBillContent] = useState({
    invoicePrefix: '', invoiceNextNumber: '1', invoiceTerms: '', invoiceThankYou: '',
    invoiceDueDays: '', bankName: '', bankAccountName: '', bankAccountNumber: '',
    bankIfsc: '', bankBranch: '',
  })
  const [showSignatureBox, setShowSignatureBox] = useState(true)
  const [showReceiverSignature, setShowReceiverSignature] = useState(false)
  // 📄 Phase 4 — every on/off switch that changes the bill, keyed by the
  // registry in lib/invoice-visibility.
  const [visibility, setVisibility] = useState<Record<string, boolean>>(
    () => Object.fromEntries(VISIBILITY_TOGGLES.map(t => [t.key, t.default])),
  )
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  // 🔒 V11: Stock policy toggle — 'block' (default) or 'allow' (kirana mode).
  const [stockPolicy, setStockPolicy] = useState<'block' | 'allow'>('block')
  // 🔒 V17-Ext §5.1: Period lock state. null = unlocked. Date string = locked
  // until that date. Loaded from /api/settings, persisted via persistPeriodLock.
  const [lockedUntil, setLockedUntil] = useState<string | null>(null)
  // Local input state for the date picker (ISO date string, e.g. "2026-03-31")
  const [lockDateInput, setLockDateInput] = useState('')
  const [savingLock, setSavingLock] = useState(false)
  // 🔒 V17-Ext §5.1: Health check state. Stores the last reconciliation result.
  const [healthCheck, setHealthCheck] = useState<any>(null)
  const [runningHealthCheck, setRunningHealthCheck] = useState(false)

  const { data } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await offlineFetch('/api/settings')
      return r.json()
    },
  })

  useEffect(() => {
    if (data?.setting) {
      setForm({
        shopName: data.setting.shopName || '',
        ownerName: data.setting.ownerName || '',
        phone: data.setting.phone || '',
        email: data.setting.email || '',
        gstin: data.setting.gstin || '',
        state: data.setting.state || '',
        address: data.setting.address || '',
        upiId: data.setting.upiId || '',
        // 🔒 AUDIT V23 FIX §13.8: Hydrate scanLang/voiceLang from server.
        // Was missing → selectors reset to 'Original' on every page load.
        scanLang: data.setting.scanLang || 'original',
        voiceLang: data.setting.voiceLang || 'original',
      })
      setRoundOffEnabled(data.setting.roundOffEnabled ?? false)
      setEInvoiceApplicable(data.setting.eInvoiceApplicable ?? null)
      setDocSendFormat(data.setting.docSendFormat ?? 'smart')
      setDocShareLink(data.setting.docShareLink ?? false)
      setInvoiceTheme(data.setting.invoiceTheme ?? 'classic')
      setInvoiceTemplate(data.setting.invoiceTemplate ?? 'standard')
      setInvoicePaperSize(data.setting.invoicePaperSize ?? 'a4')
      setBillContent({
        invoicePrefix: data.setting.invoicePrefix ?? '',
        invoiceNextNumber: String(data.setting.invoiceNextNumber ?? 1),
        invoiceTerms: data.setting.invoiceTerms ?? '',
        invoiceThankYou: data.setting.invoiceThankYou ?? '',
        invoiceDueDays: data.setting.invoiceDueDays != null ? String(data.setting.invoiceDueDays) : '',
        bankName: data.setting.bankName ?? '',
        bankAccountName: data.setting.bankAccountName ?? '',
        bankAccountNumber: data.setting.bankAccountNumber ?? '',
        bankIfsc: data.setting.bankIfsc ?? '',
        bankBranch: data.setting.bankBranch ?? '',
      })
      setShowSignatureBox(data.setting.showSignatureBox ?? true)
      setShowReceiverSignature(data.setting.showReceiverSignature ?? false)
      // 📄 Phase 4: read every toggle off the registry, so adding one to that
      // list is the whole change — no matching line to remember here.
      setVisibility(
        Object.fromEntries(
          VISIBILITY_TOGGLES.map(t => [t.key, data.setting[t.key] ?? t.default]),
        ),
      )
      setSignatureUrl(data.setting.signatureUrl ?? null)
      setStockPolicy(data.setting.stockPolicy === 'allow' ? 'allow' : 'block')
      // 🔒 V17-Ext §5.1: Sync period lock state from server.
      // lockedUntil is an ISO timestamp (or null). We store the full timestamp
      // for display + derive the date-only string for the date input default.
      const lockVal = data.setting.lockedUntil
      setLockedUntil(lockVal || null)
      if (lockVal) {
        // Extract YYYY-MM-DD for the date input default
        setLockDateInput(new Date(lockVal).toISOString().slice(0, 10))
      } else {
        setLockDateInput('')
      }
      // hideProfit is now managed by useSetting() hook — no need to sync here
      // 🔒 PDF Redesign Spec Part 3 §2: Sync logoUrl. Stored separately from
      // `form` because it's uploaded via /api/settings/logo (Cloudinary upload)
      // rather than the regular PUT /api/settings flow.
      setLogoUrl(data.setting.logoUrl || null)
    }
  }, [data])

  // 🔒 PDF Redesign Spec Part 3 §2: Shop logo URL (Cloudinary secure_url).
  // Managed separately from `form` because the upload is a 2-step process
  // (POST /api/settings/logo → Cloudinary upload → URL stored on Setting).
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  // 🔒 V12: Persist the round-off toggle instantly (like the hide-profit toggle).
  // 🔒 R16-1 (Round 16): Revert optimistic update on failure. Was: toggle
  // showed ON while server had OFF — fixed on next page load. Now: reverts
  // to the previous value in catch, matching use-setting.ts:76-83 pattern.
  /**
   * Saves a bill-delivery setting on its own, immediately.
   *
   * Optimistic with a rollback, matching persistRoundOff: a toggle that waits
   * for a round trip feels broken on a shop's connection, and one that lies
   * about having saved is worse.
   */
  /**
   * 📄 Phase 3: save the typed fields.
   *
   * Separate from persistDocSetting because these are TYPED, not tapped —
   * there is a Save button, so no optimistic write and no rollback dance. The
   * cache is refreshed afterwards so the live preview picks them up.
   */
  const [savingBill, setSavingBill] = useState(false)
  const persistBillContent = async (patch: Record<string, unknown>) => {
    setSavingBill(true)
    try {
      const r = await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        offline: { invalidate: ['/api/settings'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      queryClient.invalidateQueries({ queryKey: ['setting'] })
      sonnerToast.success('Saved')
    } catch (e: unknown) {
      sonnerToast.error(e instanceof Error ? e.message : "Couldn't save that")
    } finally {
      setSavingBill(false)
    }
  }

  const persistDocSetting = async (
    patch: { docSendFormat?: 'smart' | 'image' | 'pdf'; docShareLink?: boolean; invoiceTheme?: string; invoiceTemplate?: string; invoicePaperSize?: string },
    rollback: () => void,
  ) => {
    /*
     * 🐛 2026-08-15. Rahul: "preview is not working instantly".
     *
     * The picker updated its own local state and the server, and the preview
     * reads Setting from the ['setting'] query — which only changed after the
     * PUT returned and the cache was invalidated. So a tap repainted the
     * chosen tile at once and the bill a second or more later, which reads as
     * the app ignoring you. Guidance on live previews is that the feedback has
     * to be immediate for exploration to feel safe, and validation feedback
     * inside 300ms.
     *
     * Writing the patch into the cache first makes every reader instant, and
     * the rollback below already restores it if the save fails.
     */
    queryClient.setQueryData(['setting'], (old: any) =>
      old ? { ...old, setting: { ...old.setting, ...patch } } : old)
    try {
      const r = await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        offline: { invalidate: ['/api/settings'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      sonnerToast.success('Saved')
    } catch (e: any) {
      rollback()
      // Put the cache back too, or the preview keeps showing a choice the
      // server rejected.
      queryClient.invalidateQueries({ queryKey: ['setting'] })
      sonnerToast.error(e?.message || "Couldn't save that setting")
    }
  }

  const persistEInvoice = async (next: boolean) => {
    const prev = eInvoiceApplicable
    setEInvoiceApplicable(next)
    try {
      const r = await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eInvoiceApplicable: next }),
        offline: { invalidate: ['/api/settings'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      queryClient.invalidateQueries({ queryKey: ['setting'] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      sonnerToast.success(next ? 'e-Invoicing turned on' : 'e-Invoicing turned off')
    } catch (e: any) {
      setEInvoiceApplicable(prev)
      sonnerToast.error(e?.message || 'Could not save the e-invoicing setting')
    }
  }

  const persistRoundOff = async (next: boolean) => {
    const prev = roundOffEnabled
    setRoundOffEnabled(next)
    try {
      const r = await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundOffEnabled: next }),
        offline: { invalidate: ['/api/settings'] },
      })
      // 🔒 2026-07-22: the R16-1 revert never fired. offlineFetch RESOLVES
      // with the Response on a 4xx/5xx — it only throws on a network failure —
      // so a server rejection skipped the catch entirely: the toggle stayed on,
      // a success toast appeared, and nothing had been saved.
      if (!r.ok) throw new Error(await readError(r))
      queryClient.invalidateQueries({ queryKey: ['setting'] })
      sonnerToast.success(`Invoice round-off ${next ? 'on' : 'off'}`)
    } catch (e: any) {
      setRoundOffEnabled(prev)
      sonnerToast.error(e?.message || 'Could not save round-off setting')
    }
  }

  // 🔒 V11: Persist the stock policy toggle instantly.
  // 🔒 R16-2 (Round 16): Revert optimistic update on failure (same as R16-1).
  const persistStockPolicy = async (next: 'block' | 'allow') => {
    const prev = stockPolicy
    setStockPolicy(next)
    try {
      const r = await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockPolicy: next }),
        offline: { invalidate: ['/api/settings'] },
      })
      // 🔒 2026-07-22: same defect as persistRoundOff — see the note there.
      if (!r.ok) throw new Error(await readError(r))
      queryClient.invalidateQueries({ queryKey: ['setting'] })
      sonnerToast.success(next === 'allow' ? 'Overselling allowed (kirana mode)' : 'Overselling blocked')
    } catch (e: any) {
      setStockPolicy(prev)
      sonnerToast.error(e?.message || 'Could not save stock policy setting')
    }
  }

  // 🔒 V17-Ext §5.1: Lock the period. Sends ONLY lockedUntil (not the whole
  // form) so the lock can be set independently of a settings save. The server
  // treats undefined fields as "don't touch" so other settings are preserved.
  const persistPeriodLock = async (dateStr: string) => {
    if (!dateStr) {
      sonnerToast.error('Please select a date first')
      return
    }
    setSavingLock(true)
    try {
      // Convert YYYY-MM-DD to end-of-day ISO (so "March 31" locks ALL of March 31)
      const lockDate = new Date(dateStr + 'T23:59:59.999')
      const r = await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockedUntil: lockDate.toISOString() }),
        offline: { invalidate: ['/api/settings'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      setLockedUntil(lockDate.toISOString())
      sonnerToast.success(`Period locked until ${new Date(dateStr).toLocaleDateString('en-IN')}. Transactions dated on or before this date can no longer be edited.`)
      haptic.success()
      queryClient.invalidateQueries({ queryKey: ['setting'] })
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e?.message || 'Could not set period lock')
    } finally {
      setSavingLock(false)
    }
  }

  // 🔒 V17-Ext §5.1: Unlock the period. Sends lockedUntil: null. The owner
  // can always unlock — they're the boss. (A future "filed GST" status could
  // make this truly irreversible, but that's out of scope for now.)
  const handleUnlock = async () => {
    if (!await confirmDialog('Unlock the period? This will allow editing and deleting transactions in the previously locked period.', { title: 'Unlock Period', confirmLabel: 'Unlock', destructive: true })) return
    setSavingLock(true)
    try {
      const r = await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockedUntil: null }),
        offline: { invalidate: ['/api/settings'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      setLockedUntil(null)
      setLockDateInput('')
      sonnerToast.success('Period unlocked. You can now edit all transactions.')
      haptic.success()
      queryClient.invalidateQueries({ queryKey: ['setting'] })
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e?.message || 'Could not unlock period')
    } finally {
      setSavingLock(false)
    }
  }

  // 🔒 V17-Ext §5.1: Run the reconciliation health check. Calls /api/reconciliation
  // which runs 3 checks: party balances, GST totals, and orphaned data.
  // Shows a green check or red x for each check so the shopkeeper (and their
  // CA) can trust the numbers.
  const handleRunHealthCheck = async () => {
    setRunningHealthCheck(true)
    try {
      const r = await offlineFetch('/api/reconciliation')
      if (!r.ok) throw new Error(await readError(r))
      const data = await r.json()
      setHealthCheck(data)
      if (data.allPassed) {
        sonnerToast.success('All checks passed — your books are balanced.')
      } else {
        const failed = data.checks.filter((c: any) => !c.passed).length
        sonnerToast.warning(`${failed} check(s) failed`, {
          description: 'See details below.',
          duration: 8000,
        })
      }
      haptic.success()
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e?.message || 'Could not run health check')
    } finally {
      setRunningHealthCheck(false)
    }
  }

  /**
   * Save an inline shop rename. Closes the editor only on success, so a
   * failure leaves the typed name on screen to retry rather than discarding it.
   */
  const submitRename = async (shopId: string) => {
    const trimmed = renameValue.trim()
    const current = shops.find(s => s.id === shopId)
    if (!trimmed || trimmed === current?.name) {
      setRenameShopId(null)
      return
    }
    setRenameSaving(true)
    try {
      const result = await renameShop(shopId, trimmed)
      if (result) setRenameShopId(null)
    } finally {
      setRenameSaving(false)
    }
  }

  /**
   * 🔒 #30 (2026-08-13): remove a shop, or put it away.
   *
   * The shopkeeper is asked once, in plain words, and the SERVER decides which
   * of the two actually happens. Trying the delete first is deliberate: if the
   * shop is empty it simply goes, and if it is not, the refusal carries the
   * counts ("holds 12 bill(s), 3 customer(s)…") — which is a far better basis
   * for the follow-up question than anything guessed on the client.
   *
   * So a traded shop produces a SECOND confirmation, naming what is inside it,
   * offering to archive. Two questions only in the case that deserves two.
   */
  const handleRemoveShop = async (shop: { id: string; name: string }) => {
    const ok = await confirmDialog(
      `Remove "${shop.name}"?\n\n` +
        `If this shop has no bills, customers or products, it will be deleted. ` +
        `If it has any, nothing is lost — we'll offer to put it away instead, and everything in it is kept.`,
      { title: 'Remove this shop?', confirmLabel: 'Continue', destructive: true },
    )
    if (!ok) return

    setRemovingShopId(shop.id)
    try {
      const deleted = await removeShop(shop.id, 'delete')
      if (deleted) return

      /*
       * The delete was refused. removeShop has already shown the server's
       * explanation, which names what the shop holds — so this question can be
       * short, and the shopkeeper has already read the reason.
       */
      const archive = await confirmDialog(
        `"${shop.name}" has records in it, so it cannot be deleted.\n\n` +
          `Put it away instead? It disappears from this list, and every bill, customer and product in it is kept.`,
        { title: 'Put this shop away?', confirmLabel: 'Put it away', destructive: false },
      )
      if (archive) await removeShop(shop.id, 'archive')
    } finally {
      setRemovingShopId(null)
    }
  }

  const handleSave = async () => {
    if (!form.shopName.trim()) {
      sonnerToast.error('Shop name is required')
      return
    }
    setSaving(true)
    try {
      const r = await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, hideProfit, roundOffEnabled, stockPolicy, scanLang: (form as any).scanLang, voiceLang: (form as any).voiceLang }),
        offline: { invalidate: ['/api/settings', '/api/dashboard'] },
      })
      if (!r.ok) throw new Error(await readError(r))
      sonnerToast.success(isQueuedResponse(r) ? 'Saved offline — will sync when online' : 'Settings saved')
      haptic.success()
      queryClient.invalidateQueries({ queryKey: ['setting'] })
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e?.message || "Couldn\'t save settings")
    } finally {
      setSaving(false)
    }
  }

  const handleResetData = async () => {
    if (!await confirmDialog('This will DELETE ALL your data (products, transactions, parties). This cannot be undone. Are you absolutely sure?', { title: 'Reset All Data', confirmLabel: 'I understand, delete everything' })) return
    if (!await confirmDialog('Last confirmation: All data will be permanently deleted. Continue?', { title: 'Final Confirmation', confirmLabel: 'Yes, delete permanently' })) return
    try {
      // Delete via prisma - we'll do this via a special endpoint
      const r = await offlineFetch('/api/seed', { method: 'DELETE', offline: { queueable: false, invalidate: ['/api/products', '/api/parties', '/api/transactions', '/api/dashboard', '/api/settings'] } })
      if (r.ok) {
        haptic.error()
        sonnerToast.success('All data deleted. Refreshing...')
        setTimeout(() => window.location.reload(), 1500)
      } else {
        // 🔒 R16-5 (Round 16): Was: silent failure — user clicks "Reset All
        // Data", nothing happens, no toast. Now: surface the server's error
        // (period-lock refusal, permission denied, etc.).
        haptic.error()
        sonnerToast.error(await readError(r), { duration: 8000 })
      }
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e?.message || "Couldn\'t reset data")
    }
  }

  // 🐛 UI/UX Phase 4 Fix 2: Delete Account — DPDP Act compliance.
  // The /api/account/delete endpoint exists but was never exposed in the UI.
  // Now: triple-confirmation dialog → calls API → signs out → redirects to login.
  const handleDeleteAccount = async () => {
    if (!await confirmDialog(
      'This will PERMANENTLY DELETE your entire account — all products, transactions, parties, settings, and your login. This CANNOT be undone. Are you absolutely sure?',
      { title: 'Delete My Account', confirmLabel: 'I understand, delete my account', destructive: true }
    )) return
    if (!await confirmDialog(
      'Final confirmation: Your account and ALL data will be permanently deleted. You will not be able to recover anything. Continue?',
      { title: 'Final Confirmation', confirmLabel: 'Yes, delete my account permanently', destructive: true }
    )) return
    if (!await confirmDialog(
      'Type DELETE to confirm. This is your last chance to cancel.',
      { title: 'Type DELETE to Confirm', confirmLabel: 'DELETE — Permanently erase everything', destructive: true }
    )) return
    try {
      const r = await offlineFetch('/api/account/delete', { method: 'DELETE', offline: { queueable: false } })
      if (r.ok) {
        haptic.error()
        sonnerToast.success('Account deleted. Redirecting to login...')
        // Clear all local data
        try { localStorage.clear() } catch {}
        try { sessionStorage.clear() } catch {}
        setTimeout(() => signOut({ callbackUrl: '/' }), 1500)
      } else {
        haptic.error()
        sonnerToast.error(await readError(r), { duration: 8000 })
      }
    } catch (e: any) {
      haptic.error()
      sonnerToast.error(e?.message || "Couldn\'t delete account")
    }
  }

  const handleClearPendingWrites = async () => {
    if (!await confirmDialog('Clear all pending offline writes? These are changes made while offline that haven\'t synced yet. This cannot be undone.', { title: 'Clear Pending Writes', confirmLabel: 'Clear' })) return
    try {
      const { getPendingWrites, deletePendingWrite } = await import('@/lib/offline-fetch')
      const writes = await getPendingWrites()
      for (const w of writes) {
        if (w.id) await deletePendingWrite(w.id)
      }
      sonnerToast.success(`Cleared ${writes.length} pending write(s)`)
      window.location.reload()
    } catch (e: any) {
      sonnerToast.error(e?.message || "Couldn't clear the offline queue — try again.")
    }
  }

  const handleClearOfflineCache = async () => {
    if (!await confirmDialog('Clear offline cache? This will remove all locally cached data. You\'ll need internet to reload it. Your cloud data is NOT affected.', { title: 'Clear Cache', confirmLabel: 'Clear' })) return
    try {
      const { clearAllOfflineData } = await import('@/lib/offline-fetch')
      await clearAllOfflineData()
      sonnerToast.success('Cache cleared. Reloading…')
      setTimeout(() => window.location.reload(), 1000)
    } catch (e: any) {
      sonnerToast.error(e?.message || "Couldn\'t clear cache")
    }
  }

  // 🔒 V21-012 (Phase 4a): Read pending tab from store (set by Account page)
  // so the Settings page opens on the correct tab when navigated from Account.
  const pendingTab = useAppStore((s) => s.pendingSettingsTab)
  const setPendingSettingsTab = useAppStore((s) => s.setPendingSettingsTab)
  // 🔒 V21-014 (Phase 6): If singleTab is set, use it as the initial tab.
  const [settingsTab, setSettingsTab] = useState<'profile' | 'features' | 'appearance' | 'data' | 'staff'>(singleTab || 'profile')

  /*
   * Which cards to draw. An explicit `sections` list wins; otherwise the
   * active tab decides, so the tabbed /settings page behaves exactly as before.
   *
   * A Set, not an array: `show()` runs once per card on every render, and a
   * linear scan per card is the kind of thing that is free at 13 cards and
   * embarrassing at 130.
   */
  const activeSections = useMemo(
    () => new Set<SettingsSection>(sections ?? TAB_SECTIONS[settingsTab] ?? []),
    [sections, settingsTab]
  )
  const show = (key: SettingsSection) => activeSections.has(key)

  /*
   * Would this card title just repeat the page heading?
   *
   * Compared loosely — case, punctuation and the difference between "&" and
   * "and" all folded away — because the pairs that actually collide are near
   * misses, not exact ones: the page says "Staff & Access" while the card says
   * "Staff Access". Genuinely different headings like "Appearance & Language"
   * over a "Theme & Appearance" card survive this and still render, which is
   * what we want: the card is naming a subsection, not echoing the page.
   */
  const echoesHost = (title: string) => {
    if (!hostTitle) return false
    // '&' and the word 'and' both fold away, so a "Staff Access" card sitting
    // under a "Staff & Access" page is recognised as the echo it is.
    const fold = (t: string) => t.toLowerCase().replace(/&/g, ' ').replace(/and/g, ' ').replace(/[^a-z0-9]/g, '')
    return fold(hostTitle) === fold(title)
  }

  // 🔒 V22-7 (Phase 5): Feature search query — filters FEATURE_CATEGORIES by
  // keyword (label + description + category title). Empty = show all.
  const [featureSearch, setFeatureSearch] = useState('')

  /*
   * "Anonymous Analytics" reads and writes the REAL consent, not a feature flag.
   *
   * WHY (2026-08-08, found in browser). This row was an ordinary entry in
   * FEATURE_CATEGORIES, so it rendered `features.analyticsTracking` — a Zustand
   * flag that defaults to TRUE and that nothing else reads. Actual analytics is
   * gated solely by the `bahikhata-analytics-consent` value the consent modal
   * writes, which defaults to off. The two never spoke.
   *
   * So the privacy screen showed "Anonymous Analytics — ON" with a green badge
   * to a shopkeeper who had declined, and turning the switch off did not stop
   * anything, because nothing was running in the first place. A privacy control
   * that reports the opposite of the truth is worse than no control at all, and
   * this codebase has removed one placebo toggle already (see the App Lock note
   * above). This one is wired to the real gate instead.
   *
   * Read after mount, not during render: the value lives in localStorage and
   * reading it while rendering on the server would hydrate to the wrong state.
   */
  const [analyticsOn, setAnalyticsOn] = useState(false)
  useEffect(() => { setAnalyticsOn(hasAnalyticsConsent()) }, [])

  // 🔒 V26 (V23 §4 cleanup): App Lock placebo state/handler REMOVED. The toggle
  // UI was already replaced with an honest "Coming Soon" row, but the dead
  // persistAppLock handler (with its lying "will require PIN on next launch"
  // toast) and the localStorage flag were left behind. Deleted so the next
  // edit can't accidentally re-wire a false security promise.

  // 🔒 V22-11 (Batch A, Phase 5g): Default Landing Page setting.
  // Lets users choose which view opens on launch. Persisted to localStorage.
  // Applied in page.tsx on first authentication.
  const [defaultLanding, setDefaultLanding] = useState('dashboard')
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDefaultLanding(localStorage.getItem('bahikhata:default-landing') || 'dashboard')
    }
  }, [])

  // 🔒 AUDIT V23 FIX §13.9b: Day-End Summary Time — was reading localStorage
  // directly in render, so after picking a new time the Select didn't visually
  // update until an unrelated re-render. Move to state + hydrate on mount so
  // the control reflects the saved value immediately and updates on change.
  const [dayEndTime, setDayEndTime] = useState('18')
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDayEndTime(localStorage.getItem('bahikhata:day-end-time') || '18')
    }
  }, [])
  const persistDefaultLanding = (view: string) => {
    setDefaultLanding(view)
    if (typeof window !== 'undefined') {
      localStorage.setItem('bahikhata:default-landing', view)
    }
    const labels: Record<string, string> = {
      dashboard: 'Dashboard',
      sales: 'Sales Ledger',
      purchases: 'Purchase Ledger',
      inventory: 'Inventory',
      parties: 'Parties',
      reports: 'Reports',
      scanner: 'AI Bill Scanner',
    }
    sonnerToast.success(`Default landing page: ${labels[view] || view}`)
  }

  // 🔒 V22-12 (Batch B, Phase 5d): Notification Preferences — granular toggles
  // for each notification type. Stored in localStorage as JSON.
  // Read by NotificationCenter to filter which notifications to show.
  const defaultNotifPrefs = {
    lowStock: true,
    receivable: true,
    pendingSync: true,
    announcements: true,
    dailyDigest: true,     // 🔒 Feature Phase 4: Daily digest card on dashboard
    backupReminder: true,  // 🔒 Feature Phase 5: Auto-backup reminder card
  }
  const [notifPrefs, setNotifPrefs] = useState(defaultNotifPrefs)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('bahikhata:notif-prefs')
        if (stored) setNotifPrefs({ ...defaultNotifPrefs, ...JSON.parse(stored) })
      } catch { /* ignore parse errors */ }
    }
  }, [])
  const updateNotifPref = (key: keyof typeof defaultNotifPrefs, enabled: boolean) => {
    const updated = { ...notifPrefs, [key]: enabled }
    setNotifPrefs(updated)
    if (typeof window !== 'undefined') {
      localStorage.setItem('bahikhata:notif-prefs', JSON.stringify(updated))
    }
    const labels: Record<string, string> = {
      lowStock: 'Low stock alerts',
      receivable: 'Receivable alerts',
      pendingSync: 'Pending sync alerts',
      announcements: 'Announcement banners',
    }
    sonnerToast.success(`${labels[key]} ${enabled ? 'enabled' : 'disabled'}`)
  }

  // 🔒 V22-7 (Phase 5): Auto-backup state. Stores last backup timestamp.
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [backingUp, setBackingUp] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setLastBackup(localStorage.getItem('bahikhata:last-backup'))
    }
  }, [])
  const handleBackupNow = async () => {
    setBackingUp(true)
    try {
      await exportBackup()
      const now = new Date().toISOString()
      setLastBackup(now)
      if (typeof window !== 'undefined') {
        localStorage.setItem('bahikhata:last-backup', now)
      }
      sonnerToast.success('Backup downloaded successfully')
    } catch (err: any) {
      sonnerToast.error(err?.message || 'Backup failed', { description: String(err?.message || err).slice(0, 200) })
    } finally {
      setBackingUp(false)
    }
  }

  // 🔒 V22-7 (Phase 5): Filtered feature categories based on search query.
  // Matches against category title, feature label, and feature description.
  // Case-insensitive. When search is empty, shows all categories.
  const filteredFeatureCategories = useMemo(() => {
    if (!featureSearch.trim()) return FEATURE_CATEGORIES
    const q = featureSearch.toLowerCase().trim()
    return FEATURE_CATEGORIES.map((cat) => {
      const titleMatches = cat.title.toLowerCase().includes(q)
      const filteredFeatures = cat.features.filter(
        (f) =>
          f.label.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q),
      )
      if (titleMatches || filteredFeatures.length > 0) {
        return { ...cat, features: titleMatches ? cat.features : filteredFeatures }
      }
      return null
    }).filter(Boolean) as typeof FEATURE_CATEGORIES
  }, [featureSearch])

  // 🔒 V21-012 fix: Read from store on mount for pending tab
  // 🔒 V26 N13: ALSO react to pendingTab changes while Settings is open.
  // Was: only ran on mount, so hitting Ctrl+K → "Staff & Access" while
  // Settings was already open did nothing (setView('settings') was a no-op,
  // the effect didn't re-fire). Now: pendingTab is in the dep array, so
  // a later setPendingSettingsTab() switches the tab reactively. Mirrors
  // the Reports.tsx pattern (Reports.tsx:69-79).
  useEffect(() => {
    if (singleTab) return // Don't override singleTab mode
    const tab = pendingTab
    if (tab) {
      setSettingsTab(tab)
      setPendingSettingsTab(null)
    }
  }, [pendingTab, setPendingSettingsTab, singleTab])

  const tabs = [
    { id: 'profile', label: 'Profile', icon: Store },
    { id: 'features', label: 'Features', icon: Check },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'data', label: 'Data', icon: Database },
    ...(isOwner ? [{ id: 'staff', label: 'Staff', icon: Users }] : []),
  ] as const

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Tab bar — hidden when singleTab is set (Account page dedicated sections) */}
      {/* 🐛 2026-08-08: `!singleTab` alone let the tab bar leak onto every
          Account page once they started passing `sections` instead — each
          dedicated page rendered "Profile | Features | Appearance | Data |
          Staff" above its own heading. Either prop means "you are embedded,
          the host owns navigation". */}
      {!singleTab && !sections && (
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setSettingsTab(tab.id as any)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                settingsTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>
      )}

      {/* ── PROFILE TAB ─────────────────────────────────────────────── */}
      {show('shop-profile') && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          {!echoesHost('Shop Profile') && (
          <CardTitle className="flex items-center gap-2">
            <Store className="w-5 h-5 text-amber-600 dark:text-amber-400" /> Shop Profile
          </CardTitle>
          )}
          <p className="text-xs text-muted-foreground">This information appears on invoices and reports</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 🔒 PDF Redesign Spec Part 3 §2: Shop logo uploader. Appears at
              the top of the Shop Profile card so users see it before the
              text fields — it's the single highest-impact branding change. */}
          <ShopLogoUploader logoUrl={logoUrl} onLogoChange={setLogoUrl} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="field-shop-name">Shop Name *</Label>
              <Input id="field-shop-name" value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} placeholder="e.g. Sharma Kirana Store" />
            </div>
            <div>
              <Label htmlFor="field-owner-name">Owner Name</Label>
              <Input id="field-owner-name" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} placeholder="Your name" />
            </div>
            <div>
              <Label htmlFor="field-phone">Phone</Label>
              <Input id="field-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit mobile" />
            </div>
            <div>
              <Label htmlFor="field-email">Email</Label>
              <Input id="field-email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
            </div>
            <div>
              <Label htmlFor="field-gstin">GSTIN</Label>
              <Input id="field-gstin" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="15-digit GST number" className="font-mono uppercase" />
            </div>
            <div>
              <Label htmlFor="field-state">State</Label>
              <Input id="field-state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="e.g. Uttar Pradesh" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="field-address">Address</Label>
              <Input id="field-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Full shop address" />
            </div>
            {/* V17-Ext 5.4: UPI ID for udhaar collection links */}
            <div>
              <Label htmlFor="field-upi-id-for-payment-collection">UPI ID (for payment collection)</Label>
              <Input id="field-upi-id-for-payment-collection" value={form.upiId} onChange={(e) => setForm({ ...form, upiId: e.target.value })} placeholder="e.g. shop@paytm, 9876543210@ybl" className="font-mono lowercase" />
              <p className="text-xs text-muted-foreground mt-1">
                Your UPI VPA. When you send an udhaar reminder via WhatsApp, it will include a
                one-tap payment link for this amount.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} className="bg-gradient-saffron gap-2">
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {/* 🐛 UI/UX Phase 5 Fix 3: Multi-shop — disabled creation until switching
          is built. Was: users could CREATE shops but NOT switch between them
          (one-way trap). Now: shows existing shops but hides the "Add New Shop"
          button with an honest "Coming Soon" message. */}
      {show('manage-shops') && (
        <Card className="shadow-card border-border/60">
          <CardHeader>
            {!echoesHost('Manage Shops') && (
            <CardTitle className="flex items-center gap-2">
              <Store className="w-5 h-5 text-primary" /> Manage Shops
            </CardTitle>
            )}
            <p className="text-xs text-muted-foreground">Add shops and their GSTINs for consolidated reporting</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {shops.map(shop => (
                <div key={shop.id} className={`flex items-center gap-3 p-3 rounded-lg border transition ${shop.isDefault ? 'border-primary bg-primary/5' : 'border-border'}`}>
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Store className="w-4 h-4 text-primary" />
                  </div>
                  {/* 🔒 2026-08-03 (audit): a shop could be created and never
                      renamed — an owner was stuck with a typo in their own
                      shop's name for good. Edited inline rather than in a
                      dialog: it is one short field, and a popup on a phone
                      hides the list you are renaming within. */}
                  {renameShopId === shop.id ? (
                    <>
                      <div className="flex-1 min-w-0">
                        <Input
                          autoFocus
                          value={renameValue}
                          maxLength={200}
                          aria-label="Shop name"
                          className="h-9 text-sm"
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); void submitRename(shop.id) }
                            if (e.key === 'Escape') { e.preventDefault(); setRenameShopId(null) }
                          }}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 flex-shrink-0"
                        disabled={renameSaving || !renameValue.trim() || renameValue.trim() === shop.name}
                        onClick={() => void submitRename(shop.id)}
                      >
                        {renameSaving ? 'Saving…' : 'Save'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 flex-shrink-0"
                        disabled={renameSaving}
                        onClick={() => setRenameShopId(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{shop.name}</p>
                        <p className="text-2xs text-muted-foreground truncate">
                          {shop.gstin ? `GSTIN: ${shop.gstin}` : 'No GSTIN'} {shop.isDefault ? ' · Default' : ''}
                        </p>
                      </div>
                      {/* 🔒 V26 FIX N4: Switch button removed — was cosmetic. Multi-shop
                          data scoping is coming soon. Shops can still be created + their
                          GSTIN used in the Consolidated Report. */}
                      {shop.isDefault && (
                        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-3xs">Default</Badge>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 p-0 flex-shrink-0"
                        aria-label={`Rename ${shop.name}`}
                        onClick={() => { setRenameShopId(shop.id); setRenameValue(shop.name) }}
                      >
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      {/*
                        🔒 #30 (2026-08-13): a shop can now be put away.
                        The API shipped with #21 and had no caller, so a shop
                        created by mistake still sat here forever.

                        ONE control, not two. The shopkeeper should not have to
                        know whether their shop counts as "empty" — they ask to
                        remove it, and the SERVER decides. If it holds books the
                        refusal explains what is in there and offers to put it
                        away instead, which is a better sentence than any
                        client-side guess at the counts.

                        Hidden for the last remaining shop: the server refuses
                        that anyway, and a button whose only outcome is a
                        rejection is worse than no button.
                      */}
                      {shops.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0 flex-shrink-0 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                          aria-label={`Remove ${shop.name}`}
                          disabled={removingShopId === shop.id}
                          onClick={() => void handleRemoveShop(shop)}
                        >
                          {removingShopId === shop.id
                            ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            : <Trash2 className="w-4 h-4 text-muted-foreground" />}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* 🐛 Phase 5 Fix 3: "Add New Shop" button removed — was a one-way
                trap (users could create shops but couldn't switch between them).
                Now: honest "Coming Soon" message. Switching will be added in a
                future update. */}
            <div className="mt-3 p-3 rounded-lg border border-dashed border-border bg-muted/30 text-center">
              <Store className="w-5 h-5 text-muted-foreground/50 mx-auto mb-1" />
              <p className="text-xs font-medium text-muted-foreground">Multi-shop switching coming soon</p>
              <p className="text-2xs text-muted-foreground/70 mt-0.5">
                You&apos;ll be able to add multiple shops and switch between them. For now, all data goes to your default shop.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 🔒 AUDIT V25 FIX §3.5 (Batch 3b): Business Goals card MOVED to
          Appearance tab (Business Rules & Goals group). Was in Profile tab
          — but revenue/expense targets are business configuration, not
          profile data. Profile tab now contains only owner/shop info. */}

      {/* ── DATA & ACCOUNTING ───────────────────────────────────────
          Was ONE card reached by TWO menu rows: "Accounting Controls"
          and "Data & Backup" both navigated to accountSection 'data'
          and rendered byte-identical pages. Now they are two pages,
          because a period lock and a cache purge have nothing to do
          with each other. ─────────────────────────────────────────── */}
      {show('accounting') && isOwner && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          {!echoesHost('Accounting Controls') && (
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" /> Accounting Controls
          </CardTitle>
          )}
          <p className="text-xs text-muted-foreground">Reconciliation and period lock — for filing integrity</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* 🔒 V17-Ext §5.1: Period Lock — protect filed GST periods from edits */}
          <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-4">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-amber-900 dark:text-amber-100 text-sm">Period Lock (Financial-Year lock)</p>
                  {lockedUntil ? (
                    <Badge className="bg-amber-600 text-white hover:bg-amber-700">Locked</Badge>
                  ) : (
                    <Badge variant="secondary">Unlocked</Badge>
                  )}
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                  Once you file GST for a period, lock it. No one (not even staff) can edit, delete,
                  or create transactions dated on or before the lock date. This protects your filed
                  returns from accidental or fraudulent changes.
                </p>

                {lockedUntil ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-100">
                      <Calendar className="w-4 h-4" />
                      <span>
                        Locked until:{' '}
                        <strong>{new Date(lockedUntil).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</strong>
                      </span>
                    </div>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Transactions dated on or before this date are read-only. To make changes, unlock
                      the period first (owner only).
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 border-amber-400 dark:border-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                      onClick={handleUnlock}
                      disabled={savingLock}
                    >
                      {savingLock ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                      {savingLock ? 'Unlocking...' : 'Unlock Period'}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-end gap-2 flex-wrap">
                      <div className="flex-1 min-w-[160px]">
                        <Label className="text-xs text-amber-900 dark:text-amber-100" htmlFor="field-lock-until-date-inclusive">Lock until date (inclusive)</Label>
                        <Input id="field-lock-until-date-inclusive"
                          type="date"
                          value={lockDateInput}
                          onChange={(e) => setLockDateInput(e.target.value)}
                          className="mt-1"
                          max={new Date().toISOString().slice(0, 10)}
                        />
                      </div>
                      <Button
                        size="sm"
                        className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                        onClick={() => persistPeriodLock(lockDateInput)}
                        disabled={savingLock || !lockDateInput}
                      >
                        {savingLock ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                        {savingLock ? 'Locking...' : 'Lock Period'}
                      </Button>
                    </div>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Tip: Lock until the last day of the month you filed GST for (e.g. March 31).
                      You can always unlock later if needed.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 🔒 V17-Ext §5.1: Reconciliation Health Check */}
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/20 p-4">
            <div className="flex items-start gap-3">
              <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-emerald-900 dark:text-emerald-100 text-sm">Health Check (Reconciliation)</p>
                <p className="text-xs text-emerald-800 dark:text-emerald-200 mt-1">
                  Verify your books are balanced. Checks that party balances match dashboard totals,
                  per-item GST matches invoice headers, and no orphaned data exists. Run this before
                  filing GST or at month-end to catch any issues.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-2 border-emerald-400 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                  onClick={handleRunHealthCheck}
                  disabled={runningHealthCheck}
                >
                  {runningHealthCheck ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {runningHealthCheck ? 'Checking...' : 'Run Health Check'}
                </Button>

                {/* Results */}
                {healthCheck && (
                  <div className="mt-3 space-y-2">
                    {healthCheck.allPassed ? (
                      <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300 font-medium">
                        <Check className="w-4 h-4" />
                        All checks passed — your books are balanced.
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-rose-700 dark:text-rose-300 font-medium">
                        <AlertTriangle className="w-4 h-4" />
                        Some checks failed — see details below.
                      </div>
                    )}
                    {healthCheck.checks.map((check: any, i: number) => (
                      <div
                        key={i}
                        className={cn(
                          'flex items-start gap-2 rounded-md p-2 text-xs',
                          check.passed ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200' : 'bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200'
                        )}
                      >
                        {check.passed ? (
                          <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-semibold">{check.name}</p>
                          <p className="mt-0.5">{check.details}</p>
                        </div>
                      </div>
                    ))}
                    {healthCheck.runAt && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        Last checked: {new Date(healthCheck.runAt).toLocaleString('en-IN')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {show('data-backup') && isOwner && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          {!echoesHost('Data & Backup') && (
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" /> Data & Backup
          </CardTitle>
          )}
          <p className="text-xs text-muted-foreground">Backup, restore, offline cache, delete account</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Offline cache management */}
          <div className="rounded-lg border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/20 p-4">
            <div className="flex items-start gap-3">
              <Database className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-blue-900 dark:text-blue-100 text-sm">Offline Data</p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Clear locally cached data or stuck pending writes. Your cloud data is never affected.
                </p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <Button variant="outline" size="sm" className="gap-2 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40" onClick={handleClearPendingWrites}>
                    <Trash2 className="w-4 h-4" /> Clear Pending Writes
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40" onClick={handleClearOfflineCache}>
                    <Database className="w-4 h-4" /> Clear Offline Cache
                  </Button>
                </div>
              </div>
            </div>
          </div>
          {/* 🔒 V17 Audit Phase 1 P1.6: Backup card moved OUT of the Danger Zone.
              Was: safe "Download Backup" action grouped with destructive "Reset All Data"
              inside a rose-bordered danger card. Now: separate blue card above the danger
              zone so the user doesn't confuse a safe action with a destructive one. */}
          {/* 🔒 AUDIT V25 FIX §3 row 7 (Batch 3): Unified backup card — consolidated
              the 3 separate backup cards (Data tab "Backup Your Data" + Data tab
              "Restore from Backup" + Appearance tab "Backup & Restore") into ONE
              card here in the Data tab. The Appearance tab duplicate is removed.
              This card now shows last-backup timestamp + uses handleBackupNow
              (which tracks backingUp state). Restore stays as a separate card
              below — it's a different action (upload vs download). */}
          <div className="rounded-lg border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-950/20 p-4">
            <div className="flex items-start gap-3">
              <Download className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-blue-900 dark:text-blue-100 text-sm">Backup Your Data</p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Download all your products, transactions, parties, and settings as a JSON file.
                  Use this to migrate to a new device or keep a safe copy.
                </p>
                <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
                  <p className="text-2xs text-blue-700 dark:text-blue-300">
                    {lastBackup
                      ? `Last backup: ${new Date(lastBackup).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at ${new Date(lastBackup).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                      : 'No backup yet — tap "Backup Now" to download'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                    onClick={handleBackupNow}
                    disabled={backingUp}
                  >
                    {backingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {backingUp ? 'Backing up...' : 'Backup Now'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* 🔒 V17 Audit Phase 9: Restore from Backup — upload a JSON backup file
              🔒 V26 N5: Honest copy — restore REPLACES all current data (not merges).
              The backend blocks restore into a non-empty shop; the UI must say so
              up front so the user knows to reset first if needed. */}
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/20 p-4">
            <div className="flex items-start gap-3">
              <Upload className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-emerald-900 dark:text-emerald-100 text-sm">Restore from Backup</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                  Upload a previously downloaded backup JSON file to restore your data.
                  This <strong>REPLACES all current data</strong> — restore only works on an empty shop.
                  If you have existing data, go to Danger Zone below and tap "Reset All Data" first.
                  After restore, stock is rebuilt from transactions and items are re-linked to your catalog by name.
                </p>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    // 🔒 V26 N5: Explicit confirmation — restore is destructive (replaces all data).
                    const confirmed = await confirmDialog(
                      'Restore will REPLACE all your current data with the backup. Stock will be rebuilt from transactions. Continue?',
                      { title: 'Restore from Backup', confirmLabel: 'Restore', destructive: true },
                    )
                    if (!confirmed) {
                      e.target.value = ''
                      return
                    }
                    try {
                      const text = await file.text()
                      const backup = JSON.parse(text)
                      // 🔒 V26 P7-1 (Phase 7): Generate restoreSessionId client-side,
                      // persist in localStorage so a retry after timeout carries the
                      // SAME id → the server's resume path fires. Clear on success.
                      const restoreSessionId = localStorage.getItem('bahikhata:restore-session') || crypto.randomUUID()
                      localStorage.setItem('bahikhata:restore-session', restoreSessionId)
                      // 🔒 V26 P7-1: Use timeoutMs override — restores of >1500 rows
                      // take >20s, and the blanket R8 timeout would abort them.
                      const r = await offlineFetch('/api/import/restore', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ backup, restoreSessionId }),
                        offline: { queueable: false, timeoutMs: 120_000 },
                      })
                      const result = await r.json()
                      if (!r.ok) throw new Error(result.error || result.message || 'Restore failed')
                      // Success — clear the session marker so a future restore starts fresh.
                      localStorage.removeItem('bahikhata:restore-session')
                      /*
                       * 🔒 2026-08-14: the decision about WHAT to tell the
                       * shopkeeper moved to lib/restore-outcome.ts so it can be
                       * tested by being called.
                       *
                       * What used to be here read four counters and never
                       * rendered the server's own `message`. A warning added on
                       * the server was written, returned, and dropped on the
                       * floor — the shopkeeper saw "Restore complete!". That is
                       * the failure silent-failure-reporting.test.ts exists to
                       * catch, reappearing one level up. The server now returns
                       * `warnings` as a list and describeRestoreOutcome renders
                       * all of them, so the next warning added there reaches the
                       * user without anyone remembering to wire it up.
                       */
                      const outcome = describeRestoreOutcome(result)
                      const toast = outcome.kind === 'warning' ? sonnerToast.warning : sonnerToast.success
                      toast(outcome.title, {
                        description: outcome.description,
                        duration: outcome.durationMs,
                      })
                    } catch (err: any) {
                      // 🔒 V26 P7-1: On timeout/failure, the session marker persists
                      // in localStorage → a retry with the same file carries the same
                      // restoreSessionId → the server resumes where it left off.
                      sonnerToast.error('Restore is taking longer than expected', {
                        description: 'It may still be running on the server. Tap Restore again with the same file to continue where it left off.',
                        duration: 15000,
                      })
                    }
                    // Reset the input so the same file can be selected again
                    e.target.value = ''
                  }}
                  className="hidden"
                  id="restore-backup-upload"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 gap-2 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                  onClick={() => document.getElementById('restore-backup-upload')?.click()}
                >
                  <Upload className="w-4 h-4" /> Upload Backup File
                </Button>
              </div>
            </div>
          </div>

          {/* 🔒 V26 R7 (Phase 5): Unsynced Entries card.
              Surfaces the dead-letter store (was: zero UI consumers — the
              saveToDeadLetter comment promised review+re-enter, but no screen
              existed). Hidden when the store is empty (no noise on the Data
              tab for the vast majority of users who never hit a dead-letter). */}
          <UnsyncedEntries />

          {/* 🔒 V-2 data-repair (auditor spec Part B): Founder-only review of
              supplier opening balances with the wrong sign. Auto-hides when
              no suspects or non-founder. */}
          <SupplierOpeningBalanceReview />

          {/* Danger zone — destructive actions only (no safe actions mixed in) */}
          <div className="rounded-lg border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-rose-900 dark:text-rose-100 text-sm">Danger Zone</p>
                <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">
                  This will permanently delete all products, transactions, parties and settings. Useful if you want to start fresh.
                </p>
                <Button variant="destructive" size="sm" className="mt-3 gap-2" onClick={handleResetData}>
                  <Trash2 className="w-4 h-4" /> Reset All Data
                </Button>

                {/* 🐛 UI/UX Phase 4 Fix 2: Delete Account — DPDP Act compliance.
                    The API endpoint /api/account/delete existed but was never
                    exposed in the UI. Now: triple-confirmation + signOut. */}
                <div className="mt-4 pt-4 border-t border-rose-200 dark:border-rose-900/40">
                  <p className="font-semibold text-rose-900 dark:text-rose-100 text-sm">Delete Account</p>
                  <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">
                    Permanently delete your account and ALL data. This cannot be undone. Required by DPDP Act.
                  </p>
                  <Button variant="destructive" size="sm" className="mt-2 gap-2" onClick={handleDeleteAccount}>
                    <UserX className="w-4 h-4" /> Delete My Account
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      )}


      {/* ── APPEARANCE & LANGUAGE ───────────────────────────────────
          🎨 2026-08-08. Was one card holding six unrelated domains and
          running 4.3 screens tall. Rahul: "app settings has about".
          It also had theme, language, profit privacy, revenue targets,
          invoice design, bill delivery, stock policy, the app lock and
          every notification switch. Split by what the shopkeeper came
          looking for. ───────────────────────────────────────────── */}
      {show('appearance') && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          {!echoesHost('Theme & Appearance') && (
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" /> Theme & Appearance
          </CardTitle>
          )}
          <p className="text-xs text-muted-foreground">Colours, dark mode, and the languages the app and the AI use</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {THEME_OPTIONS.map((theme) => (
              <button
                key={theme.id}
                onClick={() => {
                  setThemeColor(theme.id)
                  sonnerToast.success(`${theme.label} theme applied`)
                }}
                className={`group relative rounded-xl p-4 border-2 transition text-left ${
                  themeColor === theme.id ? 'border-primary shadow-lg' : 'border-border hover:border-primary/40 hover:shadow-md'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="w-12 h-12 rounded-xl shadow-md"
                    style={{ background: theme.swatch }}
                  />
                  {themeColor === theme.id && (
                    <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
                <p className="text-sm font-semibold">{theme.label}</p>
                <p className="text-2xs text-muted-foreground">{theme.description}</p>
              </button>
            ))}
          </div>
          {/* Dark Mode Toggle (moved from header) */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Dark Mode</p>
                <p className="text-2xs text-muted-foreground">Switch between light and dark themes</p>
              </div>
            </div>
            <Switch
              checked={features.darkMode}
              onCheckedChange={(checked) => { setFeature('darkMode', checked); sonnerToast.success(`Dark mode ${checked ? 'enabled' : 'disabled'}`) }}
            />
          </div>
          {/* Language Toggle — 6 languages */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 p-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Language / ભાષા / भाषा / மொழி / భాష</p>
                <p className="text-2xs text-muted-foreground">Choose your preferred language</p>
              </div>
            </div>
            <div className="flex gap-1 bg-background rounded-lg p-0.5 flex-wrap">
              {[
                { code: 'en', label: 'English', toast: 'Language: English' },
                { code: 'hi', label: 'हिंदी', toast: 'भाषा: हिंदी' },
                { code: 'gu', label: 'ગુજરાતી', toast: 'ભાષા: ગુજરાતી' },
                { code: 'mr', label: 'मराठी', toast: 'भाषा: मराठी' },
                { code: 'ta', label: 'தமிழ்', toast: 'மொழி: தமிழ்' },
                { code: 'te', label: 'తెలుగు', toast: 'భాష: తెలుగు' },
              ].map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => { setLanguage(lang.code as any); sonnerToast.success(lang.toast) }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${language === lang.code ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* 📄 2026-08-15. Rahul: "adding everything in the same section … can be
          frustrating for the user because if the user just want to change one
          thing then he has to scroll everything".

          He is right, and it was about to get much worse — Phase 3 adds terms,
          signature, bank details, numbering and a thank-you line to this same
          page. So Invoices & Bills is a hub of three pages now, each with the
          live preview above it. The cards below are the CONTENT of those pages;
          the hub itself is InvoiceSettingsPage. */}
      {show('invoice-design') && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* 📄 2026-08-15, Phase 2: LAYOUT and COLOUR are two questions.

              myBillBook asks them as one — named "Theme Styling" presets plus
              a row of colour dots, with nothing saying which decides what. Two
              controls, each doing one thing, gives 8 x 6 = 48 looks and stays
              explainable. Layout first, because it changes the bill more. */}
          <div className="mt-3 rounded-lg bg-muted/30 border border-border/60 p-3">
            <div className="flex items-center gap-2 mb-2">
              {/* 🎨 2026-08-15: coloured, like the Account menu one level up.
                  A grey glyph here made the screen look unfinished beside its
                  own parent. And the description is gone: "Invoice layout" is
                  self-explanatory, and the wireframes below say the rest. */}
              <FileText className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <p className="text-sm font-medium">Invoice layout</p>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {INVOICE_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    const prev = invoiceTemplate
                    setInvoiceTemplate(t.id)
                    persistDocSetting({ invoiceTemplate: t.id }, () => setInvoiceTemplate(prev))
                  }}
                  aria-pressed={invoiceTemplate === t.id}
                  title={t.description}
                  className={
                    'rounded-lg border p-2 transition text-left ' +
                    (invoiceTemplate === t.id
                      ? 'border-primary ring-2 ring-primary/25'
                      : 'border-border/70 hover:border-border')
                  }
                >
                  {/* A wireframe of the BONES — header treatment, row rhythm,
                      totals block. Deliberately colourless: the swatch below
                      answers colour, and showing it twice is what makes
                      myBillBook's two controls impossible to tell apart. */}
                  <span className="block rounded overflow-hidden border border-border/50 bg-white p-1">
                    <span className={
                      'block ' +
                      (t.header === 'band' ? 'h-2.5 bg-slate-700'
                        : t.header === 'rule' ? 'h-2.5 bg-white border-b-2 border-slate-700'
                        : 'h-2.5 bg-white border border-slate-500')
                    } />
                    <span className="block mt-1 space-y-0.5">
                      {[0, 1, 2].map(r => (
                        <span
                          key={r}
                          className={
                            'block w-full ' +
                            (t.density === 'compact' ? 'h-0.5' : t.density === 'airy' ? 'h-1.5' : 'h-1') + ' ' +
                            (t.table === 'zebra' ? (r % 2 ? 'bg-slate-200' : 'bg-slate-100')
                              : t.table === 'grid' ? 'border border-slate-300'
                              : 'border-b border-slate-200')
                          }
                        />
                      ))}
                    </span>
                    <span className={
                      'block h-1.5 w-1/2 ml-auto mt-1 ' +
                      (t.totals === 'bar' ? 'bg-slate-700'
                        : t.totals === 'panel' ? 'border border-slate-500'
                        : 'bg-slate-300')
                    } />
                  </span>
                  {/* 🎨 2026-08-15. Rahul: "for so basic things like explaining
                      standard or compact you don't need to describe it or add info
                      button when it's clear from the layout design and preview is
                      there too." Right — the wireframe above shows the difference
                      and the live bill shows the result. A button explaining what
                      the picture already says is decoration. */}
                  <span className="block text-3xs mt-1 font-medium truncate">{t.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 📄 2026-08-15: the SHEET. A third question beside shape and colour,
              and the one with a practical answer rather than a taste: A5 is half
              of A4 and is what most Indian bill books and counter printers use.
              A five-line kirana bill on a full A4 sheet wastes most of the page,
              every sale. This reaches the PDF, the download and WhatsApp — not
              just the preview. */}
          <div className="mt-3 rounded-lg bg-muted/30 border border-border/60 p-3">
            <div className="flex items-center gap-2 mb-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm font-medium">Paper size</p>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {PAPER_SIZES.map(ps => (
                <button
                  key={ps.id}
                  type="button"
                  onClick={() => {
                    const prev = invoicePaperSize
                    setInvoicePaperSize(ps.id)
                    persistDocSetting({ invoicePaperSize: ps.id }, () => setInvoicePaperSize(prev))
                  }}
                  aria-pressed={invoicePaperSize === ps.id}
                  className={
                    'rounded-lg border p-2 transition text-left ' +
                    (invoicePaperSize === ps.id
                      ? 'border-primary ring-2 ring-primary/25'
                      : 'border-border/70 hover:border-border')
                  }
                >
                  <span className="flex items-center gap-2">
                    {/* The sheets at their true relative proportions, so the
                        difference is visible rather than asserted. */}
                    <span
                      className="block border border-slate-400 bg-white flex-shrink-0"
                      style={{ width: ps.id === 'a4' ? 17 : 12, height: ps.id === 'a4' ? 24 : 17 }}
                    />
                    <span className="min-w-0">
                      <span className="block text-3xs font-medium">{ps.name}</span>
                      <span className="block text-3xs text-muted-foreground leading-tight">
                        {ps.widthMm} × {ps.heightMm} mm
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          {/* 📄 The invoice colour. ONE theme drives the WhatsApp picture, the
              link page and the PDF — a shop's bill and its payment page should
              not look like two different businesses. */}
          <div className="mt-3 rounded-lg bg-muted/30 border border-border/60 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Palette className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <p className="text-sm font-medium">Invoice colour</p>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {INVOICE_THEMES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    const prev = invoiceTheme
                    setInvoiceTheme(t.id)
                    persistDocSetting({ invoiceTheme: t.id }, () => setInvoiceTheme(prev))
                  }}
                  aria-pressed={invoiceTheme === t.id}
                  title={t.description}
                  className={
                    'rounded-lg border p-1.5 transition text-left ' +
                    (invoiceTheme === t.id
                      ? 'border-primary ring-2 ring-primary/25'
                      : 'border-border/70 hover:border-border')
                  }
                >
                  {/* 🎨 2026-08-15. Rahul: "for just showing the invoice color you
                      don't need to show proper layout because it takes unnecessary
                      space and make the page scroll unnecessary."

                      It was a miniature document per swatch — eight of them, each
                      repeating a shape the layout picker directly above had already
                      shown. Two bands of colour say the same thing in a fifth of
                      the height. */}
                  <span className="flex items-center gap-2">
                    <span
                      className="block w-7 h-7 rounded-md border border-black/10 flex-shrink-0"
                      style={{ background: t.headerBg }}
                    />
                    <span
                      className="block w-2.5 h-7 rounded-sm flex-shrink-0"
                      style={{ background: t.accent }}
                    />
                    {/* 🎨 2026-08-15. Rahul: "in mobile view there is few letters
                        is visible with colour which is neither complete nor needed".
                        Right — at four to a row the name truncated to two or three
                        letters, which tells nobody anything and is worse than
                        silence. The swatch IS the choice; the name returns when
                        there is room for all of it. */}
                    <span className="text-3xs truncate hidden sm:inline">{t.name}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      )}
      {show('invoice-sending') && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
        </CardHeader>
        <CardContent className="space-y-3">          {/* 📄 How bills go out. See docs/DOCUMENT-ENGINE-PLAN.md. */}
          <div className="mt-3 rounded-lg bg-muted/30 border border-border/60 p-3">
            <div className="flex items-center gap-2 mb-2">
              <MessageCircle className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">How bills are sent</p>
                <p className="text-2xs text-muted-foreground">
                  A short bill sends as a picture, which opens straight in a WhatsApp chat. A long one
                  sends as a PDF — WhatsApp shrinks tall images until the text cannot be read.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ['smart', 'Automatic', 'Picks by bill size'],
                ['image', 'Always picture', 'Best for short bills'],
                ['pdf', 'Always PDF', 'Best for long bills'],
              ] as const).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    const prev = docSendFormat
                    setDocSendFormat(value)
                    persistDocSetting({ docSendFormat: value }, () => setDocSendFormat(prev))
                  }}
                  aria-pressed={docSendFormat === value}
                  className={
                    'rounded-lg border px-2 py-2 text-left transition ' +
                    (docSendFormat === value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/25'
                      : 'border-border/70 hover:border-border')
                  }
                >
                  <span className="block text-2xs font-medium">{label}</span>
                  <span className="block text-3xs text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
          </div>
          {/* 📄 The shareable link. OFF by default — it puts a page carrying a
              customer's bill on the public internet behind an unguessable
              address, which is the shopkeeper's decision to make. */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/30 border border-border/60 p-3">
            <div className="flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">Also send a bill link</p>
                <p className="text-2xs text-muted-foreground">
                  {docShareLink
                    ? 'ON: a link goes with every bill. Your customer can open it on any phone and pay by UPI, and you can see when they viewed it. Long bills stay readable. Links expire after 90 days.'
                    : 'OFF (default): only the picture or PDF is sent. Turn on to include a link your customer can open and pay from — it works for bills of any length.'}
                </p>
              </div>
            </div>
            <Switch
              checked={docShareLink}
              onCheckedChange={(checked) => {
                const prev = docShareLink
                setDocShareLink(checked)
                persistDocSetting({ docShareLink: checked }, () => setDocShareLink(prev))
              }}
            />
          </div>
        </CardContent>
      </Card>
      )}
      {show('invoice-tax') && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          <p className="text-xs text-muted-foreground">Rounding and e-invoicing. Both affect the tax you file.</p>
        </CardHeader>
        <CardContent className="space-y-3">          {/* 🔒 V12: Invoice round-off toggle */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/30 border border-border/60 p-3">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Round off invoice total</p>
                <p className="text-2xs text-muted-foreground">
                  Round the grand total of each sale to the nearest rupee and show a &ldquo;Round Off&rdquo; line on the invoice (e.g. ₹1,062.40 → ₹1,062).
                </p>
              </div>
            </div>
            <Switch
              checked={roundOffEnabled}
              onCheckedChange={(checked) => persistRoundOff(checked)}
            />
          </div>
          {/*
            * e-invoicing applicability.
            *
            * Asked rather than computed. The rule (Notification 10/2023) tests
            * whether turnover crossed ₹5 crore in ANY year since 2017-18, does
            * not lapse if turnover later falls, and aggregates every GSTIN under
            * the PAN — years before this app existed, other registrations, and a
            * liability that outlives the figures that created it. None of that
            * is knowable from the data here.
            *
            * Until it is answered the invoice screen still shows the e-invoice
            * card, with a note saying it may not apply. Hiding it from a shop
            * that turns out to be liable is the worse mistake.
            */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/30 border border-border/60 p-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">My shop needs e-Invoicing</p>
                <p className="text-2xs text-muted-foreground">
                  Turn this on only if your turnover crossed ₹5 crore in any year since 2017-18 —
                  counting every GSTIN on your PAN, and even if it has dropped since. Most small
                  shops do not need it.
                  {eInvoiceApplicable === null && ' You haven’t answered this yet.'}
                </p>
              </div>
            </div>
            <Switch
              checked={eInvoiceApplicable === true}
              onCheckedChange={(checked) => persistEInvoice(checked)}
            />
          </div>
        </CardContent>
      </Card>
      )}


      {/* ═══ Phase 3 — what is ON the bill ═══════════════════════════════
          Terms, signature, bank details and a thank-you. Read from Rahul's
          myBillBook screenshots (docs/INVOICE-ENGINE-PLAN.md Part 1) — these
          are the biggest content gap against them. Every field is optional
          and nothing here changes a figure on the bill. */}
      {show('invoice-content') && (
      <Card className="shadow-card border-border/60">
        <CardContent className="space-y-4 pt-5">
            <div>
              <Label htmlFor="bill-invoiceTerms">Terms & conditions</Label>
              <Input id="bill-invoiceTerms"
                value={billContent.invoiceTerms}
                onChange={(e) => setBillContent({ ...billContent, invoiceTerms: e.target.value })}
                placeholder="Goods once sold will not be taken back." className="mt-1" />
            </div>
            <div>
              <Label htmlFor="bill-invoiceThankYou">Thank-you line</Label>
              <Input id="bill-invoiceThankYou"
                value={billContent.invoiceThankYou}
                onChange={(e) => setBillContent({ ...billContent, invoiceThankYou: e.target.value })}
                placeholder="Thank you for your business!" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="bill-invoiceDueDays">Payment due after (days)</Label>
              <Input id="bill-invoiceDueDays" inputMode="numeric" type="number"
                value={billContent.invoiceDueDays}
                onChange={(e) => setBillContent({ ...billContent, invoiceDueDays: e.target.value })}
                placeholder="e.g. 15" className="mt-1" />
              <p className="text-2xs text-muted-foreground mt-1">
                {/* The bill prints a real date, never "Net 30" — a specific day
                    is understood by everyone and outperforms the jargon. */}
                The bill will say &ldquo;Please pay by&rdquo; and the date. Leave blank for none.
              </p>
            </div>

            <div className="pt-2 border-t border-border/50">
              <p className="text-sm font-medium mb-2">Bank details</p>
              <div className="space-y-3">
            <div>
              <Label htmlFor="bill-bankName">Bank</Label>
              <Input id="bill-bankName"
                value={billContent.bankName}
                onChange={(e) => setBillContent({ ...billContent, bankName: e.target.value })}
                placeholder="State Bank of India" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="bill-bankAccountName">Account name</Label>
              <Input id="bill-bankAccountName"
                value={billContent.bankAccountName}
                onChange={(e) => setBillContent({ ...billContent, bankAccountName: e.target.value })}
                placeholder="Rahul Grocery" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="bill-bankAccountNumber">Account number</Label>
              <Input id="bill-bankAccountNumber"
                value={billContent.bankAccountNumber}
                onChange={(e) => setBillContent({ ...billContent, bankAccountNumber: e.target.value })}
                placeholder="1234567890" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="bill-bankIfsc">IFSC</Label>
              <Input id="bill-bankIfsc"
                value={billContent.bankIfsc}
                onChange={(e) => setBillContent({ ...billContent, bankIfsc: e.target.value })}
                placeholder="SBIN0001234" className="mt-1 font-mono uppercase" />
            </div>
            <div>
              <Label htmlFor="bill-bankBranch">Branch</Label>
              <Input id="bill-bankBranch"
                value={billContent.bankBranch}
                onChange={(e) => setBillContent({ ...billContent, bankBranch: e.target.value })}
                placeholder="M.G. Road" className="mt-1" />
            </div>
              </div>
            </div>

            <div className="pt-2 border-t border-border/50 space-y-3">
              <p className="text-sm font-medium">Signature</p>
              <SignatureField value={signatureUrl} onChange={setSignatureUrl} />
              <div className="flex items-center justify-between rounded-lg bg-muted/30 border border-border/60 p-3">
                <p className="text-sm font-medium">Print a signature line</p>
                <Switch checked={showSignatureBox}
                  onCheckedChange={(v) => { setShowSignatureBox(v); persistBillContent({ showSignatureBox: v }) }} />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/30 border border-border/60 p-3">
                <p className="text-sm font-medium inline-flex items-center gap-1.5">
                  Customer's signature
                  <InfoHint label="Customer's signature"
                    text="Adds a second line for your customer to sign when they receive the goods. Useful if you deliver and need proof it arrived." />
                </p>
                <Switch checked={showReceiverSignature}
                  onCheckedChange={(v) => { setShowReceiverSignature(v); persistBillContent({ showReceiverSignature: v }) }} />
              </div>
            </div>

            <Button className="w-full" disabled={savingBill}
              onClick={() => persistBillContent({
                invoiceTerms: billContent.invoiceTerms || null,
                invoiceThankYou: billContent.invoiceThankYou || null,
                invoiceDueDays: billContent.invoiceDueDays ? Number(billContent.invoiceDueDays) : null,
                bankName: billContent.bankName || null,
                bankAccountName: billContent.bankAccountName || null,
                bankAccountNumber: billContent.bankAccountNumber || null,
                bankIfsc: billContent.bankIfsc || null,
                bankBranch: billContent.bankBranch || null,
              })}>
              {savingBill ? 'Saving…' : 'Save'}
            </Button>
        </CardContent>
      </Card>
      )}

      {/* ═══ Phase 4 — what else appears on the bill ════════════════════
          Rendered FROM the registry rather than hand-written, so a toggle
          cannot exist in the schema and be missing here, or vice versa.

          Only the `data` toggles. The two signature switches are in the same
          registry — the API and the schema guard need them there — but they
          belong on screen beside the signature pad in "On the bill", not in a
          list they have no context in. */}
      {show('invoice-visibility') && (
      <Card className="shadow-card border-border/60">
        <CardContent className="space-y-2 pt-5">
          {VISIBILITY_TOGGLES.filter(t => t.kind === 'data').map(t => (
            <div key={t.key}
              className="flex items-start justify-between gap-3 rounded-lg bg-muted/30 border border-border/60 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t.label}</p>
                {/* Only where the label genuinely is not enough. */}
                {t.help && <p className="text-2xs text-muted-foreground mt-0.5">{t.help}</p>}
              </div>
              <Switch
                checked={visibility[t.key] ?? t.default}
                onCheckedChange={(v) => {
                  // Optimistic, then saved. The preview above reads the same
                  // cache, so the bill redraws as the switch moves — feedback
                  // under 300ms is the whole reason this screen has a preview.
                  setVisibility(prev => ({ ...prev, [t.key]: v }))
                  persistBillContent({ [t.key]: v })
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>
      )}

      {/* ═══ Phase 3 — numbering ════════════════════════════════════════ */}
      {show('invoice-numbering') && (
      <Card className="shadow-card border-border/60">
        <CardContent className="space-y-4 pt-5">
            <div>
              <Label htmlFor="bill-invoicePrefix">Prefix</Label>
              <Input id="bill-invoicePrefix"
                value={billContent.invoicePrefix}
                onChange={(e) => setBillContent({ ...billContent, invoicePrefix: e.target.value })}
                placeholder="RG/26-27/" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="bill-invoiceNextNumber">Next bill number</Label>
              <Input id="bill-invoiceNextNumber" inputMode="numeric" type="number"
                value={billContent.invoiceNextNumber}
                onChange={(e) => setBillContent({ ...billContent, invoiceNextNumber: e.target.value })}
                className="mt-1" />
              <p className="text-2xs text-muted-foreground mt-1">
                Your next bill will be{' '}
                <span className="font-mono font-medium text-foreground">
                  {(billContent.invoicePrefix || '') + (billContent.invoiceNextNumber || '1')}
                </span>
              </p>
            </div>
            <Button className="w-full" disabled={savingBill}
              onClick={() => persistBillContent({
                invoicePrefix: billContent.invoicePrefix || null,
                invoiceNextNumber: Math.max(1, Number(billContent.invoiceNextNumber) || 1),
              })}>
              {savingBill ? 'Saving…' : 'Save'}
            </Button>
        </CardContent>
      </Card>
      )}

      {show('preferences') && (
        <>
      <Card className="shadow-card border-border/60">
        <CardHeader>
          {!echoesHost('Preferences') && (
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-primary" /> Preferences
          </CardTitle>
          )}
          <p className="text-xs text-muted-foreground">How the app behaves day to day</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* 🔒 V22-11 (Batch A, Phase 5g): Default Landing Page setting.
              Lets users choose which view opens on app launch.
              Persisted to localStorage, applied in page.tsx. */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-900/40 p-3">
            <div className="flex items-center gap-2">
              <Home className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <div>
                <p className="text-sm font-medium">Default Landing Page</p>
                <p className="text-2xs text-muted-foreground">
                  Choose which screen opens when you launch the app.
                </p>
              </div>
            </div>
            <Select value={defaultLanding} onValueChange={(v) => persistDefaultLanding(v)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dashboard">Dashboard</SelectItem>
                <SelectItem value="sales">Sales Ledger</SelectItem>
                <SelectItem value="purchases">Purchase Ledger</SelectItem>
                <SelectItem value="inventory">Inventory</SelectItem>
                <SelectItem value="parties">Parties</SelectItem>
                <SelectItem value="reports">Reports</SelectItem>
                <SelectItem value="scanner">AI Scanner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Day-End Summary Time setting */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Day-End Summary Time</p>
                <p className="text-2xs text-muted-foreground">When to show daily summary card on dashboard</p>
              </div>
            </div>
            <Select value={dayEndTime} onValueChange={(v) => { setDayEndTime(v); if (typeof window !== 'undefined') localStorage.setItem('bahikhata:day-end-time', v); sonnerToast.success(`Summary shows at ${v}:00`) }}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 10).map(h => (
                  <SelectItem key={h} value={String(h)}>{h}:00</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Hide Profit Toggle */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3">
            <div className="flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-medium">Hide Profit</p>
                <p className="text-2xs text-muted-foreground">
                  Hide profit figures from dashboard, ledger, and transaction details. Useful when staff or customers are looking at your screen. Profit is still calculated — just hidden from view.
                </p>
              </div>
            </div>
            <Switch
              checked={hideProfit}
              onCheckedChange={(checked) => {
                updateHideProfit(checked)
                sonnerToast.success(`Profit ${checked ? 'hidden' : 'visible'}`)
              }}
            />
          </div>
          {/* 🔒 V11: Stock policy toggle — block or allow overselling */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/30 border border-border/60 p-3">
            <div className="flex items-center gap-2">
              <PackageX className="w-4 h-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">Allow overselling (kirana mode)</p>
                <p className="text-2xs text-muted-foreground">
                  {stockPolicy === 'allow'
                    ? 'ON: You can sell more than you have in stock. A warning shows, but the sale goes through. Useful for shops that sell first and record purchases later.'
                    : 'OFF (default): You cannot sell more than you have in stock. The sale is blocked until you record a purchase. Keeps your stock numbers accurate.'}
                </p>
              </div>
            </div>
            <Switch
              checked={stockPolicy === 'allow'}
              onCheckedChange={(checked) => persistStockPolicy(checked ? 'allow' : 'block')}
            />
          </div>
        </CardContent>
      </Card>
        </>
      )}

      {show('preferences') && (
        <>
          {/* Business Goals — monthly revenue/expense targets */}
          <Card className="shadow-card border-border/60">
            <CardHeader>
              {!echoesHost('Monthly Business Goals') && (
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" /> Monthly Business Goals
              </CardTitle>
              )}
              <p className="text-xs text-muted-foreground">Set targets for this month and track progress on dashboard</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="field-revenue-target">Revenue Target (₹)</Label>
                <div className="flex gap-2 mt-1">
                  <Input id="field-revenue-target"
                    inputMode="decimal" type="number"
                    value={revenueGoal}
                    onChange={(e) => setRevenueGoal(e.target.value)}
                    placeholder={revenueTarget ? String(revenueTarget) : 'e.g. 500000'}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const amt = parseFloat(revenueGoal) || 0
                      setRevenueTarget(amt)
                      sonnerToast.success(amt > 0 ? `Revenue target set: ${formatINR(amt)}` : 'Revenue target removed')
                      setRevenueGoal('')
                    }}
                  >
                    Set
                  </Button>
                </div>
                {revenueTarget ? (
                  <p className="text-2xs text-emerald-600 dark:text-emerald-400 mt-1">
                    Current target: {formatINR(revenueTarget)} — track progress on dashboard
                  </p>
                ) : (
                  <p className="text-2xs text-muted-foreground mt-1">No target set</p>
                )}
              </div>
              <div>
                <Label htmlFor="field-expense-budget">Expense Budget (₹)</Label>
                <div className="flex gap-2 mt-1">
                  <Input id="field-expense-budget"
                    inputMode="decimal" type="number"
                    value={expenseGoal}
                    onChange={(e) => setExpenseGoal(e.target.value)}
                    placeholder={expenseBudget ? String(expenseBudget) : 'e.g. 100000'}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const amt = parseFloat(expenseGoal) || 0
                      setExpenseBudget(amt)
                      sonnerToast.success(amt > 0 ? `Expense budget set: ${formatINR(amt)}` : 'Expense budget removed')
                      setExpenseGoal('')
                    }}
                  >
                    Set
                  </Button>
                </div>
                {expenseBudget ? (
                  <p className="text-2xs text-amber-600 dark:text-amber-400 mt-1">
                    Current budget: {formatINR(expenseBudget)} — track on Income & Expense page
                  </p>
                ) : (
                  <p className="text-2xs text-muted-foreground mt-1">No budget set</p>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {show('notifications') && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          {!echoesHost('Notifications') && (
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" /> Notifications
          </CardTitle>
          )}
          <p className="text-xs text-muted-foreground">Choose which alerts appear in the bell icon</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* 🔒 V22-12 (Batch B, Phase 5d): Notification Preferences — granular
              toggles for each notification type. Controls which notifications
              appear in the NotificationCenter bell icon. */}
          <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-medium">Notification Preferences</p>
                <p className="text-2xs text-muted-foreground">Choose which alerts appear in the bell icon</p>
              </div>
            </div>
            <div className="space-y-2.5">
              {[
                { key: 'lowStock' as const, label: 'Low stock & out-of-stock alerts', desc: 'Notify when products run low' },
                { key: 'receivable' as const, label: 'Receivable (udhaar) alerts', desc: 'Notify when customers owe you money' },
                { key: 'pendingSync' as const, label: 'Pending sync alerts', desc: 'Notify about offline changes waiting to sync' },
                { key: 'announcements' as const, label: 'Announcement banners', desc: 'Show important updates from the team' },
                { key: 'dailyDigest' as const, label: 'Daily digest card', desc: 'Show today\'s summary on dashboard after 9 PM' },
                { key: 'backupReminder' as const, label: 'Auto-backup reminder', desc: 'Remind to backup if last backup is >7 days old' },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between">
                  <div className="flex-1 min-w-0 pr-2">
                    <p className="text-xs font-medium">{item.label}</p>
                    <p className="text-3xs text-muted-foreground">{item.desc}</p>
                  </div>
                  <Switch
                    checked={notifPrefs[item.key]}
                    onCheckedChange={(checked) => updateNotifPref(item.key, checked)}
                  />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      )}




      {/* ── AI SCANNER LANGUAGE (in Profile tab) ─────────────────────── */}
      {show('appearance') && (
        <Card className="shadow-card border-border/60">
          <CardHeader>
            {!echoesHost('AI Bill Scanner Language') && (
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="w-5 h-5 text-primary" /> AI Bill Scanner Language
            </CardTitle>
            )}
            <CardDescription>Choose the language for scanned item names</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                When you scan a bill, the AI extracts item names. Choose which language the item names should be in:
              </p>
              <select
                value={(form as any).scanLang || 'original'}
                onChange={(e) => {
                  setForm({ ...form, scanLang: e.target.value } as any)
                  // Save immediately
                  fetch('/api/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scanLang: e.target.value }),
                  }).then(() => {
                    sonnerToast.success('Scanner language updated')
                  }).catch(() => {
                    sonnerToast.error("Couldn\'t update language")
                  })
                }}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="original">Original (keep bill's language)</option>
                <option value="en">English</option>
                <option value="hi">हिन्दी (Hindi)</option>
                <option value="ta">தமிழ் (Tamil)</option>
                <option value="gu">ગુજરાતી (Gujarati)</option>
                <option value="mr">मराठी (Marathi)</option>
                <option value="bn">বাংলা (Bengali)</option>
                <option value="te">తెలుగు (Telugu)</option>
                <option value="kn">ಕನ್ನಡ (Kannada)</option>
                <option value="ml">മലയാളം (Malayalam)</option>
                <option value="pa">ਪੰਜਾਬੀ (Punjabi)</option>
              </select>
              <p className="text-2xs text-muted-foreground">
                "Original" keeps the item names in whatever language the bill is written in (Hindi bill → Hindi names, English bill → English names).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── AI VOICE ENTRY LANGUAGE (in Profile tab) ────────────────── */}
      {show('appearance') && (
        <Card className="shadow-card border-border/60">
          <CardHeader>
            {!echoesHost('AI Voice Entry Language') && (
            <CardTitle className="flex items-center gap-2">
              <Mic className="w-5 h-5 text-primary" /> AI Voice Entry Language
            </CardTitle>
            )}
            <CardDescription>Choose the language for voice recognition &amp; parsed item names</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                When you record a voice entry, the app listens in the selected language and the AI parses item names in that same language. Pick the language you normally speak in:
              </p>
              <select
                value={(form as any).voiceLang || 'original'}
                onChange={(e) => {
                  setForm({ ...form, voiceLang: e.target.value } as any)
                  // Save immediately
                  fetch('/api/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ voiceLang: e.target.value }),
                  }).then(() => {
                    sonnerToast.success('Voice entry language updated')
                  }).catch(() => {
                    sonnerToast.error("Couldn\'t update language")
                  })
                }}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="original">Original (keep spoken language, no translation)</option>
                <option value="en">English (translate to English)</option>
                <option value="hi">हिन्दी (Hindi)</option>
                <option value="ta">தமிழ் (Tamil)</option>
                <option value="gu">ગુજરાતી (Gujarati)</option>
                <option value="mr">मराठी (Marathi)</option>
                <option value="bn">বাংলা (Bengali)</option>
                <option value="te">తెలుగు (Telugu)</option>
                <option value="kn">ಕನ್ನಡ (Kannada)</option>
                <option value="ml">മലയാളം (Malayalam)</option>
                <option value="pa">ਪੰਜਾਬੀ (Punjabi)</option>
              </select>
              <p className="text-2xs text-muted-foreground">
                "Original" listens in Hindi (default) and keeps the spoken language in the parsed result — e.g. if you speak Marathi, item names stay in Marathi. Pick "English" if you want the AI to translate spoken words into English item names.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STAFF TAB ───────────────────────────────────────────────── */}
      {show('staff') && isOwner && (
        <div className="space-y-4">
          <StaffManagement />
          <CAAccess />
        </div>
      )}

      {/* ── FEATURES TAB ────────────────────────────────────────────── */}
      {show('features') && isOwner && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              {!echoesHost('Features & Preferences') && (
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" /> Features & Preferences
              </CardTitle>
              )}
              <p className="text-xs text-muted-foreground mt-1">Toggle features on/off — only use what you need</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { resetFeatures(); sonnerToast.success('All features reset to defaults') }} className="gap-1">
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </Button>
          </div>
          {/* 🔒 V22-7 (Phase 5): Search bar — filter features by keyword.
              Filters by category title, feature label, and description.
              Shows "no results" message if nothing matches. */}
          <div className="relative mt-3">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              type="text"
              value={featureSearch}
              onChange={(e) => setFeatureSearch(e.target.value)}
              placeholder="Search features... (e.g. 'GST', 'dark mode', 'reminder')"
              className="pl-9 h-9 text-sm"
            />
            {featureSearch && (
              <button
                onClick={() => setFeatureSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {filteredFeatureCategories.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No features match &ldquo;{featureSearch}&rdquo;. Try a different keyword.
            </div>
          ) : (
            filteredFeatureCategories.map((category) => (
            <div key={category.title}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">{category.title}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {category.features.map(({ key, label, description, icon: Icon }) => {
                  /* Analytics is the one row backed by real consent rather than
                     a feature flag — see the note beside `analyticsOn`. */
                  const isAnalytics = key === 'analyticsTracking'
                  const on = isAnalytics ? analyticsOn : features[key]
                  const setOn = (checked: boolean) => {
                    if (isAnalytics) {
                      setAnalyticsConsent(checked)
                      if (checked) initAnalytics()
                      setAnalyticsOn(checked)
                    } else {
                      setFeature(key, checked)
                    }
                    sonnerToast.success(`${label} ${checked ? 'enabled' : 'disabled'}`)
                  }
                  return (
                  <div
                    key={key}
                    className={`rounded-lg border p-3 flex items-start gap-3 transition ${on ? 'border-primary/30 bg-primary/5' : 'border-border'}`}
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{label}</p>
                        {on && <Badge className="text-3xs bg-emerald-100 text-emerald-700 dark:text-emerald-300">ON</Badge>}
                      </div>
                      <p className="text-2xs text-muted-foreground mt-0.5">{description}</p>
                    </div>
                    <Switch checked={on} onCheckedChange={setOn} />
                  </div>
                  )
                })}
              </div>
            </div>
          ))
          )}
        </CardContent>
      </Card>
      )}

      {/* AI Provider Comparison tool — admin only */}
      {show('ai-tools') && (
        <Card className="shadow-card border-primary/30 bg-primary/5">
          <CardHeader>
            {!echoesHost('AI Tools') && (
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="w-4 h-4 text-primary" />
              AI Tools
            </CardTitle>
            )}
            <p className="text-xs text-muted-foreground">
              Compare AI providers and track real-time token usage & costs
            </p>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-2">
            <Button onClick={() => setView('ai-comparison')} className="gap-2 flex-1">
              <Sparkles className="w-4 h-4" />
              Compare Providers
            </Button>
            <Button onClick={() => setView('ai-usage')} variant="outline" className="gap-2 flex-1">
              <Coins className="w-4 h-4" />
              Usage & Cost Dashboard
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 🐛 2026-08-08: These two buttons nearly vanished.
          They lived in an ungated "About EkBook" card that rendered at the
          foot of EVERY settings tab — which is why About showed up inside App
          Settings, one of the things Rahul reported. Removing that card took
          Replay Tour and Replay Theme Picker with it, leaving no way to see
          the intro again. Rebuilt as what it always was: two actions, on the
          About page, without repeating the version the page already shows. */}
      {show('about-card') && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          {!echoesHost('Show me around again') && (
          <CardTitle className="text-base">Show me around again</CardTitle>
          )}
          <p className="text-xs text-muted-foreground">Replay the first-run guides any time.</p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => {
                try {
                  localStorage.removeItem('bahikhata-tour-seen')
                  sonnerToast.success('Tour reset! It will show next time you reload.')
                } catch {}
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Replay Tour
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => {
                try {
                  localStorage.removeItem('bahikhata-theme-picker-done')
                  sonnerToast.success('Theme picker reset! It will show next time you reload.')
                } catch {}
              }}
            >
              <Palette className="w-3.5 h-3.5" /> Replay Theme Picker
            </Button>
          </div>
        </CardContent>
      </Card>
      )}
      {confirmDialogEl}
    </div>
  )
}
