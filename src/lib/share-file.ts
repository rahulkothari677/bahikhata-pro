/**
 * Hands a generated file to the user — natively on Android, as a download on
 * the web.
 *
 * 🐛 2026-08-04, second report. The card export was rebuilt to produce a real
 * PNG and it did: verified in a browser, 2100×1400, correct in every typeface.
 * On Rahul's phone nothing happened at all — no share sheet, no saved file, and
 * WhatsApp still received plain text.
 *
 * The card code used `navigator.share`, `navigator.canShare` and an `<a
 * download>` click. All three are BROWSER APIs. EkBook ships as a Capacitor app
 * whose WebView has none of them: `canShare` is undefined, so the share path
 * was skipped silently, and `<a download>.click()` in a WebView does nothing at
 * all — no error, no file. Every fallback led somewhere that quietly did
 * nothing, and the WhatsApp button's last resort was the wa.me text link, which
 * is exactly the "it shares as text" symptom that started this.
 *
 * Verifying in a browser could never have caught it. The app is a browser
 * there; the whole failure is that it is not one on his phone.
 *
 * The native path is the one this app already uses for invoice PDFs
 * (TransactionDetail) and CSV exports (csv-export): write the bytes into the
 * app's cache directory, then hand the file's URI to the system share sheet.
 * That is what opens "all share option of my mobile" — WhatsApp, Gmail, Drive,
 * Files — with a real image attached rather than a line of text.
 */

import { Capacitor } from '@capacitor/core'

/** Blob → base64 without the data: prefix, which is what Filesystem wants. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = () => reject(new Error('Could not read the generated file.'))
    reader.readAsDataURL(blob)
  })
}

/** True when the user dismissed the share sheet — not a failure. */
export function isShareCancelled(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null
  const msg = String(e?.message || '').toLowerCase()
  return e?.name === 'AbortError' || msg.includes('cancel') || msg.includes('abort')
}

/**
 * Opens the system share sheet with `blob` attached, or downloads it on the web.
 *
 * `text` rides along as the message body. It is a CAPTION, never a substitute:
 * the whole point of this rewrite is that the recipient gets the picture.
 */
export async function shareBlobFile(
  blob: Blob,
  filename: string,
  opts: { title?: string; text?: string; dialogTitle?: string } = {},
): Promise<'shared' | 'downloaded'> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')

    const file = await Filesystem.writeFile({
      path: filename,
      data: await toBase64(blob),
      // Cache, not Documents: this is a file the user is about to send, not
      // one the app is keeping. Android clears it when space is needed, and it
      // needs no storage permission.
      directory: Directory.Cache,
      recursive: true,
    })

    await Share.share({
      title: opts.title,
      text: opts.text,
      url: file.uri,
      dialogTitle: opts.dialogTitle ?? 'Share your card',
    })
    return 'shared'
  }

  // Web share sheets exist on some desktop browsers and most mobile ones, and
  // they are nicer than a download when present. `canShare` must be CHECKED
  // rather than assumed: several browsers expose `share` but reject files, and
  // calling it with an unsupported payload throws instead of degrading.
  const shareFile = typeof File !== 'undefined' ? new File([blob], filename, { type: blob.type }) : null
  if (shareFile && navigator.canShare?.({ files: [shareFile] })) {
    await navigator.share({ files: [shareFile], title: opts.title, text: opts.text })
    return 'shared'
  }

  downloadBlob(blob, filename)
  return 'downloaded'
}

/**
 * Saves `blob` to the device, without a share sheet.
 *
 * On Android the file still goes through the share sheet — a WebView cannot
 * write to the user's Downloads folder directly, and a "saved" file the user
 * cannot find is worse than one they chose the destination for.
 */
export async function saveBlobFile(blob: Blob, filename: string, title?: string): Promise<'shared' | 'downloaded'> {
  if (Capacitor.isNativePlatform()) {
    return await shareBlobFile(blob, filename, { title, dialogTitle: 'Save your card' })
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}

/** Browser download. Does nothing useful inside a Capacitor WebView. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = filename
  link.href = url
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
