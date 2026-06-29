import { cn } from "@/lib/utils"

/**
 * Skeleton — placeholder block shown during loading.
 *
 * Uses the .shimmer class (defined in globals.css) for a premium
 * wave-gradient animation instead of basic animate-pulse. The shimmer
 * gives a sense of "content is loading" rather than just "block is empty".
 *
 * In dark mode, the shimmer automatically uses darker gray tones via the
 * .dark .shimmer CSS override.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("shimmer rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
