'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { toast as sonnerToast } from 'sonner'
import { Store, Save, Database, Trash2, AlertTriangle } from 'lucide-react'

export function Settings() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
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
