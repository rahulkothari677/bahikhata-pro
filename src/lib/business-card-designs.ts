/**
 * 🐛 UI/UX Phase 2: Business Card Design Registry
 *
 * 10 top-notch business card designs for the user to choose from.
 * Each design defines: background, text colors, layout variant, decoration,
 * and font pairing. The designs range from minimal to festive, light to dark,
 * to match different business types and personal preferences.
 *
 * Inspired by: CRED cards, JioBusiness, Vyapar, KhataBook, Canva templates.
 *
 * Design IDs are stable — never change them (stored in Setting.cardDesign).
 * To add a new design: append to the array with a new unique id.
 */

export interface BusinessCardDesign {
  /** Stable unique ID (stored in Setting.cardDesign). Never change. */
  id: string
  /** Display name shown in the picker UI */
  name: string
  /** Short description shown in the picker UI */
  description: string
  /** Preview colors for the picker thumbnail (gradient CSS) */
  previewGradient: string
  /** Card background CSS (gradient or solid) */
  background: string
  /** Text color for primary text (shop name) */
  primaryTextColor: string
  /** Text color for secondary text (owner, phone, etc.) */
  secondaryTextColor: string
  /** Text color for labels (Proprietor:, GSTIN:, etc.) */
  labelTextColor: string
  /** QR code background color (must contrast with foreground) */
  qrBgColor: string
  /** QR code foreground color */
  qrFgColor: string
  /** Layout variant: 'classic' (text left, QR right) | 'centered' (text centered, QR below) | 'split' (top half text, bottom half QR) */
  layout: 'classic' | 'centered' | 'split'
  /** Decoration: 'none' | 'circles' | 'waves' | 'mandala' | 'particles' */
  decoration: 'none' | 'circles' | 'waves' | 'mandala' | 'particles'
  /** Whether the card has a dark background (affects QR code rendering) */
  isDark: boolean
}

