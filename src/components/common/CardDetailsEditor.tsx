'use client'

/**
 * The card's own details, editable on the card screen.
 *
 * 🎨 2026-08-04. Rahul: "i want a proper section in business card where the
 * user can fill or edit all the the things. also there should be an option on
 * the top to pre filled from profile or manual entry."
 *
 * WHY THE CARD NEEDS ITS OWN COPY OF THESE FIELDS. Settings holds the shop's
 * LEGAL identity — the name, address and GSTIN that print on a GST invoice. The
 * card is marketing. A shop registered as "SHREE SIDDHIVINAYAK TRADING CO."
 * that trades as "Siddhivinayak Stores" should not have to falsify its invoices
 * to get the trading name on a visiting card, and a shop whose invoices carry a
 * landline may want a mobile on the card. Sending the shopkeeper to Settings to
 * edit the card would have forced exactly that trade.
 *
 * The two modes are a real switch, not a hint:
 *   Pre-filled — the card tracks the profile live. Fix a typo in Settings and
 *     the card fixes itself. Fields here are read-only, but still SHOWN, so the
 *     shopkeeper can see what the card will say before they change anything.
 *   Manual — what is typed here wins. A field left blank still falls back to
 *     the profile, so flipping the toggle never blanks the card.
 *
 * Nothing typed here is ever cleared by switching modes. Someone who sets up a
 * manual card, flips to pre-filled to compare, and flips back must find their
 * work intact — losing it would be the app deleting the user's data, which is
 * the one thing this app does not do.
 */

import { useEffect, useMemo, useState } from 'react'
import { Check, Image as ImageIcon, Loader2, RotateCcw, Type } from 'lucide-react'
import { toast as sonnerToast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ShopLogoUploader } from '@/components/settings/ShopLogoUploader'
import { cn } from '@/lib/utils'
import { offlineFetch } from '@/lib/offline-fetch'
import {
  MONOGRAM_FONTS,
  DEFAULT_MONOGRAM_FONT_ID,
  CARD_FONT_TARGETS,
  CARD_FONT_TARGET_LABELS,
  type CardFontTarget,
} from '@/lib/monogram-fonts'
import { deriveMonogram } from '@/lib/brand-monogram'
import {
  CARD_FIELDS,
  CARD_FONT_COLUMNS,
  cardColumn,
  profileCardValues,
  type CardField,
  type CardSettingLike,
} from '@/lib/card-details'

const LABELS: Record<CardField, string> = {
  shopName: 'Shop name',
  ownerName: 'Your name',
  tagline: 'Tagline',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  gstin: 'GSTIN',
}

const HINTS: Record<CardField, string> = {
  shopName: 'The big name on the card',
  ownerName: 'Shown with a person icon',
  // The one field with no profile equivalent — it exists only on the card, so
  // it says so, otherwise its empty "pre-filled" state looks like a bug.
  tagline: 'Card only — e.g. "Trust · Quality · Since 1998"',
  phone: 'The number customers should call',
  email: '',
  address: 'Keep it short — it prints on one line',
  gstin: 'Optional on a card',
}

const PLACEHOLDERS: Record<CardField, string> = {
  shopName: 'Sharma Kirana Store',
  ownerName: 'Rahul Sharma',
  tagline: 'Your daily grocery partner',
  phone: '+91 98765 43210',
  email: 'shop@example.com',
  address: 'Mumbai, Maharashtra - 400001',
  gstin: '27ABCDE1234F1Z5',
}

interface Props {
  setting: CardSettingLike
  sessionEmail?: string | null
  /** Called after a successful save so the card re-renders with the new text. */
  onSaved?: () => void
  /**
   * Called on EVERY change, with the settings the card should preview.
   *
   * 🎨 2026-08-05. Rahul: "when i click anything it should start to visible
   * directly on cards and not after once i save so the user can preview it
   * instantly." Before this, choosing a typeface or typing a tagline changed
   * nothing until Save — so the shopkeeper was picking blind and pressing Save
   * to find out, which is the wrong way round for a design decision.
   *
   * The card renders these OVER the saved settings. Nothing here is stored
   * until Save; this is a preview, not an autosave, so a shopkeeper can try
   * six typefaces and walk away without having changed their card.
   */
  onPreview?: (draft: Partial<CardSettingLike>) => void
}

