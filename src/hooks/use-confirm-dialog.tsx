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
 *
 * Phase 4c (#234): `requireText` adds a box the person must type a word into
 * before the confirm button works. The account deletion's last step said
 * "Type DELETE to confirm" for months while showing no box to type in; the
 * words on the one action that cannot be undone must be true.
 */

import { useState, useCallback } from 'react'
import { Input } from '@/components/ui/input'
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
  const [requireText, setRequireText] = useState<string | null>(null)
  const [typed, setTyped] = useState('')

  const confirmDialog = useCallback((
    msg: string,
    opts?: { title?: string; confirmLabel?: string; destructive?: boolean; requireText?: string }
  ) => {
    setTitle(opts?.title || 'Are you sure?')
    setMessage(msg)
    setConfirmLabel(opts?.confirmLabel || 'Confirm')
    setDestructive(opts?.destructive ?? true)
    setRequireText(opts?.requireText ?? null)
    setTyped('')
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      setResolver(() => resolve)
    })
  }, [])

  const textOk = !requireText || typed.trim() === requireText

  const handleConfirm = () => {
    if (!textOk) return
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
        {requireText && (
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={requireText}
            aria-label={`Type ${requireText} to confirm`}
            autoCapitalize="characters"
            autoComplete="off"
            className="h-12 text-base font-mono"
          />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!textOk}
            className={destructive ? 'bg-bad hover:bg-bad/90 text-white' : ''}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { confirmDialog, dialog }
}
