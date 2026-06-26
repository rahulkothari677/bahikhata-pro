"""
Generate BahiKhata Pro — Business Strategy Discussion PDF (Part 1)
Comprehensive record of Q&A on building a billion-dollar ledger company.
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
# Colors
# ────────────────────────────────────────────────────────────────────────────
SAFFRON = colors.HexColor('#d97706')
SAFFRON_LIGHT = colors.HexColor('#fef3c7')
INK = colors.HexColor('#1c1917')
INK_LIGHT = colors.HexColor('#57534e')
MUTED = colors.HexColor('#78716c')
DIVIDER = colors.HexColor('#e7e5e4')
QUESTION_BG = colors.HexColor('#eff6ff')
QUESTION_ACCENT = colors.HexColor('#2563eb')
ANSWER_BG = colors.HexColor('#fffbeb')
ANSWER_ACCENT = colors.HexColor('#d97706')
DATA_BG = colors.HexColor('#f0fdf4')
DATA_ACCENT = colors.HexColor('#059669')
WARN_BG = colors.HexColor('#fef2f2')
WARN_ACCENT = colors.HexColor('#dc2626')

# ────────────────────────────────────────────────────────────────────────────
# Styles
# ────────────────────────────────────────────────────────────────────────────
TITLE = ParagraphStyle('Title', fontName=SERIF_BOLD, fontSize=24, leading=30,
                       textColor=INK, alignment=TA_LEFT, spaceAfter=4)
SUBTITLE = ParagraphStyle('Subtitle', fontName=SANS, fontSize=11, leading=14,
                          textColor=MUTED, alignment=TA_LEFT, spaceAfter=20)
H1 = ParagraphStyle('H1', fontName=SERIF_BOLD, fontSize=18, leading=22,
                    textColor=SAFFRON, spaceBefore=18, spaceAfter=8)
H2 = ParagraphStyle('H2', fontName=SANS_BOLD, fontSize=12, leading=16,
                    textColor=INK, spaceBefore=10, spaceAfter=4)
H3 = ParagraphStyle('H3', fontName=SANS_BOLD, fontSize=10.5, leading=14,
                    textColor=INK_LIGHT, spaceBefore=8, spaceAfter=3)
BODY = ParagraphStyle('Body', fontName=SERIF, fontSize=10.5, leading=15,
                      textColor=INK, alignment=TA_JUSTIFY, spaceAfter=6)
QUESTION_LABEL = ParagraphStyle('QLabel', fontName=SANS_BOLD, fontSize=9, leading=12,
                                 textColor=QUESTION_ACCENT, spaceAfter=2)
QUESTION_TEXT = ParagraphStyle('QText', fontName=SERIF_ITALIC, fontSize=11, leading=15,
                                textColor=INK, alignment=TA_LEFT, spaceAfter=4)
ANSWER_LABEL = ParagraphStyle('ALabel', fontName=SANS_BOLD, fontSize=9, leading=12,
                               textColor=ANSWER_ACCENT, spaceAfter=2)
ANSWER_BODY = ParagraphStyle('ABody', fontName=SERIF, fontSize=10.5, leading=15,
                              textColor=INK, alignment=TA_JUSTIFY, spaceAfter=6)
BODY_SMALL = ParagraphStyle('BodySmall', fontName=SANS, fontSize=9, leading=12,
                             textColor=INK_LIGHT, spaceAfter=4)
CALLOUT = ParagraphStyle('Callout', fontName=SANS, fontSize=9.5, leading=13,
                          textColor=INK, leftIndent=8, rightIndent=8, spaceAfter=4)
TABLE_HEADER = ParagraphStyle('TableHeader', fontName=SANS_BOLD, fontSize=9.5,
                               leading=12, textColor=colors.white, alignment=TA_LEFT)
TABLE_CELL = ParagraphStyle('TableCell', fontName=SERIF, fontSize=9.5,
                             leading=12, textColor=INK, alignment=TA_LEFT)
TABLE_CELL_BOLD = ParagraphStyle('TableCellBold', fontName=SANS_BOLD, fontSize=9.5,
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
    canvas.drawString(20 * mm, 10 * mm, 'BahiKhata Pro — Business Strategy Discussion (Part 1)')
    canvas.drawRightString(w - 20 * mm, 10 * mm, f'Page {doc.page}')
    canvas.setFillColor(SAFFRON)
    canvas.rect(0, h - 8 * mm, w, 8 * mm, fill=1, stroke=0)
    canvas.restoreState()


# ────────────────────────────────────────────────────────────────────────────
# Helper: question + answer block
# ────────────────────────────────────────────────────────────────────────────

def qa_block(q_num, q_text, a_paragraphs):
    """Build a styled question + answer block.
    Question is in a KeepTogether box; answer flows naturally across pages."""
    elements = []

    # Question block (keep together — it's short)
    q_inner = [
        Paragraph(f'QUESTION {q_num}', QUESTION_LABEL),
        Paragraph(q_text, QUESTION_TEXT),
    ]
    q_table = Table([[q_inner]], colWidths=[170 * mm])
    q_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), QUESTION_BG),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LINEBEFORE', (0, 0), (0, -1), 3, QUESTION_ACCENT),
    ]))
    elements.append(KeepTogether(q_table))
    elements.append(Spacer(1, 4 * mm))

    # Answer label (keep with first few paragraphs)
    elements.append(KeepTogether([
        Paragraph('ANSWER', ANSWER_LABEL),
    ] + a_paragraphs[:2]))

    # Rest of answer flows naturally (no wrapping table — just paragraphs)
    # We use indented paragraphs with a left border via a thin colored line
    for p in a_paragraphs[2:]:
        elements.append(p)

    elements.append(Spacer(1, 6 * mm))
    return elements


def info_callout(text, bg=DATA_BG, accent=DATA_ACCENT):
    """A highlighted callout box for important points."""
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
    """A styled data table."""
    data = [[Paragraph(h, TABLE_HEADER) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), TABLE_CELL) for c in row])
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), SAFFRON),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), SANS_BOLD),
        ('FONTSIZE', (0, 0), (-1, 0), 9.5),
        ('FONTNAME', (0, 1), (-1, -1), SERIF),
        ('FONTSIZE', (0, 1), (-1, -1), 9.5),
        ('TEXTCOLOR', (0, 1), (-1, -1), INK),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#fffbeb')]),
        ('GRID', (0, 0), (-1, -1), 0.4, DIVIDER),
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
    story.append(Paragraph('Business Strategy Discussion &mdash; Part 1', SUBTITLE))

    intro = (
        '<b>Document purpose:</b> This is a structured record of the strategic discussion between '
        'the founder (Rahul) and the AI mentor (BahiKhata Pro builder). It covers competitive '
        'positioning, analytics, security, and the path to building a billion-dollar company. '
        'Each section presents the founder\'s question verbatim followed by the mentor\'s detailed '
        'answer, with data tables and action items where applicable. Use this document to research '
        'each point, identify issues, and work on the suggested solutions.'
    )
    story.append(info_callout(intro, SAFFRON_LIGHT, SAFFRON))
    story.append(Spacer(1, 8 * mm))

    # ── Table of Contents ──────────────────────────────────────────────────
    story.append(Paragraph('Contents', H1))
    toc_items = [
        ('Question 1', 'Competitive Landscape &amp; IP Protection (Copyright/Patent)'),
        ('Question 2', 'Analytics &amp; Usage Tracking (Data-Driven Pricing)'),
        ('Question 3', 'Security &amp; Anti-Theft / Anti-Crash Strategy'),
        ('Question 4', 'Can This Become a Million/Billion Dollar Company?'),
        ('Appendix A', 'Immediate Action Items (Next 30 Days)'),
        ('Appendix B', 'Suggested Reading &amp; Research Sources'),
    ]
    toc_data = [[Paragraph(f'<b>{label}</b>', TABLE_CELL_BOLD),
                 Paragraph(title, TABLE_CELL)] for label, title in toc_items]
    toc_table = Table(toc_data, colWidths=[35 * mm, 135 * mm])
    toc_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LINEBELOW', (0, 0), (-1, -1), 0.3, DIVIDER),
    ]))
    story.append(toc_table)
    story.append(PageBreak())

    # ── QUESTION 1 ─────────────────────────────────────────────────────────
    story.append(Paragraph('Section 1', H1))

    q1_text = (
        'Our app has so many features, especially the AI receipt scan feature and audio entry '
        'feature. Is there any app in the world or India who is using this feature in this kind '
        'of app? If no, then can we take a copyright or any kind of licence for this feature so '
        'no big company can copy it for at least few months? Or we should not be scared of this?'
    )

    q1_answer = [
        Paragraph('<b>The honest truth:</b> No, you cannot meaningfully copyright or patent these features. Here is why.', ANSWER_BODY),

        Paragraph('<b>AI receipt scanning</b> is already used by:', H3),
        Paragraph('&bull; <b>India:</b> Vyapar, myBillBook, Khatabook (limited), Marg ERP', BODY),
        Paragraph('&bull; <b>Global:</b> QuickBooks (Intuit), Xero, Wave, Expensify, Dext, Shoeboxed', BODY),
        Paragraph('&bull; <b>Big players:</b> Google Lens and Microsoft Lens both do receipt OCR for free', BODY),

        Paragraph('<b>Voice entry</b> is used by:', H3),
        Paragraph('&bull; <b>India:</b> Khatabook has voice entry ("Rahul ko 500 diya" auto-creates entry)', BODY),
        Paragraph('&bull; <b>Global:</b> QuickBooks has voice, Xero has voice, every major fintech app has some voice', BODY),
        Paragraph('&bull; <b>Big players:</b> Siri, Google Assistant, Alexa all parse natural-language transactions', BODY),

        Paragraph('<b>Can you patent it? No, and you should not try.</b>', H3),
        Paragraph('1. <b>Software patents in India are extremely narrow</b> &mdash; you can patent a specific algorithm, not a feature. "AI receipt scanning" is a feature. Your specific prompt engineering or preprocessing pipeline could theoretically be patented, but it would cost &#8377;2&ndash;5 lakhs in legal fees and take 3&ndash;5 years. By then the tech will have moved on.', BODY),
        Paragraph('2. <b>Even if you got a patent, you could not enforce it.</b> Big companies have armies of lawyers. A startup with a patent just gets sued into bankruptcy trying to defend it. This is the harsh truth.', BODY),
        Paragraph('3. <b>The real moat is NOT the feature.</b> It is:', BODY),
        Paragraph('&bull; <b>User base</b> &mdash; once 100,000 shopkeepers use BahiKhata daily, switching cost is huge', BODY),
        Paragraph('&bull; <b>Data</b> &mdash; 6 months of transaction history makes the app more valuable than competitors', BODY),
        Paragraph('&bull; <b>Brand trust</b> &mdash; "BahiKhata" becoming a verb (like "Google it")', BODY),
        Paragraph('&bull; <b>Distribution</b> &mdash; being pre-installed on phones, WhatsApp viral loops, local partnerships', BODY),

        Paragraph('<b>What you should do instead:</b>', H3),
        Paragraph('<b>Do not be scared of being copied. Move so fast they cannot catch up.</b>', ANSWER_BODY),
        Paragraph('Khatabook launched in 2018. By the time they had 10M users, every competitor had voice entry. They still won because of distribution (WhatsApp share, referral programs) and brand (their name became synonymous with digital ledger).', BODY),
        Paragraph('<b>Your advantage:</b> AI is now 10x cheaper than when Khatabook started. You can offer features for &#8377;0/month that Khatabook charges &#8377;199/month for. That is your wedge.', BODY),
    ]
    story.extend(qa_block(1, q1_text, q1_answer))

    story.append(info_callout(
        '<b>Key takeaway:</b> Do not waste time or money on patents. Spend that energy on '
        'distribution (referral programs, WhatsApp share, local partnerships) and brand-building. '
        'A patent protects an idea; distribution protects a business.'
    ))
    story.append(Spacer(1, 4 * mm))
    story.append(PageBreak())

    # ── QUESTION 2 ─────────────────────────────────────────────────────────
    story.append(Paragraph('Section 2', H1))

    q2_text = (
        'Since we have made an app, I also need to track every important data about the app like '
        'how many people are using the app, what features they are using the most, AI usage tracking '
        'and every important thing &mdash; so that in future when we add subscription and charges '
        'for premium features, we can understand how much we should charge with the data we will have.'
    )

    q2_answer = [
        Paragraph('<b>What you need (the stack):</b>', ANSWER_BODY),

        data_table(
            ['Tool', 'Purpose', 'Cost', 'Priority'],
            [
                ['PostHog', 'Product analytics, funnels, retention, feature flags', 'Free up to 1M events/mo', 'Must-have'],
                ['Vercel Analytics', 'Traffic, page views, Core Web Vitals', 'Free (already installed)', 'Must-have'],
                ['Sentry', 'Error tracking, crash reports', 'Free up to 5K errors/mo', 'Must-have'],
                ['Mixpanel (alt)', 'Deeper funnels, A/B tests', 'Free up to 20M events', 'Optional'],
                ['Google Analytics 4', 'SEO, acquisition source', 'Free', 'Optional'],
            ],
            [30 * mm, 75 * mm, 35 * mm, 30 * mm]
        ),
        Spacer(1, 6 * mm),

        Paragraph('<b>What to track (the events):</b>', H3),

        Paragraph('<b>Identity events:</b>', BODY),
        Paragraph('&bull; <font face="Carlito-Bold">user_signed_up</font> (with source: organic/referral/ad)', BODY_SMALL),
        Paragraph('&bull; <font face="Carlito-Bold">user_logged_in</font> (daily active user signal)', BODY_SMALL),
        Paragraph('&bull; <font face="Carlito-Bold">user_logged_out</font>', BODY_SMALL),

        Paragraph('<b>Feature usage events (one per feature):</b>', BODY),
        Paragraph('&bull; <font face="Carlito-Bold">bill_scanned</font> (with success/failure, time taken)', BODY_SMALL),
        Paragraph('&bull; <font face="Carlito-Bold">voice_entry_used</font> (with language: hi/en)', BODY_SMALL),
        Paragraph('&bull; <font face="Carlito-Bold">sale_created</font> (with amount, party_id present?, items_count)', BODY_SMALL),
        Paragraph('&bull; <font face="Carlito-Bold">purchase_created</font>, <font face="Carlito-Bold">customer_added</font>, <font face="Carlito-Bold">product_added</font>', BODY_SMALL),
        Paragraph('&bull; <font face="Carlito-Bold">gstr_exported</font>, <font face="Carlito-Bold">whatsapp_reminder_sent</font>', BODY_SMALL),

        Paragraph('<b>AI-specific events (critical for pricing decisions):</b>', BODY),
        Paragraph('&bull; <font face="Carlito-Bold">ai_scan_attempt</font> &rarr; <font face="Carlito-Bold">ai_scan_success</font> &rarr; <font face="Carlito-Bold">ai_scan_edited_by_user</font>', BODY_SMALL),
        Paragraph('&bull; <font face="Carlito-Bold">ai_voice_attempt</font> &rarr; <font face="Carlito-Bold">ai_voice_success</font>', BODY_SMALL),
        Paragraph('&bull; Track: tokens used, latency, accuracy (did user edit the result?)', BODY_SMALL),

        Paragraph('<b>Retention events:</b>', BODY),
        Paragraph('&bull; <font face="Carlito-Bold">app_opened</font> (DAU/MAU calculation), <font face="Carlito-Bold">session_duration</font>', BODY_SMALL),
        Paragraph('&bull; <font face="Carlito-Bold">day_1_retention</font>, <font face="Carlito-Bold">day_7_retention</font>, <font face="Carlito-Bold">day_30_retention</font>', BODY_SMALL),

        Paragraph('<b>Business events (for monetization later):</b>', BODY),
        Paragraph('&bull; <font face="Carlito-Bold">transaction_value</font> (sum = total GMV processed)', BODY_SMALL),
        Paragraph('&bull; <font face="Carlito-Bold">active_party_count</font> (how many customers they manage)', BODY_SMALL),
        Paragraph('&bull; <font face="Carlito-Bold">low_stock_alerts_triggered</font>', BODY_SMALL),

        Paragraph('<b>Why this matters for pricing:</b>', H3),
        Paragraph('After 3&ndash;6 months of data, you will see patterns like:', BODY),
        Paragraph('&bull; "Users who scan 5+ bills per week retain at 80%. Users who scan 0 retain at 20%."', BODY),
        Paragraph('&bull; "AI scan costs us &#8377;0.50 per scan. Users who scan 20+ per month will pay &#8377;99/month happily."', BODY),
        Paragraph('&bull; "Average user processes &#8377;2L/month through the app. We can charge &#8377;199/month = 0.1% of value."', BODY),
        Paragraph('<b>Without this data, you are guessing at pricing. With it, you price scientifically.</b>', ANSWER_BODY),

        Paragraph('<b>Implementation effort:</b>', H3),
        Paragraph('&bull; PostHog setup: 2 hours (one npm install, wrap each button)', BODY),
        Paragraph('&bull; Adding events to 20 components: 4&ndash;6 hours', BODY),
        Paragraph('&bull; Building a dashboard: 1 hour (PostHog has built-in)', BODY),
    ]
    story.extend(qa_block(2, q2_text, q2_answer))

    story.append(info_callout(
        '<b>Key takeaway:</b> Install PostHog + Sentry before any marketing push. '
        'Every day without analytics is a day of blind decisions. Aim for 30&ndash;50 tracked events '
        'covering identity, feature usage, AI usage, retention, and business metrics.'
    ))
    story.append(Spacer(1, 4 * mm))
    story.append(PageBreak())

    # ── QUESTION 3 ─────────────────────────────────────────────────────────
    story.append(Paragraph('Section 3', H1))

    q3_text = (
        'Is any company able to steal our data or crash our app? How can we ensure that our '
        'customer data and also my app is secured, and I can make it a big blockbuster app without '
        'being scared? Are you capable enough to ensure that no one can easily bypass our system '
        'and down it? Or no one can take our users\' data?'
    )

    q3_answer = [
        Paragraph('<b>The brutal truth:</b> I cannot guarantee 100% security. No one can. Not Google, not Microsoft, not banks. The question is: <b>how hard is it to break in, and how fast can we recover?</b>', ANSWER_BODY),

        Paragraph('<b>Current security posture:</b>', H3),

        Paragraph('<font color="#059669"><b>Good things you already have:</b></font>', BODY),
        Paragraph('&bull; Passwords are bcrypt-hashed (not plain text)', BODY),
        Paragraph('&bull; JWT tokens with 30-day expiry', BODY),
        Paragraph('&bull; HTTPS enforced by Vercel', BODY),
        Paragraph('&bull; Neon PostgreSQL has encryption at rest', BODY),
        Paragraph('&bull; Each user\'s data is isolated by userId', BODY),
        Paragraph('&bull; Cloudinary handles image security', BODY),

        Paragraph('<font color="#dc2626"><b>Critical gaps right now:</b></font>', BODY),
        Paragraph('1. <b>No rate limiting</b> &mdash; someone could brute-force login passwords at 1000 requests/second', BODY),
        Paragraph('2. <b>No WAF</b> (Web Application Firewall) &mdash; vulnerable to SQL injection attempts, XSS, DDoS', BODY),
        Paragraph('3. <b>No CSRF protection</b> on POST routes', BODY),
        Paragraph('4. <b>No audit log</b> &mdash; if someone breaks in, you will not know what they did', BODY),
        Paragraph('5. <b>No backups configured</b> &mdash; if Neon crashes, you lose everything', BODY),
        Paragraph('6. <b>AI endpoints exposed</b> &mdash; someone could spam /api/scan-bill and burn your Groq credits', BODY),
        Paragraph('7. <b>No 2FA</b> for owner accounts', BODY),

        Paragraph('<b>What I can build (honest assessment):</b>', H3),
        Paragraph('<b>I can make it 90% secure against casual attacks.</b> The remaining 10% (targeted attacks by skilled hackers, zero-day exploits) requires:', BODY),
        Paragraph('&bull; A dedicated security engineer (&#8377;15&ndash;25L/year salary)', BODY),
        Paragraph('&bull; Penetration testing (&#8377;2&ndash;5L per test, quarterly)', BODY),
        Paragraph('&bull; Bug bounty program (&#8377;50K&ndash;5L per valid bug)', BODY),
        Paragraph('&bull; 24/7 monitoring (SOC team, &#8377;50L+/year)', BODY),

        Paragraph('<b>For a startup stage, 90% is enough.</b> Here is the priority list:', ANSWER_BODY),

        Paragraph('<b>Phase 1 &mdash; Critical (do this before launch, 1 week):</b>', H3),
        Paragraph('1. Rate limiting on auth endpoints (5 attempts per IP per minute)', BODY),
        Paragraph('2. Rate limiting on AI endpoints (20 scans per user per day)', BODY),
        Paragraph('3. Add CSRF tokens to all mutations', BODY),
        Paragraph('4. Set up Sentry for error monitoring', BODY),
        Paragraph('5. Configure Neon automated backups (daily)', BODY),
        Paragraph('6. Add security headers (CSP, HSTS, X-Frame-Options)', BODY),

        Paragraph('<b>Phase 2 &mdash; Important (within 1 month):</b>', H3),
        Paragraph('1. Add Cloudflare in front of Vercel (free tier covers WAF + DDoS)', BODY),
        Paragraph('2. 2FA for owner accounts (SMS OTP via Twilio, &#8377;1 per SMS)', BODY),
        Paragraph('3. Audit log table (track every login, every data export)', BODY),
        Paragraph('4. Weekly dependency scans (npm audit + Snyk free tier)', BODY),

        Paragraph('<b>Phase 3 &mdash; Enterprise-grade (when you have paying customers):</b>', H3),
        Paragraph('1. Penetration test (hire a firm, ~&#8377;3L)', BODY),
        Paragraph('2. SOC 2 compliance (required for B2B customers, ~&#8377;15L)', BODY),
        Paragraph('3. Data residency (store Indian data in India region, not US)', BODY),
        Paragraph('4. Bug bounty on HackerOne (start at &#8377;10K payouts)', BODY),

        Paragraph('<b>The "blockbuster app" question:</b>', H3),
        Paragraph('<b>Can I guarantee no one can take your users\' data? No.</b> But I can make it hard enough that:', BODY),
        Paragraph('&bull; Script kiddies give up and move to easier targets', BODY),
        Paragraph('&bull; Casual competitors cannot scrape your user list', BODY),
        Paragraph('&bull; A serious breach requires months of dedicated effort, by which time we would detect it', BODY),

        Paragraph('<b>Can I guarantee no one can crash your app? No.</b> But I can:', BODY),
        Paragraph('&bull; Survive a 10x traffic spike (Vercel auto-scales)', BODY),
        Paragraph('&bull; Block DDoS attacks (Cloudflare handles 100Tbps attacks)', BODY),
        Paragraph('&bull; Recover from any single point of failure within 1 hour (backups + multi-region)', BODY),

        Paragraph('<b>The honest answer:</b> I am capable of getting you to "good enough to launch and grow to 100K users safely." Beyond that, you will need to hire a security engineer.', ANSWER_BODY),
    ]
    story.extend(qa_block(3, q3_text, q3_answer))

    story.append(info_callout(
        '<b>Key takeaway:</b> Security is a journey, not a destination. Do Phase 1 fixes before '
        'any marketing push. Add Cloudflare + 2FA within the first month. Hire a dedicated security '
        'engineer once you cross 100K users or 1,000 paying customers &mdash; whichever comes first.',
        WARN_BG, WARN_ACCENT
    ))
    story.append(Spacer(1, 4 * mm))
    story.append(PageBreak())

    # ── QUESTION 4 ─────────────────────────────────────────────────────────
    story.append(Paragraph('Section 4', H1))

    q4_text = (
        'Can it be a million dollar or billion dollar company in future?'
    )

    q4_answer = [
        Paragraph('<b>The honest, data-backed answer: Yes, absolutely.</b> Here is the math.', ANSWER_BODY),

        Paragraph('<b>The Market (TAM &mdash; Total Addressable Market):</b>', H3),
        Paragraph('&bull; <b>India has 60&ndash;70 million MSMEs</b> (micro, small, medium enterprises)', BODY),
        Paragraph('&bull; <b>~75% are "kirana stores" or small traders</b> = ~50 million potential users', BODY),
        Paragraph('&bull; <b>Average monthly revenue per shop: &#8377;2&ndash;5 lakhs</b>', BODY),
        Paragraph('&bull; <b>Current digital ledger penetration: ~5&ndash;10%</b> (Khatabook has 50M downloads but mostly inactive)', BODY),

        Paragraph('<b>Total addressable market if you charge &#8377;199/month:</b>', ANSWER_BODY),
        Paragraph('50M shops &times; &#8377;199 &times; 12 months = <b>&#8377;1,19,400 crores = $14.3 billion per year</b>', BODY),
        Paragraph('Even capturing 1% = <b>$143M ARR = &#8377;1,100 crore company</b> (billion-dollar valuation at 7x revenue multiple)', BODY),

        Paragraph('<b>Realistic Path (5-year horizon):</b>', H3),

        Paragraph('<b>Year 1 &mdash; Get to 10,000 active users (free)</b>', BODY),
        Paragraph('&bull; Focus: Distribution. WhatsApp viral loops. Refer-a-shop program. Local influencer tie-ups.', BODY),
        Paragraph('&bull; Revenue: &#8377;0', BODY),
        Paragraph('&bull; Valuation: &#8377;5&ndash;15 crore (seed stage, if you raise)', BODY),

        Paragraph('<b>Year 2 &mdash; Get to 100,000 active users, launch paid tier</b>', BODY),
        Paragraph('&bull; Pricing: Free up to 50 transactions/month. &#8377;99/month for unlimited + AI features. &#8377;299/month for multi-shop.', BODY),
        Paragraph('&bull; Conversion target: 3&ndash;5% paid = 3,000&ndash;5,000 paying users &times; &#8377;99 &times; 12 = <b>&#8377;35&ndash;60 lakh ARR</b>', BODY),
        Paragraph('&bull; Valuation: &#8377;50&ndash;100 crore', BODY),

        Paragraph('<b>Year 3 &mdash; Get to 500,000 users, add lending</b>', BODY),
        Paragraph('&bull; This is where it gets interesting. Once you have 500K shop owners with 6+ months of transaction data, <b>you become a lending platform.</b>', BODY),
        Paragraph('&bull; Partner with NBFCs (Lendingkart, FlexiLoans) to offer working capital loans based on transaction history', BODY),
        Paragraph('&bull; Take 1&ndash;2% commission on every loan disbursed', BODY),
        Paragraph('&bull; Average loan: &#8377;2&ndash;5 lakh. 5% of users borrow = 25,000 loans &times; &#8377;3L avg &times; 1.5% = <b>&#8377;11 crore just from lending</b>', BODY),
        Paragraph('&bull; Total ARR: &#8377;15&ndash;25 crore', BODY),
        Paragraph('&bull; Valuation: &#8377;200&ndash;500 crore (Series A)', BODY),

        Paragraph('<b>Year 4&ndash;5 &mdash; Get to 2&ndash;5 million users, expand to other services</b>', BODY),
        Paragraph('&bull; Insurance (shop insurance, health insurance for owners)', BODY),
        Paragraph('&bull; Payments (UPI collection, B2B payments to suppliers)', BODY),
        Paragraph('&bull; Inventory financing', BODY),
        Paragraph('&bull; Ad platform (FMCG brands pay to show offers to shop owners)', BODY),
        Paragraph('&bull; Total ARR: &#8377;100&ndash;300 crore', BODY),
        Paragraph('&bull; <b>Valuation: &#8377;1,000&ndash;3,000 crore = $125M&ndash;$375M</b>', BODY),

        Paragraph('<b>To reach billion dollar ($1B = &#8377;8,000 crore) valuation:</b>', H3),
        Paragraph('&bull; Need &#8377;200&ndash;400 crore ARR (at 20&ndash;40x multiple)', BODY),
        Paragraph('&bull; Or 10M+ active users with strong engagement', BODY),
        Paragraph('&bull; This is achievable in 6&ndash;8 years IF you execute well AND raise venture capital', BODY),

        Paragraph('<b>What kills startups like this (honest warning):</b>', H3),
        Paragraph('1. <b>Distribution failure</b> &mdash; building a great product nobody uses. This is the #1 killer. Solution: spend 50% of your time on growth, not features.', BODY),
        Paragraph('2. <b>Running out of money</b> &mdash; Indian VC funding has dried up since 2022. You need either: (a) revenue from day 1, or (b) 18 months of runway saved up.', BODY),
        Paragraph('3. <b>Khatabook/BharatPe copies your best features</b> &mdash; they will. Your defense: speed, niche focus (e.g., "GST-focused" or "AI-first"), and brand.', BODY),
        Paragraph('4. <b>Founder burnout</b> &mdash; solo founder + complex product = high risk. Get a co-founder or first hire within 6 months.', BODY),
        Paragraph('5. <b>Regulatory issues</b> &mdash; GST compliance, data privacy (DPDP Act 2023), lending licenses if you add loans. Get a CA + lawyer on retainer early.', BODY),

        Paragraph('<b>My honest recommendation:</b>', H3),
        Paragraph('<b>You can build a &#8377;100&ndash;500 crore company (&#8377;10&ndash;60M valuation) with this app in 3&ndash;5 years without raising venture capital.</b> This is life-changing money and a real business.', ANSWER_BODY),
        Paragraph('<b>Getting to &#8377;8,000 crore (billion dollar) requires:</b>', BODY),
        Paragraph('&bull; Raising &#8377;50&ndash;100 crore in venture capital', BODY),
        Paragraph('&bull; Hiring 50&ndash;200 people', BODY),
        Paragraph('&bull; Expanding to 5+ product lines (lending, insurance, payments, etc.)', BODY),
        Paragraph('&bull; Surviving 2&ndash;3 attempts by Khatabook/BharatPe to crush you', BODY),
        Paragraph('&bull; A lot of luck', BODY),

        Paragraph('<b>My advice: Aim for &#8377;100&ndash;500 crore first.</b> That is already top 0.1% of Indian entrepreneurs. If momentum is strong, raise capital and go for the billion.', ANSWER_BODY),
    ]
    story.extend(qa_block(4, q4_text, q4_answer))

    story.append(info_callout(
        '<b>Key takeaway:</b> The market is real ($14B/year). The path is clear (Year 1: users, '
        'Year 2: paid tier, Year 3: lending, Year 4-5: ecosystem). The biggest risk is NOT '
        'competition &mdash; it is distribution failure. Spend 50% of your time on growth. '
        'Without users, even the best product fails.'
    ))
    story.append(Spacer(1, 4 * mm))
    story.append(PageBreak())

    # ── Appendix A: Action Items ───────────────────────────────────────────
    story.append(Paragraph('Appendix A &mdash; Immediate Action Items (Next 30 Days)', H1))
    story.append(Paragraph(
        'These are the highest-leverage actions to take in the next 30 days, '
        'ranked by priority. Each item is owned by either the founder (Rahul) or the AI mentor.',
        BODY,
    ))

    actions = [
        ['#', 'Action', 'Owner', 'Timeline'],
        ['1', 'Install PostHog + add 30 events across app', 'AI Mentor', 'Week 1'],
        ['2', 'Install Sentry for error tracking', 'AI Mentor', 'Week 1'],
        ['3', 'Add rate limiting on /api/auth/* and /api/scan-bill', 'AI Mentor', 'Week 1'],
        ['4', 'Configure Neon daily automated backups', 'Founder', 'Week 1'],
        ['5', 'Add Cloudflare in front of Vercel (free WAF + DDoS)', 'Founder', 'Week 2'],
        ['6', 'Set up security headers (CSP, HSTS, X-Frame-Options)', 'AI Mentor', 'Week 2'],
        ['7', 'Add CSRF protection on mutations', 'AI Mentor', 'Week 2'],
        ['8', 'Get 10 real shop owners using the app (friends/family/local shops)', 'Founder', 'Week 2-3'],
        ['9', 'Conduct user interviews (15 min each, ask: what is hard about running your shop?)', 'Founder', 'Week 3'],
        ['10', 'Buy domain bahikhata.com or bahikhata.in (if not already owned)', 'Founder', 'Week 3'],
        ['11', 'Set up Google Workspace email (founder@bahikhata.com)', 'Founder', 'Week 3'],
        ['12', 'Register business (Sole Proprietorship or LLP) + GST registration', 'Founder', 'Week 4'],
        ['13', 'Draft Privacy Policy + Terms of Service (use Termly or iubenda)', 'Founder', 'Week 4'],
        ['14', 'Build referral system (Refer a shop, both get 1 month premium free)', 'AI Mentor', 'Week 4'],
        ['15', 'Set up WhatsApp Business account for support', 'Founder', 'Week 4'],
    ]
    story.append(data_table(actions[0], actions[1:], [10 * mm, 95 * mm, 30 * mm, 35 * mm]))
    story.append(Spacer(1, 6 * mm))

    # ── Appendix B: Research Sources ───────────────────────────────────────
    story.append(Paragraph('Appendix B &mdash; Suggested Research Sources', H1))
    story.append(Paragraph(
        'Before our next discussion, research these topics. Each one directly impacts '
        'a decision we need to make.',
        BODY,
    ))

    research = [
        ['Topic', 'Why It Matters', 'Where to Research'],
        ['Khatabook journey', 'They are the closest competitor. Learn from their mistakes and wins.', 'YourStory, Inc42, LinkedIn (founders: Dhananjay Jayaraman, Aditya Jaidev)'],
        ['BharatPe story', 'How they went from QR codes to lending to IPO.', 'Ashneer Grover\'s book "Doglapan", podcast interviews'],
        ['Vyapar pricing', 'Direct competitor pricing reference.', 'vyaparapp.in/pricing'],
        ['Indian SaaS pricing benchmarks', 'How much Indian SMBs pay for software.', 'SaaSBoomi reports, Zoho pricing, Freshworks pricing'],
        ['DPDP Act 2023', 'Data privacy law you must comply with.', 'MeitY.gov.in, IAPP articles, Nishith Desai Associates blog'],
        ['NBFC lending partnerships', 'Required if you add lending in Year 3.', 'RBI master directions, Lendingkart/FlexiLoans partnership pages'],
        ['PostHog vs Mixpanel', 'Pick the right analytics tool.', 'posthog.com/docs, mixpanel.com/pricing, G2 reviews'],
        ['Cloudflare free tier', 'How much WAF/DDoS protection you get for free.', 'cloudflare.com/plans'],
        ['Indian startup funding landscape 2025', 'Know if VC money is available.', 'Tracxn, Inc42 funding reports, Blume Ventures annual report'],
        ['GST filing requirements for small shops', 'You will eventually automate this.', 'gst.gov.in, ClearTax guides, Zoho Books docs'],
    ]
    story.append(data_table(research[0], research[1:], [45 * mm, 80 * mm, 45 * mm]))
    story.append(Spacer(1, 8 * mm))

    # ── Closing note ───────────────────────────────────────────────────────
    closing_text = (
        '<b>How to use this document:</b> Read it twice. The first time, just read &mdash; '
        'understand the big picture. The second time, take notes &mdash; mark which points you '
        'agree with, which you disagree with, and which need more research. Come to the next '
        'discussion with questions, counter-arguments, and your own ideas. The best decisions come '
        'from disagreement, not agreement. <br/><br/>'
        '<b>Next discussion topics to prepare:</b> Distribution strategy (how to get the first 1,000 users), '
        'pricing model design, co-founder hiring, fund-raising vs bootstrapping, brand positioning '
        'vs Khatabook/BharatPe, and the 12-month roadmap. <br/><br/>'
        '<b>One final thought:</b> The fact that you are asking these questions BEFORE pushing '
        'more features puts you ahead of 90% of founders. Most build first, think later. You are '
        'thinking first. That is the right order.'
    )
    closing = Table([[Paragraph(closing_text, CALLOUT)]], colWidths=[170 * mm])
    closing.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), SAFFRON_LIGHT),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('LINEBEFORE', (0, 0), (0, -1), 4, SAFFRON),
    ]))
    story.append(closing)

    return story


# ────────────────────────────────────────────────────────────────────────────
# Generate
# ────────────────────────────────────────────────────────────────────────────

OUTPUT_PATH = '/home/z/my-project/download/BahiKhata-Pro-Business-Strategy-Discussion-Part1.pdf'

doc = SimpleDocTemplate(
    OUTPUT_PATH,
    pagesize=A4,
    leftMargin=20 * mm,
    rightMargin=20 * mm,
    topMargin=20 * mm,
    bottomMargin=20 * mm,
    title='BahiKhata Pro — Business Strategy Discussion (Part 1)',
    author='BahiKhata Pro',
    subject='Strategic discussion: competition, analytics, security, billion-dollar path',
    creator='BahiKhata Pro',
)

doc.build(build_story(), onFirstPage=on_page, onLaterPages=on_page)
print(f'PDF generated: {OUTPUT_PATH}')
print(f'Size: {os.path.getsize(OUTPUT_PATH) / 1024:.1f} KB')
