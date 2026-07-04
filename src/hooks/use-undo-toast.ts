'use client'

import { toast as sonnerToast } from 'sonner'

/**
 * Shows a toast with an "Undo" button for 5 seconds.
 * If user doesn't click Undo, the onConfirm callback runs.
 *
 * Usage:
 *   const { showUndoToast } = useUndoToast()
 *   showUndoToast('Transaction deleted', () => actuallyDelete())
 */
export function useUndoToast() {
  const showUndoToast = (message: string, onConfirm: () => void, duration = 5000) => {
    let confirmed = false

    const toastId = sonnerToast(message, {
      duration,
      action: {
        label: 'Undo',
        onClick: () => {
          confirmed = true
          sonnerToast.success('Action cancelled')
        },
      },
      onDismiss: () => {
        if (!confirmed) {
          onConfirm()
        }
      },
      onAutoClose: () => {
        if (!confirmed) {
          onConfirm()
        }
      },
    })

    return toastId
  }

  return { showUndoToast }
}
