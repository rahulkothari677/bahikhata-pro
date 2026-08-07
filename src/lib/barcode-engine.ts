/**
 * Barcode decoding: the phone's own engine first, JavaScript only as a fallback.
 *
 * WHY (2026-08-07). After fixing the wrong camera, the decode rate and the
 * resolution, the scanner worked — but it took three or four seconds and the
 * packet had to be held just so. Side by side with Android's built-in scanner,
 * which reads the same label in under a second from any angle, that is not a
 * scanner a shopkeeper can use on a queue of customers.
 *
 * The gap is not tuning, it is the decoder. ZXing is a barcode reader written
 * in JavaScript: every frame is copied into a canvas, read back pixel by pixel,
 * and searched on the main thread. Android's scanner is Google's ML Kit —
 * native, hardware-accelerated, trained on damaged and skewed real-world codes.
 * No amount of adjustment closes that distance.
 *
 * The useful part: Chrome on Android exposes that SAME ML Kit engine to web
 * pages as `BarcodeDetector`. So on the phone this app is actually used on, it
 * can have the exact scanner it is being compared against — from the web layer,
 * with no new Android plugin and no reinstalling the APK.
 *
 * BarcodeDetector is not everywhere: Chrome ships it on Android and macOS, not
 * on Windows, and Firefox and iOS Safari do not have it at all. So this feature
 * -detects and keeps ZXing for everyone else. Both paths share one camera
 * setup, so the resolution and focus work applies either way — only the
 * decoding differs.
 */

import type { IScannerControls } from '@zxing/browser'

export type EngineName = 'native' | 'zxing'

export interface ScanEngine {
  /** Which decoder ended up running — surfaced so the UI can say so. */
  engine: EngineName
  stream: MediaStream
  /**
   * Start looking again after the picker was dismissed.
   *
   * Optional because only the native path can reach the picker — ZXing's
   * browser reader returns one result at a time and never pauses.
   */
  resume?: () => void
  stop: () => void
}

export interface ScanCallbacks {
  onCode: (code: string, format: string) => void
  /**
   * Fired every frame while MORE THAN ONE barcode is in view, and once with an
   * empty array when that stops being true.
   *
   * Shipping boxes and medicine strips routinely carry two or three codes.
   * Silently taking found[0] means the app picks one by whichever the engine
   * happened to list first — invisible to the shopkeeper, and wrong often
   * enough to matter when the codes are a product code and a courier code.
   */
  onCandidates?: (codes: DetectedCode[]) => void
  /** Fired if the engine changes after start — see the native path's bail-out. */
  onEngineChange?: (engine: EngineName) => void
  /**
   * Fired when scanning has failed in a way the user must be told about.
   *
   * Only the mid-scan fallback can reach this: failures during startup reject
   * startDecoding itself and are handled by the caller's try/catch. But once
   * the loop is running there is no promise left to reject into, and a scanner
   * that has quietly stopped decoding looks exactly like one pointed at a bad
   * barcode — the shopkeeper would keep trying, with no way to know.
   */
  onError?: (message: string) => void
}

/** One barcode the camera can currently see. */
export interface DetectedCode {
  value: string
  format: string
  /** Where it sits, in the video's own pixels — not screen pixels. */
  box: { x: number; y: number; width: number; height: number }
}

export interface Rect { left: number; top: number; width: number; height: number }

/**
 * Convert a box in video pixels to a box in element pixels.
 *
 * Needed because the preview is `object-cover`: the video is scaled up until it
 * fills the element and the overflow is cropped, so a barcode at video pixel
 * (100, 50) is NOT at element pixel (100, 50). Without this the tap targets for
 * choosing between barcodes would sit next to the barcodes rather than on them,
 * which is worse than not offering the choice at all.
 *
 * object-cover scales by the LARGER of the two ratios (so neither axis leaves a
 * gap) and centres the result, which is what the offsets undo. A pure function
 * so it can be tested without a camera — the one part of the multi-code picker
 * a machine can actually verify.
 */
