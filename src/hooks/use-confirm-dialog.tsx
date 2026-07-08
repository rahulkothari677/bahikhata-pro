'use client'

/**
 * 🔒 FIX M13: Reusable confirmation dialog hook.
 *
 * Replaces native window.confirm() with a styled Radix AlertDialog.
 * Usage:
 *   const { confirmDialog, dialog } = useConfirmDialog()
 *   // In the handler:
 *   if (!await confirmDialog('Delete this?')) return
 *   // In the JSX:
 *   {dialog}
 */

import { useState, useCallback } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function useConfirmDialog() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('Are you sure?')
  const [message, setMessage] = useState('')
  const [confirmLabel, setConfirmLabel] = useState('Confirm')
  const [destructive, setDestructive] = useState(false)
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null)

  const confirmDialog = useCallback((
    msg: string,
    opts?: { title?: string; confirmLabel?: string; destructive?: boolean }
  ) => {
    setTitle(opts?.title || 'Are you sure?')
    setMessage(msg)
    setConfirmLabel(opts?.confirmLabel || 'Confirm')
    setDestructive(opts?.destructive ?? true)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      setResolver(() => resolve)
    })
  }, [])

  const handleConfirm = () => {
    setOpen(false)
    resolver?.(true)
    setResolver(null)
  }

  const handleCancel = () => {
    setOpen(false)
    resolver?.(false)
    setResolver(null)
  }

  const dialog = (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) handleCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className={destructive ? 'bg-rose-600 hover:bg-rose-700 text-white' : ''}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { confirmDialog, dialog }
}
