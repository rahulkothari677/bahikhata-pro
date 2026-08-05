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

  /**
   * Ink chosen to read against THIS artwork — not a generic palette.
   *
   * ⚠️ `contact` EXISTS BECAUSE ONE PALETTE CANNOT SERVE TWO GROUNDS. In Gold
   * Fold the name sits on cream while the contact rows sit on a charcoal panel.
   * Before this field existed, the designation inherited the near-white contact
   * colour and rendered cream-on-cream — invisible. Caught by measuring the
   * rendered colours against their positions, not by reading the code.
   *
   * When the whole card has one ground, leave `contact` unset and it falls back
   * to `secondary`.
   */
  ink: {
    /** Shop name, monogram. */
    primary: string
    /** Owner and designation — whatever ground the IDENTITY block sits on. */
    secondary: string
    /** Contact rows. Defaults to `secondary` when the card has one ground. */
    contact?: string
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
      /**
       * Suggested monogram typeface for this artwork. The USER's choice wins;
       * this is only the starting point. See lib/monogram-fonts for the ten.
       */
      suggestedFontId?: string
      /** Typographic only — overrides ink.primary for the letters. */
      color?: string
    }
    shopName: Zone
    /**
     * A line under the shop name — "Trust · Quality · Since 1998".
     *
     * `color` overrides `ink.accent`. It exists because Gold Fold's accent is
     * the gold used for its rules, and gold on cream at tagline size measures
     * about 2:1 contrast — fine for a hairline, unreadable as text.
     */
    tagline?: Zone & { color?: string }
    /**
     * Owner name, with the designation stacked beneath it.
     *
     * An earlier version put both on ONE line ("Rahul Kothari · Proprietor") to
     * save vertical space. That made the line long enough to truncate — and the
     * thing it cut was the person's own name, which is the last thing that
     * should go. Two short lines fit where one long one does not; the room came
     * from shrinking the monogram instead.
     */
    ownerName?: Zone
    /**
     * Ornamental rule above the shop name: a line, a small diamond, a line.
     * Rahul's reference uses exactly this — it is what stops the left half
     * reading as two unrelated things stacked up.
     */
    divider?: Zone
    /** Plain closing rule beneath the shop name, as in the reference. */
    dividerBottom?: Zone
    /**
     * The contact block.
     *
     * 🎨 2026-08-05. The first two templates had no icons in the artwork, so the
     * card DREW them. The eight Rahul sent next have the icons — person, phone,
     * mail, location, GST — printed into the image itself, with ruled lines
     * beside them. For those, drawing our own would double every glyph.
     *
     * So: leave `contactIcons` unset and the card draws none, and set
     * `rowPitch` to the spacing the ARTWORK uses so the text lands on the
     * printed rows rather than near them. Both numbers come from measuring the
     * image, never from guessing — see docs/CARD-ARTWORK-BRIEF.md.
     */
    contact?: Zone & {
      /**
       * Distance between row CENTRES, in cqw, taken from the artwork.
       *
       * ⚠️ When this is set, `y` is the centre of the FIRST ROW, not the top of
       * the block. Aligning to a printed icon means matching its centre line,
       * and a block top would have to be back-computed from the text size —
       * which changes with the shop's name length.
       */
      rowPitch?: number
      /**
       * Adds GSTIN as a final contact row. The eight artworks print a GST icon
       * alongside the other four, so on those cards the number belongs in the
       * list rather than off in its own corner.
       */
      withGstin?: boolean
    }
    /** `color` overrides `ink.label` — see `tagline`. */
    gstin?: Zone & { color?: string }
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
      // The identity block sits on CREAM, so this stays dark. It rendered
      // cream-on-cream until `contact` was split out.
      secondary: '#4A4740',
      // Contact rows sit on the DARK charcoal panel.
      contact: '#F2EDE3',
      label: '#C6A05C',
      accent: '#C6A05C',
    },
    zones: {
      // Bare serif letters on the paper, no badge — as in the render.
      // LEFT half carries ONLY the mark and the shop name, so the monogram can
      // be large enough to actually read as a logo. Cramming the owner and
      // designation in here too is what forced it down to a size where the
      // chosen typeface was indistinguishable.
      // y=19, not 16. At 16 the mark floated 6% above the ornamental rule;
      // Rahul's reference leaves ~3%, which reads as one composed block rather
      // than a logo and a name that happen to share a side.
      logo: { x: 10, y: 19, w: 28, size: 25, shape: 'square', style: 'typographic' },
      divider: { x: 12, y: 46, w: 24 },
      shopName: { x: 3, y: 50.5, w: 42, align: 'center' },

      dividerBottom: { x: 18, y: 62.5, w: 12 },
      // Under the closing rule, on the cream. Positions here were MEASURED off
      // the artwork rather than guessed: this strip reads mean luminance 209
      // with sd 29, while y71 dips to a minimum of 3 where a fold edge cuts
      // across — text there would sit half on cream and half on shadow.
      // Charcoal rather than the gold accent, which is a 2:1 contrast on cream.
      tagline: { x: 5, y: 64.5, w: 34, align: 'center', color: '#4A4740' },

      // RIGHT panel: person first, then how to reach them.
      contact: { x: 53, y: 30, w: 44 },
      // Below the four contact rows, which end near y70. Mean luminance 38 with
      // sd 5 — the calmest area on the card, and gold on charcoal is legible.
      gstin: { x: 55, y: 71, w: 40 },
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
      // One ground across the whole card, so `contact` is deliberately unset
      // and falls back to this.
      secondary: '#4A4145',
      label: '#B08290',
      accent: '#B0616F',
    },
    zones: {
      logo: { x: 11, y: 25, w: 26, size: 24, shape: 'square', style: 'typographic', color: '#A85A63' },
      divider: { x: 13, y: 51.5, w: 22 },
      shopName: { x: 3, y: 55.5, w: 42, align: 'center' },

      dividerBottom: { x: 18, y: 67.5, w: 12 },
      // Measured: mean luminance 230, sd 24. y75 is calmer still but leaves the
      // line floating away from the rule it belongs to.
      tagline: { x: 5, y: 69.5, w: 38, align: 'center' },

      // The floral branch fills the top-right, so the identity starts below it.
      contact: { x: 55, y: 38, w: 42 },
      // Contacts end near y78. Measured at y81: mean 234, sd 13, minimum 156 —
      // no dark speck anywhere in the strip. y84 dips to 47 where the lower
      // watercolour wash begins.
      gstin: { x: 55, y: 81, w: 40 },
    },
    contactIcons: { style: 'circle', color: '#FFFFFF', background: '#C98894', divider: true },
    darkText: false,
  },

  /*
   * ── The eight Rahul sent on 2026-08-05 ────────────────────────────────
   *
   * These differ from the first two in one structural way: THE CONTACT ICONS
   * ARE PART OF THE ARTWORK — a person, phone, envelope, pin and a GST sheet,
   * printed in a column with ruled lines beside them. So `contactIcons` is left
   * unset (the card draws none of its own) and each `contact` zone carries the
   * artwork's own `rowPitch`, with `y` on the FIRST icon's centre line.
   *
   * Every number below was MEASURED off the image, not chosen: the icon centres
   * came from a connected-components pass over the gradient map, and the text
   * widths from scanning rightward along each row until the background stops
   * matching. Guessing these by eye is what cost three rounds on the first card.
   */
  {
    id: 'noir-marble',
    name: 'Noir Marble',
    category: 'general',
    description: 'Black silk and gold beside white marble. Jewellers, consultants, premium retail.',
    image: '/card-templates/noir-marble.jpg',
    fallbackColor: '#F2EFE9',
    aspect: 1.5,
    ink: {
      primary: '#F4ECDC',
      secondary: '#E4D9C2',
      // The contact rows sit on the WHITE MARBLE half, so they invert.
      contact: '#2B2721',
      label: '#C8A34E',
      accent: '#C8A34E',
    },
    zones: {
      logo: { x: 6, y: 12, w: 40, size: 22, shape: 'square', style: 'typographic' },
      // The artwork's own gold ornament sits at y ~45 and does the work a drawn
      // divider would, so this card has none of its own.
      // y50, not 46: the ornament sits at y~45 and the name was landing ON it.
      // y50: this card's gap is set by the ARTWORK's ornament at y~45 rather
      // than by a drawn divider, and at 48 the name touched it.
      shopName: { x: 5, y: 50, w: 42, align: 'center' },
      contact: { x: 63, y: 23.5, w: 30, rowPitch: 9.12, withGstin: true },
    },
    darkText: true,
  },
  {
    id: 'onyx-chevron',
    name: 'Onyx Chevron',
    category: 'general',
    description: 'Textured black with a gold chevron. Hardware, automotive, wholesale.',
    image: '/card-templates/onyx-chevron.jpg',
    fallbackColor: '#141414',
    aspect: 1.5,
    ink: {
      primary: '#F0E6CE',
      secondary: '#D8CBA8',
      contact: '#EFE4C6',
      label: '#C9A24E',
      accent: '#C9A24E',
    },
    zones: {
      logo: { x: 5, y: 14, w: 40, size: 22, shape: 'square', style: 'typographic' },
      divider: { x: 12, y: 41, w: 26 },
      shopName: { x: 4, y: 45, w: 42, align: 'center' },
      tagline: { x: 6, y: 57, w: 38, align: 'center' },
      contact: { x: 61.5, y: 23.3, w: 34, rowPitch: 8.65, withGstin: true },
    },
    darkText: false,
  },
  {
    id: 'midnight-minimal',
    name: 'Midnight',
    category: 'services',
    description: 'All black with a silver arc. Architects, designers, luxury services.',
    image: '/card-templates/midnight-minimal.jpg',
    fallbackColor: '#101010',
    aspect: 1.5,
    ink: {
      primary: '#EDEDED',
      secondary: '#C9C9C9',
      contact: '#DCDCDC',
      label: '#9C9C9C',
      accent: '#B4B4B4',
    },
    zones: {
      logo: { x: 5, y: 14, w: 38, size: 21, shape: 'square', style: 'typographic' },
      divider: { x: 11, y: 41, w: 26 },
      shopName: { x: 3, y: 45, w: 42, align: 'center' },
      tagline: { x: 5, y: 57, w: 38, align: 'center' },
      // Rows 1 and 2 are hemmed in by the artwork's short divider dashes, so
      // the text starts just past them.
      contact: { x: 62.5, y: 22.1, w: 33, rowPitch: 9.3, withGstin: true },
    },
    darkText: false,
  },
  {
    id: 'rose-marble',
    name: 'Rose Marble',
    category: 'gifts',
    description: 'Blush marble with pressed florals. Boutiques, salons, florists, bakers.',
    image: '/card-templates/rose-marble.jpg',
    fallbackColor: '#F7E9E4',
    aspect: 1.5,
    ink: {
      primary: '#8A544D',
      secondary: '#A0706A',
      contact: '#7E4F49',
      label: '#B2837A',
      accent: '#C08A78',
    },
    zones: {
      logo: { x: 10, y: 14, w: 36, size: 21, shape: 'square', style: 'typographic' },
      divider: { x: 16, y: 41, w: 24 },
      shopName: { x: 6, y: 45, w: 42, align: 'center' },
      tagline: { x: 8, y: 57, w: 38, align: 'center' },
      contact: { x: 63.5, y: 23.9, w: 33, rowPitch: 8.57, withGstin: true },
    },
    darkText: true,
  },
  {
    id: 'navy-copper',
    name: 'Navy & Copper',
    category: 'services',
    description: 'Deep navy, copper edge and marble. Finance, legal, consultants.',
    image: '/card-templates/navy-copper.jpg',
    fallbackColor: '#F2EDE7',
    aspect: 1.5,
    ink: {
      primary: '#F4F2EE',
      secondary: '#DCD6CC',
      // The rows sit on the marble half.
      contact: '#1E2A42',
      label: '#B87A4E',
      accent: '#C0794A',
    },
    zones: {
      logo: { x: 6, y: 16, w: 36, size: 21, shape: 'square', style: 'typographic' },
      divider: { x: 12, y: 43, w: 24 },
      shopName: { x: 4, y: 47, w: 40, align: 'center' },
      contact: { x: 65.5, y: 29.3, w: 31.5, rowPitch: 8.21, withGstin: true },
    },
    darkText: true,
  },
  {
    id: 'gilded-geometry',
    name: 'Gilded Geometry',
    category: 'hardware',
    description: 'Folded cream, black and gold planes. Builders, engineers, traders.',
    image: '/card-templates/gilded-geometry.jpg',
    fallbackColor: '#EFE6D4',
    aspect: 1.5,
    ink: {
      primary: '#2B2822',
      secondary: '#4A453B',
      contact: '#2B2822',
      label: '#9A7A33',
      accent: '#B08D3F',
    },
    zones: {
      // The artwork's icons start low (y 43.5), so the identity block takes the
      // calm upper left — measured at luminance 220 with sd 3, the flattest
      // area on any of the eight.
      logo: { x: 5, y: 8, w: 38, size: 20, shape: 'square', style: 'typographic' },
      divider: { x: 11, y: 33, w: 26 },
      shopName: { x: 3, y: 37, w: 42, align: 'center' },
      tagline: { x: 5, y: 48, w: 38, align: 'center' },
      contact: { x: 65.8, y: 43.5, w: 30, rowPitch: 7.45, withGstin: true },
    },
    darkText: true,
  },
  {
    id: 'ink-blossom',
    name: 'Ink Blossom',
    category: 'food',
    description: 'Sumi-e ink wash with cherry blossom. Tea, spices, crafts, wellness.',
    image: '/card-templates/ink-blossom.jpg',
    fallbackColor: '#F4F2EC',
    aspect: 1.5,
    ink: {
      primary: '#1E1C19',
      secondary: '#403C36',
      contact: '#23201C',
      label: '#8A5148',
      accent: '#A33A2A',
    },
    zones: {
      // Left of the artwork's vertical brush stroke, which sits at x ~36.
      logo: { x: 3, y: 16, w: 28, size: 19, shape: 'square', style: 'typographic' },
      shopName: { x: 2, y: 42, w: 30, align: 'center' },
      // The narrowest of the eight: the blossom branch crowds row 1 and the
      // enso and mountain crowd the lower rows, leaving ~27% of usable width.
      // Starts as close to the printed icons as their edge allows and stops
      // just short of the enso circle at x~78. Even so this is the tightest
      // line on any of the ten — a long address will still clip here, which is
      // the artwork's constraint rather than the layout's.
      contact: { x: 48.5, y: 28.7, w: 29.5, rowPitch: 7.63, withGstin: true },
    },
    darkText: true,
  },
  {
    id: 'tiranga',
    name: 'Tiranga',
    category: 'patriotic',
    description: 'Tricolour brushwork with the Ashoka Chakra. Independence Day, civic, general.',
    image: '/card-templates/tiranga.jpg',
    fallbackColor: '#F6F1E6',
    aspect: 1.5,
    ink: {
      primary: '#173A6B',
      secondary: '#3A4A63',
      contact: '#1B3055',
      label: '#B8892F',
      accent: '#D48A2A',
    },
    zones: {
      // The ONLY one of the eight with its icons on the LEFT, so the identity
      // block takes the calm cream band across the top (measured 234 / sd 8)
      // rather than the usual opposite half.
      logo: { x: 30, y: 3, w: 20, size: 15, shape: 'square', style: 'typographic' },
      shopName: { x: 52, y: 6, w: 44 },
      tagline: { x: 52, y: 17, w: 44 },
      contact: { x: 15.5, y: 31.7, w: 29.5, rowPitch: 6.63, withGstin: true },
    },
    darkText: true,
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
