'use client'

/**
 * The shop's own payment QR — a photo of the code already stuck to the counter.
 *
 * 🗑️➕ 2026-08-15. Rahul removed the shareable bill link ("sharing link or
 * directly paying option sometimes cause fear in the mind of general public")
 * and asked for a place to "add the image of their QR or add upi id".
 *
 * WHY UPLOADING BEATS GENERATING, for a lot of shops. The kirana next door has
 * a laminated PhonePe or Paytm code on the counter that their regulars have
 * scanned fifty times. Putting THAT on the bill is more trustworthy than a code
 * this app produced, it needs no VPA typed correctly, and the money lands in
 * whichever account they actually use.
 *
 * Deliberately the upload half of SignatureField and nothing more — no drawing
 * canvas, because nobody draws a QR code.
 */

import { useRef, useState } from 'react'
import { Upload, Trash2 } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { Button } from '@/components/ui/button'

export function PaymentQrField({
  value,
  onChange,
}: {
  value: string | null
  onChange: (url: string | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = async (dataUrl: string) => {
    setBusy(true)
    try {
      const r = await fetch('/api/settings/payment-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Upload failed')
      onChange(j.paymentQrUrl)
      sonnerToast.success('QR code saved')
    } catch (e: unknown) {
      /*
       * Never swallowed. A shopkeeper who believes their QR is on every bill,
       * and whose customers therefore cannot pay, loses money silently — which
       * is worse than the upload plainly failing in front of them.
       */
      sonnerToast.error(e instanceof Error ? e.message : "Couldn't save the QR code")
    } finally {
      setBusy(false)
    }
  }

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > 2 * 1024 * 1024) { sonnerToast.error('Please pick an image under 2 MB'); return }
    const reader = new FileReader()
    reader.onload = () => upload(String(reader.result))
    reader.onerror = () => sonnerToast.error("Couldn't read that file")
    reader.readAsDataURL(f)
  }

  const remove = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/settings/payment-qr', { method: 'DELETE' })
      if (!r.ok) throw new Error('Could not remove it')
      onChange(null)
      sonnerToast.success('QR code removed')
    } catch (e: unknown) {
      sonnerToast.error(e instanceof Error ? e.message : "Couldn't remove it")
    } finally {
      setBusy(false)
    }
  }

  if (value) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="bg-white rounded border border-border/40 p-2 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Your payment QR code" className="max-h-40 object-contain" />
        </div>
        <div className="flex gap-2 mt-3">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5"
            onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="w-3.5 h-3.5" /> Replace
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-rose-600"
            onClick={remove} disabled={busy}>
            <Trash2 className="w-3.5 h-3.5" /> Remove
          </Button>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
          onChange={onPickFile} className="hidden" />
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-center">
      <p className="text-xs text-muted-foreground mb-3">
        Take a photo of the QR code on your counter, or upload the image your
        bank or payment app gave you.
      </p>
      <Button variant="outline" size="sm" className="gap-1.5"
        onClick={() => fileRef.current?.click()} disabled={busy}>
        <Upload className="w-3.5 h-3.5" /> {busy ? 'Uploading…' : 'Upload QR'}
      </Button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
        onChange={onPickFile} className="hidden" />
    </div>
  )
}
