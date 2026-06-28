'use client'

/**
 * RatePromptModal — asks the user to rate the app after they've used it
 * a few times. Non-intrusive: shows at milestones (5, 15, 30 actions).
 *
 * - "Rate now" → opens the app store / review page, marks as rated
 * - "Maybe later" → dismisses, asks again after 7 days
 * - "Don't ask again" → permanently dismisses
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Star, X } from 'lucide-react'
import { useState } from 'react'

export function RatePromptModal({
  open,
  onRated,
  onDismiss,
}: {
  open: boolean
  onRated: () => void
  onDismiss: () => void
}) {
  const [hoverRating, setHoverRating] = useState(0)
  const [selectedRating, setSelectedRating] = useState(0)

  const handleRate = () => {
    if (selectedRating === 0) return
    onRated()
    // In production, this would open the Play Store / App Store review URL
    // For PWA: open a rating URL or just show a thank-you message
    if (typeof window !== 'undefined') {
      // Try to use the Native App Store review API if available (PWA installed)
      // Otherwise, just thank the user
    }
  }

  const handleMaybeLater = () => {
    onDismiss()
  }

  const handleDontAsk = () => {
    onDismiss()
    // Mark as permanently dismissed
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('bahikhata:rate-prompt:v1')
        if (raw) {
          const s = JSON.parse(raw)
          s.hasRated = true // treat "don't ask" same as rated (no more prompts)
          localStorage.setItem('bahikhata:rate-prompt:v1', JSON.stringify(s))
        }
      } catch {
        // silent
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleMaybeLater() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center justify-center mb-2">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
              <Star className="w-8 h-8 text-white fill-white" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">Enjoying BahiKhata Pro?</DialogTitle>
        </DialogHeader>

        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-4">
            You&apos;ve recorded several transactions. We&apos;d love to hear your feedback —
            it helps other shop owners discover the app.
          </p>

          {/* Star rating selector */}
          <div className="flex justify-center gap-1 mb-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setSelectedRating(star)}
                className="p-1 transition-transform hover:scale-110 active:scale-95"
                aria-label={`Rate ${star} stars`}
              >
                <Star
                  className={`w-8 h-8 transition-colors ${
                    (hoverRating || selectedRating) >= star
                      ? 'text-amber-400 fill-amber-400'
                      : 'text-muted-foreground/30'
                  }`}
                />
              </button>
            ))}
          </div>

          {selectedRating > 0 && (
            <p className="text-xs text-muted-foreground mb-3">
              {selectedRating === 5 && '🎉 Awesome! Thank you!'}
              {selectedRating === 4 && '😊 Great! We appreciate it.'}
              {selectedRating === 3 && '👍 Thanks for the feedback!'}
              {selectedRating === 2 && '🙏 Thanks — we\'ll keep improving.'}
              {selectedRating === 1 && '🙏 Sorry to hear that. We\'ll do better.'}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2">
          <Button
            onClick={handleRate}
            disabled={selectedRating === 0}
            className="w-full bg-gradient-saffron gap-2"
          >
            <Star className="w-4 h-4" />
            Rate Now
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMaybeLater}
              className="flex-1 text-muted-foreground"
            >
              Maybe later
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDontAsk}
              className="flex-1 text-muted-foreground"
            >
              Don&apos;t ask again
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
