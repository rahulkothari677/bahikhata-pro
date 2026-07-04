"""
BahiKhata Pro — Business Strategy & Launch Plan PDF
Comprehensive record of analytics, subscription, and viral launch strategy.
"""

import os
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY

# ────────────────────────────────────────────────────────────────────────────
# Font registration
# ────────────────────────────────────────────────────────────────────────────
FONT_DIR = '/usr/share/fonts/truetype'

pdfmetrics.registerFont(TTFont('Carlito', f'{FONT_DIR}/english/Carlito-Regular.ttf'))
pdfmetrics.registerFont(TTFont('Carlito-Bold', f'{FONT_DIR}/english/Carlito-Bold.ttf'))
pdfmetrics.registerFont(TTFont('LibSerif', f'{FONT_DIR}/liberation/LiberationSerif-Regular.ttf'))
pdfmetrics.registerFont(TTFont('LibSerif-Bold', f'{FONT_DIR}/liberation/LiberationSerif-Bold.ttf'))
SANS = 'Carlito'
SANS_BOLD = 'Carlito-Bold'
SERIF = 'LibSerif'
SERIF_BOLD = 'LibSerif-Bold'

# ────────────────────────────────────────────────────────────────────────────
# Colors
# ────────────────────────────────────────────────────────────────────────────
SAFFRON = colors.HexColor('#d97706')
SAFFRON_LIGHT = colors.HexColor('#fef3c7')
INK = colors.HexColor('#1c1917')
INK_LIGHT = colors.HexColor('#57534e')
MUTED = colors.HexColor('#78716c')
DIVIDER = colors.HexColor('#e7e5e4')
GREEN_BG = colors.HexColor('#d1fae5')
GREEN_ACCENT = colors.HexColor('#059669')
RED_BG = colors.HexColor('#fee2e2')
RED_ACCENT = colors.HexColor('#dc2626')
AMBER_BG = colors.HexColor('#fef3c7')
AMBER_ACCENT = colors.HexColor('#d97706')
BLUE_BG = colors.HexColor('#dbeafe')
BLUE_ACCENT = colors.HexColor('#2563eb')

# ────────────────────────────────────────────────────────────────────────────
# Styles
# ────────────────────────────────────────────────────────────────────────────
TITLE = ParagraphStyle('Title', fontName=SERIF_BOLD, fontSize=24, leading=30,
                       textColor=INK, alignment=TA_LEFT, spaceAfter=4)
SUBTITLE = ParagraphStyle('Subtitle', fontName=SANS, fontSize=11, leading=14,
                          textColor=MUTED, alignment=TA_LEFT, spaceAfter=20)
H1 = ParagraphStyle('H1', fontName=SERIF_BOLD, fontSize=18, leading=22,
                    textColor=SAFFRON, spaceBefore=18, spaceAfter=8)
H2 = ParagraphStyle('H2', fontName=SANS_BOLD, fontSize=13, leading=17,
                    textColor=INK, spaceBefore=12, spaceAfter=4)
H3 = ParagraphStyle('H3', fontName=SANS_BOLD, fontSize=11, leading=14,
                    textColor=INK_LIGHT, spaceBefore=8, spaceAfter=3)
BODY = ParagraphStyle('Body', fontName=SERIF, fontSize=10.5, leading=15,
                      textColor=INK, alignment=TA_JUSTIFY, spaceAfter=6)
BULLET = ParagraphStyle('Bullet', fontName=SERIF, fontSize=10.5, leading=15,
                        textColor=INK, leftIndent=15, spaceAfter=3)
BODY_SMALL = ParagraphStyle('BodySmall', fontName=SANS, fontSize=9, leading=12,
                             textColor=INK_LIGHT, spaceAfter=4)
CALLOUT = ParagraphStyle('Callout', fontName=SANS, fontSize=9.5, leading=13,
                          textColor=INK, leftIndent=8, rightIndent=8, spaceAfter=4)
TABLE_HEADER = ParagraphStyle('TableHeader', fontName=SANS_BOLD, fontSize=9.5,
                               leading=12, textColor=colors.white, alignment=TA_LEFT)
