#!/usr/bin/env python3
"""
V20-022: WCAG contrast audit for dark mode.

Computes contrast ratios for all semantic color pairs in dark mode.
WCAG AA requirements:
  - Normal text (< 18pt): 4.5:1
  - Large text (>= 18pt or >= 14pt bold): 3:1
  - UI components (borders, icons): 3:1

OKLCH → sRGB → relative luminance → contrast ratio.
"""

import math

def oklch_to_oklab(L, C, H):
    """OKLCH to OKLAB."""
    h_rad = math.radians(H)
    a = C * math.cos(h_rad)
    b = C * math.sin(h_rad)
    return L, a, b

def oklab_to_linear_rgb(L, a, b):
    """OKLAB to linear sRGB."""
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b

    l = l_ ** 3
    m = m_ ** 3
    s = s_ ** 3

    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

    return r, g, bl

def linear_to_srgb(c):
    """Linear to sRGB gamma."""
    if c <= 0.0031308:
        return 12.92 * c
    return 1.055 * (c ** (1/2.4)) - 0.055

def oklch_to_srgb(L, C, H, alpha=1.0):
    """OKLCH to sRGB (0-255)."""
    lab = oklch_to_oklab(L, C, H)
    r, g, b = oklab_to_linear_rgb(*lab)
    r = max(0, min(1, linear_to_srgb(r)))
    g = max(0, min(1, linear_to_srgb(g)))
    b = max(0, min(1, linear_to_srgb(b)))
    return r * 255, g * 255, b * 255, alpha

def relative_luminance(r, g, b, alpha=1.0, bg=(0, 0, 0)):
    """WCAG relative luminance. If alpha < 1, composite over bg."""
    # Composite over background
    r = r * alpha + bg[0] * (1 - alpha)
    g = g * alpha + bg[1] * (1 - alpha)
    b = b * alpha + bg[2] * (1 - alpha)

    # Normalize to 0-1
    r = r / 255
    g = g / 255
    b = b / 255

    # Apply inverse sRGB gamma
    def lin(c):
        if c <= 0.03928:
            return c / 12.92
        return ((c + 0.055) / 1.055) ** 2.4

    R = lin(r)
    G = lin(g)
    B = lin(b)

    return 0.2126 * R + 0.7152 * G + 0.0722 * B

def contrast_ratio(rgb1, rgb2):
    """WCAG contrast ratio between two RGB colors."""
    l1 = relative_luminance(*rgb1[:3])
    l2 = relative_luminance(*rgb2[:3])
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)

def parse_oklch(s):
    """Parse 'oklch(0.7 0.18 42)' or 'oklch(1 0 0 / 10%)' to (L, C, H, alpha)."""
    s = s.replace('oklch(', '').replace(')', '').strip()
    parts = s.split('/')
    main = parts[0].split()
    L = float(main[0])
    C = float(main[1])
    H = float(main[2])
    alpha = 1.0
    if len(parts) > 1:
        alpha_str = parts[1].strip().replace('%', '')
        alpha = float(alpha_str) / 100
    return L, C, H, alpha

# ─── Dark mode color palette (from globals.css .dark {}) ───────────────
dark_palette = {
    'background': 'oklch(0.15 0.01 30)',
    'foreground': 'oklch(0.96 0 0)',
    'card': 'oklch(0.2 0.01 30)',
    'card-foreground': 'oklch(0.96 0 0)',
    'popover': 'oklch(0.2 0.01 30)',
    'popover-foreground': 'oklch(0.96 0 0)',
    'primary': 'oklch(0.7 0.18 42)',
    'primary-foreground': 'oklch(0.15 0.01 30)',
    'secondary': 'oklch(0.26 0.01 30)',
    'secondary-foreground': 'oklch(0.96 0 0)',
    'muted': 'oklch(0.26 0.01 30)',
    'muted-foreground': 'oklch(0.7 0.01 30)',
    'accent': 'oklch(0.3 0.04 145)',
    'accent-foreground': 'oklch(0.96 0 0)',
    'destructive': 'oklch(0.7 0.19 22)',
    'border': 'oklch(1 0 0 / 10%)',
    'input': 'oklch(1 0 0 / 15%)',
    'ring': 'oklch(0.7 0.18 42)',
    'sidebar': 'oklch(0.16 0.01 30)',
    'sidebar-foreground': 'oklch(0.96 0 0)',
    'sidebar-primary': 'oklch(0.7 0.18 42)',
    'sidebar-primary-foreground': 'oklch(0.15 0.01 30)',  # V20-022 fix: was 0.99 0 0
    'sidebar-accent': 'oklch(0.25 0.02 30)',
    'sidebar-accent-foreground': 'oklch(0.96 0 0)',
    'chart-tick': 'oklch(0.7 0.01 30)',
    'chart-tooltip-text': 'oklch(0.96 0 0)',
    'chart-tooltip-bg': 'oklch(0.22 0.01 30)',
}

