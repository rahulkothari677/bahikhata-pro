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
import { registerExitGuard } from '@/lib/exit-guard'
import {
  openCamera, startDecoding, mapBoxToElement, torchSupported, setTorch,
  type ScanEngine, type EngineName, type DetectedCode,
} from '@/lib/barcode-engine'
import { X, Camera, SwitchCamera, Loader2, AlertCircle, ScanLine, Flashlight, FlashlightOff } from 'lucide-react'
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

/*
 * Controls sitting on this screen must be styled for black, not for the theme.
 *
 * The overlay is `bg-black` always — it is a camera viewfinder, it does not
 * follow light/dark mode. `variant="outline"` DOES follow the theme: it renders
 * `bg-background`, which in light mode is near-white. Pairing that with
 * `text-white`, as the Switch camera button did, produced white text on a white
 * pill — invisible, and reported from a real phone.
 *
 * Explicit colours, no variant, so the theme cannot reach in and repaint them.
 */
const ON_BLACK_BUTTON =
  'bg-white/10 text-white border border-white/30 hover:bg-white/20 hover:text-white backdrop-blur-sm'

export function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (code: string, format?: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const engineRef = useRef<ScanEngine | null>(null)
  const [engine, setEngine] = useState<EngineName | null>(null)
  const [candidates, setCandidates] = useState<DetectedCode[]>([])
  const [canTorch, setCanTorch] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [scannedCode, setScannedCode] = useState<string | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceIdx, setSelectedDeviceIdx] = useState(0)
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 })

  // Stop the camera and clean up
  const stopCamera = useCallback(() => {
    setCandidates([])
    setTorchOn(false)
    if (engineRef.current) {
      engineRef.current.stop()
      engineRef.current = null
    }
  }, [])

  /**
   * Start scanning.
   *
   * `deviceId` undefined means "pick the right camera yourself" — which is what
   * happens on open. Passing an id is only for the Switch camera button.
   *
   * WHY NOT PICK BY LABEL (2026-08-07). The old code asked for the device list
   * and looked for /back|rear|environment/ in the labels. Two things were wrong
   * with that, and together they meant the front camera opened every time:
   *
   *  1. It never ran. Mount called startCamera(0), and the guard was
   *     `deviceIdx >= 0 && deviceIdx < length ? deviceIdx : backIdx`. Zero is a
   *     valid index, so the back-camera branch was unreachable dead code and
   *     index 0 — the front camera on essentially every Android — was used.
   *
   *  2. Even reached, it could not have worked. Browsers return EMPTY labels
   *     from enumerateDevices until camera permission has been granted, and on
   *     open it has not been. There was nothing for the regex to match.
   *
   * facingMode: 'environment' asks the browser for the rear camera directly.
   * It needs no permission to express, no labels, and no guessing at names in
   * whatever language the phone is set to. `ideal` rather than `exact` so a
   * laptop with only a front camera still opens instead of throwing.
   */
  const startCamera = useCallback(async (deviceId?: string) => {
    setStarting(true)
    setError(null)
    stopCamera()

    if (!videoRef.current) {
      setStarting(false)
      return
    }

    try {
      /*
       * One camera acquisition, two possible decoders.
       *
       * openCamera asks for facingMode environment, 1920x1080 and continuous
       * autofocus; startDecoding then uses the phone's own ML Kit engine via
       * BarcodeDetector where it exists and falls back to ZXing where it does
       * not. See src/lib/barcode-engine.ts for why that split exists — briefly,
       * a JavaScript decoder cannot catch a native one, and on Android the
       * native one is available to us for free.
       */
      const stream = await openCamera(deviceId)

      const handleCode = (code: string, format: string) => {
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

      engineRef.current = await startDecoding(stream, videoRef.current, {
        onCode: handleCode,
        // The native engine can give up mid-scan on a device where it is
        // present but broken; keep the label honest when it does.
        onCandidates: setCandidates,
        onEngineChange: setEngine,
        // Reached only if BOTH engines fail after the camera opened; startup
        // failures reject startDecoding and land in the catch below.
        onError: setError,
      })
      setEngine(engineRef.current.engine)
      // Off by default, always. Only offer the button where the camera can
      // actually do it — on a laptop or an unsupported phone it would be a
      // control that does nothing.
      setCanTorch(torchSupported(stream))
      setTorchOn(false)

      /*
       * Enumerate AFTER the stream is live, not before.
       *
       * Permission has now been granted, so labels are populated and the Switch
       * camera button can show something meaningful. Asking first — as the old
       * code did — returns unlabelled entries and taught the scanner nothing.
       */
      const videoDevices = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === 'videoinput')
      setDevices(videoDevices)

      // Highlight whichever camera actually ended up live, so that Switch
      // advances from the real starting point rather than from index 0.
      const liveId = stream.getVideoTracks()[0]?.getSettings?.().deviceId
      const liveIdx = liveId ? videoDevices.findIndex((d) => d.deviceId === liveId) : -1
      setSelectedDeviceIdx(liveIdx >= 0 ? liveIdx : 0)

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

  // Start camera on mount. No argument: let facingMode pick the rear camera.
  useEffect(() => {
    startCamera()
    return () => {
      stopCamera()
    }

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

  /*
   * Android's back button closes the scanner rather than navigating.
   *
   * Escape covers a desktop keyboard, and nothing covered the button most
   * Android users actually press — so back went to whatever was behind the
   * form. Worse, with items already on the form it hit the sale's own
   * leave-confirmation instead, asking about abandoning a sale when all the
   * user wanted was to put the camera away.
   *
   * Returning false means "handled, do not navigate": the guard's job here is
   * to consume the press, not to ask a question.
   */
  useEffect(() => {
    return registerExitGuard(async () => {
      stopCamera()
      onClose()
      return false
    })
  }, [onClose, stopCamera])

  const handleClose = () => {
    stopCamera()
    onClose()
  }

  const handleSwitchCamera = () => {
    if (devices.length < 2) return
    const nextIdx = (selectedDeviceIdx + 1) % devices.length
    startCamera(devices[nextIdx]?.deviceId)
  }

  /**
   * Dismiss the picker and keep looking.
   *
   * resume() rather than startCamera(): the camera is still open and permission
   * is still granted, so restarting it would black the preview for a moment and
   * re-run the whole engine handshake for nothing.
   */
  const handleKeepLooking = () => {
    setCandidates([])
    engineRef.current?.resume?.()
  }

  /** The shopkeeper tapped one of several barcodes on the label. */
  const handleChoose = (code: DetectedCode) => {
    setCandidates([])
    lastScanRef.current = { code: code.value, time: Date.now() }
    setScannedCode(code.value)
    safeHaptic([10, 40, 20])
    setTimeout(() => {
      onScan(code.value, code.format)
      stopCamera()
    }, 600)
  }

  const handleToggleTorch = async () => {
    const next = !torchOn
    try {
      await setTorch(engineRef.current?.stream || null, next)
      setTorchOn(next)
    } catch {
      // Some cameras advertise the torch and then refuse it. Leave the button
      // showing its real state rather than lying about a light that is off.
      setTorchOn(false)
    }
  }

  const handleRescan = () => {
    setScannedCode(null)
    lastScanRef.current = { code: '', time: 0 }
    // Re-open the camera the user was already on, not the default one — if they
    // switched to get a better angle, "Scan again" must not undo that.
    startCamera(devices[selectedDeviceIdx]?.deviceId)
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/*
       * pt-safe, and it was missing.
       *
       * This overlay is `fixed inset-0`, so on Android — where the WebView now
       * runs edge-to-edge — its top bar sat UNDER the system status bar. The
       * title collided with the clock, and worse, the ✕ was in the strip the
       * system owns, so tapping it did nothing. Reported as "it blocked the
       * whole screen and I couldn't cancel it", which is exactly right: the
       * only way out was underneath the status bar.
       *
       * CameraPreviewModal already did this. This file was missed in the
       * original safe-area sweep because that sweep went looking for sticky
       * headers, and this is a full-screen overlay.
       */}
      <div className="flex items-center justify-between p-4 pt-safe bg-black/80">
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
        {!scannedCode && !error && candidates.length <= 1 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {/*
              * A guide, not a gate. The whole frame is decoded, so a barcode
              * anywhere on screen reads — but a small tight box teaches the
              * opposite, and "I have to position it very perfectly" was
              * exactly the complaint. Wider, and the caption below says so.
              */}
            <div className="relative w-72 h-44 max-w-[86vw]">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg" />
              {/* Animated scan line */}
              <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-primary shadow-lg shadow-primary/50 animate-pulse" />
            </div>
            <div className="absolute bottom-8 left-0 right-0 text-center text-white/80 text-sm">
              {starting ? 'Starting camera...' : 'Hold the barcode anywhere in view'}
            </div>
          </div>
        )}

        {/*
          * Choose-your-barcode overlay.
          *
          * Shipping boxes and medicine strips often carry two or three codes —
          * a product code and a courier or batch code. Taking the first one the
          * engine listed would be a silent coin-flip, so when more than one is
          * in view the app stops and asks.
          *
          * Boxes are positioned through mapBoxToElement because the preview is
          * object-cover: video pixels are not element pixels, and tap targets
          * that sit NEXT to the barcodes would be worse than no choice at all.
          */}
        {candidates.length > 1 && !scannedCode && !error && (
          <div className="absolute inset-0">
            {candidates.map((c, i) => {
              const v = videoRef.current
              const r = mapBoxToElement(
                c.box,
                v?.videoWidth || 0,
                v?.videoHeight || 0,
                v?.clientWidth || 0,
                v?.clientHeight || 0,
              )
              return (
                <button
                  key={`${c.value}-${i}`}
                  onClick={() => handleChoose(c)}
                  aria-label={`Use barcode ${c.value}`}
                  className="absolute border-2 border-primary bg-primary/20 rounded-md active:bg-primary/40"
                  style={{
                    left: r.left,
                    top: r.top,
                    // A correctly-mapped box can still be a thin sliver on a
                    // 1D barcode seen edge-on. 44px is this app's thumb-size
                    // standard, and an accurate target too small to hit is
                    // just an inaccurate one.
                    width: Math.max(r.width, 44),
                    height: Math.max(r.height, 44),
                  }}
                >
                  <span className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                </button>
              )
            })}
            {/*
              * The values, spelled out.
              *
              * Boxes alone are not enough. The label that exposed this bug was a
              * phone carton carrying two IMEI barcodes — visually identical
              * stripes, one digit different. Tapping the right rectangle is not
              * the same as knowing which code you took, so the list shows the
              * actual digits and doubles as a second, larger tap target.
              */}
            <div className="absolute bottom-0 left-0 right-0 bg-black/85 pb-safe">
              <p className="text-white text-sm text-center pt-3 pb-2">
                {candidates.length} codes found — which one?
              </p>
              <div className="max-h-52 overflow-y-auto px-3 pb-3 space-y-2">
                {candidates.map((c, i) => (
                  <button
                    key={`row-${c.value}-${i}`}
                    onClick={() => handleChoose(c)}
                    className={cn('w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left', ON_BLACK_BUTTON)}
                  >
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-mono text-sm text-white break-all">{c.value}</span>
                      <span className="block text-2xs text-white/50 uppercase">{c.format.replace(/_/g, ' ')}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="px-3 pb-3">
                <Button onClick={handleKeepLooking} className={cn('w-full gap-2', ON_BLACK_BUTTON)}>
                  <Camera className="w-4 h-4" />
                  None of these — keep scanning
                </Button>
              </div>
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
            <Button onClick={handleClose} className={cn('gap-2', ON_BLACK_BUTTON)}>
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
              <Button onClick={handleRescan} className={cn('gap-2', ON_BLACK_BUTTON)}>
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
        {canTorch && !scannedCode && !error && (
          <Button
            onClick={handleToggleTorch}
            size="sm"
            aria-pressed={torchOn}
            className={cn('gap-2', torchOn
              ? 'bg-amber-400 text-black hover:bg-amber-300 border border-amber-300'
              : ON_BLACK_BUTTON)}
          >
            {torchOn ? <Flashlight className="w-4 h-4" /> : <FlashlightOff className="w-4 h-4" />}
            {torchOn ? 'Light on' : 'Light'}
          </Button>
        )}
        {devices.length > 1 && !scannedCode && !error && (
          <Button
            onClick={handleSwitchCamera}
            size="sm"
            className={cn('gap-2', ON_BLACK_BUTTON)}
          >
            <SwitchCamera className="w-4 h-4" />
            Switch camera
          </Button>
        )}
        {/*
          * "2 cameras detected" told a shopkeeper nothing. Which ENGINE is
          * running is the thing worth knowing: on the fast path this is the
          * phone's own scanner and reads are near-instant, on the fallback it
          * is JavaScript and wants a steadier hand. It also lets a real
          * device confirm which path it actually took, which no amount of
          * testing on a laptop can establish.
          */}
        <p className="text-white/50 text-xs">
          {engine === 'native' && 'Fast scan'}
          {engine === 'zxing' && 'Basic scan — hold steady'}
        </p>
      </div>
    </div>
  )
}
