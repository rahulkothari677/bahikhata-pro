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
  function tickingVideo(maxFrames = 60) {
    const el = document.createElement('video') as any
    let frames = 0
    el.play = jest.fn().mockResolvedValue(undefined)
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
    await new Promise((r) => setTimeout(r, 120))

    // The whole point: taking found[0] would be a silent coin-flip between a
    // product code and a courier code.
    expect(onCode).not.toHaveBeenCalled()
    expect(onCandidates).toHaveBeenCalled()
    const offered = onCandidates.mock.calls.at(-1)![0]
    expect(offered.map((c: any) => c.value)).toEqual(['PRODUCT-1', 'COURIER-2'])
    engine.stop()
  })

  it('still accepts a lone barcode automatically, which is the fast path', async () => {
    g.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['ean_13']) }
      detect() { return Promise.resolve([{ rawValue: '8901030865278', format: 'ean_13', boundingBox: box(0) }]) }
    }
    const onCode = jest.fn()
    const engine = await startDecoding(fakeStream(), tickingVideo(), { onCode })
    await new Promise((r) => setTimeout(r, 120))
    expect(onCode).toHaveBeenCalledWith('8901030865278', 'ean_13')
    engine.stop()
  })

  it('waits for a lone code to repeat before accepting it', async () => {
    // Two codes on a box do not always resolve on the same frame. Accepting the
    // instant one appears would close the scanner before the second was seen,
    // so the picker would rarely appear on the very labels that need it.
    let frame = 0
    g.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['code_128']) }
      detect() {
        frame++
        return Promise.resolve(frame === 1
          ? [{ rawValue: 'FIRST', format: 'code_128', boundingBox: box(0) }]
          : [
              { rawValue: 'FIRST', format: 'code_128', boundingBox: box(0) },
              { rawValue: 'SECOND', format: 'code_128', boundingBox: box(200) },
            ])
      }
    }
    const onCode = jest.fn()
    const onCandidates = jest.fn()
    const engine = await startDecoding(fakeStream(), tickingVideo(), { onCode, onCandidates })
    await new Promise((r) => setTimeout(r, 120))

    expect(onCode).not.toHaveBeenCalled()
    expect(onCandidates).toHaveBeenCalled()
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
