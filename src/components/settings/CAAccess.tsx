'use client'

/**
 * V17-Ext Tier 3 Step 4: CA / Accountant Access card.
 *
 * This component renders a separate card in Settings → Staff tab for managing
 * CA (Chartered Accountant) accounts. CAs have READ-ONLY access to a fixed
 * set of modules (dashboard, sales, purchases, reports, incomeExpense, parties).
 *
 * Unlike staff, CAs:
 *   - Have NO customizable permissions matrix (access is hardcoded)
 *   - Cannot create/edit/delete anything (enforced server-side via assertCanWrite)
 *   - Cannot access inventory, scanner, or settings modules
 *   - Cannot manage staff or other sub-accounts
 *
 * This component shares the ['staff'] query cache with StaffManagement — both
 * call GET /api/staff, which returns both staff + CA accounts. React Query
 * deduplicates the network request; each component filters client-side.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { toast as sonnerToast } from 'sonner'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import {
  UserPlus, Trash2, Calculator, Eye, ShieldCheck, Lock,
} from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'

// Modules CAs can access (for the info box — mirrors canAccessModule's CA_MODULES)
const CA_ACCESSIBLE_MODULES = [
  'Dashboard',
  'Sales Ledger',
  'Purchase Ledger',
  'Reports & GST',
  'Income & Expense',
  'Customers & Suppliers',
]

const CA_BLOCKED_MODULES = [
  'Inventory (stock management)',
  'AI Bill Scanner',
  'Settings',
  'Staff management',
  'Any create/edit/delete action',
]

export function CAAccess() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { confirmDialog, dialog: confirmDialogEl } = useConfirmDialog()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [saving, setSaving] = useState(false)

  // Shares cache with StaffManagement (same queryKey) — one network request
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const r = await offlineFetch('/api/staff')
      return r.json()
    },
  })

  // Filter to CA accounts only (staff are shown in StaffManagement)
  const cas: any[] = (data?.staff || []).filter((s: any) => s.role === 'ca')

  const handleAdd = async () => {
    if (!form.email || !form.password) {
      toast({ title: 'Email and password required', variant: 'destructive' })
      return
    }
    if (form.password.length < 8) {
      toast({ title: 'Password must be at least 8 characters', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const r = await offlineFetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, role: 'ca' }),
        offline: { queueable: false },
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || data.error || data.message || 'Unknown error')
      sonnerToast.success('CA account created! They can now log in with read-only access.')
      // Invalidate the shared ['staff'] cache so both cards refresh
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      setDialogOpen(false)
      setForm({ name: '', email: '', password: '' })
    } catch (e: any) {
      toast({ title: 'Failed to create CA account', description: e.message || 'Unknown error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!await confirmDialog('Remove this CA account? They will no longer be able to log in.', { title: 'Remove CA Account', confirmLabel: 'Remove', destructive: true })) return
    const r = await offlineFetch(`/api/staff?id=${id}`, { method: 'DELETE', offline: { queueable: false } })
    if (r.ok) {
      sonnerToast.success('CA account removed')
      queryClient.invalidateQueries({ queryKey: ['staff'] })
    }
  }

  return (
    <>
      <Card className="shadow-card border-border/60">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center">
                <Calculator className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <CardTitle className="text-base">CA / Accountant Access</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Give your accountant read-only access to view reports &amp; ledgers
                </p>
              </div>
            </div>
            <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-2 bg-violet-600 hover:bg-violet-700">
              <UserPlus className="w-4 h-4" /> Add CA
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-20 w-full rounded-xl" />
          ) : cas.length === 0 ? (
            <div className="text-center py-8">
              <Calculator className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium">No CA accounts yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Add your chartered accountant so they can view your GST reports, ledgers,
                and party statements — without being able to change any data.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {cas.map((ca) => (
                <div
                  key={ca.id}
                  className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border/50"
                >
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {(ca.name || ca.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ca.name || 'No name'}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{ca.email}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge className="text-[10px] bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300 hover:bg-violet-100">
                      <Eye className="w-3 h-3 mr-1" /> Read-only
                    </Badge>
                    <p className="text-[10px] text-muted-foreground">Added {formatDate(ca.createdAt)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50"
                    onClick={() => handleDelete(ca.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Info box: what CAs can and cannot do */}
          <div className="mt-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 p-3 border border-violet-100 dark:border-violet-900/50">
            <p className="text-xs text-violet-700 dark:text-violet-300 font-medium flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> What a CA can do:
            </p>
            <ul className="text-[11px] text-violet-600 dark:text-violet-400 mt-1 space-y-0.5">
              {CA_ACCESSIBLE_MODULES.map((m) => (
                <li key={m}>• {m}</li>
              ))}
            </ul>
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1.5 mt-2.5">
              <Lock className="w-3.5 h-3.5" /> What a CA cannot do:
            </p>
            <ul className="text-[11px] text-rose-500 dark:text-rose-400 mt-1 space-y-0.5">
              {CA_BLOCKED_MODULES.map((m) => (
                <li key={m}>• {m}</li>
              ))}
            </ul>
          </div>
        </CardContent>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-violet-600" /> Add CA / Accountant
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. CA Rajesh Kumar"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="ca@example.com"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Password *</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Min 8 characters"
                  className="mt-1"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Share these credentials with your accountant. They can log in at the same URL
                  with read-only access to view your reports, ledgers, and party statements.
                  They will not be able to create, edit, or delete anything.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={saving} className="bg-violet-600 hover:bg-violet-700">
                {saving ? 'Creating...' : 'Create CA Account'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
      {confirmDialogEl}
    </>
  )
}
