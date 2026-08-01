/**
 * Business Card Design Registry — 10 distinct, premium layouts.
 *
 * 🎨 REBUILT 2026-07-29. The previous registry claimed ten designs but varied
 * only COLOUR: seven of the ten used `layout: 'classic'`, so the gallery read as
 * one card in ten colourways. Rahul spotted that immediately. STRUCTURE is what
 * makes a card look designed; colour alone reads as a theme picker.
 *
 * WHAT MAKES THESE READ AS PREMIUM — the rules every design here follows:
 *
 *  1. MUTED PALETTES. Real letterpress and metal cards are bone, ink, oxblood,
 *     graphite, brass. Saturated orange-to-red gradients read as a free
 *     template — the fastest way to look cheap is maximum chroma.
 *  2. TYPOGRAPHIC HIERARCHY. The shop name is large with TIGHT tracking; labels
 *     are tiny, uppercase, WIDE tracking, low contrast. The distance between
 *     those two extremes is most of the effect, and it costs nothing.
 *  3. RESTRAINT. A good card is mostly empty. At most one decorative gesture.
 *  4. HAIRLINES, not borders. 1px at 20–40% opacity reads as engraving; a 2px
 *     solid border reads as a <div>.
 *  5. MATERIAL. A whisper of grain or weave stops a flat fill looking like CSS.
 *
 * Every design declares a LOGO SLOT, and some are built around it — `emblem` is
 * meaningless without a logo. That is why the uploader belongs ON the card
 * rather than buried in a settings form (where it lived until today, at line
 * 628 of Settings.tsx, which is why Rahul could not find it).
 *
 * Design IDs are stable and stored in Setting.cardDesign. NEVER change or reuse
 * one — append instead. An id that stops resolving silently returns every user
 * who chose it to the default.
 */

/** Structural arrangement. This is what actually differentiates the designs. */
export type CardLayout =
  | 'classic'      // name left, QR right — the traditional arrangement
  | 'left-bar'     // solid spine down the left third, content to its right
  | 'diagonal'     // two tones split on a diagonal
  | 'emblem'       // logo large and centred, name beneath — logo is the hero
  | 'framed'       // inset hairline frame, wide margin, formal
  | 'top-band'     // colour band across the top, details on the body below
  | 'minimal'      // type only, one hairline rule, maximum whitespace
  | 'portrait'     // vertical orientation, centred stack
  | 'corner'       // one bold corner wedge, the rest left quiet
  | 'full-bleed'   // pattern fills the card, text sits on a scrim

/** Where the shop logo sits. Each layout has one natural home for it. */
export type LogoSlot =
  | 'top-left'
  | 'top-center'
  | 'center-hero'      // 2x size — the design is built around it
  | 'in-band'
  | 'in-spine'
  | 'inline'           // beside the name, wordmark-style
  | 'bottom-right'
  | 'corner-opposite'

export type SurfaceTexture = 'none' | 'grain' | 'linen' | 'sheen'

export interface BusinessCardDesign {
  /** Stable unique ID (stored in Setting.cardDesign). Never change. */
  id: string
  name: string
  /** One line, shown under the name in the picker. Says who it suits. */
  description: string
  /** Small gradient/solid for the picker thumbnail. */
  previewGradient: string

  layout: CardLayout
  /** Main card surface — solid or gradient CSS. */
  background: string
  /** Secondary surface: the spine, band, wedge or diagonal half, per layout. */
  accentSurface?: string
  texture: SurfaceTexture

  /** Ink. `ruleColor` is for hairlines; `accentColor` for the single highlight. */
  primaryTextColor: string
  secondaryTextColor: string
  labelTextColor: string
  ruleColor: string
  accentColor: string

  fontFamily: 'sans' | 'serif' | 'mono'
  nameSize: 'lg' | 'xl' | '2xl'
  nameTracking: 'tight' | 'normal' | 'wide'
  /** Uppercase micro-labels ("PROPRIETOR"). The main premium tell. */
  showLabels: boolean

  logoSlot: LogoSlot
  qrBgColor: string
  qrFgColor: string
  /** `framed` draws a hairline box around the QR; `tinted` sits it on accent. */
  qrStyle: 'plain' | 'framed' | 'tinted'