TABLE_CELL = ParagraphStyle('TableCell', fontName=SERIF, fontSize=9.5,
                             leading=12, textColor=INK, alignment=TA_LEFT)

# ────────────────────────────────────────────────────────────────────────────
# Page templates
# ────────────────────────────────────────────────────────────────────────────

def on_page(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setStrokeColor(DIVIDER)
    canvas.setLineWidth(0.5)
    canvas.line(20 * mm, 15 * mm, w - 20 * mm, 15 * mm)
    canvas.setFont(SANS, 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(20 * mm, 10 * mm, 'BahiKhata Pro — Business Strategy & Launch Plan')
    canvas.drawRightString(w - 20 * mm, 10 * mm, f'Page {doc.page}')
    canvas.setFillColor(SAFFRON)
    canvas.rect(0, h - 8 * mm, w, 8 * mm, fill=1, stroke=0)
    canvas.restoreState()


# ────────────────────────────────────────────────────────────────────────────
# Helper functions
# ────────────────────────────────────────────────────────────────────────────

def callout(text, bg=GREEN_BG, accent=GREEN_ACCENT):
    t = Table([[Paragraph(text, CALLOUT)]], colWidths=[170 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LINEBEFORE', (0, 0), (0, -1), 3, accent),
    ]))
    return t


def data_table(headers, rows, col_widths):
    data = [[Paragraph(h, TABLE_HEADER) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), TABLE_CELL) for c in row])
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), SAFFRON),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#fffbeb')]),
        ('GRID', (0, 0), (-1, -1), 0.4, DIVIDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    return t


# ────────────────────────────────────────────────────────────────────────────
# Build content
# ────────────────────────────────────────────────────────────────────────────

def build_story():
    story = []

    # ── Title ──────────────────────────────────────────────────────────────
    story.append(Spacer(1, 12 * mm))
    story.append(Paragraph('BahiKhata Pro', TITLE))
    story.append(Paragraph('Business Strategy & Launch Plan — Complete Discussion Record', SUBTITLE))

    intro = (
        '<b>Document purpose:</b> This is a comprehensive record of the strategic discussion '
        'between the founder (Rahul) and the AI mentor. It covers three critical areas: '
        '(1) Analytics and admin dashboard for tracking every important metric, '
        '(2) Subscription pricing strategy for profitable growth, and '
        '(3) Viral launch strategy for reaching millions of shop owners. '
        'Use this document to research each point, identify issues, and work on the suggested solutions.'
    )
    story.append(callout(intro, SAFFRON_LIGHT, SAFFRON))
    story.append(Spacer(1, 8 * mm))

    # ── Table of Contents ──────────────────────────────────────────────────
    story.append(Paragraph('Contents', H1))
    toc_items = [
        ('Part 1', 'Analytics & Admin Dashboard'),
        ('  1.1', 'What to Track (Privacy-Compliant)'),
        ('  1.2', 'Privacy Compliance (DPDP Act + GDPR)'),
        ('  1.3', 'Admin Dashboard — Separate App Architecture'),
        ('Part 2', 'Subscription Strategy'),
        ('  2.1', 'Pricing Model (Free / Pro / Business / Enterprise)'),
        ('  2.2', 'Revenue Math (Year 1 Projections)'),
        ('  2.3', 'The "Billionaire in a Year" Reality Check'),
        ('Part 3', 'Viral Launch Strategy'),
        ('  3.1', 'Pre-Launch (30 Days Before)'),
        ('  3.2', 'Launch Day Blitz'),
        ('  3.3', 'Post-Launch (First 90 Days)'),
        ('Part 4', 'Step-by-Step Execution Plan (12 Weeks)'),
        ('Part 5', 'Honest Opinion & Recommendations'),
    ]
    toc_data = [[Paragraph(f'<b>{label}</b>', TABLE_CELL),
                 Paragraph(title, TABLE_CELL)] for label, title in toc_items]
    toc_table = Table(toc_data, colWidths=[25 * mm, 145 * mm])
    toc_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LINEBELOW', (0, 0), (-1, -2), 0.3, DIVIDER),
    ]))
    story.append(toc_table)
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # PART 1: ANALYTICS & ADMIN DASHBOARD
    # ════════════════════════════════════════════════════════════════════════
    story.append(Paragraph('Part 1 — Analytics & Admin Dashboard', H1))
    story.append(Paragraph(
        'This section covers what metrics to track, privacy compliance, and the architecture '
        'for a separate admin dashboard app. The goal is to give the founder complete visibility '
        'into the business without compromising user privacy.',
        BODY,
    ))

    # ── 1.1 What to Track ──────────────────────────────────────────────────
    story.append(Paragraph('1.1 What to Track (Privacy-Compliant)', H2))

    story.append(Paragraph('<b>Track These (Legal & Valuable):</b>', H3))
    story.append(Paragraph('<b>User Identity (Anonymous):</b>', BODY))
    story.append(Paragraph('&bull; User ID (random UUID, not email/phone)', BULLET))
    story.append(Paragraph('&bull; Signup date, signup source (organic/referral/ad)', BULLET))
    story.append(Paragraph('&bull; Account type (free/pro/business)', BULLET))
    story.append(Paragraph('&bull; Geographic region (state-level only, NOT GPS)', BULLET))

    story.append(Paragraph('<b>Engagement:</b>', BODY))
    story.append(Paragraph('&bull; DAU/MAU (Daily/Monthly Active Users)', BULLET))
    story.append(Paragraph('&bull; Session duration, screens per session', BULLET))
    story.append(Paragraph('&bull; Retention: Day 1, Day 7, Day 30', BULLET))
    story.append(Paragraph('&bull; Churn rate (when users stop using app)', BULLET))

    story.append(Paragraph('<b>Feature Usage:</b>', BODY))
    story.append(Paragraph('&bull; Which features used (bill scan, voice entry, GST export)', BULLET))
    story.append(Paragraph('&bull; How often each feature used per user', BULLET))
    story.append(Paragraph('&bull; Feature adoption funnel (signup to first sale to habitual use)', BULLET))

    story.append(Paragraph('<b>Business Metrics:</b>', BODY))
    story.append(Paragraph('&bull; Total GMV processed through app (Rupee value of all transactions)', BULLET))
    story.append(Paragraph('&bull; Average transactions per user per month', BULLET))
    story.append(Paragraph('&bull; AI usage (scans per user — critical for pricing)', BULLET))
    story.append(Paragraph('&bull; Conversion rate: free to paid', BULLET))

    story.append(Paragraph('<b>Revenue:</b>', BODY))
    story.append(Paragraph('&bull; MRR (Monthly Recurring Revenue)', BULLET))
    story.append(Paragraph('&bull; ARPU (Average Revenue Per User)', BULLET))
    story.append(Paragraph('&bull; LTV (Lifetime Value)', BULLET))
    story.append(Paragraph('&bull; CAC (Customer Acquisition Cost)', BULLET))

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph('<b>DO NOT Track (Privacy Violations):</b>', H3))
    story.append(Paragraph('&bull; Personal customer data of shop owners\' customers (names, phones, addresses)', BULLET))
    story.append(Paragraph('&bull; Transaction amounts of individual shops (only aggregates)', BULLET))
    story.append(Paragraph('&bull; GPS location (state-level only)', BULLET))
    story.append(Paragraph('&bull; Phone contacts', BULLET))
    story.append(Paragraph('&bull; Browsing history outside app', BULLET))
    story.append(Paragraph('&bull; Biometric data', BULLET))

    story.append(Spacer(1, 4 * mm))
    story.append(callout(
        '<b>Key principle:</b> Track behavior, not identity. Track what users DO, not WHO they are. '
        'This keeps you legally safe while still giving you actionable business insights.',
        GREEN_BG, GREEN_ACCENT
    ))
    story.append(PageBreak())

    # ── 1.2 Privacy Compliance ─────────────────────────────────────────────
    story.append(Paragraph('1.2 Privacy Compliance (DPDP Act + GDPR)', H2))

    story.append(Paragraph('<b>DPDP Act (India, effective 2023):</b>', H3))
    story.append(Paragraph('The Digital Personal Data Protection Act is India\'s data privacy law. '
                           'Key requirements:', BODY))
    story.append(Paragraph('&bull; Must get explicit consent before collecting data', BULLET))
    story.append(Paragraph('&bull; Must have a Privacy Policy', BULLET))
    story.append(Paragraph('&bull; Users can request data deletion', BULLET))
    story.append(Paragraph('&bull; Must appoint a Data Protection Officer (DPO) if processing more than 50K users', BULLET))
    story.append(Paragraph('&bull; Penalties: up to Rs.250 crore for violations', BULLET))

    story.append(Paragraph('<b>What you need to build:</b>', H3))
    story.append(Paragraph('1. Privacy Policy page (legal document, can use Termly or iubenda to generate)', BULLET))
    story.append(Paragraph('2. Consent modal on first login (user must click "I Agree")', BULLET))
    story.append(Paragraph('3. Data deletion endpoint (user can delete account + all data)', BULLET))
    story.append(Paragraph('4. Data export endpoint (user can download their data in JSON/CSV)', BULLET))

    story.append(Spacer(1, 4 * mm))
    story.append(callout(
        '<b>Compliance tip:</b> Start compliance NOW, not after you have users. Retrofitting privacy '
        'is 10x harder than building it in from day one. The Rs.250 crore penalty is not a joke — '
        'the Indian government has already started enforcement actions.',
        RED_BG, RED_ACCENT
    ))

    # ── 1.3 Admin Dashboard ────────────────────────────────────────────────
    story.append(Paragraph('1.3 Admin Dashboard — Separate App Architecture', H2))

    story.append(Paragraph(
        'Build a SEPARATE admin app, not a section within the user app. Here\'s why:',
        BODY,
    ))
    story.append(Paragraph('&bull; Security isolation (admin app has different auth, different database access)', BULLET))
    story.append(Paragraph('&bull; No performance impact on user app', BULLET))
    story.append(Paragraph('&bull; Can be accessed from desktop only', BULLET))
    story.append(Paragraph('&bull; Different team members can access without seeing user data', BULLET))

    story.append(Paragraph('<b>Admin app tech stack:</b>', H3))
    story.append(Paragraph('&bull; Next.js app deployed on admin.bahikhata.pro', BULLET))
    story.append(Paragraph('&bull; Reads from same Neon database (read-only replica for safety)', BULLET))
    story.append(Paragraph('&bull; PostHog dashboard embed for product analytics', BULLET))
    story.append(Paragraph('&bull; Stripe/Razorpay dashboard embed for revenue', BULLET))
    story.append(Paragraph('&bull; Custom charts for business metrics', BULLET))

    story.append(Paragraph('<b>Admin dashboard pages (8 sections):</b>', H3))
    admin_pages = [
        ['#', 'Page', 'Key Metrics'],
        ['1', 'Overview', 'DAU/MAU, MRR, total users, churn rate'],
        ['2', 'Users', 'Signup trends, geographic distribution, active users'],
        ['3', 'Feature Usage', 'Which features used most, adoption funnels'],
        ['4', 'Revenue', 'MRR, ARPU, conversion rate, churn'],
        ['5', 'AI Usage', 'Scans per user, cost per user, profitability'],
        ['6', 'Cohort Analysis', 'Retention by signup month'],
        ['7', 'Geographic', 'State-wise distribution, top cities'],
        ['8', 'Alerts', 'Unusual activity, churn spikes, error rates'],
    ]
    story.append(data_table(admin_pages[0], admin_pages[1:], [10 * mm, 45 * mm, 115 * mm]))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # PART 2: SUBSCRIPTION STRATEGY
    # ════════════════════════════════════════════════════════════════════════
    story.append(Paragraph('Part 2 — Subscription Strategy', H1))
    story.append(Paragraph(
        'This section covers the pricing model, revenue projections, and the honest reality '
        'of reaching a billion-dollar valuation. The goal is sustainable, profitable growth '
        'without relying on venture capital.',
        BODY,
    ))

    # ── 2.1 Pricing Model ──────────────────────────────────────────────────
    story.append(Paragraph('2.1 Pricing Model (4 Tiers)', H2))

    pricing = [
        ['Tier', 'Price', 'Target %', 'Key Features'],
        ['Free', 'Rs.0', '80%', '50 transactions/mo, 50 products, 3 AI scans total, 1 shop'],
        ['Pro', 'Rs.99/mo\nor Rs.999/yr', '15%', 'Unlimited transactions, 100 AI scans/mo, voice, GST, WhatsApp, insights, 1 shop'],
        ['Business', 'Rs.299/mo\nor Rs.2,999/yr', '4%', 'Everything in Pro + unlimited AI, 3 shops, 5 staff, advanced reports'],
        ['Enterprise', 'Custom', '1%', 'Everything in Business + unlimited shops/staff, API, dedicated manager'],
    ]
    story.append(data_table(pricing[0], pricing[1:], [25 * mm, 30 * mm, 20 * mm, 95 * mm]))

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph('<b>Pricing Strategy Logic:</b>', H3))
    story.append(Paragraph(
        '<b>Free tier (Hook):</b> Get users addicted. Once they hit 50 transactions/month, they NEED '
        'to upgrade. The 3 free AI scans let them experience the magic, then they want more.', BODY,
    ))
    story.append(Paragraph(
        '<b>Pro tier (Bread & butter):</b> Rs.99/month is affordable for any shop doing Rs.2-5 lakh/month '
        'revenue. It\'s 0.05% of their revenue. AI scan cost = Rs.0.50/scan, so 100 scans = Rs.50 cost, '
        'Rs.49 profit per user. Sustainable.', BODY,
    ))
    story.append(Paragraph(
        '<b>Business tier (Growth):</b> For shops with 2-3 locations. Rs.299/month is still cheap for '
        'multi-shop management. This is where profit per user is highest.', BODY,
    ))
    story.append(Paragraph(
        '<b>Enterprise tier (Future):</b> Large chains with 10+ shops. Custom pricing, usually '
        'Rs.2,000-10,000/month depending on scale. Don\'t build this until you have demand.', BODY,
    ))
    story.append(PageBreak())

    # ── 2.2 Revenue Math ───────────────────────────────────────────────────
    story.append(Paragraph('2.2 Revenue Math (Year 1 Projections)', H2))

    story.append(Paragraph('<b>Conservative Scenario:</b>', H3))
    story.append(Paragraph('&bull; 10,000 total users by month 12', BULLET))
    story.append(Paragraph('&bull; 15% on Pro = 1,500 paying users x Rs.99 x 12 = Rs.17.8 lakh ARR', BULLET))
    story.append(Paragraph('&bull; 4% on Business = 400 users x Rs.299 x 12 = Rs.14.3 lakh ARR', BULLET))
    story.append(Paragraph('&bull; <b>Total Year 1 ARR: Rs.32 lakh (~$40K)</b>', BULLET))

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph('<b>Aggressive Scenario (viral launch works):</b>', H3))
    story.append(Paragraph('&bull; 100,000 total users by month 12', BULLET))
    story.append(Paragraph('&bull; 15% on Pro = 15,000 x Rs.99 x 12 = Rs.1.78 crore ARR', BULLET))
    story.append(Paragraph('&bull; 4% on Business = 4,000 x Rs.299 x 12 = Rs.1.43 crore ARR', BULLET))
    story.append(Paragraph('&bull; <b>Total Year 1 ARR: Rs.3.2 crore (~$400K)</b>', BULLET))

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph('<b>Valuation at Rs.3.2 crore ARR:</b>', H3))
    story.append(Paragraph('&bull; At 10x revenue multiple = Rs.32 crore ($4M)', BULLET))
    story.append(Paragraph('&bull; At 20x revenue multiple (SaaS premium) = Rs.64 crore ($8M)', BULLET))

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph('<b>To reach $1B valuation, you need:</b>', H3))
    story.append(Paragraph('&bull; Rs.200-400 crore ARR ($25-50M)', BULLET))
    story.append(Paragraph('&bull; 5-10 million users', BULLET))
    story.append(Paragraph('&bull; 3-5 years minimum', BULLET))

    # ── 2.3 Reality Check ──────────────────────────────────────────────────
    story.append(Paragraph('2.3 The "Billionaire in a Year" Reality Check', H2))

    story.append(callout(
        '<b>Honest truth:</b> "Becoming a billionaire in a year" is not realistic, even with AI. '
        'Here is what successful Indian startups actually took:',
        RED_BG, RED_ACCENT
    ))

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph('<b>Successful Indian startups timeline:</b>', H3))
    story.append(Paragraph('&bull; <b>Khatabook:</b> Founded 2018, $100M valuation in 2021 (3 years), still not profitable', BULLET))
    story.append(Paragraph('&bull; <b>BharatPe:</b> Founded 2018, $2.8B valuation in 2021 (3 years), but burned Rs.4,000+ crore', BULLET))
    story.append(Paragraph('&bull; <b>CRED:</b> Founded 2018, $6B valuation in 2022 (4 years), still losing money', BULLET))

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph('<b>What is achievable:</b>', H3))
    story.append(Paragraph('&bull; Build a Rs.10-50 crore company in 2-3 years (life-changing money)', BULLET))
    story.append(Paragraph('&bull; Reach Rs.100-500 crore valuation in 3-5 years (top 0.1% of entrepreneurs)', BULLET))
    story.append(Paragraph('&bull; Reaching $1B+ requires 5-8 years + venture capital + luck', BULLET))

    story.append(Spacer(1, 4 * mm))
    story.append(callout(
        '<b>My honest recommendation:</b> Aim for Rs.100 crore company in 3 years. That is already '
        'top 0.01% of Indian entrepreneurs. If momentum is strong, raise capital and aim higher. '
        'Do not set unrealistic expectations — it leads to burnout and bad decisions.',
        AMBER_BG, AMBER_ACCENT
    ))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # PART 3: VIRAL LAUNCH STRATEGY
    # ════════════════════════════════════════════════════════════════════════
    story.append(Paragraph('Part 3 — Viral Launch Strategy', H1))
    story.append(Paragraph(
        'This section covers the pre-launch buildup, launch day blitz, and post-launch growth. '
        'The goal is to create a viral loop where every user brings in more users.',
        BODY,
    ))

    # ── 3.1 Pre-Launch ─────────────────────────────────────────────────────
    story.append(Paragraph('3.1 Pre-Launch (30 Days Before)', H2))

    story.append(Paragraph('<b>Week 1-2: Build Curiosity</b>', H3))
    story.append(Paragraph('&bull; Teaser videos on Instagram/YouTube Shorts showing AI scanning a bill in 2 seconds', BULLET))
    story.append(Paragraph('&bull; "Coming soon" landing page with email signup (target: 10K emails)', BULLET))
    story.append(Paragraph('&bull; WhatsApp groups for shop owners — share sneak peeks', BULLET))
    story.append(Paragraph('&bull; Influencer outreach — find 50 micro-influencers in business/finance niche', BULLET))

    story.append(Paragraph('<b>Week 3: Create FOMO (Fear of Missing Out)</b>', H3))
    story.append(Paragraph('&bull; Limited beta access — 1,000 early users get 1 year free Pro', BULLET))
    story.append(Paragraph('&bull; Countdown timer on website', BULLET))
    story.append(Paragraph('&bull; Behind-the-scenes content — show the team, the tech, the mission', BULLET))
    story.append(Paragraph('&bull; Press kit — send to YourStory, Inc42, TechInAsia', BULLET))

    story.append(Paragraph('<b>Week 4: The 24-Hour Blitz</b>', H3))
    story.append(Paragraph('&bull; Launch on Product Hunt (huge international visibility)', BULLET))
    story.append(Paragraph('&bull; YouTube video — "I built India\'s smartest ledger app" (educational + emotional)', BULLET))
    story.append(Paragraph('&bull; Reddit AMA — r/india, r/smallbusiness, r/entrepreneur', BULLET))
    story.append(Paragraph('&bull; Twitter thread — 20 tweets showing every feature', BULLET))
    story.append(Paragraph('&bull; Instagram Reels — 5 viral-style short videos', BULLET))
    story.append(Paragraph('&bull; WhatsApp status — share with all contacts', BULLET))
    story.append(Paragraph('&bull; LinkedIn post — professional audience', BULLET))

    # ── 3.2 Launch Day ─────────────────────────────────────────────────────
    story.append(Paragraph('3.2 Launch Day — "First 1000 Users" Playbook', H2))

    story.append(Paragraph('1. <b>Free lifetime Pro</b> for first 1,000 signups (creates urgency)', BULLET))
    story.append(Paragraph('2. <b>Refer-and-earn:</b> Refer 3 shop owners, get 1 year Pro free', BULLET))
    story.append(Paragraph('3. <b>WhatsApp share button</b> in app — every invoice sent becomes marketing', BULLET))
    story.append(Paragraph('4. <b>Local partnerships</b> — tie up with 50 kirana associations across India', BULLET))
    story.append(Paragraph('5. <b>Regional language ads</b> — Hindi, Tamil, Telugu, Bengali (cheap + effective)', BULLET))

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph('<b>The Viral Loop (This is how Khatabook grew):</b>', H3))
    story.append(Paragraph(
        'User creates sale -> WhatsApp invoice sent to customer -> Customer sees "Powered by BahiKhata Pro" '
        '-> Customer\'s shop owner friend sees it -> Friend asks "What app is this?" -> New user signs up '
        '-> New user creates sale -> cycle repeats', BODY,
    ))
    story.append(callout(
        '<b>Key insight:</b> Every invoice shared = free marketing. This is the most powerful growth '
        'channel for a B2B app. Make sure every invoice has a small "Powered by BahiKhata Pro" footer.',
        GREEN_BG, GREEN_ACCENT
    ))
    story.append(PageBreak())

    # ── 3.3 Post-Launch ────────────────────────────────────────────────────
    story.append(Paragraph('3.3 Post-Launch (First 90 Days)', H2))

    story.append(Paragraph('<b>Month 1: Validate</b>', H3))
    story.append(Paragraph('&bull; Get to 1,000 active users', BULLET))
    story.append(Paragraph('&bull; Fix bugs based on feedback', BULLET))
    story.append(Paragraph('&bull; Optimize onboarding (reduce drop-off)', BULLET))
    story.append(Paragraph('&bull; Start PostHog analytics', BULLET))

    story.append(Paragraph('<b>Month 2: Grow</b>', H3))
    story.append(Paragraph('&bull; Get to 10,000 users', BULLET))
    story.append(Paragraph('&bull; Launch referral program officially', BULLET))
    story.append(Paragraph('&bull; Start paid ads (Rs.5-10L budget on Meta + Google)', BULLET))
    story.append(Paragraph('&bull; Partner with 100 local influencers', BULLET))

    story.append(Paragraph('<b>Month 3: Scale</b>', H3))
    story.append(Paragraph('&bull; Get to 50,000 users', BULLET))
    story.append(Paragraph('&bull; Launch Pro tier (start monetization)', BULLET))
    story.append(Paragraph('&bull; Hire 2-3 people (customer support, growth)', BULLET))
    story.append(Paragraph('&bull; Raise seed round if needed (Rs.5-10 crore)', BULLET))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # PART 4: EXECUTION PLAN
    # ════════════════════════════════════════════════════════════════════════
    story.append(Paragraph('Part 4 — Step-by-Step Execution Plan (12 Weeks)', H1))

    story.append(Paragraph(
        'This is the concrete execution plan. Each phase has specific tasks with estimated timelines. '
        'Do not skip phases — each one builds on the previous.',
        BODY,
    ))

    exec_plan = [
        ['Phase', 'Timeline', 'Tasks'],
        ['Phase 1:\nAnalytics\nFoundation', 'Week 1-2',
         '1. Install PostHog\n2. Add 30 tracking events\n3. Build Privacy Policy + Consent modal\n4. Add data deletion endpoint\n5. Set up Vercel Analytics'],
        ['Phase 2:\nAdmin\nDashboard', 'Week 3-4',
         '6. Build separate admin app at admin.bahikhata.pro\n7. Pages: Overview, Users, Features, Revenue, AI Usage\n8. Embed PostHog charts\n9. Add Stripe/Razorpay dashboard\n10. Add alert system'],
        ['Phase 3:\nSubscription\nSystem', 'Week 5-6',
         '11. Add subscription fields to Prisma schema\n12. Integrate Razorpay (better for India than Stripe)\n13. Build paywall modal\n14. Build subscription management page\n15. Add feature flags'],
        ['Phase 4:\nPre-Launch\nMarketing', 'Week 7-10',
         '16. Build landing page with email capture\n17. Create 10 teaser videos\n18. Reach out to 50 influencers\n19. Set up Product Hunt launch\n20. Build referral system in app'],
        ['Phase 5:\nLaunch', 'Week 11-12',
         '21. 24-hour blitz launch\n22. Monitor analytics closely\n23. Fix bugs in real-time\n24. Engage with every user on social media\n25. Start referral program'],
    ]
    story.append(data_table(exec_plan[0], exec_plan[1:], [30 * mm, 25 * mm, 115 * mm]))
    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # PART 5: HONEST OPINION
    # ════════════════════════════════════════════════════════════════════════
    story.append(Paragraph('Part 5 — Honest Opinion & Recommendations', H1))

    story.append(Paragraph('<b>Your strengths:</b>', H3))
    story.append(Paragraph('&bull; The app is genuinely good — better than Khatabook in many ways', BULLET))
    story.append(Paragraph('&bull; AI features are a real differentiator', BULLET))
    story.append(Paragraph('&bull; You are thinking about business, not just code', BULLET))
    story.append(Paragraph('&bull; You have savings to bootstrap (no VC pressure initially)', BULLET))

    story.append(Paragraph('<b>Your risks:</b>', H3))
    story.append(Paragraph('&bull; Solo founder + complex product = burnout risk', BULLET))
    story.append(Paragraph('&bull; Marketing a B2B app to shop owners is HARD (they are not on Instagram much)', BULLET))
    story.append(Paragraph('&bull; Customer support will overwhelm you at scale', BULLET))
    story.append(Paragraph('&bull; Competitors (Khatabook, BharatPe) have Rs.1,000+ crore war chests', BULLET))

    story.append(Paragraph('<b>My #1 advice:</b>', H3))
    story.append(Paragraph(
        'Do not try to do everything yourself. Within 3 months, hire:', BODY,
    ))
    story.append(Paragraph('&bull; A growth marketer (Rs.50-80K/month)', BULLET))
    story.append(Paragraph('&bull; A customer support person (Rs.25-40K/month)', BULLET))
    story.append(Paragraph('&bull; Maybe a junior developer (Rs.60-100K/month)', BULLET))

    story.append(Paragraph(
        '<b>Total burn: Rs.1.5-2 lakh/month</b> — manageable if you have 6-12 months of runway saved.', BODY,
    ))

    story.append(Spacer(1, 6 * mm))

    # ── Closing ────────────────────────────────────────────────────────────
    story.append(callout(
        '<b>Final thought:</b> The fact that you are asking these questions BEFORE pushing more features '
        'puts you ahead of 90% of founders. Most build first, think later. You are thinking first. '
        'That is the right order. The market is real ($14.3B/year addressable). The path is clear. '
        'The biggest risk is NOT competition — it is distribution failure. Spend 50% of your time on growth. '
        'Without users, even the best product fails.',
        SAFFRON_LIGHT, SAFFRON
    ))

    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph(
        '<b>Next steps:</b> Start with Phase 1 (Analytics Foundation). Install PostHog, add tracking '
        'events, build Privacy Policy. This takes 2-3 hours and gives you real data within a week. '
        'Then tackle the admin dashboard, then subscriptions. Execute one phase at a time. '
        'Do not rush. Build it right.',
        BODY,
    ))

    return story


# ────────────────────────────────────────────────────────────────────────────
# Generate
# ────────────────────────────────────────────────────────────────────────────

OUTPUT_PATH = '/home/z/my-project/download/Bahikhata-Business-Strategy.pdf'

doc = SimpleDocTemplate(
    OUTPUT_PATH,
    pagesize=A4,
    leftMargin=20 * mm,
    rightMargin=20 * mm,
    topMargin=20 * mm,
    bottomMargin=20 * mm,
    title='BahiKhata Pro — Business Strategy & Launch Plan',
    author='BahiKhata Pro',
    subject='Analytics, subscription pricing, and viral launch strategy',
    creator='BahiKhata Pro',
)

doc.build(build_story(), onFirstPage=on_page, onLaterPages=on_page)
print(f'PDF generated: {OUTPUT_PATH}')
print(f'Size: {os.path.getsize(OUTPUT_PATH) / 1024:.1f} KB')