type Draft = Record<CardField, string>

/**
 * What each font swatch is set in — the shopkeeper's own words for that part of
 * the card, so the sample shows what they will actually get.
 */
function sampleFor(
  target: CardFontTarget,
  monogram: string,
  draft: Draft,
  profile: Record<CardField, string | null>,
): string {
  const pick = (f: CardField) => draft[f]?.trim() || profile[f] || ''
  if (target === 'logo') return monogram
  if (target === 'shopName') return pick('shopName') || 'My Shop'
  if (target === 'tagline') return pick('tagline') || 'Your tagline'
  return pick('ownerName') || pick('phone') || 'Contact'
}

function draftFrom(setting: CardSettingLike): Draft {
  return CARD_FIELDS.reduce((acc, f) => {
    const v = setting[cardColumn(f)]
    acc[f] = typeof v === 'string' ? v : ''
    return acc
  }, {} as Draft)
}

/** Which mark the card prints. See Setting.cardMark. */
const MARKS = ['auto', 'logo', 'monogram'] as const
type Mark = (typeof MARKS)[number]

type Fonts = Record<CardFontTarget, string | null>

/**
 * Only the LOGO falls back to a default face. For the shop name, tagline and
 * contacts, null means "the app's own type", which is a real choice and the
 * one every existing card is already using.
 */
function fontsFrom(setting: CardSettingLike): Fonts {
  return CARD_FONT_TARGETS.reduce((acc, target) => {
    const v = setting[CARD_FONT_COLUMNS[target]]
    acc[target] = typeof v === 'string' && v ? v : target === 'logo' ? DEFAULT_MONOGRAM_FONT_ID : null
    return acc
  }, {} as Fonts)
}

