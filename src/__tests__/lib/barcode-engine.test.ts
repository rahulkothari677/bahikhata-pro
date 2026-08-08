/**
 * Which decoder runs, and whether the camera is genuinely released.
 *
 * The decoding itself is not testable here — it needs a real camera pointed at
 * a real packet, which is the one part only a phone can confirm. What IS
 * testable is the part that decides, and the part that turns the camera off,
 * and both have consequences worth pinning:
 *
 *  - Pick wrong and the shopkeeper is back to a three-second scan.
 *  - Fail to release and the phone keeps filming after the sheet is closed,
 *    with the camera light on. That is a privacy problem, not a battery one.
 */
import {
  nativeEngineAvailable, openCamera, startDecoding,
  mapBoxToElement, torchSupported, setTorch,
} from '@/lib/barcode-engine'

const g = globalThis as any

/**
 * Wait for something to become true, rather than for a fixed number of ms.
 *
 * WHY (2026-08-08). These tests used to sleep past the engine's 400ms
 * collection window — `setTimeout(r, 600)` — and then assert. That passed on a
 * developer machine and failed on CI, where the frame callbacks are driven by
 * `setTimeout(cb, 1)` and a loaded runner delivers them far apart: the window
 * had elapsed but not enough frames had arrived to carry the decision, so
 * `onCandidates` had simply not been called yet. Two tests went red on main and
 * the suite was blocked on a race, not a defect.
 *
 * Polling waits exactly as long as the machine needs and no longer, so the
 * tests stay fast locally and stop lying on slow hardware. A real regression
 * still fails them — the condition never comes true and the timeout fires.
 */
async function until(cond: () => boolean, label: string, timeoutMs = 5000) {
  const started = Date.now()
  while (!cond()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for: ${label}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

function fakeTrack() {
  return { stop: jest.fn(), getSettings: () => ({ deviceId: 'cam-1' }) }
}

function fakeStream(track = fakeTrack()) {
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
}

function fakeVideo() {
  return {
    srcObject: null,
    play: jest.fn().mockResolvedValue(undefined),
    requestVideoFrameCallback: jest.fn(),
  } as unknown as HTMLVideoElement
}

afterEach(() => {
  delete g.BarcodeDetector
  jest.restoreAllMocks()
})

describe('choosing an engine', () => {
  it('says no when the browser has no BarcodeDetector at all', async () => {
    delete g.BarcodeDetector
    expect(await nativeEngineAvailable()).toBe(false)
  })

  it('says no when BarcodeDetector exists but supports nothing', async () => {
    // Reported on some Android builds where Play Services is present but the
    // barcode module has not been downloaded yet: the constructor exists and
    // the format list comes back empty. Treating that as "available" would
    // hand every scan to an engine that can never match anything.
    g.BarcodeDetector = class { static getSupportedFormats() { return Promise.resolve([]) } }
    expect(await nativeEngineAvailable()).toBe(false)
  })

  it('says no when asking throws, rather than letting the scanner fail to open', async () => {
    g.BarcodeDetector = class { static getSupportedFormats() { return Promise.reject(new Error('no')) } }
    expect(await nativeEngineAvailable()).toBe(false)
  })

  it('says yes when a real format list comes back', async () => {
    g.BarcodeDetector = class { static getSupportedFormats() { return Promise.resolve(['ean_13', 'code_128']) } }
    expect(await nativeEngineAvailable()).toBe(true)
  })
})

describe('the native path', () => {
  beforeEach(() => {
    g.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['ean_13', 'code_128']) }
      detect() { return Promise.resolve([]) }
    }
  })

  it('reports itself as native and starts looking at frames', async () => {
    const video = fakeVideo()
    const engine = await startDecoding(fakeStream(), video, { onCode: jest.fn() })
    expect(engine.engine).toBe('native')
    // Frame-driven, not timer-driven: this is the difference between reading a
    // packet as it comes up and asking the user to hold it still.
    expect((video as any).requestVideoFrameCallback).toHaveBeenCalled()
  })

  it('stops every camera track when the scanner closes', async () => {
    const track = fakeTrack()
    const engine = await startDecoding(fakeStream(track), fakeVideo(), { onCode: jest.fn() })
    engine.stop()
    expect(track.stop).toHaveBeenCalled()
  })

  it('asks only for formats the device actually supports', async () => {
    // Passing a format ML Kit has not got throws in the constructor on some
    // builds, which would drop every scan to the slow path for no reason.
    const seen: any[] = []
    g.BarcodeDetector = class {
      constructor(opts: any) { seen.push(opts) }
      static getSupportedFormats() { return Promise.resolve(['ean_13']) }
      detect() { return Promise.resolve([]) }
    }
    await startDecoding(fakeStream(), fakeVideo(), { onCode: jest.fn() })
    expect(seen[0].formats).toEqual(['ean_13'])
  })
})

