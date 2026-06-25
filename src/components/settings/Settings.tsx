'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { StaffManagement } from '@/components/settings/StaffManagement'
import { useToast } from '@/hooks/use-toast'
import { toast as sonnerToast } from 'sonner'
import { useAppStore, type FeatureKey } from '@/store/app-store'
import { THEME_OPTIONS } from '@/components/providers/ThemeProvider'
import {
  Store, Save, Database, Trash2, AlertTriangle, Moon, Keyboard,
  Search, MessageCircle, Sparkles, Bell, Repeat, FileSpreadsheet,
  Users, Package, ScanLine, TrendingUp, Smartphone, RotateCcw, Palette, Check, Globe,
} from 'lucide-react'

const FEATURE_CONFIG: { key: FeatureKey; label: string; description: string; icon: any }[] = [
  { key: 'darkMode', label: 'Dark Mode', description: 'Switch between light and dark themes', icon: Moon },
  { key: 'keyboardShortcuts', label: 'Keyboard Shortcuts', description: 'Press N/S/I/D/R/A for quick navigation', icon: Keyboard },
  { key: 'globalSearch', label: 'Global Search (Ctrl+K)', description: 'Search products, parties & transactions anywhere', icon: Search },
  { key: 'whatsappSharing', label: 'WhatsApp Invoice Sharing', description: 'Send invoices to customers via WhatsApp', icon: MessageCircle },
  { key: 'smartInsights', label: 'Smart Insights & Alerts', description: 'AI-powered alerts for stock, dues & profit', icon: Sparkles },
  { key: 'paymentReminders', label: 'Payment Reminders', description: 'Track outstanding dues and send reminders', icon: Bell },
  { key: 'recurringEntries', label: 'Recurring Entries', description: 'Auto-create rent, salary entries monthly', icon: Repeat },
  { key: 'gstrExport', label: 'GSTR-1 Export', description: 'Export GST returns in portal format', icon: FileSpreadsheet },
  { key: 'customerLoyalty', label: 'Customer Loyalty Tracking', description: 'Track repeat customers & lifetime value', icon: Users },
  { key: 'reorderAlerts', label: 'Reorder Automation', description: 'Auto-suggest purchases when stock is low', icon: Package },
  { key: 'aiScanner', label: 'AI Bill Scanner', description: 'Snap bill photos and auto-extract data', icon: ScanLine },
  { key: 'lowStockAlerts', label: 'Low Stock Alerts', description: 'Get notified when products run low', icon: AlertTriangle },
  { key: 'profitTracking', label: 'Profit Tracking', description: 'Auto-calculate profit on every sale', icon: TrendingUp },
  { key: 'pwaInstall', label: 'PWA Install', description: 'Install as app on phone/desktop', icon: Smartphone },
]

export function Settings() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const { features, setFeature, resetFeatures, themeColor, setThemeColor, language, setLanguage } = useAppStore()
  const isOwner = session?.user?.role !== 'staff'
  const [form, setForm] = useState({
    shopName: '', ownerName: '', phone: '', email: '',
    gstin: '', state: '', address: '',
  })
  const [saving, setSaving] = useState(false)

  const { data } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await fetch('/api/settings')
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
    }
  }, [data])

  const handleSave = async () => {
    if (!form.shopName.trim()) {
      toast({ title: 'Shop name is required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!r.ok) throw new Error('Failed')
      sonnerToast.success('Settings saved')
      queryClient.invalidateQueries({ queryKey: ['setting'] })
    } catch {
      toast({ title: 'Failed to save settings', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleResetData = async () => {
    if (!confirm('⚠️ This will DELETE ALL your data (products, transactions, parties). This cannot be undone. Are you absolutely sure?')) return
    if (!confirm('Last confirmation: All data will be permanently deleted. Continue?')) return
    try {
      // Delete via prisma - we'll do this via a special endpoint
      const r = await fetch('/api/seed', { method: 'DELETE' })
      if (r.ok) {
        sonnerToast.success('All data deleted. Refreshing...')
        setTimeout(() => window.location.reload(), 1500)
      }
    } catch {
      toast({ title: 'Failed to reset data', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
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

      {isOwner && (
      <Card className="shadow-card border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-violet-600" /> Data Management
          </CardTitle>
          <p className="text-xs text-muted-foreground">Manage your app data</p>
        </CardHeader>
        <CardContent>
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

      {/* Theme Color Picker */}
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

          {/* Language Toggle */}
          <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Language / भाषा</p>
                <p className="text-[11px] text-muted-foreground">Choose your preferred language</p>
              </div>
            </div>
            <div className="flex gap-1 bg-background rounded-lg p-0.5">
              <button
                onClick={() => { setLanguage('en'); sonnerToast.success('Language: English') }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${language === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              >
                English
              </button>
              <button
                onClick={() => { setLanguage('hi'); sonnerToast.success('भाषा: हिंदी') }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${language === 'hi' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              >
                हिंदी
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Staff Management - Owner only */}
      {isOwner && <StaffManagement />}

      {/* Feature Toggles - Owner only */}
      {isOwner && (
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
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FEATURE_CONFIG.map(({ key, label, description, icon: Icon }) => (
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
        </CardContent>
      </Card>
      )}

      <Card className="shadow-card border-border/60">
        <CardHeader>
          <CardTitle className="text-base">About BahiKhata Pro</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            India&apos;s smartest ledger app for small shop owners. Track sales, purchases, inventory, GST, and profit — all in one place. Built with ❤️ for Bharat.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="font-medium">Version</p>
              <p className="text-muted-foreground">1.0.0</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="font-medium">Built for</p>
              <p className="text-muted-foreground">🇮🇳 Indian Shop Owners</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
