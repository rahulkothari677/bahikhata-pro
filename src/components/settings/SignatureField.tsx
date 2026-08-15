'use client'

/**
 * The shop's signature: drawn with a finger, or a photo of one on paper.
 *
 * 📄 Phase 3 of docs/INVOICE-ENGINE-PLAN.md. myBillBook offers "Create by hand
 * / Import from Camera / Import from Gallery" and both matter for different
 * shops — a shopkeeper at the counter draws it; one who already has a scanned
 * signature uploads it. Camera and gallery are the same thing to a file input
 * with `capture`, so this is two controls rather than three.
 *
 * WHY IT GOES TO CLOUDINARY AND NOT INTO THE ROW. Same reasoning as the logo:
 * the PDF embeds it by URL, the row stays small, and a signature is
 * re-fetchable rather than something the invoice depends on to render. If the
 * fetch fails the bill still prints a signable line — see invoice-pdf.
 *
 * TRANSPARENT PNG, deliberately. A signature drawn on an opaque white canvas
 * lands as a white rectangle over whatever the invoice puts behind it, which on
 * a bordered template is visible and looks like damage.
 */

import { useRef, useState } from 'react'
import { Pen, Upload, Trash2, Check } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const CANVAS_W = 600
const CANVAS_H = 200

export function SignatureField({
  value,
  onChange,
}: {
  value: string | null
  onChange: (url: string | null) => void
}) {
  const [drawing, setDrawing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hasInk, setHasInk] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)

  /** Canvas pixels from a pointer, accounting for CSS scaling. */
  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * CANVAS_W,
      y: ((e.clientY - r.top) / r.height) * CANVAS_H,
    }
  }

  const startStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const c = canvasRef.current!
    c.setPointerCapture(e.pointerId)
    lastPoint.current = pointFrom(e)
    setHasInk(true)
  }

  const moveStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!lastPoint.current) return
    e.preventDefault()
    const ctx = canvasRef.current!.getContext('2d')!
    const p = pointFrom(e)
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastPoint.current = p
  }

  const endStroke = () => { lastPoint.current = null }

  const clearCanvas = () => {
    const c = canvasRef.current
    if (!c) return
    c.getContext('2d')!.clearRect(0, 0, CANVAS_W, CANVAS_H)
    setHasInk(false)
  }

  const upload = async (dataUrl: string) => {
    setBusy(true)
    try {
      const r = await fetch('/api/settings/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Upload failed')
      onChange(j.signatureUrl)
      setDrawing(false)
      clearCanvas()
      sonnerToast.success('Signature saved')
    } catch (e: unknown) {
      // Never swallowed: a shopkeeper who believes their signature is on every
      // bill and finds it is not has been misled about a legal document.
      sonnerToast.error(e instanceof Error ? e.message : "Couldn't save the signature")
    } finally {
      setBusy(false)
    }
  }

  const saveDrawing = () => {
    if (!hasInk) { sonnerToast.error('Draw your signature first'); return }
    upload(canvasRef.current!.toDataURL('image/png'))
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
      const r = await fetch('/api/settings/signature', { method: 'DELETE' })
      if (!r.ok) throw new Error('Could not remove it')
      onChange(null)
      sonnerToast.success('Signature removed')
    } catch (e: unknown) {
      sonnerToast.error(e instanceof Error ? e.message : "Couldn't remove it")
    } finally {
      setBusy(false)
    }
  }

  // ── the saved signature ──────────────────────────────────────────────
  if (value && !drawing) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="bg-white rounded border border-border/40 p-2 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Your signature" className="max-h-16 object-contain" />
        </div>
        <div className="flex gap-2 mt-3">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5"
            onClick={() => { setDrawing(true); setHasInk(false) }} disabled={busy}>
            <Pen className="w-3.5 h-3.5" /> Replace
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-rose-600"
            onClick={remove} disabled={busy}>
            <Trash2 className="w-3.5 h-3.5" /> Remove
          </Button>
        </div>
      </div>
    )
  }

  // ── drawing ──────────────────────────────────────────────────────────
  if (drawing) {
    return (
      <div className="rounded-lg border border-border/60 p-3">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onPointerDown={startStroke}
          onPointerMove={moveStroke}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          // `touch-action: none` or the first stroke scrolls the page instead.
          style={{ touchAction: 'none' }}
          className="w-full h-28 bg-white rounded border-2 border-dashed border-border cursor-crosshair"
          aria-label="Draw your signature"
        />
        <p className="text-2xs text-muted-foreground mt-1.5 text-center">
          Sign with your finger
        </p>
        <div className="flex gap-2 mt-3">
          <Button size="sm" className="flex-1 gap-1.5" onClick={saveDrawing} disabled={busy}>
            <Check className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="outline" size="sm" onClick={clearCanvas} disabled={busy}>Clear</Button>
          <Button variant="ghost" size="sm" onClick={() => { setDrawing(false); clearCanvas() }} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  // ── nothing yet ──────────────────────────────────────────────────────
  return (
    <div className={cn('rounded-lg border border-dashed border-border p-4 text-center')}>
      <p className="text-xs text-muted-foreground mb-3">
        Add your signature so it prints on every bill.
      </p>
      <div className="flex gap-2 justify-center">
        <Button variant="outline" size="sm" className="gap-1.5"
          onClick={() => setDrawing(true)} disabled={busy}>
          <Pen className="w-3.5 h-3.5" /> Draw
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5"
          onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="w-3.5 h-3.5" /> Upload
        </Button>
      </div>
      {/*
        * One input for camera and gallery both: `capture` is a HINT, so Android
        * still offers the gallery, and a shop that already has a scanned
        * signature is not forced to photograph their screen.
        */}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
        onChange={onPickFile} className="hidden" />
    </div>
  )
}
