'use client'

/**
 * Card artwork — the illustrated scenes that make a card feel designed rather
 * than styled.
 *
 * 🎨 NEW 2026-07-29. Rahul's references were rich, category-specific cards:
 * produce for a grocery, vials and a GMP seal for a pharmacy, diyas and a
 * mandala for Diwali, a tricolour sweep for Independence Day. My first pass
 * was minimal letterpress — the wrong read for this market entirely.
 *
 * WHY VECTOR AND NOT PHOTOGRAPHY:
 *   - it recolours per theme, so one scene serves a whole family of designs
 *   - it stays crisp at any size, including a print-resolution PDF
 *   - it costs kilobytes, not megabytes, on an Indian mobile connection
 *   - it carries no stock-licensing question, which a bundled photo would
 *
 * Each scene fills a shaped region of the card (a curve, a wedge, a band), so
 * the artwork is part of the composition rather than a rectangle pasted on.
 * Every scene takes its palette from the design, so nothing is hardcoded.
 */

export type ArtworkScene =
  | 'none'
  | 'produce'     // grocery, kirana, vegetables
  | 'fruit'       // fruit sellers
  | 'pharmacy'    // chemist, medical
  | 'festive'     // Diwali — diyas, lanterns, mandala
  | 'tricolour'   // patriotic / Independence Day
  | 'gifts'       // gift shops, boutiques
  | 'luxe'        // finance, jewellery — abstract gold flourish
  | 'textile'     // cloth, garments
  | 'hardware'    // tools, electrical, building

export interface ArtworkPalette {
  /** Main artwork colour — usually the design's accent. */
  primary: string
  /** Supporting colour for depth. */
  secondary: string
  /** Highlight / metallic. */
  highlight: string
  /** True when the artwork sits on a dark ground. */
  onDark: boolean
}

interface Props {
  scene: ArtworkScene
  palette: ArtworkPalette
  /** Unique per card instance — SVG ids are global, so they must not collide. */
  uid: string
}

/**
 * The artwork panel. Rendered inside a clipped region by the card layout, so
 * this component only draws — it never positions itself.
 */