export function CardDetailsEditor({ setting, sessionEmail, onSaved, onPreview }: Props) {
  const savedMode = setting.cardMode === 'manual' ? 'manual' : 'profile'
  const savedFonts = fontsFrom(setting)

  const savedMark = MARKS.includes(setting.cardMark as Mark) ? (setting.cardMark as Mark) : 'auto'
  const logoUrl = setting.logoUrl ?? null

  const [mode, setMode] = useState<'profile' | 'manual'>(savedMode)
  const [mark, setMark] = useState<Mark>(savedMark)
  const [fonts, setFonts] = useState<Fonts>(savedFonts)

  // What the card will ACTUALLY draw, which is the only thing worth showing as
  // selected. 'auto' is a rule, not a state a shopkeeper should have to reason
  // about — it resolves to the logo when one exists and the letters when not.
  const showsLogo = mark !== 'monogram' && Boolean(logoUrl)
  // Which part of the card the font grid below is changing. Rahul asked for
  // this by name: pick the element first, then the typeface, so choosing a
  // script for the monogram does not also set the address in it.
  const [target, setTarget] = useState<CardFontTarget>('logo')
  const [draftValues, setDraft] = useState<Draft>(() => draftFrom(setting))
  const [saving, setSaving] = useState(false)

  // The settings query refetches after a save, and after a save on ANOTHER
  // device. Re-seeding from the server keeps this form honest about what is
  // actually stored — but only for values the shopkeeper is not mid-edit on,
  // which is why it is keyed on the saved values rather than run on every
  // render of the parent.
  useEffect(() => {
    setDraft(draftFrom(setting))
    setMode(savedMode)
    setMark(savedMark)
    setFonts(fontsFrom(setting))
  }, [
    savedMode,
    savedMark,
    setting.cardFontId,
    setting.cardShopFontId,
    setting.cardTaglineFontId,
    setting.cardContactFontId,
    setting.cardShopName,
    setting.cardOwnerName,
    setting.cardTagline,
    setting.cardPhone,
    setting.cardEmail,
    setting.cardAddress,
    setting.cardGstin,
  ])

  const profile = useMemo(() => profileCardValues(setting, sessionEmail), [setting, sessionEmail])

  /**
   * Push the in-progress state up so the card can show it immediately.
   *
   * Built here rather than in the parent because this component is the only
   * one that knows the shape of an unsaved edit — and it is exactly the payload
   * `save` sends, so what is previewed is what will be stored.
   */
  useEffect(() => {
    if (!onPreview) return
    const draft: Partial<CardSettingLike> = { cardMode: mode, cardMark: mark }
    for (const t of CARD_FONT_TARGETS) {
      ;(draft as Record<string, unknown>)[CARD_FONT_COLUMNS[t]] = fonts[t]
    }
    for (const f of CARD_FIELDS) {
      ;(draft as Record<string, unknown>)[cardColumn(f)] = draftValues[f].trim() === '' ? null : draftValues[f].trim()
    }
    onPreview(draft)
    // `onPreview` is deliberately not a dependency: a parent that passes an
    // inline arrow would otherwise re-fire this on every one of its renders.
  }, [mode, mark, fonts, draftValues])

  const dirty =
    mode !== savedMode ||
    mark !== savedMark ||
    CARD_FONT_TARGETS.some(t => fonts[t] !== savedFonts[t]) ||
    CARD_FIELDS.some(f => (draftValues[f] || '') !== (setting[cardColumn(f)] || ''))

  // The monogram previewed in the font picker must be the one the card will
  // actually draw, so it derives from the same values the card resolves —
  // not from the profile, which in manual mode may be a different shop name.
  const previewMonogram = deriveMonogram(
    mode === 'manual' ? draftValues.shopName || profile.shopName : profile.shopName,
    mode === 'manual' ? draftValues.ownerName || profile.ownerName : profile.ownerName,
  )

  const save = async () => {
    setSaving(true)
    try {
      const body: Record<string, string | null> = { cardMode: mode, cardMark: mark }
      for (const t of CARD_FONT_TARGETS) body[CARD_FONT_COLUMNS[t]] = fonts[t]
      for (const f of CARD_FIELDS) {
        // Empty string is sent as null so the server stores NULL — a blank
        // field means "use the profile", and "" would print an empty line.
        body[cardColumn(f) as string] = draftValues[f].trim() === '' ? null : draftValues[f].trim()
      }
      const res = await offlineFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        offline: { invalidate: ['/api/settings'] },
      })
      if (!res.ok) {
        // The server's own message, not a generic one: it names the field that
        // was rejected, which is the only useful thing to show here.
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.error || `Save failed (${res.status})`)
      }
      sonnerToast.success('Card details saved')
      onSaved?.()
    } catch (err) {
      sonnerToast.error(err instanceof Error ? err.message : 'Could not save your card details')
    } finally {
      setSaving(false)
    }
  }

  const readOnly = mode === 'profile'

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Card details</h3>
        <p className="text-2xs text-muted-foreground mt-0.5">
          What gets printed on your card. Your invoices are not affected.
        </p>
      </div>

      {/* ═══ mode toggle ═══ */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {(
          [
            ['profile', 'Use my profile', 'Follows Settings automatically'],
            ['manual', 'Enter manually', 'Type your own details'],
          ] as const
        ).map(([value, label, sub]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={cn(
              'rounded-lg px-3 py-2 text-left transition',
              mode === value ? 'bg-background shadow-sm' : 'hover:bg-background/50',
            )}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium">
              {mode === value && <Check className="w-3 h-3 text-primary" />}
              {label}
            </span>
            <span className="block text-3xs text-muted-foreground mt-0.5">{sub}</span>
          </button>
        ))}
      </div>

      {/* ═══ fields ═══ */}
      <div className="space-y-3">
        {CARD_FIELDS.map(field => {
          // In pre-filled mode the box shows the PROFILE value, so the
          // shopkeeper sees what the card will say. In manual mode it shows
          // what they typed, with the profile value offered as the placeholder
          // — a blank field falls back to it, and the placeholder says so.
          const shown = readOnly ? profile[field] ?? '' : draftValues[field]
          const fallback = profile[field]
          return (
            <div key={field}>
              <Label htmlFor={`card-${field}`} className="text-2xs text-muted-foreground">
                {LABELS[field]}
              </Label>
              <Input
                id={`card-${field}`}
                value={shown}
                readOnly={readOnly}
                onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}
                placeholder={
                  !readOnly
                    ? fallback || PLACEHOLDERS[field]
                    : // The tagline has no profile equivalent, so "Not set in
                      // Settings" would send the shopkeeper looking for a field
                      // that does not exist.
                      field === 'tagline'
                      ? 'Switch to Enter manually to add one'
                      : 'Not set in Settings'
                }
                inputMode={field === 'phone' ? 'tel' : field === 'email' ? 'email' : 'text'}
                className={cn('mt-1 h-9 text-sm', readOnly && 'bg-muted/60 text-muted-foreground')}
              />
              {!readOnly && HINTS[field] && (
                <p className="text-3xs text-muted-foreground mt-1">{HINTS[field]}</p>
              )}
            </div>
          )
        })}
      </div>

      {readOnly && (
        <p className="text-3xs text-muted-foreground">
          These come from Settings → Profile. Switch to <span className="font-medium">Enter manually</span> to
          put something different on the card.
        </p>
      )}

      {/* ═══ the mark: logo or letters ═══
          One slot, either/or. The artwork leaves room for a single mark with
          the shop name directly beneath it; two would compete for the same eye. */}
      <div className="pt-1">
        <div className="flex items-center gap-1.5 mb-1">
          <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-2xs font-medium">Your mark</p>
        </div>
        <p className="text-3xs text-muted-foreground mb-2">
          The badge at the top of the card — your logo, or your initials.
        </p>

        <div className="grid grid-cols-2 gap-1.5 mb-3">
          <button
            type="button"
            onClick={() => setMark('logo')}
            aria-pressed={showsLogo}
            disabled={!logoUrl}
            className={cn(
              'rounded-lg border px-2.5 py-2 flex items-center gap-2 transition text-left',
              showsLogo
                ? 'border-primary bg-primary/5 ring-1 ring-primary/25'
                : 'border-border/70 hover:border-border',
              !logoUrl && 'opacity-50 cursor-not-allowed',
            )}
          >
            {logoUrl ? (
              <img src={logoUrl} alt="" className="w-7 h-7 object-contain flex-none" />
            ) : (
              <ImageIcon className="w-7 h-7 p-1.5 text-muted-foreground flex-none" />
            )}
            <span className="min-w-0">
              <span className="block text-2xs font-medium">Shop logo</span>
              <span className="block text-3xs text-muted-foreground truncate">
                {logoUrl ? 'Your uploaded logo' : 'Upload one below'}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMark('monogram')}
            aria-pressed={!showsLogo}
            className={cn(
              'rounded-lg border px-2.5 py-2 flex items-center gap-2 transition text-left',
              !showsLogo
                ? 'border-primary bg-primary/5 ring-1 ring-primary/25'
                : 'border-border/70 hover:border-border',
            )}
          >
            {/* text-base, not an arbitrary size — this sample sits beside a
                28px logo thumbnail and has to hold the same weight, and the
                type scale is enforced by a guardrail test. */}
            <span className="w-7 flex-none text-center font-semibold leading-none text-base">
              {previewMonogram}
            </span>
            <span className="min-w-0">
              <span className="block text-2xs font-medium">Letters</span>
              <span className="block text-3xs text-muted-foreground truncate">From your shop name</span>
            </span>
          </button>
        </div>

        {/* The uploader lives HERE, on the card screen, because this is where a
            shopkeeper is looking at their mark and deciding they want a better
            one. It was reachable only from Settings → Profile before, part-way
            down a long form. */}
        <ShopLogoUploader
          logoUrl={logoUrl}
          onLogoChange={url => {
            // The endpoint has already persisted it, so refetch rather than
            // keep a second copy of the truth in this form.
            onSaved?.()
            // A first upload shows on the card immediately — nobody uploads a
            // logo and then wants their initials.
            if (url && mark === 'monogram') setMark('logo')
          }}
        />
        <p className="text-3xs text-muted-foreground mt-1.5">
          Your logo is also used on your invoice PDFs. Choosing{' '}
          <span className="font-medium">Letters</span> changes only this card — the logo stays on your
          invoices.
        </p>
      </div>

      {/* ═══ font picker ═══
          Placed with the details rather than the design gallery on purpose:
          the typeface is a property of the shop's mark, and it must survive
          switching between card designs. */}
      <div className="pt-1">
        <div className="flex items-center gap-1.5 mb-1">
          <Type className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-2xs font-medium">Fonts</p>
        </div>
        <p className="text-3xs text-muted-foreground mb-2">
          Pick the part of the card first, then its font. Each part keeps its own.
        </p>

        {/* ═══ which part of the card ═══ */}
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {CARD_FONT_TARGETS.map(t => {
            const chosen = fonts[t]
            const name = MONOGRAM_FONTS.find(f => f.id === chosen)?.name
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTarget(t)}
                aria-pressed={target === t}
                className={cn(
                  'rounded-lg border px-2.5 py-2 text-left transition',
                  target === t
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/25'
                    : 'border-border/70 hover:border-border',
                )}
              >
                <span className="block text-2xs font-medium">{CARD_FONT_TARGET_LABELS[t]}</span>
                {/* Shows what each part is CURRENTLY set to, so the shopkeeper
                    can see all four choices without clicking through them. */}
                <span className="block text-3xs text-muted-foreground truncate">
                  {name ?? 'App default'}
                </span>
              </button>
            )
          })}
        </div>

        {/* ═══ the font, for the chosen part ═══ */}
        <div className="grid grid-cols-3 gap-2">
          {/* Only the logo must have a face — bare letterforms ARE the logo, so
              "default" is meaningless there. Everything else can go back to the
              app's own type, and needs a way to say so. */}
          {target !== 'logo' && (
            <button
              type="button"
              onClick={() => setFonts(f => ({ ...f, [target]: null }))}
              aria-pressed={fonts[target] === null}
              className={cn(
                'rounded-xl border px-2 py-2.5 transition text-center',
                fonts[target] === null
                  ? 'border-primary ring-2 ring-primary/25 bg-primary/5'
                  : 'border-border/70 hover:border-border',
              )}
            >
              <span className="block leading-none font-semibold" style={{ fontSize: 20 }}>
                {sampleFor(target, previewMonogram, draftValues, profile)}
              </span>
              <span className="block text-3xs text-muted-foreground mt-1.5 truncate">App default</span>
            </button>
          )}
          {MONOGRAM_FONTS.map(f => {
            const active = f.id === fonts[target]
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFonts(prev => ({ ...prev, [target]: f.id }))}
                aria-pressed={active}
                title={f.description}
                className={cn(
                  'rounded-xl border px-2 py-2.5 transition text-center overflow-hidden',
                  active
                    ? 'border-primary ring-2 ring-primary/25 bg-primary/5'
                    : 'border-border/70 hover:border-border',
                )}
              >
                {/* The sample is the shopkeeper's OWN text for that part, not
                    "Aa". A typeface can only be judged on the words it will
                    actually be set in — and their own shop name is the one
                    string they will look at hardest. */}
                <span
                  className="block leading-none truncate"
                  style={{
                    fontFamily: f.fontFamily,
                    fontWeight: f.fontWeight,
                    fontStyle: f.fontStyle,
                    letterSpacing: f.letterSpacing,
                    // Scaled the way the card scales it, so the picker shows the
                    // relative sizes the card will actually produce.
                    fontSize: target === 'logo' ? `${Math.round(22 * f.sizeScale)}px` : '13px',
                  }}
                >
                  {sampleFor(target, previewMonogram, draftValues, profile)}
                </span>
                <span className="block text-3xs text-muted-foreground mt-1.5 truncate">{f.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ═══ save ═══ */}
      <div className="flex items-center gap-2 pt-1">
        <Button onClick={save} disabled={!dirty || saving} size="sm" className="flex-1">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? 'Saving…' : 'Save card details'}
        </Button>
        {dirty && !saving && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(draftFrom(setting))
              setMode(savedMode)
              setMark(savedMark)
              setFonts(fontsFrom(setting))
            }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Undo
          </Button>
        )}
      </div>
    </div>
  )
}
