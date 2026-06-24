'use client'

import { LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function ViewModeToggle({ mode, onChange }: { mode: 'grid' | 'list'; onChange: (m: 'grid' | 'list') => void }) {
  return (
    <div className="flex items-center bg-muted rounded-lg p-0.5">
      <Button
        variant="ghost"
        size="sm"
        className={cn('h-7 px-2 gap-1.5', mode === 'grid' && 'bg-background shadow-sm')}
        onClick={() => onChange('grid')}
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        <span className="hidden sm:inline text-xs">Grid</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={cn('h-7 px-2 gap-1.5', mode === 'list' && 'bg-background shadow-sm')}
        onClick={() => onChange('list')}
      >
        <List className="w-3.5 h-3.5" />
        <span className="hidden sm:inline text-xs">List</span>
      </Button>
    </div>
  )
}
