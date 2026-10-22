/**
 * Phase 6e: telling a barcode gun from a person (final design plan §5: "The
 * Counter opens with the cursor in Add; the gun works anywhere").
 *
 * A USB/Bluetooth gun is a keyboard: it types the code very fast, then Enter.
 * A person types far slower. So keys arriving within MAX_GAP_MS of each other
 * build a burst; Enter after a burst of MIN_LENGTH or more is a scan. A slow
 * key starts a new burst, so a person's typing never becomes a scan.
 *
 * Used only when no text box has the cursor — typing in the customer or price
 * box stays typing. (The product search box takes the gun itself: Enter there
 * already looks the code up.)
 */
export const MAX_GAP_MS = 50
export const MIN_LENGTH = 4

export interface ScanBuffer {
  /** Feed one key; returns the scanned code when this key ends a scan, else null. */
  push(key: string, atMs: number): string | null
  reset(): void
}

export function createScanBuffer(maxGapMs = MAX_GAP_MS, minLength = MIN_LENGTH): ScanBuffer {
  let chars = ''
  let last = -Infinity
  return {
    push(key, atMs) {
      const gap = atMs - last
      last = atMs
      if (key === 'Enter') {
        const code = gap <= maxGapMs && chars.length >= minLength ? chars : null
        chars = ''
        return code
      }
      if (key.length !== 1) { chars = ''; return null } // Shift, F-keys, arrows: not part of a code
      chars = gap <= maxGapMs ? chars + key : key
      return null
    },
    reset() { chars = ''; last = -Infinity },
  }
}
