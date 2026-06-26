'use client'

/**
 * SessionTimeoutWarning — shows a warning modal 5 minutes before JWT expires.
 *
 * NextAuth JWT maxAge = 30 days. We don't want to bug users every 30 days,
 * so instead we use a much shorter "idle timeout" of 8 hours by default.
 *
 * After 8 hours of inactivity (no mouse/keyboard), show a warning with
 * "Stay logged in" (refresh session) and "Logout" buttons. If user does
 * nothing for 5 more minutes, auto-logout.
 *
 * This is a soft UX feature — actual JWT expiry is handled by NextAuth.
 */

import { useEffect, useState, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Clock, LogOut } from 'lucide-react'

const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000   // 8 hours
const WARNING_DURATION_MS = 5 * 60 * 1000    // 5 min warning window

export function SessionTimeoutWarning() {
  const { data: session, status } = useSession()
  const [showWarning, setShowWarning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(WARNING_DURATION_MS / 1000)
  const lastActivityRef = useRef<number>(Date.now())
  const countdownRef = useRef<NodeJS.Timeout | null>(null)

  // Track user activity (mouse, keyboard, touch, scroll)
  useEffect(() => {
    if (status !== 'authenticated') return

    const updateActivity = () => {
      lastActivityRef.current = Date.now()
      // If warning was showing, hide it (user came back)
      if (showWarning) {
        setShowWarning(false)
        if (countdownRef.current) clearInterval(countdownRef.current)
      }
    }

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach((e) => window.addEventListener(e, updateActivity, { passive: true }))

    // Check every 30 seconds if user has been idle
    const checkInterval = setInterval(() => {
      const idleTime = Date.now() - lastActivityRef.current
      if (idleTime >= IDLE_TIMEOUT_MS && !showWarning) {
        setShowWarning(true)
        setSecondsLeft(WARNING_DURATION_MS / 1000)

        // Start countdown
        countdownRef.current = setInterval(() => {
          setSecondsLeft((s) => {
            if (s <= 1) {
              // Time's up — logout
              signOut({ callbackUrl: '/' })
              return 0
            }
            return s - 1
          })
        }, 1000)
      }
    }, 30_000)

    return () => {
      events.forEach((e) => window.removeEventListener(e, updateActivity))
      clearInterval(checkInterval)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [status, showWarning])

  if (status !== 'authenticated') return null

  const handleStayLoggedIn = () => {
    lastActivityRef.current = Date.now()
    setShowWarning(false)
    if (countdownRef.current) clearInterval(countdownRef.current)
    // Reload to refresh the JWT
    window.location.reload()
  }

  const handleLogout = () => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    signOut({ callbackUrl: '/' })
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <Dialog open={showWarning} onOpenChange={(o) => !o && handleStayLoggedIn()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <DialogTitle className="text-lg">Are you still there?</DialogTitle>
              <DialogDescription>You've been inactive for a while.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-2">
          <p className="text-sm text-muted-foreground mb-3">
            For your security, you'll be automatically logged out in:
          </p>
          <div className="text-center text-4xl font-bold text-amber-600 mb-3">
            {formatTime(secondsLeft)}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Any unsaved changes will be lost. Click below to stay logged in.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleLogout} className="gap-2">
            <LogOut className="w-4 h-4" /> Logout
          </Button>
          <Button onClick={handleStayLoggedIn} className="bg-gradient-saffron gap-2">
            Stay logged in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
