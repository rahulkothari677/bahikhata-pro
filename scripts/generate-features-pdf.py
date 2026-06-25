"""
Generate BahiKhata Pro — Feature Roadmap PDF
A reference document for future development planning.
"""

import os
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm, cm
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

# Register Tinos (serif, Times-like) and Carlito (sans, Calibri-like)
try:
    pdfmetrics.registerFont(TTFont('Tinos', f'{FONT_DIR}/english/Tinos-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('Tinos-Bold', f'{FONT_DIR}/english/Tinos-Bold.ttf'))
    pdfmetrics.registerFont(TTFont('Tinos-Italic', f'{FONT_DIR}/english/Tinos-Italic.ttf'))
    SERIF = 'Tinos'
    SERIF_BOLD = 'Tinos-Bold'
    SERIF_ITALIC = 'Tinos-Italic'
except Exception:
    SERIF = 'Times-Roman'
    SERIF_BOLD = 'Times-Bold'
    SERIF_ITALIC = 'Times-Italic'

try:
    pdfmetrics.registerFont(TTFont('Carlito', f'{FONT_DIR}/english/Carlito-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('Carlito-Bold', f'{FONT_DIR}/english/Carlito-Bold.ttf'))
    SANS = 'Carlito'
    SANS_BOLD = 'Carlito-Bold'
except Exception:
    SANS = 'Helvetica'
    SANS_BOLD = 'Helvetica-Bold'

# ────────────────────────────────────────────────────────────────────────────
# Colors (BahiKhata brand — saffron + ink)
# ────────────────────────────────────────────────────────────────────────────
SAFFRON = colors.HexColor('#d97706')
SAFFRON_LIGHT = colors.HexColor('#fef3c7')
INK = colors.HexColor('#1c1917')
INK_LIGHT = colors.HexColor('#57534e')
MUTED = colors.HexColor('#78716c')
DIVIDER = colors.HexColor('#e7e5e4')
BG_TIER1 = colors.HexColor('#ecfdf5')  # emerald-50
BG_TIER2 = colors.HexColor('#eff6ff')  # blue-50
BG_TIER3 = colors.HexColor('#faf5ff')  # violet-50
BG_POLISH = colors.HexColor('#fff7ed')  # orange-50

# ────────────────────────────────────────────────────────────────────────────
# Styles
# ────────────────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

TITLE = ParagraphStyle(
    'Title',
    fontName=SERIF_BOLD,
    fontSize=24,
    leading=30,
    textColor=INK,
    alignment=TA_LEFT,
    spaceAfter=4,
)

SUBTITLE = ParagraphStyle(
    'Subtitle',
    fontName=SANS,
    fontSize=11,
    leading=14,
    textColor=MUTED,
    alignment=TA_LEFT,
    spaceAfter=20,
)

H1 = ParagraphStyle(
    'H1',
    fontName=SERIF_BOLD,
    fontSize=18,
    leading=22,
    textColor=SAFFRON,
    spaceBefore=18,
    spaceAfter=8,
)

H2 = ParagraphStyle(
    'H2',
    fontName=SANS_BOLD,
    fontSize=12,
    leading=16,
    textColor=INK,
    spaceBefore=10,
    spaceAfter=4,
)

BODY = ParagraphStyle(
    'Body',
    fontName=SERIF,
    fontSize=10.5,
    leading=15,
    textColor=INK,
    alignment=TA_JUSTIFY,
    spaceAfter=6,
)

BODY_SMALL = ParagraphStyle(
    'BodySmall',
    fontName=SANS,
    fontSize=9,
    leading=12,
    textColor=INK_LIGHT,
    spaceAfter=4,
)

CALLOUT = ParagraphStyle(
    'Callout',
    fontName=SANS,
    fontSize=9.5,
    leading=13,
    textColor=INK,
    leftIndent=8,
    rightIndent=8,
    spaceAfter=4,
)

FEATURE_TITLE = ParagraphStyle(
    'FeatureTitle',
    fontName=SANS_BOLD,
    fontSize=11,
    leading=14,
    textColor=INK,
    spaceAfter=2,
)

FEATURE_DESC = ParagraphStyle(
    'FeatureDesc',
    fontName=SERIF,
    fontSize=10,
    leading=13,
    textColor=INK_LIGHT,
    spaceAfter=4,
)

TIER_LABEL = ParagraphStyle(
    'TierLabel',
    fontName=SANS_BOLD,
    fontSize=10,
    leading=12,
    textColor=colors.white,
    alignment=TA_CENTER,
)

# ────────────────────────────────────────────────────────────────────────────
# Page templates (header + footer)
# ────────────────────────────────────────────────────────────────────────────

def on_page(canvas, doc):
    canvas.saveState()
    w, h = A4
    # Footer line
    canvas.setStrokeColor(DIVIDER)
    canvas.setLineWidth(0.5)
    canvas.line(20 * mm, 15 * mm, w - 20 * mm, 15 * mm)
    # Footer text
    canvas.setFont(SANS, 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(20 * mm, 10 * mm, 'BahiKhata Pro — Feature Roadmap')
    canvas.drawRightString(w - 20 * mm, 10 * mm, f'Page {doc.page}')
    # Top brand strip
    canvas.setFillColor(SAFFRON)
    canvas.rect(0, h - 8 * mm, w, 8 * mm, fill=1, stroke=0)
    canvas.restoreState()


# ────────────────────────────────────────────────────────────────────────────
# Build content
# ────────────────────────────────────────────────────────────────────────────

def build_story():
    story = []

    # ── Title block ────────────────────────────────────────────────────────
    story.append(Spacer(1, 12 * mm))
    story.append(Paragraph('BahiKhata Pro', TITLE))
    story.append(Paragraph('Feature Roadmap &mdash; Future Development Plan', SUBTITLE))

    # Intro callout
    intro_text = (
        '<b>Document purpose:</b> This is a working reference of all planned features for '
        'BahiKhata Pro, organized by priority tier. Use it to plan development sprints, '
        'track progress, and decide what to build next. Each feature includes a short '
        'description, estimated effort, and the strategic value it adds to the product.'
    )
    intro_table = Table(
        [[Paragraph(intro_text, CALLOUT)]],
        colWidths=[170 * mm],
    )
    intro_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), SAFFRON_LIGHT),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LINEBEFORE', (0, 0), (0, -1), 3, SAFFRON),
    ]))
    story.append(intro_table)
    story.append(Spacer(1, 8 * mm))

    # ── Section: Currently Shipped ─────────────────────────────────────────
    story.append(Paragraph('Currently Shipped (Phase 1 &amp; 2)', H1))
    story.append(Paragraph(
        'These features are already live in production and tested. They form the foundation '
        'of the product and should be maintained as we add new capabilities.',
        BODY,
    ))

    shipped = [
        ['Feature', 'Status'],
        ['Email + Password authentication (NextAuth)', 'Live'],
        ['Multi-tenant data isolation (per-user)', 'Live'],
        ['PostgreSQL on Neon (pooled)', 'Live'],
        ['Cloudinary image storage', 'Live'],
        ['AI bill scanning (Groq Llama 4 Scout)', 'Live'],
        ['Voice entry parsing (Groq)', 'Live'],
        ['Client-side image compression', 'Live'],
        ['PWA install + offline mode (IndexedDB)', 'Live'],
        ['Hindi + English multilingual UI', 'Live'],
        ['WhatsApp payment reminders + invoice sharing', 'Live'],
        ['GSTR-1 CSV export', 'Live'],
        ['Staff access roles (owner / staff)', 'Live'],
        ['Smart insights &amp; alerts', 'Live'],
        ['6 theme colors + dark mode', 'Live'],
        ['14 feature toggles in Settings', 'Live'],
        ['Keyboard shortcuts + global search (Ctrl+K)', 'Live'],
        ['Date range filtering (all views)', 'Live'],
        ['Print / download invoices', 'Live'],
        ['Transaction detail page (edit / delete)', 'Live'],
        ['Customer / supplier profile pages', 'Live'],
        ['Income / expense with custom categories', 'Live'],
        ['Real offline mode (login, read, write, sync)', 'Live'],
    ]
    t = Table(shipped, colWidths=[130 * mm, 40 * mm])
    t.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, 0), SANS_BOLD),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('BACKGROUND', (0, 0), (-1, 0), SAFFRON),
        ('FONTNAME', (0, 1), (0, -1), SERIF),
        ('FONTSIZE', (0, 1), (0, -1), 9.5),
        ('TEXTCOLOR', (0, 1), (0, -1), INK),
        ('FONTNAME', (1, 1), (1, -1), SANS_BOLD),
        ('FONTSIZE', (1, 1), (1, -1), 9),
        ('TEXTCOLOR', (1, 1), (1, -1), colors.HexColor('#059669')),
        ('ALIGN', (1, 0), (1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#fffbeb')]),
        ('GRID', (0, 0), (-1, -1), 0.4, DIVIDER),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(PageBreak())

    # ── Tier 1: Quick Wins ─────────────────────────────────────────────────
    story.append(Paragraph('Tier 1 &mdash; Quick Wins', H1))
    story.append(Paragraph(
        'High-impact features that can be built in 1&ndash;2 hours each. These should be the next '
        'sprint. They directly improve daily usage and give shop owners a reason to open the app '
        'every day.',
        BODY,
    ))

    tier1_features = [
        {
            'name': '1. Barcode Scanner for Inventory',
            'desc': 'Use the phone camera to scan product barcodes (EAN-13, UPC-A) during billing '
                    'and stock-in. Auto-fills product details if the barcode is already in the '
                    'catalog, or opens a quick-add dialog if it is new. Speeds up billing at the '
                    'counter by 3-5x and reduces manual entry errors.',
            'value': 'Value: Faster billing, fewer mistakes, professional feel.',
        },
        {
            'name': '2. Recurring Entries Automation',
            'desc': 'Let shop owners set up recurring rent, salary, electricity, and loan '
                    'entries that auto-create themselves every month on a chosen date. The user '
                    'gets a notification "Salary entry of ₹15,000 created" and can review or '
                    'edit before finalizing. The feature toggle already exists in Settings &mdash; '
                    'only the implementation is pending.',
            'value': 'Value: Stickiness. Users never forget an entry. Monthly active usage goes up.',
        },
        {
            'name': '3. Customer Loyalty Points',
            'desc': 'Every sale auto-earns loyalty points (configurable, e.g. 1 point per ₹100). '
                    'Points are tracked in the customer profile and can be redeemed as a discount '
                    'on future sales. Shop owner sets the conversion rate (e.g. 100 points = ₹10). '
                    'Builds repeat business for the shop and gives BahiKhata a "growth feature" '
                    'story for marketing.',
            'value': 'Value: Marketing hook + retention. Differentiator vs Khatabook/OkCredit.',
        },
        {
            'name': '4. Reorder Automation',
            'desc': 'When stock for a product drops to or below the low-stock threshold, '
                    'auto-suggest a reorder quantity based on average weekly sales. Generate a '
                    'purchase order to the linked supplier with one tap. Track pending orders '
                    'until stock arrives. Closes the inventory loop end-to-end.',
            'value': 'Value: Time saved per week. Strong "I cannot run my shop without this" hook.',
        },
    ]

    for f in tier1_features:
        block = [
            Paragraph(f['name'], FEATURE_TITLE),
            Paragraph(f['desc'], FEATURE_DESC),
            Paragraph(f'<font color="#059669"><b>{f["value"]}</b></font>', BODY_SMALL),
        ]
        wrapped = Table([[block]], colWidths=[170 * mm])
        wrapped.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), BG_TIER1),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LINEBEFORE', (0, 0), (0, -1), 3, colors.HexColor('#059669')),
        ]))
        story.append(KeepTogether(wrapped))
        story.append(Spacer(1, 4 * mm))

    story.append(PageBreak())

    # ── Tier 2: Bigger Features ────────────────────────────────────────────
    story.append(Paragraph('Tier 2 &mdash; Bigger Features', H1))
    story.append(Paragraph(
        'Features that take 2&ndash;4 hours each and meaningfully expand what the app can do. '
        'These are good candidates for the second development sprint after Tier 1 is shipped.',
        BODY,
    ))

    tier2_features = [
        {
            'name': '5. Expense Receipt Scanner',
            'desc': 'Snap a photo of any bill or receipt (electricity, supplier invoice, '
                    'transport chit). AI extracts amount, date, vendor name, and category. '
                    'Auto-creates an expense entry linked to the receipt image. The image is '
                    'stored in Cloudinary and viewable from the transaction detail page. Closes '
                    'the loop on expense tracking &mdash; no more manual entry.',
            'value': 'Value: Tax season. Every expense documented with proof.',
        },
        {
            'name': '6. GSTR-1 / GSTR-3B Filing Assistant',
            'desc': 'Generate proper GST return format ready for upload to the GST portal. '
                    'Auto-categorize B2B vs B2C sales, track input tax credit from purchases, '
                    'and produce both GSTR-1 (outward supplies) and GSTR-3B (summary return) '
                    'in the JSON format the portal accepts. Shop owner uploads, files, done. '
                    'Huge time saver vs paying a CA ₹2,000&ndash;5,000 per quarter.',
            'value': 'Value: Direct money saved. Strong premium-tier feature.',
        },
        {
            'name': '7. WhatsApp Business Integration',
            'desc': 'Beyond the current invoice sharing, add: daily sales summary auto-sent to '
                    'the owner every evening at 8 PM, automatic birthday and loyalty wishes to '
                    'customers, payment receipt confirmations instantly when a sale is recorded, '
                    'and overdue payment reminders 3 days before due date. Uses the WhatsApp '
                    'Business API (paid) or click-to-chat (free).',
            'value': 'Value: Daily engagement. Owner opens WhatsApp anyway &mdash; now the app is there too.',
        },
        {
            'name': '8. Multi-Shop Dashboard',
            'desc': 'For owners running 2 or more shops, allow switching between shops from the '
                    'sidebar. Provide a consolidated dashboard showing total revenue, profit, '
                    'and stock value across all shops. Per-shop staff permissions (shop A staff '
                    'cannot see shop B data). Requires a schema change: add shopId to User, '
                    'Product, Party, Transaction.',
            'value': 'Value: Unlocks a whole new customer segment (small chains).',
        },
    ]

    for f in tier2_features:
        block = [
            Paragraph(f['name'], FEATURE_TITLE),
            Paragraph(f['desc'], FEATURE_DESC),
            Paragraph(f'<font color="#2563eb"><b>{f["value"]}</b></font>', BODY_SMALL),
        ]
        wrapped = Table([[block]], colWidths=[170 * mm])
        wrapped.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), BG_TIER2),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LINEBEFORE', (0, 0), (0, -1), 3, colors.HexColor('#2563eb')),
        ]))
        story.append(KeepTogether(wrapped))
        story.append(Spacer(1, 4 * mm))

    story.append(PageBreak())

    # ── Tier 3: Power Features ─────────────────────────────────────────────
    story.append(Paragraph('Tier 3 &mdash; Power Features', H1))
    story.append(Paragraph(
        'Larger features (4&ndash;8 hours each) that move BahiKhata from "ledger app" to '
        '"business operating system." These justify a premium subscription tier and create '
        'long-term defensibility against competitors.',
        BODY,
    ))

    tier3_features = [
        {
            'name': '9. Voice Reporting',
            'desc': 'Ask the app questions in plain Hindi or English: "Aaj ki total sale kitni '
                    'thi?", "Is hafte ka profit kya hai?", "Sabse zyada bikne wala product kaunsa '
                    'hai?" The app speaks the answer back and shows the relevant chart. Uses '
                    'Groq for speech-to-text + LLM reasoning, plus a text-to-speech library for '
                    'the spoken reply. Game-changer for less-literate shop owners.',
            'value': 'Value: Accessibility + viral demo value. Investors love this.',
        },
        {
            'name': '10. Supplier Payment Scheduler',
            'desc': 'Track due dates for every supplier payment. Get reminders 2 days before '
                    'each payment is due. Mark payments as paid, partially paid, or extended. '
                    'See a calendar view of upcoming payables for the next 30 days. Helps shop '
                    'owners avoid late fees and maintain good supplier relationships.',
            'value': 'Value: Direct money saved (late fees). Cash flow visibility.',
        },
        {
            'name': '11. Cash Flow Forecast',
            'desc': 'Predict the next 30 days of cash position based on receivables (customers '
                    'who owe), payables (suppliers we owe), recurring expenses, and historical '
                    'sales patterns. Show a chart with predicted bank balance over time. Alert '
                    'the owner if cash is predicted to go negative in the next 2 weeks so they '
                    'can arrange a short-term loan or push sales.',
            'value': 'Value: Prevents business crises. High willingness-to-pay.',
        },
        {
            'name': '12. Data Export / Import (Excel)',
            'desc': 'One-click export of all data (products, transactions, parties, settings) '
                    'to a properly formatted .xlsx file. Bulk import from an Excel template '
                    'so shop owners migrating from Tally, Khatabook, or paper can bring their '
                    'data in. Also serves as a backup mechanism &mdash; download Excel monthly '
                    'and store offline.',
            'value': 'Value: Trust. "My data is mine" is a big deal for Indian shopkeepers.',
        },
    ]

    for f in tier3_features:
        block = [
            Paragraph(f['name'], FEATURE_TITLE),
            Paragraph(f['desc'], FEATURE_DESC),
            Paragraph(f'<font color="#7c3aed"><b>{f["value"]}</b></font>', BODY_SMALL),
        ]
        wrapped = Table([[block]], colWidths=[170 * mm])
        wrapped.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), BG_TIER3),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LINEBEFORE', (0, 0), (0, -1), 3, colors.HexColor('#7c3aed')),
        ]))
        story.append(KeepTogether(wrapped))
        story.append(Spacer(1, 4 * mm))

    story.append(PageBreak())

    # ── Polish & Improvements ──────────────────────────────────────────────
    story.append(Paragraph('Polish &amp; Improvements', H1))
    story.append(Paragraph(
        'Not new features, but ongoing work that keeps the app fast, safe, and pleasant to use. '
        'Should be scheduled alongside feature work.',
        BODY,
    ))

    polish = [
        {
            'cat': 'Performance',
            'color': '#ea580c',
            'items': [
                'Lazy-load heavy components (Reports, BillScanner) to speed up initial load',
                'Optimize dashboard query &mdash; currently fetches ALL transactions every load',
                'Add database indexes on Transaction(userId, date, type) and Product(userId, name)',
                'Move React Query staleTime from 30s to 60s to reduce refetches',
            ],
        },
        {
            'cat': 'UX Improvements',
            'color': '#0891b2',
            'items': [
                'Add swipe-to-delete and long-press menu on mobile',
                'One-tap "New Sale" quick action on the dashboard',
                'Better empty states with illustrations and guidance',
                'Onboarding tour for first-time users (highlight 3 key features)',
            ],
        },
        {
            'cat': 'Security Hardening',
            'color': '#dc2626',
            'items': [
                'Add rate limiting on /api/auth/* and /api/scan-bill endpoints',
                'Session timeout warning 5 minutes before JWT expires',
                'Audit log table (who did what, when) &mdash; required for compliance later',
                'Add CSRF protection on all mutating endpoints',
                'Run dependency vulnerability scans weekly (npm audit + Snyk)',
            ],
        },
    ]

    for section in polish:
        story.append(Paragraph(section['cat'], H2))
        for item in section['items']:
            story.append(Paragraph(f'&bull; {item}', BODY))
        story.append(Spacer(1, 4 * mm))

    story.append(Spacer(1, 6 * mm))

    # ── Closing note ───────────────────────────────────────────────────────
    closing_text = (
        '<b>How to use this document:</b> Pick one tier at a time. Within a tier, ship the '
        'feature with the highest "value" first. Do not skip Tier 1 to jump to Tier 3 &mdash; '
        'Tier 1 features are the ones that turn a first-time user into a daily user. '
        'Tier 3 features are the ones that turn a daily user into a paying subscriber. '
        'Revisit this document every quarter and re-prioritize based on what users actually ask for.'
    )
    closing = Table([[Paragraph(closing_text, CALLOUT)]], colWidths=[170 * mm])
    closing.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BG_POLISH),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LINEBEFORE', (0, 0), (0, -1), 3, SAFFRON),
    ]))
    story.append(closing)

    return story


# ────────────────────────────────────────────────────────────────────────────
# Generate
# ────────────────────────────────────────────────────────────────────────────

OUTPUT_PATH = '/home/z/my-project/download/BahiKhata-Pro-Feature-Roadmap.pdf'

doc = SimpleDocTemplate(
    OUTPUT_PATH,
    pagesize=A4,
    leftMargin=20 * mm,
    rightMargin=20 * mm,
    topMargin=20 * mm,
    bottomMargin=20 * mm,
    title='BahiKhata Pro — Feature Roadmap',
    author='BahiKhata Pro',
    subject='Future development plan for BahiKhata Pro',
    creator='BahiKhata Pro',
)

doc.build(build_story(), onFirstPage=on_page, onLaterPages=on_page)
print(f'PDF generated: {OUTPUT_PATH}')
print(f'Size: {os.path.getsize(OUTPUT_PATH) / 1024:.1f} KB')
