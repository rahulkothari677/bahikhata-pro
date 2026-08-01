/**
 * Card templates — artwork as IMAGES, with live text composited on top.
 *
 * 🎨 THE CORRECTION (2026-07-29). I spent two attempts trying to DRAW card
 * artwork in code: first minimal letterpress, then hand-authored SVG scenes.
 * Rahul rejected both, and he was right to. Nobody builds template galleries
 * that way — Canva, Vyapar and myBillBook all ship artwork a designer made
 * once, as a flat image, and paint live text over it. Redrawing photography
 * with <path> data is a losing game.
 *
 * So a template is: ONE BACKGROUND IMAGE + a spec saying where the text goes.
 *
 * WHY THE TEXT IS NOT PART OF THE IMAGE:
 *   - every shopkeeper needs their own name, phone, GSTIN
 *   - text drawn by the browser stays sharp at any zoom and in a printed PDF,
 *     where text baked into a JPEG turns to mush
 *   - the user can edit it, which is the whole point
 *   - one artwork serves every shop in that category
 *
 * ADDING A TEMPLATE IS ADDING ONE ENTRY HERE. No code changes. Drop the image
 * in public/card-templates/ (or upload to Cloudinary and paste the URL), add
 * the object, done. See docs/CARD-ARTWORK-BRIEF.md for the generation spec —
 * dimensions, safe zones, and the prompt structure.
 */

/** Where a block of content sits, as a percentage of the card. */
export interface Zone {
  /** Left edge, % of card width. */
  x: number
  /** Top edge, % of card height. */
  y: number
  /** Width, % of card width. Text wraps/truncates inside this. */
  w: number
  align?: 'left' | 'center' | 'right'
}

export interface CardTemplate {
  /** Stable id, stored in Setting.cardDesign. Never change or reuse. */
  id: string
  name: string
  /** Shown in the picker so a shopkeeper can find their trade. */
  category:
    | 'general' | 'grocery' | 'pharmacy' | 'gifts' | 'textile'
    | 'hardware' | 'food' | 'services' | 'festive' | 'patriotic'
  description: string

  /**
   * Background artwork. 1050×600 (3.5×2in at 300dpi) with NO TEXT.
   * Either a bundled path or a full Cloudinary URL.
   */
  image: string
  /** Shown while the artwork loads, and behind it if it ever fails. */
  fallbackColor: string

  /** Card aspect. Nearly all business cards are 1.75; portrait is 0.7. */
  aspect: number

  /** Ink chosen to read against THIS artwork — not a generic palette. */
  ink: {
    primary: string
    secondary: string
    label: string
    accent: string
  }

  /** Composition. Every zone is optional except `shopName`. */
  zones: {
    /**
     * The logo slot.
     *
     * `style: 'typographic'` draws the monogram as bare letters in the card's
     * ink — no badge, no fill. That is what Rahul's reference cards do, and it
     * is the more expensive-looking of the two by a distance: a filled coloured
     * square reads as an app avatar, while letterforms sitting directly on the
     * paper read as a printed mark.
     *
     * `style: 'badge'` fills a shape with the accent colour. Use it only where
     * the artwork behind the slot is too busy for bare letters to hold.
     */
    logo?: Zone & {
      size: number
      shape: 'square' | 'circle' | 'rounded'
      style?: 'badge' | 'typographic'
      /** Typographic only. Serif suits formal artwork; script suits floral. */
      font?: 'serif' | 'sans' | 'script'
      /** Typographic only — overrides ink.primary for the letters. */
      color?: string
    }
    shopName: Zone
    tagline?: Zone
    ownerName?: Zone
    /** A hairline above the designation, as in both reference cards. */
    divider?: Zone
    contact?: Zone
    gstin?: Zone
    qr?: Zone & { size: number }
  }

  /**
   * Contact rows carry small icons in both reference cards, and they do a lot
   * of work — they let a reader find the phone number without reading. Off by
   * default because a minimal template should not have them forced on.
   */
  contactIcons?: {
    /** 'plain' draws the glyph alone; 'circle' sets it on a filled disc. */
    style: 'plain' | 'circle'
    color: string
    /** Circle style only. */
    background?: string
    /** A vertical hairline between icon and text, as in the gold card. */
    divider?: boolean
  }

  /** True when the artwork is dark where the text sits — drives QR contrast. */
  darkText: boolean
}

