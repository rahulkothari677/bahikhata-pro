'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { StaffManagement } from '@/components/settings/StaffManagement'
import { CAAccess } from '@/components/settings/CAAccess'
import { useShops } from '@/hooks/use-shops'
import { exportBackup } from '@/lib/data-backup'
import { useBusinessGoals } from '@/hooks/use-business-goals'
import { Target, Download, Upload, Calendar, Clock, Coins, PackageX } from 'lucide-react'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { toast as sonnerToast } from 'sonner'
import { haptic } from '@/lib/haptic'
import { useAppStore, type FeatureKey } from '@/store/app-store'
import { THEME_OPTIONS } from '@/components/providers/ThemeProvider'
import {
  Store, Save, Database, Trash2, AlertTriangle, Moon, Keyboard,
  Search, MessageCircle, Sparkles, Bell, Repeat, FileSpreadsheet,
  Users, Package, ScanLine, TrendingUp, Smartphone, RotateCcw, Palette, Check, Globe, Shield, EyeOff, Plus, Mic, Lock, Loader2, BarChart3, Home,
} from 'lucide-react'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { useSetting } from '@/hooks/use-setting'
import { cn } from '@/lib/utils'

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
      { key: 'darkMode', label: 'Dark Mode', description: 'Switch between light and dark themes', icon: Moon },
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

