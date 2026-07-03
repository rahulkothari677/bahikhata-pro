'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { StaffManagement } from '@/components/settings/StaffManagement'
import { useShops } from '@/hooks/use-shops'
import { exportBackup } from '@/lib/data-backup'
import { useBusinessGoals } from '@/hooks/use-business-goals'
import { Target, Download, Upload, Calendar, Clock, Coins } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { toast as sonnerToast } from 'sonner'
import { haptic } from '@/lib/haptic'
import { useAppStore, type FeatureKey } from '@/store/app-store'
import { THEME_OPTIONS } from '@/components/providers/ThemeProvider'
import {
  Store, Save, Database, Trash2, AlertTriangle, Moon, Keyboard,
  Search, MessageCircle, Sparkles, Bell, Repeat, FileSpreadsheet,
  Users, Package, ScanLine, TrendingUp, Smartphone, RotateCcw, Palette, Check, Globe, Shield, EyeOff, Plus,
} from 'lucide-react'
import { offlineFetch, isQueuedResponse } from '@/lib/offline-fetch'
import { useSetting } from '@/hooks/use-setting'

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

export function Settings() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const { features, setFeature, resetFeatures, themeColor, setThemeColor, language, setLanguage, setView } = useAppStore()
  const isOwner = session?.user?.role !== 'staff'
  const [form, setForm] = useState({
    shopName: '', ownerName: '', phone: '', email: '',
    gstin: '', state: '', address: '',
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
      })
      // hideProfit is now managed by useSetting() hook — no need to sync here
    }
  }, [data])

  const handleSave = async () => {
    if (!form.shopName.trim()) {
      toast({ title: 'Shop name is required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const r = await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, hideProfit }),
        offline: { invalidate: ['/api/settings', '/api/dashboard'] },
      })
      if (!r.ok) throw new Error('Failed')
      sonnerToast.success(isQueuedResponse(r) ? 'Saved offline — will sync when online' : 'Settings saved')
      haptic.success()
      queryClient.invalidateQueries({ queryKey: ['setting'] })
    } catch {
      haptic.error()
      toast({ title: 'Failed to save settings', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleResetData = async () => {
    if (!confirm('This will DELETE ALL your data (products, transactions, parties). This cannot be undone. Are you absolutely sure?')) return
    if (!confirm('Last confirmation: All data will be permanently deleted. Continue?')) return
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
      toast({ title: 'Failed to reset data', variant: 'destructive' })
    }
  }

  const handleClearPendingWrites = async () => {
    if (!confirm('Clear all pending offline writes? These are changes made while offline that haven\'t synced yet. This cannot be undone.')) return
    try {
      const { getPendingWrites, deletePendingWrite } = await import('@/lib/offline-fetch')
      const writes = await getPendingWrites()
      for (const w of writes) {
        if (w.id) await deletePendingWrite(w.id)
      }
      sonnerToast.success(`Cleared ${writes.length} pending write(s)`)
      window.location.reload()
    } catch {
      toast({ title: 'Failed to clear pending writes', variant: 'destructive' })
    }
  }

  const handleClearOfflineCache = async () => {
    if (!confirm('Clear offline cache? This will remove all locally cached data. You\'ll need internet to reload it. Your cloud data is NOT affected.')) return
    try {
      const { clearAllOfflineData } = await import('@/lib/offline-fetch')
      await clearAllOfflineData()
      sonnerToast.success('Offline cache cleared. Reloading...')
      setTimeout(() => window.location.reload(), 1000)
    } catch {
      toast({ title: 'Failed to clear cache', variant: 'destructive' })
    }
  }

  const [settingsTab, setSettingsTab] = useState<'profile' | 'features' | 'appearance' | 'data' | 'staff'>('profile')

  const tabs = [
    { id: 'profile', label: 'Profile', icon: Store },
    { id: 'features', label: 'Features', icon: Check },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'data', label: 'Data', icon: Database },
    ...(isOwner ? [{ id: 'staff', label: 'Staff', icon: Users }] : []),
  ] as const

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Tab bar */}
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

      {/* ── PROFILE TAB ─────────────────────────────────────────────── */}
      {settingsTab === 'profile' && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="w-5 h-5 text-amber-600" /> Shop Profile
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
                <p className="text-[11px] text-emerald-600 mt-1">
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
                <p className="text-[11px] text-amber-600 mt-1">
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

          {/* Danger zone */}
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-rose-900 text-sm">Danger Zone</p>
                <p className="text-xs text-rose-700 mt-1">
                  This will permanently delete all products, transactions, parties and settings. Useful if you want to start fresh.
                </p>
              {/* Data Backup — export all data to JSON */}
              <div className="flex items-start gap-3 mb-4">
                <Download className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-sm">Backup Your Data</p>
                  <p className="text-xs text-muted-foreground mt-1">
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
          <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Dark Mode</p>
                <p className="text-[11px] text-muted-foreground">Switch to dark background</p>
              </div>
            </div>
            <Switch
              checked={features.darkMode}
              onCheckedChange={(checked) => {
                setFeature('darkMode', checked)
                sonnerToast.success(`Dark mode ${checked ? 'enabled' : 'disabled'}`)
              }}
            />
          </div>

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
              <EyeOff className="w-4 h-4 text-amber-600" />
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
                    body: JSON.stringify({ ...form, scanLang: e.target.value }),
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

      {/* ── STAFF TAB ───────────────────────────────────────────────── */}
      {settingsTab === 'staff' && isOwner && <StaffManagement />}

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
        </CardHeader>
        <CardContent className="space-y-4">
          {FEATURE_CATEGORIES.map((category) => (
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
                        {features[key] && <Badge className="text-[9px] bg-emerald-100 text-emerald-700">ON</Badge>}
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
          ))}
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
    </div>
  )
}
