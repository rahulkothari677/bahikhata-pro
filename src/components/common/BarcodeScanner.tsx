'use client'

/**
 * BarcodeScanner — camera-based barcode scanner using ZXing.
 *
 * Opens the device camera, scans for barcodes (EAN-13, EAN-8, UPC-A, Code-128,
 * QR codes, etc.), and calls onScan(code) when a code is detected.
 *
 * Features:
 * - Camera selection (front/back) — defaults to back camera
 * - Live preview with scan frame overlay
 * - Haptic feedback on successful scan
 * - Graceful error handling (camera permission denied, no camera, etc.)
 * - Cleanup on unmount (stops camera stream)
 *
 * Usage:
 *   <BarcodeScanner
 *     onScan={(code) => { console.log('Scanned:', code) }}
 *     onClose={() => setScannerOpen(false)}
 *   />
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser'
import { DecodeHintType, BarcodeFormat } from '@zxing/library'
import { X, Camera, SwitchCamera, Loader2, AlertCircle, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Local haptic wrapper — avoids importing the haptic module (minification issues)
function safeHaptic(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern)
    }
  } catch {
    // silent
  }
}

export function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (code: string, format?: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [scannedCode, setScannedCode] = useState<string | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceIdx, setSelectedDeviceIdx] = useState(0)
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 })

  // Stop the camera and clean up
  const stopCamera = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.stop()
      controlsRef.current = null
    }
  }, [])

  // Start the camera with the selected device
  const startCamera = useCallback(async (deviceIdx: number) => {
    setStarting(true)
    setError(null)
    stopCamera()

    if (!videoRef.current) {
      setStarting(false)
      return
    }

    try {
      // Configure hints to support common retail barcodes
      const hints = new Map()
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.CODE_93,
        BarcodeFormat.ITF,
        BarcodeFormat.QR_CODE,
        BarcodeFormat.DATA_MATRIX,
      ])
      hints.set(DecodeHintType.TRY_HARDER, true)

      const reader = new BrowserMultiFormatReader(hints)

      // Get available video devices
      const videoDevices = await BrowserMultiFormatReader.listVideoInputDevices()
      setDevices(videoDevices)

      if (videoDevices.length === 0) {
        setError('No camera found on this device')
        setStarting(false)
        return
      }

      // Default to back camera (usually has "back" or "environment" in label)
      const backIdx = videoDevices.findIndex((d) =>
        /back|rear|environment/i.test(d.label)
      )
      const idx = deviceIdx >= 0 && deviceIdx < videoDevices.length
        ? deviceIdx
        : (backIdx >= 0 ? backIdx : 0)
      setSelectedDeviceIdx(idx)

      const deviceId = videoDevices[idx]?.deviceId

      controlsRef.current = await reader.decodeFromVideoDevice(
        deviceId,
        videoRef.current,
        (result, err) => {
          if (result) {
            const code = result.getText()
            const format = result.getBarcodeFormat?.toString?.() || 'UNKNOWN'
            const now = Date.now()
            // Debounce: ignore same code within 2 seconds
            if (code === lastScanRef.current.code && now - lastScanRef.current.time < 2000) {
              return
            }
            lastScanRef.current = { code, time: now }
            setScannedCode(code)
            safeHaptic([10, 40, 20])
            // Brief delay so user sees the scanned code before closing
            setTimeout(() => {
              onScan(code, format)
              stopCamera()
            }, 600)
          }
          // err is expected (continuous scanning) — ignore unless it's a fatal error
        }
      )
      setStarting(false)
    } catch (err: any) {
      console.error('[BarcodeScanner] Camera start failed:', err)
      if (err?.name === 'NotAllowedError') {
        setError('Camera permission denied. Please allow camera access in your browser settings.')
      } else if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
        setError('No camera found on this device.')
      } else if (err?.name === 'NotReadableError') {
        setError('Camera is already in use by another app. Close it and try again.')
      } else {
        setError(err?.message || 'Failed to start camera. Please try again.')
      }
      setStarting(false)
    }
  }, [onScan, stopCamera])

  // Start camera on mount
  useEffect(() => {
    startCamera(0)
    return () => {
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle Escape key to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopCamera()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, stopCamera])

  const handleClose = () => {
    stopCamera()
    onClose()
  }

  const handleSwitchCamera = () => {
    if (devices.length < 2) return
    const nextIdx = (selectedDeviceIdx + 1) % devices.length
    startCamera(nextIdx)
  }

  const handleRescan = () => {
    setScannedCode(null)
    lastScanRef.current = { code: '', time: 0 }
    startCamera(selectedDeviceIdx)
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between p-4 bg-black/80">
        <div className="flex items-center gap-2 text-white">
          <ScanLine className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold">Scan Barcode</h2>
        </div>
        <button
          onClick={handleClose}
          className="p-2 rounded-lg hover:bg-white/10 text-white"
          aria-label="Close scanner"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Camera preview */}
      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          autoPlay
          playsInline
          muted
        />

        {/* Scan frame overlay */}
        {!scannedCode && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-64 h-40 max-w-[80vw]">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg" />
              {/* Animated scan line */}
              <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-primary shadow-lg shadow-primary/50 animate-pulse" />
            </div>
            <div className="absolute bottom-8 left-0 right-0 text-center text-white/80 text-sm">
              {starting ? 'Starting camera...' : 'Point camera at a barcode'}
            </div>
          </div>
        )}

        {/* Loading spinner */}
        {starting && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-rose-500/20 flex items-center justify-center mb-4">
              <AlertCircle className="w-8 h-8 text-rose-400" />
            </div>
            <h3 className="text-white font-semibold mb-2">Camera Error</h3>
            <p className="text-white/70 text-sm max-w-xs mb-4">{error}</p>
            <Button onClick={handleClose} variant="outline" className="gap-2">
              <X className="w-4 h-4" />
              Close
            </Button>
          </div>
        )}

        {/* Scanned code preview */}
        {scannedCode && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-black/80">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
              <ScanLine className="w-8 h-8 text-emerald-400" />
            </div>
            <p className="text-white/70 text-sm mb-1">Scanned:</p>
            <p className="text-white text-2xl font-bold font-mono mb-4 break-all">{scannedCode}</p>
            <div className="flex gap-2">
              <Button onClick={handleRescan} variant="outline" className="gap-2">
                <Camera className="w-4 h-4" />
                Scan again
              </Button>
              <Button
                onClick={() => {
                  onScan(scannedCode)
                  stopCamera()
                }}
                className="gap-2 bg-gradient-saffron"
              >
                Use this code
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="p-4 bg-black/80 flex items-center justify-center gap-3">
        {devices.length > 1 && !scannedCode && !error && (
          <Button
            onClick={handleSwitchCamera}
            variant="outline"
            size="sm"
            className="gap-2 text-white border-white/30 hover:bg-white/10"
          >
            <SwitchCamera className="w-4 h-4" />
            Switch camera
          </Button>
        )}
        <p className="text-white/50 text-xs">
          {devices.length > 0 && `${devices.length} camera${devices.length === 1 ? '' : 's'} detected`}
        </p>
      </div>
    </div>
  )
}
