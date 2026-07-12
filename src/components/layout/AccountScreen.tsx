'use client'

/**
 * AccountScreen — full-screen profile/account page.
 *
 * 🔒 V21-010 (Phase 2b): Profile header added.
 *
 * Design inspiration:
 * - CRED: Member-since ring around avatar, premium dark gradient
 * - PhonePe: Clean layout, name + phone + manage link
 * - Flipkart: Plan/membership badge (Free/Pro/Elite)
 *
 * The header is a gradient banner with:
 * - Large avatar (with initials, ring for premium plans)
 * - User name + shop name
 * - Phone number (if set)
 * - Plan badge (Free/Pro/Elite)
 * - Edit profile button
 * - Decorative circles for depth
 *
 * Subsequent phases will add the 10 menu sections below this header.
 */

import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { useAppStore } from '@/store/app-store'
import { useSubscription } from '@/hooks/use-subscription'
import { useStaffPermissions } from '@/hooks/use-staff-permissions'
import { offlineFetch } from '@/lib/offline-fetch'
import { haptic } from '@/lib/haptic'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getInitials, cn } from '@/lib/utils'
import {
  ArrowLeft, Pencil, Calculator, Crown, Phone, Mail, Store,
} from 'lucide-react'
import type { ViewType } from '@/store/app-store'

export function AccountScreen() {
  const { setView, previousView, setPreviousView } = useAppStore()
  const { data: session } = useSession()
  const { plan } = useSubscription()
  const { isCA } = useStaffPermissions()

  // Fetch settings for profile data
  const { data: settingData } = useQuery({
    queryKey: ['setting'],
    queryFn: async () => {
      const r = await offlineFetch('/api/settings')
      return r.json()
    },
  })

  const setting = settingData?.setting || {}
  const userName = setting.ownerName || session?.user?.name || 'Shop Owner'
  const shopName = setting.shopName || 'My Shop'
  const email = session?.user?.email || ''
  const phone = setting.phone

  const handleBack = () => {
    haptic.click()
    setView(previousView || 'dashboard')
    setPreviousView(null)
  }

  const handleEditProfile = () => {
    haptic.click()
    setPreviousView('account')
    setView('settings')
  }

  // Plan badge styling
  const planBadges = {
    free: { label: 'Free', className: 'bg-white/20 text-white', icon: null as null | typeof Crown },
    pro: { label: 'Pro', className: 'bg-amber-400 text-amber-900', icon: Crown },
    elite: { label: 'Elite', className: 'bg-violet-400 text-violet-900', icon: Crown },
  }
  const planBadge = planBadges[plan] || planBadges.free

  const PlanIcon = planBadge.icon

  return (
    <div className="min-h-screen bg-muted/30 w-full flex-1">
      {/* Top bar with back button */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={handleBack}
            className="p-2 -ml-2 rounded-lg hover:bg-muted"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-bold">Account</h2>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4 pb-24"
           style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>

        {/* ═══ Profile Header — premium gradient banner ═══ */}
        <button
          onClick={isCA ? undefined : handleEditProfile}
          disabled={isCA}
          className={cn(
            "w-full rounded-2xl shadow-card relative overflow-hidden text-white transition",
            isCA ? "cursor-default" : "active:scale-[0.98]"
          )}
        >
          <div className={cn(
            "p-6 relative",
            isCA ? "bg-gradient-to-br from-violet-600 to-purple-700" : "bg-gradient-saffron"
          )}>
            {/* Decorative circles for depth */}
            <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -mr-20 -mt-20 pointer-events-none" />
            <div className="absolute bottom-0 right-20 w-28 h-28 bg-white/5 rounded-full -mb-14 pointer-events-none" />
            <div className="absolute top-1/2 left-0 w-20 h-20 bg-white/5 rounded-full -ml-10 pointer-events-none" />

            <div className="relative flex items-center gap-4">
              {/* Avatar with ring for premium plans */}
              <div className="relative flex-shrink-0">
                <Avatar className={cn(
                  "w-20 h-20 border-4 border-white/30",
                  plan !== 'free' && "ring-2 ring-white/50 ring-offset-2 ring-offset-transparent"
                )}>
                  <AvatarFallback className="bg-white/20 backdrop-blur-sm text-white text-2xl font-bold">
                    {getInitials(userName)}
                  </AvatarFallback>
                </Avatar>
                {/* Plan badge on avatar */}
                <div className={cn(
                  "absolute -bottom-1 -right-1 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 shadow-lg",
                  planBadge.className
                )}>
                  {PlanIcon && <PlanIcon className="w-2.5 h-2.5" />}
                  {planBadge.label}
                </div>
              </div>

              {/* Name + shop + contact */}
              <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-xl font-heading tracking-tight truncate">
                    {userName}
                  </p>
                  {isCA && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-white/25 text-white whitespace-nowrap flex items-center gap-1">
                      <Calculator className="w-2.5 h-2.5" /> CA
                    </span>
                  )}
                </div>
                <p className="text-sm text-white/85 truncate flex items-center gap-1.5 mt-0.5">
                  <Store className="w-3.5 h-3.5" />
                  {shopName}
                </p>
                {phone && (
                  <p className="text-xs text-white/75 truncate flex items-center gap-1.5 mt-0.5">
                    <Phone className="w-3 h-3" />
                    {phone}
                  </p>
                )}
                {email && (
                  <p className="text-xs text-white/65 truncate flex items-center gap-1.5 mt-0.5">
                    <Mail className="w-3 h-3" />
                    {email}
                  </p>
                )}
                {isCA && (
                  <p className="text-[11px] text-white/60 truncate mt-1">
                    Read-only access — ask the owner to make changes
                  </p>
                )}
              </div>

              {/* Edit button (hidden for CA) */}
              {!isCA && (
                <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
                  <Pencil className="w-4 h-4" />
                </div>
              )}
            </div>
          </div>
        </button>

        {/* Placeholder for menu sections (Phase 2c) */}
        <div className="bg-card rounded-2xl shadow-sm border border-border/60 p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Menu sections will be added in Phase 2c
          </p>
        </div>
      </div>
    </div>
  )
}
