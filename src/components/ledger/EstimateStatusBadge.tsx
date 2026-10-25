import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { EstimateStatus } from '@/lib/estimate-status'

/** #185: an estimate's status — Open (still to follow up) or Converted (already a sale). */
export function EstimateStatusBadge({ status, className }: { status: EstimateStatus; className?: string }) {
  return status === 'converted' ? (
    <Badge className={cn('text-xs py-0 bg-good-soft text-good', className)}>Converted</Badge>
  ) : (
    <Badge className={cn('text-xs py-0 bg-check-soft text-check', className)}>Open</Badge>
  )
}