# Parse all colors
parsed = {}
for name, val in dark_palette.items():
    parsed[name] = parse_oklch(val)

# Convert to sRGB
srgb = {}
for name, (L, C, H, a) in parsed.items():
    srgb[name] = oklch_to_srgb(L, C, H, a)

# ─── Key color pairs to check ──────────────────────────────────────────
# (foreground, background, description, min_ratio_for_AA)
pairs = [
    # Text on backgrounds
    ('foreground', 'background', 'Main text on background', 4.5),
    ('card-foreground', 'card', 'Text on cards', 4.5),
    ('popover-foreground', 'popover', 'Text on popovers', 4.5),
    ('sidebar-foreground', 'sidebar', 'Sidebar text', 4.5),

    # Muted text (secondary info — still needs 4.5:1 for normal text)
    ('muted-foreground', 'background', 'Muted text on background', 4.5),
    ('muted-foreground', 'card', 'Muted text on cards', 4.5),
    ('muted-foreground', 'sidebar', 'Muted text on sidebar', 4.5),

    # Primary color usage
    ('primary', 'background', 'Primary color on background (links, icons)', 3.0),
    ('primary', 'card', 'Primary color on cards', 3.0),
    ('primary-foreground', 'primary', 'Text on primary buttons', 4.5),
    ('sidebar-primary', 'sidebar', 'Sidebar primary on sidebar', 3.0),
    ('sidebar-primary-foreground', 'sidebar-primary', 'Text on sidebar primary', 4.5),

    # Destructive (errors)
    ('destructive', 'background', 'Destructive on background', 3.0),
    ('destructive', 'card', 'Destructive on cards', 3.0),

    # Accent
    ('accent-foreground', 'accent', 'Text on accent', 4.5),

    # Chart text
    ('chart-tick', 'background', 'Chart tick text', 3.0),
    ('chart-tick', 'card', 'Chart tick text on cards', 3.0),
    ('chart-tooltip-text', 'chart-tooltip-bg', 'Chart tooltip text', 4.5),
]

print("=" * 100)
print("V20-022: WCAG Contrast Audit — Dark Mode")
print("=" * 100)
print(f"{'Pair':<55} {'Ratio':>8}  {'Min':>5}  {'Status':<10}")
print("-" * 100)

failures = []
passes = []

for fg_name, bg_name, desc, min_ratio in pairs:
    fg = srgb[fg_name]
    bg = srgb[bg_name]

    # If bg has alpha, composite over the nearest opaque bg
    if bg[3] < 1.0:
        # Composite over card or background
        bg_rgb = (srgb['card'][0], srgb['card'][1], srgb['card'][2])
        bg = (bg[0] * bg[3] + bg_rgb[0] * (1 - bg[3]),
              bg[1] * bg[3] + bg_rgb[1] * (1 - bg[3]),
              bg[2] * bg[3] + bg_rgb[2] * (1 - bg[3]), 1.0)
    if fg[3] < 1.0:
        fg = (fg[0] * fg[3] + bg[0] * (1 - fg[3]),
              fg[1] * fg[3] + bg[1] * (1 - fg[3]),
              fg[2] * fg[3] + bg[2] * (1 - fg[3]), 1.0)

    ratio = contrast_ratio(fg, bg)
    status = "PASS" if ratio >= min_ratio else "FAIL"
    pair_str = f"{fg_name} on {bg_name} ({desc})"
    print(f"{pair_str:<55} {ratio:>7.2f}  {min_ratio:>4.1f}  {status:<10}")

    if ratio >= min_ratio:
        passes.append((fg_name, bg_name, desc, ratio, min_ratio))
    else:
        failures.append((fg_name, bg_name, desc, ratio, min_ratio))

print("-" * 100)
print(f"\nSummary: {len(passes)} PASS, {len(failures)} FAIL")

if failures:
    print("\n" + "=" * 100)
    print("FAILURES (need fixing):")
    print("=" * 100)
    for fg_name, bg_name, desc, ratio, min_ratio in failures:
        deficit = min_ratio - ratio
        print(f"\n  ❌ {fg_name} on {bg_name}")
        print(f"     Description: {desc}")
        print(f"     Contrast: {ratio:.2f}:1 (need {min_ratio}:1)")
        print(f"     Deficit: {deficit:.2f}")
        print(f"     Current OKLCH: {dark_palette[fg_name]} on {dark_palette[bg_name]}")
