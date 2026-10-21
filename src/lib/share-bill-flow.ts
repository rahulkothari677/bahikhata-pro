/**
 * Sending a saved bill to the customer on WhatsApp — the whole flow, with its
 * messages. Phase 6d moved it here from the bill screen (TransactionDetail),
 * because the Counter's "Saved" sheet sends the same bill the same way: one
 * flow, so the two can never send different files or say different things.
 */
import { toast as sonnerToast } from 'sonner'
import { offlineFetch } from '@/lib/offline-fetch'
import { resolveInvoiceDesign } from '@/lib/invoice-presets'
import { invoiceShopFromSetting } from '@/lib/invoice-document'

export async function shareBillOnWhatsApp(txn: { id: string } & Record<string, unknown>, setting: any, override?: 'image' | 'pdf'): Promise<void> {
  const toastId = sonnerToast.loading('Preparing bill…')
  try {
    const { sendBill } = await import('@/lib/send-bill')
    const result = await sendBill(
      // Phase 3: the shop's payment window rides along with the bill, so the
      // WhatsApp copy carries the same due date as the download.
      { ...(txn as object), dueDays: setting?.invoiceDueDays } as never,
      // 📄 Phase 4: the same mapper the download uses. These two once drifted
      // apart — the picture honoured a setting the file ignored — and sharing
      // the mapper is what stops that happening a second time.
      invoiceShopFromSetting(setting),
      {
        preference: setting?.docSendFormat,
        override,
        themeId: setting?.invoiceTheme,
        // The layout and the sheet the shopkeeper chose, so the file that
        // reaches the customer is the one the preview showed them.
        templateId: resolveInvoiceDesign(setting).layout.id,
        // 🐛 2026-08-16: the WhatsApp path had the same hole as the download
        // path one function above — layout passed, style dropped.
        styleId: resolveInvoiceDesign(setting).style.id,
        paperId: setting?.invoicePaperSize,
      },
    )

    /*
     * On a DESKTOP browser there is no share sheet, so `sendBill` falls back
     * to downloading the file — which leaves the shopkeeper with a bill and
     * no WhatsApp. This opens the conversation with the customer's number
     * prefilled so they only have to attach it.
     *
     * 🔒 Kept from the code this replaced, including its audit fix:
     * `offlineFetch` RESOLVES on a 4xx/5xx, so a server rejection used to
     * produce an error body with no `whatsappUrl` and this did nothing at
     * all — the file had downloaded and said so, leaving the user believing
     * the bill was sent when WhatsApp never opened. Say it plainly instead.
     */
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform() && !navigator.canShare) {
      const r = await offlineFetch('/api/whatsapp-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txn.id }),
      })
      const data = await r.json().catch(() => ({}) as Record<string, string>)
      if (r.ok && data.whatsappUrl) {
        window.open(data.whatsappUrl, '_blank')
      } else {
        sonnerToast.warning('Invoice saved, but WhatsApp could not be opened', {
          description: data?.message || data?.error || 'Share the downloaded file manually.',
          duration: 8000,
        })
      }
    }

    // Naming the choice, so a switch between a picture and a PDF never reads
    // as the app being unpredictable.
    sonnerToast.success(result.reason || 'Bill ready to send', {
      id: toastId,
      // Named rather than left silent: without a UPI id the bill goes out
      // with no way to pay it, and nothing else would tell him why.
      description: result.missingUpiId
        ? 'Add your UPI ID in Settings so customers can pay straight from the bill.'
        : undefined,
      duration: result.missingUpiId ? 7000 : 4000,
    })
  } catch (err: unknown) {
    const { isShareCancelled } = await import('@/lib/share-file')
    if (isShareCancelled(err)) {
      sonnerToast.dismiss(toastId)
      return
    }
    sonnerToast.error("Couldn't share the invoice", {
      description: String((err as Error)?.message || err).slice(0, 200),
      id: toastId,
      duration: 8000,
    })
  }
}
