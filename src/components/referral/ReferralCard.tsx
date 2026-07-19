'use client'

import { useQuery } from '@tanstack/react-query'
import { offlineFetch } from '@/lib/offline-fetch'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Gift, Share2, Copy, Check, Users, Crown, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast as sonnerToast } from 'sonner'

/**
 * ReferralCard — shows the user's referral code + progress toward reward.
 *
 * "Refer 3 shops, get 1 year Pro free!"
 */
export function ReferralCard() {
  const [copied, setCopied] = useState(false)

  const { data: codeData, isLoading: codeLoading } = useQuery({
    queryKey: ['referral-code'],
    queryFn: async () => {
      const r = await offlineFetch('/api/referral/code')
      return r.json()
    },
  })

  const { data: statusData } = useQuery({
    queryKey: ['referral-status'],
    queryFn: async () => {
      const r = await offlineFetch('/api/referral/status')
      return r.json()
    },
  })

  if (codeLoading || !codeData) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    )
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(codeData.code)
    setCopied(true)
    sonnerToast.success('Referral code copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleWhatsAppShare = () => {
    window.open(codeData.whatsappUrl, '_blank')
  }

  const handleGenericShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'EkBook — India\'s Smartest Ledger App',
          text: codeData.whatsappText,
          url: codeData.shareUrl,
        })
      } catch {}
    } else {
      handleCopy()
    }
  }

  const completed = statusData?.completedReferrals || 0
  const threshold = statusData?.rewardThreshold || 3
  const progress = statusData?.progressPercent || 0
  const rewardEarned = statusData?.rewardEarned || false

  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-5 text-white">
        <div className="flex items-center gap-3 mb-2">
          <Gift className="w-6 h-6" />
          <h3 className="text-lg font-bold">Refer & Earn</h3>
        </div>
        <p className="text-sm text-white/90">
          Refer 3 shop owners and get <b>1 Year Pro FREE</b> (Rs.999 value)
        </p>
      </div>

      <CardContent className="p-5 space-y-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Your referral code</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 px-4 py-3 rounded-xl bg-muted border-2 border-dashed border-border font-mono font-bold text-lg tracking-wider">
              {codeData.code}
            </div>
            <Button onClick={handleCopy} size="icon" variant="outline" className="h-12 w-12">
              {copied ? <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium">
              Progress: {completed}/{threshold} referrals
            </p>
            {rewardEarned && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-1">
                <Crown className="w-3 h-3" /> Reward Earned!
              </span>
            )}
          </div>
          <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
            <div
              className="h-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-3xs text-muted-foreground mt-1">
            <span>0</span><span>1</span><span>2</span><span>3</span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleWhatsAppShare} className="flex-1 bg-emerald-600 hover:bg-emerald-700 gap-2">
            <Share2 className="w-4 h-4" /> Share on WhatsApp
          </Button>
          <Button onClick={handleGenericShare} variant="outline" className="gap-2">
            <Share2 className="w-4 h-4" /> More
          </Button>
        </div>

        <div className="bg-muted/50 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold">How it works:</p>
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p className="flex items-start gap-2"><span className="font-bold text-primary">1.</span> Share your code with shop owners you know</p>
            <p className="flex items-start gap-2"><span className="font-bold text-primary">2.</span> They sign up using your code — both get 7 days Pro free</p>
            <p className="flex items-start gap-2"><span className="font-bold text-primary">3.</span> After 3 successful referrals — you get 1 year Pro free (Rs.999 value)</p>
          </div>
        </div>

        {statusData?.referrals && statusData.referrals.length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Your referrals ({statusData.referrals.length})
            </p>
            <div className="space-y-1.5">
              {statusData.referrals.slice(0, 5).map((ref: any) => (
                <div key={ref.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 text-xs">
                  <div>
                    <p className="font-medium">{ref.referredName}</p>
                    {ref.referredEmail && <p className="text-muted-foreground">{ref.referredEmail}</p>}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full ${
                    ref.status === 'rewarded' ? 'bg-emerald-100 text-emerald-700 dark:text-emerald-300' :
                    ref.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                    'bg-amber-100 text-amber-700 dark:text-amber-300'
                  }`}>
                    {ref.status === 'rewarded' ? 'Reward earned' : ref.status === 'completed' ? 'Signed up' : 'Pending'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
