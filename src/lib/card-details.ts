/**
 * Resolves what actually gets printed on the business card.
 *
 * 🐛 2026-08-04. Rahul reported the card showing the wrong email. It was
 * reading `session.user.email` — the address you SIGN IN with — while Settings
 * has had its own editable Email field all along. A shopkeeper who signs in
 * with a personal Gmail and puts the shop's address in Settings got the
 * personal one printed on every card they shared.
 *
 * That bug is a symptom of a missing decision: nothing owned the question of
 * where a card field comes from, so each caller answered it differently. This
 * module is the single answer. Everything that renders a card — the account
 * screen, the PNG export, the public /card/[slug] page — resolves through here,
 * so they cannot disagree about what the shopkeeper's own card says.
 *
 * THE PRECEDENCE, highest first:
 *   1. the card's own value, when the shopkeeper chose manual entry
 *   2. the profile (Settings)
 *   3. for email only, the sign-in address — a last resort so the card is not
 *      blank for someone who never filled the profile in
 */

import type { TemplateCardData } from '@/components/common/TemplateCard'

/** The subset of Setting this needs. Loose so callers can pass the whole row. */
export interface CardSettingLike {
  shopName?: string | null
  ownerName?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  gstin?: string | null
  logoUrl?: string | null
  cardMode?: string | null
  cardMark?: string | null
  cardFontId?: string | null
  cardShopFontId?: string | null
  cardTaglineFontId?: string | null
  cardContactFontId?: string | null
  cardShopName?: string | null
  cardOwnerName?: string | null
  cardTagline?: string | null
  cardPhone?: string | null
  cardEmail?: string | null
  cardAddress?: string | null
  cardGstin?: string | null
}

/** The fields the editor exposes, in the order it shows them. */
export const CARD_FIELDS = [
  'shopName',
  'ownerName',
  'tagline',
  'phone',
  'email',
  'address',
  'gstin',
] as const

export type CardField = (typeof CARD_FIELDS)[number]

/** `cardShopName` from `shopName`. Kept in one place so the two never drift. */
export function cardColumn(field: CardField): keyof CardSettingLike {
  return `card${field[0].toUpperCase()}${field.slice(1)}` as keyof CardSettingLike
}

/** Treats whitespace as empty — a field of spaces should fall through, not print. */
function value(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/**
 * What the profile would put on the card. This is also what the editor shows
 * greyed out in "pre-filled from profile" mode, so the shopkeeper can see the
 * values they are about to override before they override them.
 */
export function profileCardValues(
  setting: CardSettingLike,
  sessionEmail?: string | null,
): Record<CardField, string | null> {
  return {
    shopName: value(setting.shopName),
    ownerName: value(setting.ownerName),
    // The profile has no tagline — it is a card-only idea, so in profile mode
    // there is simply nothing to inherit.
    tagline: null,
    phone: value(setting.phone),
    // Setting.email FIRST, sign-in address only as a fallback. This is the fix.
    email: value(setting.email) ?? value(sessionEmail),
    address: value(setting.address),
    gstin: value(setting.gstin),
  }
}

/**
 * The final values for the card.
 *
 * In 'manual' mode a card field wins ONLY when it has been filled in; a blank
 * one still falls back to the profile. That matters because switching to manual
 * must never blank the card: the shopkeeper flips the toggle to change one
 * line, and the other six keep working.
 */
export function resolveCardValues(
  setting: CardSettingLike,
  sessionEmail?: string | null,
): Record<CardField, string | null> {
  const profile = profileCardValues(setting, sessionEmail)
  if (setting.cardMode !== 'manual') return profile

  const out = { ...profile }
  for (const field of CARD_FIELDS) {
    const own = value(setting[cardColumn(field)])
    if (own !== null) out[field] = own
  }
  return out
}

/** Ready to hand straight to TemplateCard or the canvas renderer. */
export function resolveCardData(
  setting: CardSettingLike,
  sessionEmail?: string | null,
): TemplateCardData {
  const v = resolveCardValues(setting, sessionEmail)
  return {
    shopName: v.shopName,
    ownerName: v.ownerName,
    tagline: v.tagline,
    phone: v.phone,
    email: v.email,
    address: v.address,
    gstin: v.gstin,
    logoUrl: resolveCardLogo(setting),
    // One face per element. null means "keep the app's default for this part",
    // which is why these are not funnelled through a getter that substitutes a
    // default — for everything but the logo, unset is a real answer.
    monogramFontId: setting.cardFontId ?? null,
    shopFontId: setting.cardShopFontId ?? null,
    taglineFontId: setting.cardTaglineFontId ?? null,
    contactFontId: setting.cardContactFontId ?? null,
  }
}

/**
 * The logo to PRINT ON THE CARD — which is not the same question as "does this
 * shop have a logo".
 *
 * `Setting.logoUrl` is shared with the invoice PDF. A shopkeeper who prefers
 * their initials on a visiting card must not have to delete the file to get
 * them, so the card's choice is its own setting and returns null here while
 * leaving the upload untouched.
 */
export function resolveCardLogo(setting: CardSettingLike): string | null {
  const logo = value(setting.logoUrl)
  if (setting.cardMark === 'monogram') return null
  // 'logo' with nothing uploaded still falls back to the initials — the card is
  // never allowed to render an empty mark.
  return logo
}

/** True when the card will draw the derived initials rather than a logo. */
export function cardShowsMonogram(setting: CardSettingLike): boolean {
  return resolveCardLogo(setting) === null
}

/** The four font columns, keyed by the target the editor shows. */
export const CARD_FONT_COLUMNS = {
  logo: 'cardFontId',
  shopName: 'cardShopFontId',
  tagline: 'cardTaglineFontId',
  contact: 'cardContactFontId',
} as const
