'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Keyboard, Search, ShoppingCart, Truck, Package, Wallet, Users, ScanLine, FileBarChart, Settings } from 'lucide-react'

interface ShortcutsHelpProps {
  open: boolean
  onClose: () => void
}

const SHORTCUTS = [
  { key: 'Ctrl + K', desc: 'Global search', icon: Search },
  { key: 'N', desc: 'New Sale', icon: ShoppingCart },
  { key: 'S', desc: 'Sales Ledger', icon: ShoppingCart },
  { key: 'P', desc: 'Purchases Ledger', icon: Truck },
  { key: 'I', desc: 'Inventory', icon: Package },
  { key: 'D', desc: 'Dashboard', icon: FileBarChart },
  { key: 'E', desc: 'Income & Expense', icon: Wallet },
  { key: 'C', desc: 'Customers & Suppliers', icon: Users },
  { key: 'A', desc: 'AI Bill Scanner', icon: ScanLine },
  { key: 'R', desc: 'Reports', icon: FileBarChart },
  { key: 'T', desc: 'Settings', icon: Settings },
  { key: '?', desc: 'Show this help', icon: Keyboard },
]

export function ShortcutsHelp({ open, onClose }: ShortcutsHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="w-5 h-5" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SHORTCUTS.map((s) => {
            const Icon = s.icon
            return (
              <div key={s.key} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm text-muted-foreground flex-1">{s.desc}</span>
                <kbd className="px-2 py-1 text-xs font-mono font-semibold bg-muted border border-border rounded-md">
                  {s.key}
                </kbd>
              </div>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Press <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted border border-border rounded">?</kbd> anytime to see this list.
        </p>
      </DialogContent>
    </Dialog>
  )
}