// 🔒 V21-014 (Phase 6): singleTab prop — when set, hides the tab bar and
// locks to that tab. Used by the Account page to render each section as a
// dedicated standalone page (no tab navigation visible).
export function Settings({ singleTab }: { singleTab?: 'profile' | 'features' | 'appearance' | 'data' | 'staff' }) {
  const { confirmDialog, dialog: confirmDialogEl } = useConfirmDialog()
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const { features, setFeature, resetFeatures, themeColor, setThemeColor, language, setLanguage, setView } = useAppStore()
  const isOwner = session?.user?.role === 'owner'
  const [form, setForm] = useState({
    shopName: '', ownerName: '', phone: '', email: '',
    gstin: '', state: '', address: '', upiId: '',
  })
  const [saving, setSaving] = useState(false)

  // useSetting hook — provides hideProfit + updateHideProfit (persists instantly)
  const { hideProfit, updateHideProfit } = useSetting()
  const { shops, activeShop, switchShop, createShop } = useShops()
  const { revenueTarget, expenseBudget, setRevenueTarget, setExpenseBudget } = useBusinessGoals()
  const [newShopOpen, setNewShopOpen] = useState(false)
  const [newShopName, setNewShopName] = useState('')
  const [revenueGoal, setRevenueGoal] = useState('')
  const [expenseGoal, setExpenseGoal] = useState('')
  // 🔒 V12: Invoice round-off toggle (nearest rupee on sale totals).
  const [roundOffEnabled, setRoundOffEnabled] = useState(false)
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
      })
      setRoundOffEnabled(data.setting.roundOffEnabled ?? false)
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
    }
  }, [data])

  // 🔒 V12: Persist the round-off toggle instantly (like the hide-profit toggle).
  const persistRoundOff = async (next: boolean) => {
    setRoundOffEnabled(next)
    try {
      await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundOffEnabled: next }),
        offline: { invalidate: ['/api/settings'] },
      })
      sonnerToast.success(`Invoice round-off ${next ? 'on' : 'off'}`)
    } catch {
      sonnerToast.error('Could not save round-off setting')
    }
  }

  // 🔒 V11: Persist the stock policy toggle instantly.
  // 'block' = sales that would push stock negative are REJECTED (default).
  // 'allow' = sales go through with a warning (kirana mode).
  const persistStockPolicy = async (next: 'block' | 'allow') => {
    setStockPolicy(next)
    try {
      await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockPolicy: next }),
        offline: { invalidate: ['/api/settings'] },
      })
      sonnerToast.success(next === 'allow' ? 'Overselling allowed (kirana mode)' : 'Overselling blocked')
    } catch {
      sonnerToast.error('Could not save stock policy setting')
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
      if (!r.ok) throw new Error('Failed')
      setLockedUntil(lockDate.toISOString())
      sonnerToast.success(`Period locked until ${new Date(dateStr).toLocaleDateString('en-IN')}. Transactions dated on or before this date can no longer be edited.`)
      haptic.success()
      queryClient.invalidateQueries({ queryKey: ['setting'] })
    } catch {
      haptic.error()
      sonnerToast.error('Could not set period lock')
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
      if (!r.ok) throw new Error('Failed')
      setLockedUntil(null)
      setLockDateInput('')
      sonnerToast.success('Period unlocked. You can now edit all transactions.')
      haptic.success()
      queryClient.invalidateQueries({ queryKey: ['setting'] })
    } catch {
      haptic.error()
      sonnerToast.error('Could not unlock period')
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
      if (!r.ok) throw new Error('Failed')
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
    } catch {
      haptic.error()
      sonnerToast.error('Could not run health check')
    } finally {
      setRunningHealthCheck(false)
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
      if (!r.ok) throw new Error('Failed')
      sonnerToast.success(isQueuedResponse(r) ? 'Saved offline — will sync when online' : 'Settings saved')
      haptic.success()
      queryClient.invalidateQueries({ queryKey: ['setting'] })
    } catch {
      haptic.error()
      sonnerToast.error('Failed to save settings')
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
      }
    } catch {
      haptic.error()
      sonnerToast.error('Failed to reset data')
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
    } catch {
      sonnerToast.error('Failed to clear pending writes')
    }
  }

  const handleClearOfflineCache = async () => {
    if (!await confirmDialog('Clear offline cache? This will remove all locally cached data. You\'ll need internet to reload it. Your cloud data is NOT affected.', { title: 'Clear Cache', confirmLabel: 'Clear' })) return
    try {
      const { clearAllOfflineData } = await import('@/lib/offline-fetch')
      await clearAllOfflineData()
      sonnerToast.success('Offline cache cleared. Reloading...')
      setTimeout(() => window.location.reload(), 1000)
    } catch {
      sonnerToast.error('Failed to clear cache')
    }
  }

  // 🔒 V21-012 (Phase 4a): Read pending tab from store (set by Account page)
  // so the Settings page opens on the correct tab when navigated from Account.
  const pendingTab = useAppStore((s) => s.pendingSettingsTab)
  const setPendingSettingsTab = useAppStore((s) => s.setPendingSettingsTab)
  // 🔒 V21-014 (Phase 6): If singleTab is set, use it as the initial tab.
  const [settingsTab, setSettingsTab] = useState<'profile' | 'features' | 'appearance' | 'data' | 'staff'>(singleTab || 'profile')

  // 🔒 V22-7 (Phase 5): Feature search query — filters FEATURE_CATEGORIES by
  // keyword (label + description + category title). Empty = show all.
  const [featureSearch, setFeatureSearch] = useState('')

  // 🔒 V22-7 (Phase 5): App Lock toggle state. Persisted to localStorage.
  // The actual PIN/biometric enforcement is a future feature — for now this
  // just stores the preference so the UI is ready.
  const [appLockEnabled, setAppLockEnabled] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setAppLockEnabled(localStorage.getItem('bahikhata:app-lock') === 'true')
    }
  }, [])
  const persistAppLock = (enabled: boolean) => {
    setAppLockEnabled(enabled)
    if (typeof window !== 'undefined') {
      localStorage.setItem('bahikhata:app-lock', enabled ? 'true' : 'false')
    }
    sonnerToast.success(`App lock ${enabled ? 'enabled — will require PIN on next launch' : 'disabled'}`)
  }

  // 🔒 V22-11 (Batch A, Phase 5g): Default Landing Page setting.
  // Lets users choose which view opens on launch. Persisted to localStorage.
  // Applied in page.tsx on first authentication.
  const [defaultLanding, setDefaultLanding] = useState('dashboard')
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDefaultLanding(localStorage.getItem('bahikhata:default-landing') || 'dashboard')
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
      sonnerToast.error('Backup failed', { description: String(err?.message || err).slice(0, 200) })
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
  useEffect(() => {
    if (singleTab) return // Don't override singleTab mode
    const tab = useAppStore.getState().pendingSettingsTab
    if (tab) {
      setSettingsTab(tab)
      setPendingSettingsTab(null)
    }
  }, [setPendingSettingsTab, singleTab])

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
      {!singleTab && (
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
      {settingsTab === 'profile' && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="w-5 h-5 text-amber-600 dark:text-amber-400" /> Shop Profile
          </CardTitle>
          <p className="text-xs text-muted-foreground">This information appears on invoices and reports</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Shop Name *</Label>
              <Input value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} placeholder="e.g. Sharma Kirana Store" />
            </div>
            <div>
              <Label>Owner Name</Label>
              <Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} placeholder="Your name" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit mobile" />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
            </div>
            <div>
              <Label>GSTIN</Label>
              <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="15-digit GST number" className="font-mono uppercase" />
            </div>
            <div>
              <Label>State</Label>
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="e.g. Uttar Pradesh" />
            </div>
            <div className="sm:col-span-2">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Full shop address" />
            </div>
            {/* V17-Ext 5.4: UPI ID for udhaar collection links */}
            <div>
              <Label>UPI ID (for payment collection)</Label>
              <Input value={form.upiId} onChange={(e) => setForm({ ...form, upiId: e.target.value })} placeholder="e.g. shop@paytm, 9876543210@ybl" className="font-mono lowercase" />
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

      {/* Manage Shops — shows all shops, add new, switch between them */}
      {settingsTab === 'profile' && (
        <Card className="shadow-card border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="w-5 h-5 text-primary" /> Manage Shops
            </CardTitle>
            <p className="text-xs text-muted-foreground">Create and switch between multiple shops</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {shops.map(shop => (
                <div key={shop.id} className={`flex items-center gap-3 p-3 rounded-lg border transition ${activeShop?.id === shop.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}>
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Store className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{shop.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {shop.gstin ? `GSTIN: ${shop.gstin}` : 'No GSTIN'} {shop.isDefault ? ' · Default' : ''}
                    </p>
                  </div>
                  {activeShop?.id === shop.id ? (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 text-[10px]">Active</Badge>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => switchShop(shop.id)}>
                      Switch
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Add new shop */}
            {newShopOpen ? (
              <div className="mt-3 p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
                <Label>New Shop Name</Label>
                <Input
                  value={newShopName}
                  onChange={(e) => setNewShopName(e.target.value)}
                  placeholder="e.g. Sharma Kirana Store - Branch 2"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => { setNewShopOpen(false); setNewShopName('') }}>Cancel</Button>
                  <Button
                    size="sm"
                    className="flex-1 bg-gradient-saffron gap-2"
                    onClick={async () => {
                      if (!newShopName.trim()) {
                        sonnerToast.error('Enter a shop name')
                        return
                      }
                      const shop = await createShop({ name: newShopName.trim() })
                      if (shop) {
                        setNewShopOpen(false)
                        setNewShopName('')
                      }
                    }}
                  >
                    <Plus className="w-4 h-4" /> Create Shop
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full gap-2 border-dashed"
                onClick={() => setNewShopOpen(true)}
              >
                <Plus className="w-4 h-4" /> Add New Shop
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Business Goals — monthly revenue/expense targets */}
      {settingsTab === 'profile' && (
        <Card className="shadow-card border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" /> Monthly Business Goals
            </CardTitle>
            <p className="text-xs text-muted-foreground">Set targets for this month and track progress on dashboard</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Revenue Target (₹)</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="number"
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
                    sonnerToast.success(amt > 0 ? `Revenue target set: ${amt}` : 'Revenue target removed')
                    setRevenueGoal('')
                  }}
                >
                  Set
                </Button>
              </div>
              {revenueTarget ? (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                  Current target: {revenueTarget} — track progress on dashboard
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1">No target set</p>
              )}
            </div>
            <div>
              <Label>Expense Budget (₹)</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="number"
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
                    sonnerToast.success(amt > 0 ? `Expense budget set: ${amt}` : 'Expense budget removed')
                    setExpenseGoal('')
                  }}
                >
                  Set
                </Button>
              </div>
              {expenseBudget ? (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  Current budget: {expenseBudget} — track on Income & Expense page
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1">No budget set</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── DATA TAB ────────────────────────────────────────────────── */}
      {settingsTab === 'data' && isOwner && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-violet-600" /> Data Management
          </CardTitle>
          <p className="text-xs text-muted-foreground">Manage your app data</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Offline cache management */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-start gap-3">
              <Database className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-blue-900 text-sm">Offline Data</p>
                <p className="text-xs text-blue-700 mt-1">
                  Clear locally cached data or stuck pending writes. Your cloud data is never affected.
                </p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <Button variant="outline" size="sm" className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-100" onClick={handleClearPendingWrites}>
                    <Trash2 className="w-4 h-4" /> Clear Pending Writes
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-100" onClick={handleClearOfflineCache}>
                    <Database className="w-4 h-4" /> Clear Offline Cache
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* 🔒 V17-Ext §5.1: Period Lock — protect filed GST periods from edits */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-amber-900 text-sm">Period Lock (Financial-Year lock)</p>
                  {lockedUntil ? (
                    <Badge className="bg-amber-600 text-white hover:bg-amber-700">Locked</Badge>
                  ) : (
                    <Badge variant="secondary">Unlocked</Badge>
                  )}
                </div>
                <p className="text-xs text-amber-800 mt-1">
                  Once you file GST for a period, lock it. No one (not even staff) can edit, delete,
                  or create transactions dated on or before the lock date. This protects your filed
                  returns from accidental or fraudulent changes.
                </p>

                {lockedUntil ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-amber-900">
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
                      className="gap-2 border-amber-400 text-amber-800 hover:bg-amber-100"
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
                        <Label className="text-xs text-amber-900">Lock until date (inclusive)</Label>
                        <Input
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
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start gap-3">
              <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-emerald-900 text-sm">Health Check (Reconciliation)</p>
                <p className="text-xs text-emerald-800 mt-1">
                  Verify your books are balanced. Checks that party balances match dashboard totals,
                  per-item GST matches invoice headers, and no orphaned data exists. Run this before
                  filing GST or at month-end to catch any issues.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-2 border-emerald-400 text-emerald-800 hover:bg-emerald-100"
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
                      <div className="flex items-center gap-2 text-sm text-rose-700 font-medium">
                        <AlertTriangle className="w-4 h-4" />
                        Some checks failed — see details below.
                      </div>
                    )}
                    {healthCheck.checks.map((check: any, i: number) => (
                      <div
                        key={i}
                        className={cn(
                          'flex items-start gap-2 rounded-md p-2 text-xs',
                          check.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
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

          {/* 🔒 V17 Audit Phase 1 P1.6: Backup card moved OUT of the Danger Zone.
              Was: safe "Download Backup" action grouped with destructive "Reset All Data"
              inside a rose-bordered danger card. Now: separate blue card above the danger
              zone so the user doesn't confuse a safe action with a destructive one. */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-start gap-3">
              <Download className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-blue-900 text-sm">Backup Your Data</p>
                <p className="text-xs text-blue-700 mt-1">
                  Download all your products, transactions, parties, and settings as a JSON file.
                  Use this to migrate to a new device or keep a safe copy.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 gap-2 border-blue-300 text-blue-700 hover:bg-blue-100"
                  onClick={async () => {
                    try {
                      await exportBackup()
                      sonnerToast.success('Backup downloaded!')
                    } catch {
                      sonnerToast.error('Failed to create backup')
                    }
                  }}
                >
                  <Download className="w-4 h-4" /> Download Backup
                </Button>
              </div>
            </div>
          </div>

          {/* 🔒 V17 Audit Phase 9: Restore from Backup — upload a JSON backup file */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start gap-3">
              <Upload className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-emerald-900 text-sm">Restore from Backup</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                  Upload a previously downloaded backup JSON file to restore your data.
                  This MERGES with existing data — items with the same SKU or name are skipped.
                </p>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    try {
                      const text = await file.text()
                      const backup = JSON.parse(text)
                      const r = await offlineFetch('/api/import/restore', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ backup }),
                        offline: { queueable: false },
                      })
                      const result = await r.json()
                      if (!r.ok) throw new Error(result.error || result.message || 'Restore failed')
                      sonnerToast.success('Restore complete!', {
                        description: `Products: ${result.results.products.imported} imported. Parties: ${result.results.parties.imported}. Transactions: ${result.results.transactions.imported}.`,
                        duration: 10000,
                      })
                    } catch (err: any) {
                      sonnerToast.error('Restore failed', {
                        description: err.message,
                        duration: 10000,
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
                  className="mt-2 gap-2 border-emerald-300 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
                  onClick={() => document.getElementById('restore-backup-upload')?.click()}
                >
                  <Upload className="w-4 h-4" /> Upload Backup File
                </Button>
              </div>
            </div>
          </div>

          {/* Danger zone — destructive actions only (no safe actions mixed in) */}
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-rose-900 text-sm">Danger Zone</p>
                <p className="text-xs text-rose-700 mt-1">
                  This will permanently delete all products, transactions, parties and settings. Useful if you want to start fresh.
                </p>
                <Button variant="destructive" size="sm" className="mt-3 gap-2" onClick={handleResetData}>
                  <Trash2 className="w-4 h-4" /> Reset All Data
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* ── APPEARANCE TAB ──────────────────────────────────────────── */}
      {settingsTab === 'appearance' && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" /> Theme & Appearance
          </CardTitle>
          <p className="text-xs text-muted-foreground">Choose a theme — sidebar, buttons, charts & accents all update together</p>
        </CardHeader>
        <CardContent>
          {/* ─── Group: Theme & Language ─── */}
          <div className="mb-2 px-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Theme &amp; Language</p>
          </div>
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
                <p className="text-[11px] text-muted-foreground">{theme.description}</p>
              </button>
            ))}
          </div>
          {/* 🔒 V19-034: Removed duplicate Dark Mode toggle — keep the one below */}

          {/* Language Toggle — 6 languages */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 p-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Language / ભાષા / भाषा / மொழி / భాష</p>
                <p className="text-[11px] text-muted-foreground">Choose your preferred language</p>
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

          {/* Day-End Summary Time setting */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Day-End Summary Time</p>
                <p className="text-[11px] text-muted-foreground">When to show daily summary card on dashboard</p>
              </div>
            </div>
            <Select value={typeof window !== 'undefined' ? (localStorage.getItem('bahikhata:day-end-time') || '18') : '18'} onValueChange={(v) => { localStorage.setItem('bahikhata:day-end-time', v); sonnerToast.success(`Summary shows at ${v}:00`) }}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 10).map(h => (
                  <SelectItem key={h} value={String(h)}>{h}:00</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 🔒 V22-13 (Batch C, Phase 5b): Grouped section headers for better
              discoverability. The Appearance tab has 11 settings — adding
              visual group dividers makes them scannable. */}

          {/* ─── Group: Display & Privacy ─── */}
          <div className="mt-4 mb-2 px-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Display &amp; Privacy</p>
          </div>

          {/* Dark Mode Toggle (moved from header) */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Dark Mode</p>
                <p className="text-[11px] text-muted-foreground">Switch between light and dark themes</p>
              </div>
            </div>
            <Switch
              checked={features.darkMode}
              onCheckedChange={(checked) => { setFeature('darkMode', checked); sonnerToast.success(`Dark mode ${checked ? 'enabled' : 'disabled'}`) }}
            />
          </div>

          {/* Hide Profit Toggle */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3">
            <div className="flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-medium">Hide Profit</p>
                <p className="text-[11px] text-muted-foreground">
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

          {/* ─── Group: Business Rules ─── */}
          <div className="mt-4 mb-2 px-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Business Rules</p>
          </div>

          {/* 🔒 V12: Invoice round-off toggle */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/30 border border-border/60 p-3">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Round off invoice total</p>
                <p className="text-[11px] text-muted-foreground">
                  Round the grand total of each sale to the nearest rupee and show a &ldquo;Round Off&rdquo; line on the invoice (e.g. ₹1,062.40 → ₹1,062).
                </p>
              </div>
            </div>
            <Switch
              checked={roundOffEnabled}
              onCheckedChange={(checked) => persistRoundOff(checked)}
            />
          </div>

          {/* 🔒 V11: Stock policy toggle — block or allow overselling */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/30 border border-border/60 p-3">
            <div className="flex items-center gap-2">
              <PackageX className="w-4 h-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">Allow overselling (kirana mode)</p>
                <p className="text-[11px] text-muted-foreground">
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

          {/* ─── Group: Security & Backup ─── */}
          <div className="mt-4 mb-2 px-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Security &amp; Backup</p>
          </div>

          {/* 🔒 AUDIT V23 FIX §4: App Lock replaced with "Coming Soon" row.
              The previous toggle was a placebo — it toasted "will require PIN"
              but no enforcement existed. A false security promise is worse than
              no feature. Replaced with a disabled row that honestly says Coming Soon. */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 border border-border/60 p-3 opacity-70">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">App Lock</p>
                <p className="text-[11px] text-muted-foreground">
                  Require PIN or biometric to open the app.
                </p>
              </div>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wide bg-muted text-muted-foreground px-2 py-1 rounded-full">
              Coming Soon
            </span>
          </div>

          {/* 🔒 V22-11 (Batch A, Phase 5g): Default Landing Page setting.
              Lets users choose which view opens on app launch.
              Persisted to localStorage, applied in page.tsx. */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-900/40 p-3">
            <div className="flex items-center gap-2">
              <Home className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <div>
                <p className="text-sm font-medium">Default Landing Page</p>
                <p className="text-[11px] text-muted-foreground">
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

          {/* ─── Group: Notifications ─── */}
          <div className="mt-4 mb-2 px-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Notifications</p>
          </div>

          {/* 🔒 V22-12 (Batch B, Phase 5d): Notification Preferences — granular
              toggles for each notification type. Controls which notifications
              appear in the NotificationCenter bell icon. */}
          <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-medium">Notification Preferences</p>
                <p className="text-[11px] text-muted-foreground">Choose which alerts appear in the bell icon</p>
              </div>
            </div>
            <div className="space-y-2.5">
              {[
                { key: 'lowStock' as const, label: 'Low stock & out-of-stock alerts', desc: 'Notify when products run low' },
                { key: 'receivable' as const, label: 'Receivable (udhaar) alerts', desc: 'Notify when customers owe you money' },
                { key: 'pendingSync' as const, label: 'Pending sync alerts', desc: 'Notify about offline changes waiting to sync' },
                { key: 'announcements' as const, label: 'Announcement banners', desc: 'Show important updates from the team' },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between">
                  <div className="flex-1 min-w-0 pr-2">
                    <p className="text-xs font-medium">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                  </div>
                  <Switch
                    checked={notifPrefs[item.key]}
                    onCheckedChange={(checked) => updateNotifPref(item.key, checked)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 🔒 V22-7 (Phase 5): Auto-Backup — one-tap full data backup.
              Shows last backup timestamp + a "Backup Now" button that
              triggers exportBackup() (downloads a JSON file). */}
          <div className="mt-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <div className="flex-1">
                <p className="text-sm font-medium">Backup & Restore</p>
                <p className="text-[11px] text-muted-foreground">
                  Download a full backup of your shop data (products, transactions, parties, settings). Keep it safe — you can restore it anytime.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 mt-2">
              <p className="text-[11px] text-muted-foreground">
                {lastBackup
                  ? `Last backup: ${new Date(lastBackup).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at ${new Date(lastBackup).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                  : 'No backup yet — tap "Backup Now" to download'}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBackupNow}
                disabled={backingUp}
                className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950"
              >
                {backingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {backingUp ? 'Backing up...' : 'Backup Now'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* ── AI SCANNER LANGUAGE (in Profile tab) ─────────────────────── */}
      {settingsTab === 'profile' && (
        <Card className="shadow-card border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="w-5 h-5 text-primary" /> AI Bill Scanner Language
            </CardTitle>
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
                    sonnerToast.error('Failed to update language')
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
              <p className="text-[11px] text-muted-foreground">
                "Original" keeps the item names in whatever language the bill is written in (Hindi bill → Hindi names, English bill → English names).
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── AI VOICE ENTRY LANGUAGE (in Profile tab) ────────────────── */}
      {settingsTab === 'profile' && (
        <Card className="shadow-card border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className="w-5 h-5 text-primary" /> AI Voice Entry Language
            </CardTitle>
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
                    sonnerToast.error('Failed to update language')
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
              <p className="text-[11px] text-muted-foreground">
                "Original" listens in Hindi (default) and keeps the spoken language in the parsed result — e.g. if you speak Marathi, item names stay in Marathi. Pick "English" if you want the AI to translate spoken words into English item names.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STAFF TAB ───────────────────────────────────────────────── */}
      {settingsTab === 'staff' && isOwner && (
        <div className="space-y-4">
          <StaffManagement />
          <CAAccess />
        </div>
      )}

      {/* ── FEATURES TAB ────────────────────────────────────────────── */}
      {settingsTab === 'features' && isOwner && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" /> Features & Preferences
              </CardTitle>
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
                {category.features.map(({ key, label, description, icon: Icon }) => (
                  <div
                    key={key}
                    className={`rounded-lg border p-3 flex items-start gap-3 transition ${features[key] ? 'border-primary/30 bg-primary/5' : 'border-border'}`}
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${features[key] ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{label}</p>
                        {features[key] && <Badge className="text-[9px] bg-emerald-100 text-emerald-700 dark:text-emerald-300">ON</Badge>}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
                    </div>
                    <Switch
                      checked={features[key]}
                      onCheckedChange={(checked) => {
                        setFeature(key, checked)
                        sonnerToast.success(`${label} ${checked ? 'enabled' : 'disabled'}`)
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))
          )}
        </CardContent>
      </Card>
      )}

      {/* AI Provider Comparison tool — admin only */}
      {settingsTab === 'features' && (
        <Card className="shadow-card border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="w-4 h-4 text-primary" />
              AI Tools
            </CardTitle>
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

      {/* About card — always visible at bottom */}
      <Card className="shadow-card border-border/60">
        <CardHeader>
          <CardTitle className="text-base">About EkBook</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            India&apos;s smartest ledger app for small shop owners. Track sales, purchases, inventory, GST, and profit — all in one place. Built with love for Bharat.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="font-medium">Version</p>
              <p className="text-muted-foreground">1.0.0</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="font-medium">Built for</p>
              <p className="text-muted-foreground">Indian Shop Owners</p>
            </div>
          </div>

          {/* Quick actions */}
          <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-2">
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
      {confirmDialogEl}
    </div>
  )
}
