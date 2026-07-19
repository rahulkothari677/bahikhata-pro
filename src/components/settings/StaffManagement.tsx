'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toast as sonnerToast } from 'sonner'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import {
  UserPlus, Trash2, Users, Shield, ChevronDown, ChevronUp, Lock, Unlock,
  LayoutDashboard, ShoppingCart, Truck, Package, ScanLine, FileBarChart,
  Wallet, Users as UsersIcon, Settings as SettingsIcon,
} from 'lucide-react'
import { formatDate, cn } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'
import { readError } from '@/lib/read-error'
import {
  DEFAULT_STAFF_PERMISSIONS,
  MODULE_LABELS,
  type ModuleKey,
  type StaffPermissions,
} from '@/lib/staff-permissions'

// Icon mapping for each module
const MODULE_ICONS: Record<ModuleKey, any> = {
  dashboard: LayoutDashboard,
  sales: ShoppingCart,
  purchases: Truck,
  inventory: Package,
  scanner: ScanLine,
  reports: FileBarChart,
  incomeExpense: Wallet,
  parties: UsersIcon,
  settings: SettingsIcon,
}

// Order of modules in the permissions matrix
const MODULE_ORDER: ModuleKey[] = [
  'dashboard', 'sales', 'purchases', 'inventory', 'scanner',
  'reports', 'incomeExpense', 'parties', 'settings',
]

export function StaffManagement() {
  const queryClient = useQueryClient()
  const { confirmDialog, dialog: confirmDialogEl } = useConfirmDialog()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [savingPermsId, setSavingPermsId] = useState<string | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const r = await offlineFetch('/api/staff')
      return r.json()
    },
  })

  // V17-Ext Tier 3 Step 4: GET /api/staff now returns BOTH staff AND CA accounts.
  // Filter to show only staff here — CAs are shown in the separate CAAccess card.
  const staff: any[] = (data?.staff || []).filter((s: any) => s.role === 'staff')

  const handleAdd = async () => {
    if (!form.email || !form.password) {
      sonnerToast.error('Email and password required')
      return
    }
    setSaving(true)
    try {
      const r = await offlineFetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        offline: { queueable: false },
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || data.error || 'Unknown error')
      sonnerToast.success('Staff member added!')
      refetch()
      setDialogOpen(false)
      setForm({ name: '', email: '', password: '' })
    } catch (e: any) {
      sonnerToast.error('Failed to add staff', { description: e.message || 'Unknown error' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!await confirmDialog('Remove this staff member? They will no longer be able to log in.', { title: 'Remove Staff Member', confirmLabel: 'Remove', destructive: true })) return
    const r = await offlineFetch(`/api/staff?id=${id}`, { method: 'DELETE', offline: { queueable: false } })
    if (r.ok) {
      sonnerToast.success('Staff member removed')
      refetch()
    }
  }

  const handlePermissionChange = async (staffId: string, module: ModuleKey, enabled: boolean) => {
    // Find the staff member
    const staffMember = staff.find((s) => s.id === staffId)
    if (!staffMember) return

    // Update permissions locally
    const newPerms: StaffPermissions = {
      ...staffMember.permissions,
      [module]: enabled,
    }

    // Optimistically update the cache
    queryClient.setQueryData(['staff'], (old: any) => ({
      ...old,
      staff: old.staff.map((s: any) =>
        s.id === staffId ? { ...s, permissions: newPerms } : s
      ),
    }))

    // Save to server
    setSavingPermsId(staffId)
    try {
      const r = await offlineFetch(`/api/staff?id=${staffId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: newPerms }),
        offline: { queueable: false },
      })
      if (!r.ok) throw new Error(await readError(r))
      sonnerToast.success(`${MODULE_LABELS[module].label} ${enabled ? 'enabled' : 'disabled'}`)
    } catch {
      sonnerToast.error('Failed to update permissions')
      // Revert by refetching
      refetch()
    } finally {
      setSavingPermsId(null)
    }
  }

  return (
    <>
    <Card className="shadow-card border-border/60">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Staff Access</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Add employees with limited access</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)} className="bg-gradient-saffron gap-2">
            <UserPlus className="w-4 h-4" /> Add Staff
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : staff.length === 0 ? (
          <div className="text-center py-8">
            <Shield className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm font-medium">No staff members yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add employees so they can record sales &amp; purchases without seeing your reports or settings
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {staff.map((s) => {
              const isExpanded = expandedId === s.id
              const perms = s.permissions || DEFAULT_STAFF_PERMISSIONS
              const enabledCount = MODULE_ORDER.filter((m) => perms[m]).length

              return (
                <div key={s.id} className="rounded-lg border border-border/50 overflow-hidden">
                  {/* Staff row */}
                  <div className="flex items-center gap-3 p-3 bg-muted/30">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {(s.name || s.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.name || 'No name'}</p>
                      <p className="text-2xs text-muted-foreground truncate">{s.email}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <Badge variant="secondary" className="text-3xs">{enabledCount} modules</Badge>
                      <p className="text-3xs text-muted-foreground mt-1">Added {formatDate(s.createdAt)}</p>
                    </div>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : s.id)}
                      className="p-2 rounded-md hover:bg-muted text-muted-foreground"
                      aria-label="Toggle permissions"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50"
                      onClick={() => handleDelete(s.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {/* Permissions matrix — expandable */}
                  {isExpanded && (
                    <div className="border-t border-border/50 p-3 bg-background">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Module Access
                        </p>
                        {savingPermsId === s.id && (
                          <span className="text-3xs text-muted-foreground">Saving...</span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {MODULE_ORDER.map((module) => {
                          const Icon = MODULE_ICONS[module]
                          const isEnabled = perms[module] === true
                          return (
                            <div
                              key={module}
                              className={cn(
                                'flex items-center justify-between rounded-lg p-2.5 border transition',
                                isEnabled
                                  ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20'
                                  : 'border-border bg-muted/30'
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div className={cn(
                                  'w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0',
                                  isEnabled ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-muted'
                                )}>
                                  <Icon className={cn('w-3.5 h-3.5', isEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')} />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium truncate">{MODULE_LABELS[module].label}</p>
                                  <p className="text-3xs text-muted-foreground truncate">{MODULE_LABELS[module].description}</p>
                                </div>
                              </div>
                              <Switch
                                checked={isEnabled}
                                onCheckedChange={(checked) => handlePermissionChange(s.id, module, checked)}
                                disabled={savingPermsId === s.id}
                              />
                            </div>
                          )
                        })}
                      </div>
                      <p className="text-3xs text-muted-foreground mt-2 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Changes save instantly. Staff will see only enabled modules on next login.
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 border border-blue-100 dark:border-blue-900">
          <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">Default staff access:</p>
          <ul className="text-2xs text-blue-600 dark:text-blue-400 mt-1 space-y-0.5">
            <li>• Sales, Purchases, Inventory, AI Scanner</li>
            <li>• Tap a staff member to customize module access</li>
          </ul>
        </div>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" /> Add Staff Member
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="field-name">Name</Label>
              <Input id="field-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Employee name"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="field-email">Email *</Label>
              <Input id="field-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="staff@example.com"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="field-password">Password *</Label>
              <Input id="field-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 6 characters"
                className="mt-1"
              />
              <p className="text-2xs text-muted-foreground mt-1">
                Share these credentials with your employee. They can log in at the same URL.
                Default access: Sales, Purchases, Inventory, Scanner. You can customize after adding.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving} className="bg-gradient-saffron">
              {saving ? 'Adding...' : 'Add Staff'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
    {confirmDialogEl}
    </>
  )
}
