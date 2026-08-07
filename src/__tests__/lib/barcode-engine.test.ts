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
import { nativeEngineAvailable, openCamera, startDecoding } from '@/lib/barcode-engine'

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