describe('opening the camera', () => {
  it('asks for the rear camera, high resolution and continuous focus', async () => {
    const getUserMedia = jest.fn().mockResolvedValue(fakeStream())
    ;(navigator as any).mediaDevices = { getUserMedia }

    await openCamera()

    const v = getUserMedia.mock.calls[0][0].video
    // The three fixes that made scanning work at all, in one place.
    expect(v.facingMode).toEqual({ ideal: 'environment' })
    expect(v.width).toEqual({ ideal: 1920 })
    expect(v.advanced).toEqual([{ focusMode: 'continuous' }])
  })

  it('honours an explicit camera choice instead of overriding it with facingMode', async () => {
    const getUserMedia = jest.fn().mockResolvedValue(fakeStream())
    ;(navigator as any).mediaDevices = { getUserMedia }

    await openCamera('cam-2')

    const v = getUserMedia.mock.calls[0][0].video
    expect(v.deviceId).toEqual({ exact: 'cam-2' })
    // If facingMode were also sent, the browser could quietly ignore the id
    // and "Switch camera" would appear to do nothing.
    expect(v.facingMode).toBeUndefined()
  })
})

describe('when the native engine is present but broken', () => {
  /**
   * A video element whose frame callback fires on a real timer, so the decode
   * loop actually iterates. The element is a genuine <video> so that the ZXing
   * fallback has something plausible to attach to.
   */
  function tickingVideo(maxFrames = 60) {
    const el = document.createElement('video') as any
    let frames = 0
    el.play = jest.fn().mockResolvedValue(undefined)
    el.requestVideoFrameCallback = (cb: any) => {
      if (frames++ < maxFrames) setTimeout(() => cb(), 1)
    }
    return el as HTMLVideoElement
  }

  it('gives up after repeated failures instead of silently scanning nothing', async () => {
    // Real Android case: Play Services is installed so BarcodeDetector exists
    // and reports formats, but its barcode module is missing or mid-download,
    // so every detect() throws. Swallowing that would put the shop back to
    // "it does not scan", with no clue why.
    g.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['ean_13']) }
      detect() { return Promise.reject(new Error('module unavailable')) }
    }

    const onEngineChange = jest.fn()
    const engine = await startDecoding(fakeStream(), tickingVideo(), {
      onCode: jest.fn(), onEngineChange, onError: jest.fn(),
    })

    // It starts on the fast path — the failure is only discoverable by trying.
    expect(engine.engine).toBe('native')

    await new Promise((r) => setTimeout(r, 250))
    expect(onEngineChange).toHaveBeenCalledWith('zxing')

    engine.stop()
  })

  it('does not give up over occasional throws, which are normal', async () => {
    let n = 0
    // Every third frame throws — a busy detector, not a broken one. A
    // cumulative counter would eventually condemn this device wrongly.
    g.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['ean_13']) }
      detect() { n++; return n % 3 === 0 ? Promise.reject(new Error('busy')) : Promise.resolve([]) }
    }

    const onEngineChange = jest.fn()
    const engine = await startDecoding(fakeStream(), tickingVideo(), {
      onCode: jest.fn(), onEngineChange, onError: jest.fn(),
    })
    await new Promise((r) => setTimeout(r, 250))

    expect(onEngineChange).not.toHaveBeenCalled()
    expect(n).toBeGreaterThan(15)  // it really did keep going
    engine.stop()
  })
})