export const BUSINESS_CARD_DESIGNS: BusinessCardDesign[] = [
  {
    id: 'saffron-classic',
    name: 'Saffron Classic',
    description: 'Warm Indian saffron gradient with decorative circles. The default.',
    previewGradient: 'linear-gradient(135deg, #FF9933 0%, #D97706 50%, #92400E 100%)',
    background: 'linear-gradient(135deg, #FF9933 0%, #D97706 50%, #92400E 100%)',
    primaryTextColor: '#FFFFFF',
    secondaryTextColor: 'rgba(255, 255, 255, 0.85)',
    labelTextColor: 'rgba(255, 255, 255, 0.7)',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#92400E',
    layout: 'classic',
    decoration: 'circles',
    isDark: true,
  },
  {
    id: 'emerald-elegant',
    name: 'Emerald Elegant',
    description: 'Rich emerald green with subtle wave patterns. Premium feel.',
    previewGradient: 'linear-gradient(135deg, #059669 0%, #047857 50%, #064E3B 100%)',
    background: 'linear-gradient(135deg, #059669 0%, #047857 50%, #064E3B 100%)',
    primaryTextColor: '#FFFFFF',
    secondaryTextColor: 'rgba(255, 255, 255, 0.85)',
    labelTextColor: 'rgba(255, 255, 255, 0.65)',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#064E3B',
    layout: 'classic',
    decoration: 'waves',
    isDark: true,
  },
  {
    id: 'midnight-pro',
    name: 'Midnight Pro',
    description: 'Sleek dark navy with minimal decoration. Modern and professional.',
    previewGradient: 'linear-gradient(135deg, #1E3A8A 0%, #1E293B 50%, #0F172A 100%)',
    background: 'linear-gradient(135deg, #1E3A8A 0%, #1E293B 50%, #0F172A 100%)',
    primaryTextColor: '#FFFFFF',
    secondaryTextColor: 'rgba(255, 255, 255, 0.8)',
    labelTextColor: 'rgba(255, 255, 255, 0.55)',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#0F172A',
    layout: 'classic',
    decoration: 'none',
    isDark: true,
  },
  {
    id: 'royal-violet',
    name: 'Royal Violet',
    description: 'Deep violet with mandala-inspired patterns. Luxurious.',
    previewGradient: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 50%, #4C1D95 100%)',
    background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 50%, #4C1D95 100%)',
    primaryTextColor: '#FFFFFF',
    secondaryTextColor: 'rgba(255, 255, 255, 0.85)',
    labelTextColor: 'rgba(255, 255, 255, 0.6)',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#4C1D95',
    layout: 'classic',
    decoration: 'mandala',
    isDark: true,
  },
  {
    id: 'clean-white',
    name: 'Clean White',
    description: 'Minimal white card with saffron accents. Crisp and modern.',
    previewGradient: 'linear-gradient(135deg, #FFFFFF 0%, #FEF3C7 50%, #FDE68A 100%)',
    background: 'linear-gradient(135deg, #FFFFFF 0%, #FEF3C7 50%, #FDE68A 100%)',
    primaryTextColor: '#1F2937',
    secondaryTextColor: '#4B5563',
    labelTextColor: '#9CA3AF',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#D97706',
    layout: 'classic',
    decoration: 'none',
    isDark: false,
  },
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    description: 'Calming blue gradient with particle decorations. Trustworthy.',
    previewGradient: 'linear-gradient(135deg, #0EA5E9 0%, #0284C7 50%, #0369A1 100%)',
    background: 'linear-gradient(135deg, #0EA5E9 0%, #0284C7 50%, #0369A1 100%)',
    primaryTextColor: '#FFFFFF',
    secondaryTextColor: 'rgba(255, 255, 255, 0.85)',
    labelTextColor: 'rgba(255, 255, 255, 0.6)',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#0369A1',
    layout: 'centered',
    decoration: 'particles',
    isDark: true,
  },
  {
    id: 'rose-gold',
    name: 'Rose Gold',
    description: 'Elegant rose-gold gradient. Perfect for boutiques and salons.',
    previewGradient: 'linear-gradient(135deg, #F472B6 0%, #EC4899 50%, #BE185D 100%)',
    background: 'linear-gradient(135deg, #F472B6 0%, #EC4899 50%, #BE185D 100%)',
    primaryTextColor: '#FFFFFF',
    secondaryTextColor: 'rgba(255, 255, 255, 0.85)',
    labelTextColor: 'rgba(255, 255, 255, 0.65)',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#BE185D',
    layout: 'classic',
    decoration: 'circles',
    isDark: true,
  },
  {
    id: 'charcoal-minimal',
    name: 'Charcoal Minimal',
    description: 'Dark charcoal with no decoration. Ultra-minimal, premium.',
    previewGradient: 'linear-gradient(135deg, #374151 0%, #1F2937 50%, #111827 100%)',
    background: 'linear-gradient(135deg, #374151 0%, #1F2937 50%, #111827 100%)',
    primaryTextColor: '#FFFFFF',
    secondaryTextColor: 'rgba(255, 255, 255, 0.75)',
    labelTextColor: 'rgba(255, 255, 255, 0.5)',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#111827',
    layout: 'split',
    decoration: 'none',
    isDark: true,
  },
  {
    id: 'festive-saffron',
    name: 'Festive Saffron',
    description: 'Vibrant saffron with mandala patterns. Perfect for festivals.',
    previewGradient: 'linear-gradient(135deg, #F59E0B 0%, #D97706 50%, #B45309 100%)',
    background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 50%, #B45309 100%)',
    primaryTextColor: '#FFFFFF',
    secondaryTextColor: 'rgba(255, 255, 255, 0.9)',
    labelTextColor: 'rgba(255, 255, 255, 0.7)',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#B45309',
    layout: 'centered',
    decoration: 'mandala',
    isDark: true,
  },
  {
    id: 'teal-fresh',
    name: 'Teal Fresh',
    description: 'Fresh teal with wave decorations. Clean and energetic.',
    previewGradient: 'linear-gradient(135deg, #14B8A6 0%, #0D9488 50%, #0F766E 100%)',
    background: 'linear-gradient(135deg, #14B8A6 0%, #0D9488 50%, #0F766E 100%)',
    primaryTextColor: '#FFFFFF',
    secondaryTextColor: 'rgba(255, 255, 255, 0.85)',
    labelTextColor: 'rgba(255, 255, 255, 0.6)',
    qrBgColor: '#FFFFFF',
    qrFgColor: '#0F766E',
    layout: 'classic',
    decoration: 'waves',
    isDark: true,
  },
]

/**
 * Get a design by ID. Falls back to the default design if not found.
 */
export function getCardDesign(designId: string | null | undefined): BusinessCardDesign {
  if (designId) {
    const design = BUSINESS_CARD_DESIGNS.find(d => d.id === designId)
    if (design) return design
  }
  return BUSINESS_CARD_DESIGNS[0] // default: saffron-classic
}

/**
 * Generate a URL-safe slug from a shop name.
 * e.g. "Sharma Kirana Store" → "sharma-kirana-store"
 * If the slug is taken, appends a random suffix.
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

  // Add a short random suffix to avoid collisions (6 chars)
  const suffix = Math.random().toString(36).substring(2, 8)
  return `${base}-${suffix}`
}