export function CardArtwork({ scene, palette, uid }: Props) {
  if (scene === 'none') return null
  const p = palette
  const id = (n: string) => `${uid}-${n}`

  const common = {
    viewBox: '0 0 200 200',
    preserveAspectRatio: 'xMidYMid slice' as const,
    className: 'w-full h-full',
    'aria-hidden': true,
  }

  switch (scene) {
    /* Vegetables in a basket — the kirana / grocery scene. */
    case 'produce':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id={id('bg')} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={p.primary} stopOpacity="0.95" />
              <stop offset="100%" stopColor={p.secondary} stopOpacity="0.95" />
            </linearGradient>
          </defs>
          <rect width="200" height="200" fill={`url(#${id('bg')})`} />
          {/* faint leaf pattern for depth */}
          {[...Array(7)].map((_, i) => (
            <path
              key={i}
              d="M0 0 C 10 -8, 22 -6, 26 4 C 18 12, 6 10, 0 0 Z"
              fill={p.highlight}
              opacity="0.08"
              transform={`translate(${18 + (i % 4) * 48} ${22 + Math.floor(i / 4) * 62}) rotate(${i * 37})`}
            />
          ))}
          {/* basket */}
          <path d="M52 132 L148 132 L138 178 L62 178 Z" fill={p.highlight} opacity="0.9" />
          {[...Array(5)].map((_, i) => (
            <line key={i} x1={64 + i * 18} y1="132" x2={68 + i * 17} y2="178"
              stroke={p.secondary} strokeWidth="2" opacity="0.35" />
          ))}
          <rect x="48" y="126" width="104" height="10" rx="5" fill={p.highlight} />
          {/* produce */}
          <circle cx="76" cy="112" r="20" fill="#D7373A" />
          <circle cx="70" cy="105" r="6" fill="#fff" opacity="0.25" />
          <circle cx="112" cy="108" r="17" fill="#E8A317" />
          <circle cx="140" cy="118" r="14" fill="#7CB342" />
          <ellipse cx="96" cy="96" rx="13" ry="19" fill="#4C8C2B" />
          <path d="M96 78 C 104 68, 116 70, 118 78 C 110 86, 100 84, 96 78 Z" fill="#6FBF3B" />
          <circle cx="128" cy="94" r="10" fill="#C2185B" opacity="0.9" />
        </svg>
      )

    /* Fruit — brighter, rounder, for fruit sellers. */
    case 'fruit':
      return (
        <svg {...common}>
          <defs>
            <radialGradient id={id('bg')} cx="0.7" cy="0.3">
              <stop offset="0%" stopColor={p.highlight} stopOpacity="0.9" />
              <stop offset="100%" stopColor={p.primary} />
            </radialGradient>
          </defs>
          <rect width="200" height="200" fill={`url(#${id('bg')})`} />
          <ellipse cx="100" cy="180" rx="78" ry="16" fill={p.secondary} opacity="0.35" />
          <circle cx="66" cy="120" r="26" fill="#E23E30" />
          <path d="M66 94 q6 -12 16 -14" stroke="#4C8C2B" strokeWidth="4" fill="none" strokeLinecap="round" />
          <circle cx="118" cy="112" r="22" fill="#F2A00F" />
          <circle cx="150" cy="136" r="18" fill="#8BC34A" />
          <circle cx="92" cy="150" r="20" fill="#7B1FA2" opacity="0.85" />
          <circle cx="132" cy="160" r="15" fill="#E5393E" />
          <circle cx="110" cy="88" r="9" fill="#FFEB3B" opacity="0.9" />
        </svg>
      )

    /* Chemist — cross, vials, molecular lattice. Clinical and calm. */
    case 'pharmacy':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id={id('bg')} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={p.primary} />
              <stop offset="100%" stopColor={p.secondary} />
            </linearGradient>
          </defs>
          <rect width="200" height="200" fill={`url(#${id('bg')})`} />
          {/* molecular lattice */}
          <g stroke={p.highlight} strokeWidth="1" opacity="0.22" fill="none">
            {[...Array(4)].map((_, i) => (
              <g key={i} transform={`translate(${16 + i * 46} ${18 + (i % 2) * 30})`}>
                <polygon points="0,10 9,0 22,4 24,17 14,25 2,21" />
                <circle cx="0" cy="10" r="2.5" fill={p.highlight} />
                <circle cx="22" cy="4" r="2.5" fill={p.highlight} />
                <circle cx="14" cy="25" r="2.5" fill={p.highlight} />
              </g>
            ))}
          </g>
          {/* vial */}
          <rect x="86" y="86" width="30" height="66" rx="6" fill={p.highlight} opacity="0.95" />
          <rect x="86" y="104" width="30" height="48" rx="6" fill="#3FA9E0" opacity="0.55" />
          <rect x="82" y="78" width="38" height="14" rx="4" fill="#C7CDD2" />
          <rect x="88" y="70" width="26" height="10" rx="3" fill="#9AA4AC" />
          {/* capsules */}
          <g transform="translate(128 140) rotate(-24)">
            <rect x="0" y="0" width="34" height="15" rx="7.5" fill="#fff" />
            <path d="M17 0 h10 a7.5 7.5 0 0 1 0 15 h-10 z" fill="#2E7FD1" />
          </g>
          <g transform="translate(38 148) rotate(16)">
            <rect x="0" y="0" width="30" height="13" rx="6.5" fill="#fff" />
            <path d="M15 0 h8 a6.5 6.5 0 0 1 0 13 h-8 z" fill="#37B6A9" />
          </g>
          {/* medical cross */}
          <g opacity="0.95">
            <rect x="30" y="34" width="14" height="40" rx="3" fill={p.highlight} />
            <rect x="17" y="47" width="40" height="14" rx="3" fill={p.highlight} />
          </g>
        </svg>
      )

    /* Diwali — diyas, hanging lanterns, mandala. Warm and celebratory. */
    case 'festive':
      return (
        <svg {...common}>
          <defs>
            <radialGradient id={id('glow')} cx="0.5" cy="0.5">
              <stop offset="0%" stopColor="#FFD98A" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#FFD98A" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={id('bg')} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={p.primary} />
              <stop offset="100%" stopColor={p.secondary} />
            </linearGradient>
          </defs>
          <rect width="200" height="200" fill={`url(#${id('bg')})`} />
          {/* mandala */}
          <g stroke={p.highlight} fill="none" opacity="0.28" transform="translate(150 52)">
            <circle r="34" strokeWidth="1" />
            <circle r="25" strokeWidth="1" />
            <circle r="15" strokeWidth="1" />
            {[...Array(12)].map((_, i) => (
              <ellipse key={i} rx="5" ry="16" cy="-24" strokeWidth="1" transform={`rotate(${i * 30})`} />
            ))}
          </g>
          {/* hanging lanterns */}
          {[{ x: 40, y: 24, h: 30 }, { x: 66, y: 16, h: 46 }].map((l, i) => (
            <g key={i}>
              <line x1={l.x} y1="0" x2={l.x} y2={l.y + l.h} stroke={p.highlight} strokeWidth="1" opacity="0.6" />
              <ellipse cx={l.x} cy={l.y + l.h + 10} rx="9" ry="12" fill={p.highlight} opacity="0.92" />
              <circle cx={l.x} cy={l.y + l.h + 10} r="4" fill="#FFD98A" />
            </g>
          ))}
          {/* diyas */}
          {[{ x: 62, y: 168, s: 1 }, { x: 100, y: 158, s: 1.25 }, { x: 140, y: 170, s: 0.95 }].map((d, i) => (
            <g key={i} transform={`translate(${d.x} ${d.y}) scale(${d.s})`}>
              <circle cx="0" cy="-16" r="22" fill={`url(#${id('glow')})`} />
              <path d="M-20 0 q20 16 40 0 q-4 12 -20 12 q-16 0 -20 -12 Z" fill={p.highlight} />
              <ellipse cx="0" cy="0" rx="20" ry="5" fill="#8B5A2B" opacity="0.55" />
              <path d="M0 -4 q5 -9 0 -16 q-5 7 0 16 Z" fill="#FF9A1F" />
              <path d="M0 -7 q3 -5 0 -9 q-3 4 0 9 Z" fill="#FFE082" />
            </g>
          ))}
        </svg>
      )

    /* Tricolour sweep with the chakra. Restrained — this is a flag. */
    case 'tricolour':
      return (
        <svg {...common}>
          <rect width="200" height="200" fill="#FFFFFF" />
          <path d="M0 40 C 60 18, 140 62, 200 34 L200 84 C 140 112, 60 68, 0 90 Z" fill="#FF9933" opacity="0.92" />
          <path d="M0 110 C 60 88, 140 132, 200 104 L200 154 C 140 182, 60 138, 0 160 Z" fill="#138808" opacity="0.92" />
          <g transform="translate(100 100)">
            <circle r="27" fill="#FFFFFF" stroke="#000080" strokeWidth="2.5" />
            <circle r="4" fill="#000080" />
            {[...Array(24)].map((_, i) => (
              <line key={i} x1="0" y1="0" x2="0" y2="-25" stroke="#000080" strokeWidth="1.1"
                transform={`rotate(${i * 15})`} />
            ))}
          </g>
        </svg>
      )

    /* Gift boxes and ribbon. Soft, warm, celebratory. */
    case 'gifts':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id={id('bg')} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={p.primary} />
              <stop offset="100%" stopColor={p.secondary} />
            </linearGradient>
          </defs>
          <rect width="200" height="200" fill={`url(#${id('bg')})`} />
          {[...Array(9)].map((_, i) => (
            <circle key={i} cx={20 + (i % 3) * 70} cy={26 + Math.floor(i / 3) * 62} r="2.5"
              fill={p.highlight} opacity="0.35" />
          ))}
          {/* large box */}
          <rect x="66" y="104" width="70" height="60" rx="5" fill={p.highlight} />
          <rect x="96" y="104" width="12" height="60" fill={p.secondary} opacity="0.75" />
          <rect x="66" y="126" width="70" height="11" fill={p.secondary} opacity="0.75" />
          <path d="M102 104 q-22 -18 -8 -26 q12 -6 8 26 Z" fill={p.secondary} opacity="0.85" />
          <path d="M102 104 q22 -18 8 -26 q-12 -6 -8 26 Z" fill={p.secondary} opacity="0.85" />
          {/* small box */}
          <rect x="134" y="128" width="44" height="38" rx="4" fill={p.highlight} opacity="0.85" />
          <rect x="152" y="128" width="8" height="38" fill={p.primary} opacity="0.5" />
          {/* rose */}
          <g transform="translate(42 138)">
            <circle r="13" fill={p.highlight} opacity="0.9" />
            <circle r="8" fill={p.secondary} opacity="0.55" />
            <circle r="3.5" fill={p.highlight} />
          </g>
        </svg>
      )

    /* Abstract gold flourish — finance, jewellery, professional services. */
    case 'luxe':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id={id('gold')} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={p.highlight} />
              <stop offset="45%" stopColor={p.primary} />
              <stop offset="100%" stopColor={p.highlight} />
            </linearGradient>
            <linearGradient id={id('bg')} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={p.secondary} />
              <stop offset="100%" stopColor={p.primary} stopOpacity="0.35" />
            </linearGradient>
          </defs>
          <rect width="200" height="200" fill={`url(#${id('bg')})`} />
          {/* engine-turned guilloche lines */}
          <g stroke={p.highlight} fill="none" opacity="0.3">
            {[...Array(14)].map((_, i) => (
              <path key={i} d={`M${-10 + i * 6} 0 C ${40 + i * 5} 60, ${10 + i * 5} 140, ${70 + i * 5} 200`} strokeWidth="0.9" />
            ))}
          </g>
          {/* gold sweep */}
          <path d="M118 0 C 150 60, 96 130, 138 200 L200 200 L200 0 Z" fill={`url(#${id('gold')})`} />
          {/* halftone dots over the sweep */}
          <g fill={p.secondary} opacity="0.35">
            {[...Array(48)].map((_, i) => {
              const c = i % 8, r = Math.floor(i / 8)
              return <circle key={i} cx={150 + c * 7} cy={14 + r * 27} r={0.8 + (c % 4) * 0.5} />
            })}
          </g>
          <path d="M118 0 C 150 60, 96 130, 138 200" stroke={p.highlight} strokeWidth="1.4" fill="none" />
        </svg>
      )

    /* Folded cloth / weave — garment and textile shops. */
    case 'textile':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id={id('bg')} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={p.primary} />
              <stop offset="100%" stopColor={p.secondary} />
            </linearGradient>
          </defs>
          <rect width="200" height="200" fill={`url(#${id('bg')})`} />
          <g opacity="0.5">
            {[...Array(9)].map((_, i) => (
              <path key={i} d={`M0 ${20 + i * 22} Q 50 ${4 + i * 22}, 100 ${20 + i * 22} T 200 ${20 + i * 22}`}
                stroke={p.highlight} strokeWidth="2.2" fill="none" opacity={0.25 + (i % 3) * 0.16} />
            ))}
          </g>
          <g transform="translate(100 118)">
            <path d="M-46 0 q46 -34 92 0 q-46 22 -92 0 Z" fill={p.highlight} opacity="0.92" />
            <path d="M-38 14 q38 -28 76 0 q-38 20 -76 0 Z" fill={p.secondary} opacity="0.8" />
            <path d="M-28 28 q28 -22 56 0 q-28 16 -56 0 Z" fill={p.highlight} opacity="0.75" />
          </g>
        </svg>
      )

    /* Tools — hardware, electrical, building supplies. */
    case 'hardware':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id={id('bg')} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={p.primary} />
              <stop offset="100%" stopColor={p.secondary} />
            </linearGradient>
          </defs>
          <rect width="200" height="200" fill={`url(#${id('bg')})`} />
          {/* gear */}
          <g transform="translate(146 56)" fill={p.highlight} opacity="0.28">
            <circle r="26" />
            {[...Array(8)].map((_, i) => (
              <rect key={i} x="-4" y="-36" width="8" height="12" transform={`rotate(${i * 45})`} />
            ))}
            <circle r="11" fill={p.primary} />
          </g>
          {/* wrench */}
          <g transform="translate(62 132) rotate(-38)" fill={p.highlight}>
            <rect x="-5" y="-46" width="10" height="82" rx="4" />
            <path d="M-13 -60 a14 14 0 1 0 26 0 l-7 8 h-12 z" />
          </g>
          {/* screwdriver */}
          <g transform="translate(128 140) rotate(28)">
            <rect x="-4" y="-10" width="8" height="52" rx="2" fill={p.highlight} opacity="0.9" />
            <rect x="-8" y="-34" width="16" height="26" rx="5" fill={p.secondary} />
            <rect x="-4" y="42" width="8" height="7" fill={p.highlight} />
          </g>
        </svg>
      )

    default:
      return null
  }
}