describe('mapping a barcode box onto the preview', () => {
  // The preview is object-cover, so video pixels are not element pixels. Get
  // this wrong and the tap targets sit next to the barcodes instead of on them.

  it('places a box correctly when the video is wider than the element', () => {
    // 1920x1080 video in a 400x800 portrait element: scales by height
    // (800/1080 = 0.74), and the sides get cropped.
    const r = mapBoxToElement({ x: 960, y: 540, width: 100, height: 50 }, 1920, 1080, 400, 800)
    const scale = 800 / 1080
    expect(r.width).toBeCloseTo(100 * scale)
    expect(r.height).toBeCloseTo(50 * scale)
    // The centre of the video must land on the centre of the element.
    expect(r.left).toBeCloseTo(400 / 2)
    expect(r.top).toBeCloseTo(800 / 2)
  })

  it('places a box correctly when the video is taller than the element', () => {
    const r = mapBoxToElement({ x: 540, y: 960, width: 50, height: 100 }, 1080, 1920, 800, 400)
    const scale = 800 / 1080
    expect(r.left).toBeCloseTo(800 / 2)
    expect(r.top).toBeCloseTo(400 / 2)
    expect(r.width).toBeCloseTo(50 * scale)
  })

  it('maps the video origin to a negative offset, since cover crops', () => {
    // Point (0,0) of the video is off-screen when the sides are cropped —
    // returning 0 here would bunch every box against the left edge.
    const r = mapBoxToElement({ x: 0, y: 0, width: 10, height: 10 }, 1920, 1080, 400, 800)
    expect(r.left).toBeLessThan(0)
    expect(r.top).toBeCloseTo(0)
  })

  it('returns an empty box before the video has reported its size', () => {
    // videoWidth is 0 until metadata loads; dividing by it would give NaN and
    // React would drop the style silently, stacking every target at 0,0.
    const r = mapBoxToElement({ x: 10, y: 10, width: 10, height: 10 }, 0, 0, 400, 800)
    expect(r).toEqual({ left: 0, top: 0, width: 0, height: 0 })
  })
})

