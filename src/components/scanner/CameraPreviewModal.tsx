'use client'

/**
 * CameraPreview — custom camera view with flash toggle and grid overlay.
 *
 * Uses @capacitor-community/camera-preview for live camera feed inside the webview.
 * This gives us:
 * - Flash/torch toggle button
 * - Rule-of-thirds grid overlay for bill alignment
 * - Capture button
 * - Cancel button
 *
 * On web (browser), falls back to hidden <input capture> (no custom UI).
 */

import { useState, useRef, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { CameraPreview, CameraPreviewOptions, CameraPreviewPictureOptions } from '@capacitor-community/camera-preview'
import { Camera, X, Zap, ZapOff, Grid3x3, Grid3X3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptic'

interface CameraPreviewModalProps {
  open: boolean
  onClose: () => void
  onCapture: (file: File) => void
}

export function CameraPreviewModal({ open, onClose, onCapture }: CameraPreviewModalProps) {
  const [torchOn, setTorchOn] = useState(false)
  const [gridOn, setGridOn] = useState(true)
  const [torchSupported, setTorchSupported] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState('')
  const cameraStartedRef = useRef(false)

  useEffect(() => {
    if (!open || !Capacitor.isNativePlatform()) return

    async function startCamera() {
      try {
        // Check torch support — getFlashMode was removed in newer versions
        // of @capacitor-community/camera-preview. We use setFlashMode with
        // a try/catch to detect torch support instead.
        try {
          await CameraPreview.setFlashMode({ flashMode: 'off' })
          setTorchSupported(true)
        } catch {
          setTorchSupported(false)
        }

        const options: CameraPreviewOptions = {
          position: 'rear',
          parent: 'camera-preview-container',
          className: 'camera-preview-element',
          toBack: true,
          storeToFile: true,
          width: window.screen.width,
          height: window.screen.height,
        }

        await CameraPreview.start(options)
        cameraStartedRef.current = true
      } catch (err: any) {
        setError('Failed to open camera: ' + String(err?.message || err))
      }
    }

    startCamera()

    return () => {
      if (cameraStartedRef.current) {
        CameraPreview.stop().catch(() => {})
        cameraStartedRef.current = false
      }
    }
  }, [open])

  const handleTorch = async () => {
    haptic.click()
    try {
      if (torchOn) {
        await CameraPreview.setFlashMode({ flashMode: 'off' })
        setTorchOn(false)
      } else {
        await CameraPreview.setFlashMode({ flashMode: 'on' })
        setTorchOn(true)
      }
    } catch {
      // Some devices use 'torch' mode instead
      try {
        if (!torchOn) {
          await CameraPreview.setFlashMode({ flashMode: 'torch' })
          setTorchOn(true)
        } else {
          await CameraPreview.setFlashMode({ flashMode: 'off' })
          setTorchOn(false)
        }
      } catch {
        setTorchSupported(false)
      }
    }
  }

  const handleCapture = async () => {
    haptic.medium()
    setCapturing(true)
    try {
      const options: CameraPreviewPictureOptions = {
        quality: 80,
      }
      const result = await CameraPreview.capture(options)
      // result.value is the file path
      const filePath = result.value

      // Read the file using Filesystem
      const { Filesystem } = await import('@capacitor/filesystem')
      const fileResult = await Filesystem.readFile({ path: filePath })

      let blob: Blob
      if (typeof fileResult.data === 'string') {
        const byteCharacters = atob(fileResult.data)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        blob = new Blob([byteArray], { type: 'image/jpeg' })
      } else {
        blob = fileResult.data as Blob
      }

      const file = new File([blob], `bill_${Date.now()}.jpg`, { type: 'image/jpeg' })

      // Stop camera before calling onCapture
      await CameraPreview.stop()
      cameraStartedRef.current = false

      onCapture(file)
    } catch (err: any) {
      setError('Capture failed: ' + String(err?.message || err))
    } finally {
      setCapturing(false)
    }
  }

  const handleClose = async () => {
    haptic.click()
    if (cameraStartedRef.current) {
      try {
        await CameraPreview.stop()
        cameraStartedRef.current = false
      } catch {}
    }
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      {/* Camera preview container — the native camera renders here */}
      <div id="camera-preview-container" className="absolute inset-0" />

      {/* Grid overlay — rule of thirds */}
      {gridOn && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Vertical lines */}
          <div className="absolute top-0 bottom-0 left-1/3 w-px bg-white/30" />
          <div className="absolute top-0 bottom-0 left-2/3 w-px bg-white/30" />
          {/* Horizontal lines */}
          <div className="absolute left-0 right-0 top-1/3 h-px bg-white/30" />
          <div className="absolute left-0 right-0 top-2/3 h-px bg-white/30" />
          {/* Center frame guide — helps align the bill */}
          <div className="absolute inset-[15%] border-2 border-white/20 rounded-xl" />
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="absolute top-20 left-4 right-4 bg-red-600 text-white text-sm p-3 rounded-lg z-10">
          {error}
          <button onClick={handleClose} className="ml-2 underline">Close</button>
        </div>
      )}

      {/* Top controls */}
      <div className="absolute top-0 left-0 right-0 p-4 pt-[calc(1rem+env(safe-area-inset-top))] flex items-center justify-between z-10">
        <button
          onClick={handleClose}
          className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white active:scale-95 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2">
          {/* Grid toggle */}
          <button
            onClick={() => { haptic.click(); setGridOn(!gridOn) }}
            className={cn(
              'w-10 h-10 rounded-full backdrop-blur-sm flex items-center justify-center transition active:scale-95',
              gridOn ? 'bg-white text-black' : 'bg-black/50 text-white'
            )}
          >
            <Grid3X3 className="w-5 h-5" />
          </button>

          {/* Flash toggle */}
          {torchSupported && (
            <button
              onClick={handleTorch}
              className={cn(
                'w-10 h-10 rounded-full backdrop-blur-sm flex items-center justify-center transition active:scale-95',
                torchOn ? 'bg-amber-400 text-black' : 'bg-black/50 text-white'
              )}
            >
              {torchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 p-8 pb-[calc(2rem+env(safe-area-inset-bottom))] flex items-center justify-center z-10">
        {/* Capture button */}
        <button
          onClick={handleCapture}
          disabled={capturing}
          className="w-20 h-20 rounded-full border-4 border-white bg-white/20 backdrop-blur-sm flex items-center justify-center active:scale-95 transition disabled:opacity-50"
        >
          {capturing ? (
            <div className="w-12 h-12 rounded-full bg-white/40 animate-pulse" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-white" />
          )}
        </button>
      </div>

      {/* Helper text */}
      {!capturing && (
        <div className="absolute bottom-32 left-0 right-0 text-center z-10">
          <p className="text-white/70 text-xs">Align the bill within the frame</p>
        </div>
      )}
    </div>
  )
}