/**
 * The shipped set.
 *
 * ⚠️ EMPTY UNTIL THE ARTWORK EXISTS. Deliberately not seeded with placeholders:
 * a gallery of grey boxes is worse than an honest empty state, and a template
 * pointing at a missing image renders as a broken card in a shopkeeper's hand.
 *
 * `hasTemplates()` lets the UI fall back to the built-in vector designs until
 * real artwork is added, so the app never shows an empty picker.
 */
export const CARD_TEMPLATES: CardTemplate[] = [
  /**
   * Artwork + reference render supplied by Rahul, 2026-07-29.
   *
   * Cream folded-paper left half for the identity block, charcoal hexagonal
   * panel on the right for contacts, gold edges throughout. Zone coordinates
   * are read off his render so the live text lands where the designed text sat.
   */
  {
    id: 'gold-fold',
    name: 'Gold Fold',
    category: 'general',
    description: 'Folded ivory and gold with a charcoal panel. Finance, consultants, jewellers.',
    image: '/card-templates/gold-fold.jpg',
    // Shows while the artwork loads, and stays if it ever fails to. Matched to
    // the cream half, because that is where the text sits — a wrong fallback
    // would make the name unreadable in exactly that moment.
    fallbackColor: '#EFE7D8',
    aspect: 1.5,
    ink: {
      primary: '#23252B',
      // Contact text sits on the DARK panel, so it must be near-white — not a
      // mid grey derived from the primary ink.
      secondary: '#F2EDE3',
      label: '#C6A05C',
      accent: '#C6A05C',
    },
    zones: {
      // Bare serif letters on the paper, no badge — as in the render.
      logo: { x: 12, y: 12, w: 26, size: 26, shape: 'square', style: 'typographic', font: 'serif' },
      divider: { x: 10, y: 47, w: 30 },
      shopName: { x: 6, y: 51, w: 40, align: 'center' },
      ownerName: { x: 6, y: 60, w: 40, align: 'center' },
      contact: { x: 53, y: 38, w: 44 },
    },
    contactIcons: { style: 'plain', color: '#C6A05C', divider: true },
    darkText: false,
  },

  /**
   * Watercolour blush with a floral branch top-right. Same identity-left,
   * contacts-right structure, but the contact icons sit on filled discs and the
   * monogram is script rather than serif.
   */
  {
    id: 'blush-botanical',
    name: 'Blush Botanical',
    category: 'gifts',
    description: 'Soft watercolour and gold leaf. Boutiques, gifts, salons, florists.',
    image: '/card-templates/blush-botanical.jpg',
    fallbackColor: '#FBF3EC',
    aspect: 1.5,
    ink: {
      primary: '#2A2A2C',
      // Contacts sit on the pale watercolour here, so this stays a dark ink.
      secondary: '#4A4145',
      label: '#B08290',
      accent: '#B0616F',
    },
    zones: {
      logo: { x: 13, y: 25, w: 24, size: 24, shape: 'square', style: 'typographic', font: 'script', color: '#A85A63' },
      shopName: { x: 6, y: 55, w: 42, align: 'center' },
      divider: { x: 12, y: 65, w: 30 },
      ownerName: { x: 6, y: 67, w: 42, align: 'center' },
      contact: { x: 56, y: 46, w: 40 },
    },
    contactIcons: { style: 'circle', color: '#FFFFFF', background: '#C98894', divider: true },
    darkText: false,
  },
]

export function hasTemplates(): boolean {
  return CARD_TEMPLATES.length > 0
}

export function getTemplate(id: string | null | undefined): CardTemplate | null {
  if (!id) return null
  return CARD_TEMPLATES.find(t => t.id === id) ?? null
}

/** Categories that actually have artwork, for the picker's filter chips. */
export function availableCategories(): CardTemplate['category'][] {
  return [...new Set(CARD_TEMPLATES.map(t => t.category))]
}

/**
 * The artwork spec, exported so the brief and the code cannot drift apart.
 * If these numbers change, docs/CARD-ARTWORK-BRIEF.md must change with them.
 */
export const ARTWORK_SPEC = {
  /** 3.5 x 2 inches at 300dpi — the standard Indian business card, print-ready. */
  width: 1050,
  height: 600,
  /** Nothing important within 3mm of the edge; printers trim into it. */
  bleedPercent: 4,
  /**
   * Keep the left ~55% visually calm. That is where the shop name, owner and
   * contact lines land, and text over a busy photo is unreadable at card size.
   */
  textSafeLeftPercent: 55,
  format: 'JPEG (photographic) or PNG (flat colour / transparency)',
  maxFileSizeKb: 220,
} as const