describe('more than one barcode in view', () => {
  /*
   * The frame budget must outlast the engine's 400ms collection window.
   *
   * It was 200 frames at `setTimeout(cb, 1)`. Node clamps that to roughly 1-4ms,
   * so the budget was worth somewhere between 200ms and 800ms depending on the
   * machine — straddling the 400ms window. Where frames ran out first the engine
   * never got the frame that carries the decision, so `onCandidates`/`onCode`
   * were simply never called and the test failed with no callback at all. That
   * is what went red on CI while passing locally.
   *
   * 5000 frames is unambiguously longer than the window on any machine. The
   * cost is nothing: `stop()` ends the loop, and the polling helper returns as
   * soon as the callback lands.
   */
  function tickingVideo(maxFrames = 5000) {
    const el = document.createElement('video') as any
    let frames = 0
    el.play = jest.fn().mockResolvedValue(undefined)
    el.pause = jest.fn()
    el.requestVideoFrameCallback = (cb: any) => { if (frames++ < maxFrames) setTimeout(() => cb(), 1) }
    return el as HTMLVideoElement
  }

  const box = (x: number) => ({ x, y: 0, width: 10, height: 10 })

  it('does not silently pick one — it offers both', async () => {
    g.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['code_128']) }
      detect() {
        return Promise.resolve([
          { rawValue: 'PRODUCT-1', format: 'code_128', boundingBox: box(0) },
          { rawValue: 'COURIER-2', format: 'code_128', boundingBox: box(200) },
        ])
      }
    }
    const onCode = jest.fn()
    const onCandidates = jest.fn()
    const engine = await startDecoding(fakeStream(), tickingVideo(), { onCode, onCandidates })
    await until(() => onCandidates.mock.calls.length > 0, 'both codes to be offered')

    // Taking found[0] would be a silent coin-flip between a product code and a
    // courier code.
    expect(onCode).not.toHaveBeenCalled()
    const offered = onCandidates.mock.calls.at(-1)![0]
    expect(offered.map((c: any) => c.value).sort()).toEqual(['COURIER-2', 'PRODUCT-1'])
    engine.stop()
  })

  it('offers both even when they NEVER appear on the same frame', async () => {
    /*
     * The bug from the screen recording, as a test.
     *
     * A phone carton with two IMEI barcodes: ML Kit resolves long, thin,
     * closely-stacked 1D codes one per frame, whichever is sharpest as the hand
     * moves. The first implementation only offered a choice when a single frame
     * held two codes — that frame never arrived, so it accepted whichever code
     * repeated and closed. "It doesn't stop on the specific code and randomly
     * selects one."
     */
    let frame = 0
    g.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['code_128']) }
      detect() {
        frame++
        // Strictly alternating. Never two in one frame.
        return Promise.resolve([frame % 2
          ? { rawValue: 'IMEI-A', format: 'code_128', boundingBox: box(0) }
          : { rawValue: 'IMEI-B', format: 'code_128', boundingBox: box(60) }])
      }
    }
    const onCode = jest.fn()
    const onCandidates = jest.fn()
    const engine = await startDecoding(fakeStream(), tickingVideo(), { onCode, onCandidates })
    await until(() => onCandidates.mock.calls.length > 0, 'the alternating codes to be offered')

    expect(onCode).not.toHaveBeenCalled()
    const offered = onCandidates.mock.calls.at(-1)![0]
    expect(offered.map((c: any) => c.value).sort()).toEqual(['IMEI-A', 'IMEI-B'])
    engine.stop()
  })

  it('freezes the picture while the shopkeeper chooses', async () => {
    // Tap targets sit on the video. A live preview means they drift under the
    // thumb while it is reaching.
    const video = tickingVideo()
    g.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['code_128']) }
      detect() {
        return Promise.resolve([
          { rawValue: 'A', format: 'code_128', boundingBox: box(0) },
          { rawValue: 'B', format: 'code_128', boundingBox: box(60) },
        ])
      }
    }
    const engine = await startDecoding(fakeStream(), video, { onCode: jest.fn(), onCandidates: jest.fn() })
    await until(() => (video as any).pause.mock.calls.length > 0, 'the preview to freeze')
    expect((video as any).pause).toHaveBeenCalled()
    engine.stop()
  })

  it('still accepts a lone barcode automatically, which is the fast path', async () => {
    g.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['ean_13']) }
      detect() { return Promise.resolve([{ rawValue: '8901030865278', format: 'ean_13', boundingBox: box(0) }]) }
    }
    const onCode = jest.fn()
    const engine = await startDecoding(fakeStream(), tickingVideo(), { onCode })
    // A single code is accepted once the app has satisfied itself there is no
    // second one — i.e. after the collection window, however long that takes to
    // arrive on this machine.
    await until(() => onCode.mock.calls.length > 0, 'the lone barcode to be accepted')
    expect(onCode).toHaveBeenCalledWith('8901030865278', 'ean_13')
    engine.stop()
  })

  it('does not accept a lone barcode before the collection window is up', async () => {
    // The whole reason the picker was being skipped: deciding too early.
    g.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['ean_13']) }
      detect() { return Promise.resolve([{ rawValue: 'ONLY-ONE', format: 'ean_13', boundingBox: box(0) }]) }
    }
    const onCode = jest.fn()
    const engine = await startDecoding(fakeStream(), tickingVideo(), { onCode })
    await new Promise((r) => setTimeout(r, 120))
    expect(onCode).not.toHaveBeenCalled()
    engine.stop()
  })

  it('resumes scanning when the picker is dismissed', async () => {
    const video = tickingVideo()
    g.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['code_128']) }
      detect() {
        return Promise.resolve([
          { rawValue: 'A', format: 'code_128', boundingBox: box(0) },
          { rawValue: 'B', format: 'code_128', boundingBox: box(60) },
        ])
      }
    }
    const engine = await startDecoding(fakeStream(), video, { onCode: jest.fn(), onCandidates: jest.fn() })
    await new Promise((r) => setTimeout(r, 150))

    expect(engine.resume).toBeDefined()
    engine.resume!()
    // Plays again rather than re-opening the camera, which would black the
    // preview and re-run the engine handshake for nothing.
    expect((video as any).play).toHaveBeenCalledTimes(2)
    engine.stop()
  })
})

describe('the torch', () => {
  it('is not offered when the camera cannot do it', () => {
    const track = { ...fakeTrack(), getCapabilities: () => ({}) }
    expect(torchSupported({ getVideoTracks: () => [track] } as any)).toBe(false)
  })

  it('is not offered when the browser has no getCapabilities at all', () => {
    expect(torchSupported({ getVideoTracks: () => [fakeTrack()] } as any)).toBe(false)
  })

  it('is offered when the camera reports a torch', () => {
    const track = { ...fakeTrack(), getCapabilities: () => ({ torch: true }) }
    expect(torchSupported({ getVideoTracks: () => [track] } as any)).toBe(true)
  })

  it('turns on only when asked, and can be turned back off', async () => {
    const applyConstraints = jest.fn().mockResolvedValue(undefined)
    const stream = { getVideoTracks: () => [{ applyConstraints }] } as any

    await setTorch(stream, true)
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] })

    await setTorch(stream, false)
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] })
  })
})