  isDark: boolean
}

export const BUSINESS_CARD_DESIGNS: BusinessCardDesign[] = [
  {
    id: 'ivory-letterpress',
    name: 'Ivory Letterpress',
    description: 'Bone stock, charcoal ink, engraved hairline frame. The printed classic.',
    previewGradient: 'linear-gradient(160deg, #FBF9F4 0%, #F1EDE3 100%)',
    layout: 'framed',
    background: 'linear-gradient(160deg, #FBF9F4 0%, #F1EDE3 100%)',
    texture: 'linen',
    primaryTextColor: '#1C1917',
    secondaryTextColor: '#57534E',
    labelTextColor: '#A8A29E',
    ruleColor: 'rgba(28, 25, 23, 0.18)',
    accentColor: '#8A6A3B',
    fontFamily: 'serif',
    nameSize: 'xl',
    nameTracking: 'tight',
    showLabels: true,
    logoSlot: 'top-center',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#1C1917',
    qrStyle: 'framed',
    isDark: false,
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Matte black, fine grain, a single brass rule. Understated luxury.',
    previewGradient: 'linear-gradient(150deg, #17171A 0%, #0B0B0D 100%)',
    layout: 'classic',
    background: 'linear-gradient(150deg, #17171A 0%, #0B0B0D 100%)',
    texture: 'grain',
    primaryTextColor: '#F5F3EF',
    secondaryTextColor: 'rgba(245, 243, 239, 0.72)',
    labelTextColor: 'rgba(197, 165, 114, 0.85)',
    ruleColor: 'rgba(197, 165, 114, 0.45)',
    accentColor: '#C5A572',
    fontFamily: 'sans',
    nameSize: '2xl',
    nameTracking: 'tight',
    showLabels: true,
    logoSlot: 'top-left',
    qrBgColor: '#F5F3EF',
    qrFgColor: '#0B0B0D',
    qrStyle: 'plain',
    isDark: true,
  },
  {
    id: 'indigo-brass',
    name: 'Indigo & Brass',
    description: 'Deep ink navy band with brass rules and small caps. Formal, warm.',
    previewGradient: 'linear-gradient(180deg, #1E2A44 0%, #1E2A44 38%, #FAF9F6 38%, #FAF9F6 100%)',
    layout: 'top-band',
    background: '#FAF9F6',
    accentSurface: 'linear-gradient(150deg, #23304D 0%, #141D31 100%)',
    texture: 'none',
    primaryTextColor: '#141D31',
    secondaryTextColor: '#4A5568',
    labelTextColor: '#9AA1AE',
    ruleColor: 'rgba(176, 141, 87, 0.5)',
    accentColor: '#B08D57',
    fontFamily: 'serif',
    nameSize: 'xl',
    nameTracking: 'normal',
    showLabels: true,
    logoSlot: 'in-band',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#141D31',
    qrStyle: 'framed',
    isDark: false,
  },
  {
    id: 'bone-minimal',
    name: 'Bone Minimal',
    description: 'Type and one rule. Nothing else. For those who need no decoration.',
    previewGradient: 'linear-gradient(180deg, #FFFFFF 0%, #F7F7F5 100%)',
    layout: 'minimal',
    background: 'linear-gradient(180deg, #FFFFFF 0%, #F7F7F5 100%)',
    texture: 'none',
    primaryTextColor: '#111111',
    secondaryTextColor: '#6B6B6B',
    labelTextColor: '#B4B4B4',
    ruleColor: 'rgba(17, 17, 17, 0.14)',
    accentColor: '#111111',
    fontFamily: 'sans',
    nameSize: '2xl',
    nameTracking: 'tight',
    showLabels: false,
    logoSlot: 'inline',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#111111',
    qrStyle: 'plain',
    isDark: false,
  },
  {
    id: 'oxblood-spine',
    name: 'Oxblood Spine',
    description: 'A deep burgundy spine against cream. Strong without shouting.',
    previewGradient: 'linear-gradient(90deg, #5B1A22 0%, #5B1A22 34%, #FBF8F3 34%, #FBF8F3 100%)',
    layout: 'left-bar',
    background: '#FBF8F3',
    accentSurface: 'linear-gradient(180deg, #6B2028 0%, #4A141B 100%)',
    texture: 'none',
    primaryTextColor: '#2A1518',
    secondaryTextColor: '#6B5B5D',
    labelTextColor: '#A89496',
    ruleColor: 'rgba(107, 32, 40, 0.22)',
    accentColor: '#6B2028',
    fontFamily: 'serif',
    nameSize: 'xl',
    nameTracking: 'normal',
    showLabels: true,
    logoSlot: 'in-spine',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#4A141B',
    qrStyle: 'framed',
    isDark: false,
  },
  {
    id: 'forest-emblem',
    name: 'Forest Emblem',
    description: 'Your logo, large and centred, ringed in gold. Built for a strong mark.',
    previewGradient: 'linear-gradient(160deg, #17352B 0%, #0E2019 100%)',
    layout: 'emblem',
    background: 'linear-gradient(160deg, #17352B 0%, #0E2019 100%)',
    texture: 'sheen',
    primaryTextColor: '#F2F5F1',
    secondaryTextColor: 'rgba(242, 245, 241, 0.7)',
    labelTextColor: 'rgba(200, 169, 106, 0.85)',
    ruleColor: 'rgba(200, 169, 106, 0.4)',
    accentColor: '#C8A96A',
    fontFamily: 'serif',
    nameSize: 'xl',
    nameTracking: 'wide',
    showLabels: true,
    logoSlot: 'center-hero',
    qrBgColor: '#F2F5F1',
    qrFgColor: '#0E2019',
    qrStyle: 'plain',
    isDark: true,
  },
  {
    id: 'graphite-diagonal',
    name: 'Graphite Diagonal',
    description: 'Two greys cut on a diagonal. Architectural and modern.',
    previewGradient: 'linear-gradient(115deg, #2E3238 0%, #2E3238 48%, #4A5058 48%, #4A5058 100%)',
    layout: 'diagonal',
    background: '#24272C',
    accentSurface: 'linear-gradient(135deg, #454B54 0%, #363B42 100%)',
    texture: 'grain',
    primaryTextColor: '#F4F5F6',
    secondaryTextColor: 'rgba(244, 245, 246, 0.7)',
    labelTextColor: 'rgba(244, 245, 246, 0.45)',
    ruleColor: 'rgba(244, 245, 246, 0.2)',
    accentColor: '#8FB8C9',
    fontFamily: 'sans',
    nameSize: '2xl',
    nameTracking: 'tight',
    showLabels: false,
    logoSlot: 'top-left',
    qrBgColor: '#F4F5F6',
    qrFgColor: '#24272C',
    qrStyle: 'plain',
    isDark: true,
  },
  {
    id: 'terracotta-band',
    name: 'Terracotta',
    description: 'A warm clay band on bone. Indian warmth, kept sophisticated.',
    previewGradient: 'linear-gradient(180deg, #B4532A 0%, #B4532A 38%, #FDF9F4 38%, #FDF9F4 100%)',
    layout: 'top-band',
    background: '#FDF9F4',
    accentSurface: 'linear-gradient(135deg, #C25E33 0%, #9E4423 100%)',
    texture: 'none',
    primaryTextColor: '#2B1A12',
    secondaryTextColor: '#6D584C',
    labelTextColor: '#A9948A',
    ruleColor: 'rgba(158, 68, 35, 0.25)',
    accentColor: '#9E4423',
    fontFamily: 'sans',
    nameSize: 'xl',
    nameTracking: 'normal',
    showLabels: true,
    logoSlot: 'in-band',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#9E4423',
    qrStyle: 'framed',
    isDark: false,
  },
  {
    id: 'midnight-portrait',
    name: 'Midnight Portrait',
    description: 'A vertical card with a centred stack. Stands out in a stack of horizontals.',
    previewGradient: 'linear-gradient(170deg, #191B33 0%, #0D0E1C 100%)',
    layout: 'portrait',
    background: 'linear-gradient(170deg, #191B33 0%, #0D0E1C 100%)',
    texture: 'sheen',
    primaryTextColor: '#EDEEF5',
    secondaryTextColor: 'rgba(237, 238, 245, 0.68)',
    labelTextColor: 'rgba(140, 150, 210, 0.8)',
    ruleColor: 'rgba(140, 150, 210, 0.3)',
    accentColor: '#8C96D2',
    fontFamily: 'sans',
    nameSize: 'xl',
    nameTracking: 'wide',
    showLabels: true,
    logoSlot: 'top-center',
    qrBgColor: '#EDEEF5',
    qrFgColor: '#0D0E1C',
    qrStyle: 'plain',
    isDark: true,
  },
  {
    id: 'teal-corner',
    name: 'Teal Corner',
    description: 'One deep-teal wedge, the rest left quiet. Confident restraint.',
    previewGradient: 'linear-gradient(135deg, #0E4F52 0%, #0E4F52 30%, #FFFFFF 30%, #FFFFFF 100%)',
    layout: 'corner',
    background: '#FFFFFF',
    accentSurface: 'linear-gradient(135deg, #125C60 0%, #0A3E41 100%)',
    texture: 'none',
    primaryTextColor: '#0A2325',
    secondaryTextColor: '#5A6B6C',
    labelTextColor: '#9DACAD',
    ruleColor: 'rgba(18, 92, 96, 0.22)',
    accentColor: '#125C60',
    fontFamily: 'sans',
    nameSize: 'xl',
    nameTracking: 'tight',
    showLabels: true,
    logoSlot: 'corner-opposite',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#0A3E41',
    qrStyle: 'framed',
    isDark: false,
  },
]

