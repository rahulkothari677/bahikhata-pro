import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * 🔒 WHEEL GUARD (2026-07-22, Rahul-reported).
 *
 * A focused `<input type="number">` treats the mouse wheel as a value change.
 * Scrolling the page with the cursor happening to sit over a price/qty/discount
 * field silently rewrites the amount — the user sees the page move, not the
 * number change, and saves a wrong figure. In a ledger app that is a money bug
 * wearing a UX costume, so the fix lives HERE (the shared Input) rather than at
 * the ~30 individual call sites, where the next new field would miss it.
 *
 * Behaviour: if the wheel arrives while the number input has focus, blur it.
 * The value stops changing and the page scrolls normally from the next tick.
 * We deliberately do NOT preventDefault — that would trap the page scroll.
 * Keyboard ArrowUp/ArrowDown are left alone: those are a deliberate act.
 */
function Input({ className, type, onWheel, ...props }: React.ComponentProps<"input">) {
  const handleWheel = React.useCallback(
    (e: React.WheelEvent<HTMLInputElement>) => {
      if (type === 'number' && document.activeElement === e.currentTarget) {
        e.currentTarget.blur()
      }
      onWheel?.(e)
    },
    [type, onWheel],
  )

  return (
    <input
      type={type}
      data-slot="input"
      onWheel={handleWheel}
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