export function mapBoxToElement(
  box: { x: number; y: number; width: number; height: number },
  videoW: number,
  videoH: number,
  elW: number,
  elH: number,
): Rect {
  if (!videoW || !videoH) return { left: 0, top: 0, width: 0, height: 0 }

  const scale = Math.max(elW / videoW, elH / videoH)
  const shownW = videoW * scale
  const shownH = videoH * scale
  // Negative: the amount cropped off each side by the centring.
  const offsetX = (elW - shownW) / 2
  const offsetY = (elH - shownH) / 2

  return {
    left: box.x * scale + offsetX,
    top: box.y * scale + offsetY,
    width: box.width * scale,
    height: box.height * scale,
  }
}

/** Can this camera turn its light on? */
export function torchSupported(stream: MediaStream | null): boolean {
  const track = stream?.getVideoTracks?.()[0]
  if (!track?.getCapabilities) return false
  try {
    return !!(track.getCapabilities() as any).torch
  } catch {
    return false
  }
}

/**
 * Turn the camera light on or off.
 *
 * Deliberately not called anywhere on startup: the torch stays OFF until the
 * shopkeeper asks for it. A light that comes on by itself in a customer's face
 * is startling, and it drains the battery of a phone that spends all day on the
 * counter.
 */
export async function setTorch(stream: MediaStream | null, on: boolean): Promise<void> {
  const track = stream?.getVideoTracks?.()[0]
  if (!track) return
  await track.applyConstraints({ advanced: [{ torch: on }] } as any)
}

/** BarcodeDetector's result shape, reduced to what the UI needs. */
function toDetected(b: any): DetectedCode {
  const r = b.boundingBox || {}
  return {
    value: b.rawValue,
    format: b.format || 'UNKNOWN',
    box: { x: r.x || 0, y: r.y || 0, width: r.width || 0, height: r.height || 0 },
  }
}

/** Formats worth looking for, in BarcodeDetector's naming. */
const NATIVE_FORMATS = [
  'ean_13', 'ean_8', 'upc_a', 'upc_e',
  'code_128', 'code_39', 'code_93', 'itf', 'codabar',
  'qr_code', 'data_matrix',
]

/**
 * Ask for the camera once, as well as this device will allow.
 *
 * `deviceId` is only passed when the user picked a camera explicitly; normally
 * facingMode chooses, which is the fix for the front camera opening.
 *
 * focusMode 'continuous' is the quiet one that matters most for the complaint
 * about needing to position perfectly. A barcode is read at 10-20cm, well
 * inside the range where a fixed-focus frame is a blur, and a blurred barcode
 * is not a hard read, it is an impossible one. It goes in `advanced`, which
 * browsers are required to ignore rather than reject when unsupported — so
 * asking costs nothing on a device that cannot do it.
 */
export async function openCamera(deviceId?: string): Promise<MediaStream> {
  const video: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: 'environment' } }

  video.width = { ideal: 1920 }
  video.height = { ideal: 1080 }
  ;(video as any).advanced = [{ focusMode: 'continuous' }]

  return navigator.mediaDevices.getUserMedia({ video, audio: false })
}

/** Is the phone's own barcode engine available here? */
export async function nativeEngineAvailable(): Promise<boolean> {
  const Detector = (globalThis as any).BarcodeDetector
  if (!Detector) return false
  try {
    const supported = await Detector.getSupportedFormats()
    return Array.isArray(supported) && supported.length > 0
  } catch {
    return false
  }
}

/**
 * Start decoding from an already-open stream.
 *
 * The native path runs off requestVideoFrameCallback, so it looks at EVERY
 * frame the camera actually delivers rather than on a timer. That is the whole
 * difference between "hold it still and wait" and "it beeps as you bring it
 * up": at 30fps the packet passes through focus and alignment several times a
 * second, and the reader only has to get lucky once. A timer samples a fraction
 * of those moments and misses the good ones.
 *
 * Each detect() is awaited before the next frame is requested, so a slow frame
 * cannot pile work up behind it.
 */
