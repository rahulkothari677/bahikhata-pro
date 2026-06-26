'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
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
import { UserPlus, Trash2, Users, Shield } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'

export function StaffManagement() {
  const { toast } = useToast()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [saving, setSaving] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => {
      const r = await offlineFetch('/api/staff')
      return r.json()
    },
  })

  const staff: any[] = data?.staff || []

  const handleAdd = async () => {
    if (!form.email || !form.password) {
      toast({ title: 'Email and password required', variant: 'destructive' })
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
      toast({ title: 'Failed to add staff', description: e.message || 'Unknown error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this staff member? They will no longer be able to log in.')) return
    const r = await offlineFetch(`/api/staff?id=${id}`, { method: 'DELETE', offline: { queueable: false } })
    if (r.ok) {
      sonnerToast.success('Staff member removed')
      refetch()
    }
  }

  return (
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
              Add employees so they can record sales & purchases without seeing your reports or settings
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {staff.map((s) => (
              <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50 group">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                  {(s.name || s.email).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.name || 'No name'}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{s.email}</p>
                </div>
                <div className="text-right">
                  <Badge variant="secondary" className="text-[10px]">Staff</Badge>
                  <p className="text-[10px] text-muted-foreground mt-1">Added {formatDate(s.createdAt)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50"
                  onClick={() => handleDelete(s.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 border border-blue-100 dark:border-blue-900">
          <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">Staff can:</p>
          <ul className="text-[11px] text-blue-600 dark:text-blue-400 mt-1 space-y-0.5">
            <li>• Add new sales &amp; purchases</li>
            <li>• Scan bills with AI</li>
            <li>• View inventory &amp; parties</li>
          </ul>
          <p className="text-xs text-blue-700 dark:text-blue-300 font-medium mt-2">Staff cannot:</p>
          <ul className="text-[11px] text-blue-600 dark:text-blue-400 mt-1 space-y-0.5">
            <li>• View reports or financial data</li>
            <li>• Change settings or themes</li>
            <li>• Delete transactions or products</li>
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
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Employee name"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Email *</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="staff@example.com"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Password *</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 6 characters"
                className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Share these credentials with your employee. They can log in at the same URL.
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
  )
}