/** Shown when a user has never chosen a design. */
export const DEFAULT_CARD_DESIGN_ID = 'ivory-letterpress'

/**
 * Resolve a stored design id, falling back to the default.
 *
 * Never throws. Stored ids outlive registry edits, and a card that fails to
 * render is worse than a card in an unexpected style.
 */
export function getCardDesign(designId: string | null | undefined): BusinessCardDesign {
  if (designId) {
    const design = BUSINESS_CARD_DESIGNS.find(d => d.id === designId)
    if (design) return design
  }
  return (
    BUSINESS_CARD_DESIGNS.find(d => d.id === DEFAULT_CARD_DESIGN_ID) ??
    BUSINESS_CARD_DESIGNS[0]
  )
}

/**
 * Generate a URL-safe slug from a shop name.
 * e.g. "Sharma Kirana Store" → "sharma-kirana-store-a1b2c3"
 *
 * The random suffix is deliberate: two shops with the same name must not
 * collide on the public card URL.
 */
export function generateCardSlug(shopName: string): string {
  const base = shopName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // remove special chars
    .replace(/\s+/g, '-') // spaces to hyphens
    .replace(/-+/g, '-') // collapse multiple hyphens
    .replace(/^-|-$/g, '') // trim leading/trailing hyphens
    || 'my-shop' // fallback if empty

  const suffix = Math.random().toString(36).substring(2, 8)
  return `${base}-${suffix}`
}

/**
 * CSS for the material texture overlay, kept here so designs stay declarative.
 *
 * Applied as an absolutely-positioned layer above the background and below the
 * content — never on the content itself, or the text inherits the blend mode
 * and turns muddy.
 */
export function textureStyle(texture: SurfaceTexture, isDark: boolean): React.CSSProperties {
  switch (texture) {
    case 'grain':
      // Fine noise wash. Stops a flat fill looking like a coloured div.
      return {
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
        opacity: isDark ? 0.16 : 0.07,
        mixBlendMode: isDark ? 'overlay' : 'multiply',
      }
    case 'linen':
      // Crosshatch weave, like uncoated paper stock.
      return {
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(0,0,0,0.035) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(0,0,0,0.035) 0 1px, transparent 1px 3px)',
        opacity: 1,
      }
    case 'sheen':
      // One soft highlight sweeping from the top-left, as light falls on a
      // coated card held at an angle.
      return {
        backgroundImage:
          'radial-gradient(120% 80% at 15% 0%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 55%)',
        opacity: 1,
      }
    default:
      return { display: 'none' }
  }
}
