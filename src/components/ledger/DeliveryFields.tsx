'use client'

/**
 * "Ship to another address" — the delivery state, address and the bill-to-ship-to
 * question (Phase 2c, #114; IGST Act s.10(1)(a)/(b)). ONE block for New Sale and
 * for editing a saved bill (#226, Phase 7g-4b): the edit dialog could not change
 * a bill's delivery at all, so a wrong one meant delete and re-enter.
 *
 * The rules are lib/gst-states.ts (deliveryCheck, resolveStateCode, gstinStateCode),
 * the same ones the server applies; this only draws them.
 */
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { InfoHint } from '@/components/common/InfoHint'
import { StateField } from '@/components/common/StateField'
import { deliveryCheck, gstinStateCode, resolveStateCode, stateNameForCode, type SupplyPlaces } from '@/lib/gst-states'

export function DeliveryFields({
  places,
  partyName,
  shipElsewhere,
  onShipElsewhere,
  deliveryState,
  onDeliveryState,
  deliveryAddress,
  onDeliveryAddress,
  billToShipTo,
  onBillToShipTo,
}: {
  /** As supplyKind takes them; `delivery` is the state in use (null while the switch is off). */
  places: SupplyPlaces
  partyName?: string
  shipElsewhere: boolean
  onShipElsewhere: (on: boolean) => void
  deliveryState: string
  onDeliveryState: (state: string) => void
  deliveryAddress: string
  onDeliveryAddress: (address: string) => void
  billToShipTo: boolean | null
  onBillToShipTo: (answer: boolean) => void
}) {
  const check = deliveryCheck(places)
  const deliveryCode = resolveStateCode(places.delivery)
  const buyerGstinCode = gstinStateCode(places.party?.gstin)
  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <Label htmlFor="field-ship-elsewhere" className="text-sm">Ship to another address</Label>
          <InfoHint
            label="Ship to another address"
            text="For goods sent by courier or transport. GST follows the state the goods are delivered to, and the bill prints the delivery address."
          />
        </div>
        <Switch id="field-ship-elsewhere" checked={shipElsewhere} onCheckedChange={onShipElsewhere} />
      </div>
      {shipElsewhere && (
        <div className="mt-2 space-y-2">
          <div>
            <Label htmlFor="field-delivery-state" className="text-xs">Delivery state</Label>
            <StateField id="field-delivery-state" value={deliveryState} onChange={onDeliveryState} />
          </div>
          <div>
            <Label htmlFor="field-delivery-address" className="text-xs">Delivery address</Label>
            <Input id="field-delivery-address" value={deliveryAddress} onChange={(e) => onDeliveryAddress(e.target.value)} placeholder="Street, city, PIN" maxLength={300} className="mt-1 h-11" />
          </div>
          {check.asksShipTo && (
            <div id="field-ship-to-choice" role="radiogroup" aria-label="Who gets the goods">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-medium">{`Who gets the goods in ${stateNameForCode(deliveryCode)}?`}</p>
                <InfoHint
                  label="Who gets the goods"
                  text={`If ${partyName} asked you to send the goods to their own customer, GST follows ${partyName}’s GST state, ${stateNameForCode(buyerGstinCode)} (bill-to-ship-to). If the goods are for ${partyName}, GST follows the delivery state.`}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <Button type="button" role="radio" aria-checked={billToShipTo === true} variant={billToShipTo === true ? 'default' : 'outline'} className="h-auto min-h-11 py-2 px-2 whitespace-normal leading-tight" onClick={() => onBillToShipTo(true)}>Buyer&apos;s customer</Button>
                <Button type="button" role="radio" aria-checked={billToShipTo === false} variant={billToShipTo === false ? 'default' : 'outline'} className="h-auto min-h-11 py-2 px-2 whitespace-normal leading-tight" onClick={() => onBillToShipTo(false)}>The buyer</Button>
              </div>
              {check.buyerLosesCredit && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  {`${partyName} can’t claim this GST — their GSTIN is from ${stateNameForCode(buyerGstinCode)}.`}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