export async function startDecoding(
  stream: MediaStream,
  video: HTMLVideoElement,
  { onCode, onCandidates, onEngineChange, onError }: ScanCallbacks,
): Promise<ScanEngine> {
  if (await nativeEngineAvailable()) {
    const Detector = (globalThis as any).BarcodeDetector
    const supported: string[] = await Detector.getSupportedFormats()
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f))
    const detector = new Detector(formats.length ? { formats } : undefined)

    video.srcObject = stream
    await video.play().catch(() => {})

    let stopped = false

    /*
     * Give up on the native engine if it cannot actually decode.
     *
     * BarcodeDetector's presence is not a promise that it works. On Android it
     * is backed by a Play Services module that can be missing, mid-download, or
     * broken on a particular build — and in those states detect() throws on
     * every frame rather than failing to construct. Swallowing that silently
     * would put the shop straight back to "it does not scan at all", with no
     * clue why, which is the exact fault this whole change exists to fix.
     *
     * Consecutive, not cumulative: an occasional throw is normal (a frame can
     * arrive mid-resize, the detector can be busy) and must not accumulate over
     * a long session into a false verdict. Ten in a row is about a third of a
     * second — long enough that it cannot be a hiccup, short enough that the
     * shopkeeper only notices the scan took a moment longer to get going.
     */
    let consecutiveErrors = 0
    let paused = false
    let zxingControls: IScannerControls | null = null
    /*
     * Distinct from `stopped`, which the mid-scan bail-out also sets to end the
     * native loop. `closed` means the user shut the scanner, and it is the only
     * thing that can answer "should the fallback still be starting?" — without
     * it, closing the sheet during that await leaves a ZXing decode loop
     * running against a dead stream, because stop() ran while zxingControls was
     * still null and had nothing to cancel.
     */
    let closed = false

    /*
     * Collect every code seen in a short window, THEN decide.
     *
     * WHY THIS IS NOT PER-FRAME (2026-08-07, from a screen recording). The
     * first version only offered a choice when a SINGLE frame contained more
     * than one code. On the label in that recording — a phone box with two IMEI
     * barcodes and a QR — that frame never came. ML Kit resolves long, thin,
     * closely-stacked 1D codes ONE PER FRAME, depending on which happens to be
     * sharpest as the hand moves. So the app saw one code at a time, the
     * three-frame streak below was satisfied by whichever code repeated, and it
     * accepted that one and closed.
     *
     * From the outside that is exactly "it doesn't stop on the specific code
     * and randomly selects one" — and it is worse than a missing feature,
     * because the shopkeeper cannot tell a choice was made at all.
     *
     * So: from the first sighting, keep looking for COLLECT_MS and remember
     * every distinct value. Then one decision, on the whole set.
     *
     * 400ms is the trade. Long enough that a second code on the same label has
     * several frames to surface; short enough that a single barcode still feels
     * instant, which is the behaviour just reported as "too fast" and worth
     * protecting. A frame that genuinely contains two codes short-circuits the
     * wait, because there is nothing left to learn by waiting.
     */
    const COLLECT_MS = 400
    const seen = new Map<string, DetectedCode>()
    let collectingSince = 0

    const decide = () => {
      const list = [...seen.values()]
      if (list.length === 1) {
        onCode(list[0].value, list[0].format)
        return
      }
      /*
       * Freeze the picture while the shopkeeper chooses.
       *
       * The boxes are drawn over the video, so a live preview means the tap
       * targets drift under the thumb while it is reaching. Pausing makes them
       * hold still, which is what "hold on all the codes" needs to mean to be
       * usable. It also stops the decode loop, so nothing can be accepted
       * behind the picker.
       */
      paused = true
      video.pause()
      onCandidates?.(list)
    }

    const loop = async () => {
      if (stopped || paused) return
      try {
        const found: any[] = await detector.detect(video)
        consecutiveErrors = 0
        if (stopped || paused) return

        const now = Date.now()

        if (found && found.length) {
          if (!collectingSince) collectingSince = now
          for (const b of found) {
            const d = toDetected(b)
            seen.set(d.value, d)
          }
          // Two in one frame settles it: both are demonstrably in view.
          if (found.length > 1 || now - collectingSince >= COLLECT_MS) decide()
        } else if (collectingSince && now - collectingSince >= COLLECT_MS) {
          // Everything left the frame mid-collection. Decide on what was seen
          // rather than discarding it — the codes were real a moment ago.
          decide()
        } else if (!collectingSince) {
          seen.clear()
        }
      } catch {
        consecutiveErrors++
        if (consecutiveErrors >= 10 && !stopped) {
          stopped = true
          // Hand the SAME stream to ZXing — the camera is already open and
          // permission is already granted, so this is invisible to the user
          // beyond the engine label changing.
          onEngineChange?.('zxing')
          startZxing(stream, video, onCode).then(
            (c) => {
              if (closed) c.stop()
              else zxingControls = c
            },
            (err) => {
              // Both engines are down. Say so rather than leaving a live
              // preview that will never read anything.
              if (!closed) onError?.(err?.message || 'Scanning failed on this device.')
            },
          )
          return
        }
      }
      if (!stopped) requestFrame()
    }

    const requestFrame = () => {
      const v = video as any
      if (typeof v.requestVideoFrameCallback === 'function') {
        v.requestVideoFrameCallback(() => { loop() })
      } else {
        // Safari before 15.4 and a few Android WebViews lack the frame
        // callback. rAF is roughly display rate, which is close enough.
        requestAnimationFrame(() => { loop() })
      }
    }

    requestFrame()

    return {
      engine: 'native',
      stream,
      /** Called by "Scan again" after the shopkeeper dismisses the picker. */
      resume: () => {
        if (stopped || closed) return
        seen.clear()
        collectingSince = 0
        paused = false
        void video.play().catch(() => {})
        requestFrame()
      },
      stop: () => {
        stopped = true
        closed = true
        // May have fallen back mid-scan; that reader owns a decode loop of its
        // own and would keep running behind a closed sheet.
        zxingControls?.stop()
        stream.getTracks().forEach((t) => t.stop())
        video.srcObject = null
      },
    }
  }

  // ---- Fallback: ZXing in JavaScript ----
  const controls = await startZxing(stream, video, onCode)

  return {
    engine: 'zxing',
    stream,
    stop: () => {
      controls.stop()
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}

/** ZXing set up over an already-open stream. Used as the fallback, twice over:
 *  chosen up front when BarcodeDetector is absent, and switched to mid-scan if
 *  a present-but-broken BarcodeDetector keeps throwing. */
async function startZxing(
  stream: MediaStream,
  video: HTMLVideoElement,
  onCode: (code: string, format: string) => void,
): Promise<IScannerControls> {
  const { BrowserMultiFormatReader } = await import('@zxing/browser')
  const { DecodeHintType, BarcodeFormat } = await import('@zxing/library')

  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
    BarcodeFormat.ITF, BarcodeFormat.CODABAR,
    BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX,
  ])
  hints.set(DecodeHintType.TRY_HARDER, true)

  /*
   * 100ms here, against ZXing's 500ms default. This path is the slow one by
   * definition, so it gets the most attempts a main-thread decoder can take
   * without making the preview stutter — a stuttering preview makes aiming
   * harder, which costs more than the extra attempts win.
   */
  const reader = new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 100,
    delayBetweenScanSuccess: 500,
  })

  return reader.decodeFromStream(stream, video, (result) => {
    if (result) onCode(result.getText(), result.getBarcodeFormat?.toString?.() || 'UNKNOWN')
  })
}
