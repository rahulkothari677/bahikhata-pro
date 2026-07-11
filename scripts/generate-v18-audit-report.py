#!/usr/bin/env python3
"""
Generate the V18 Post-Auditor Audit Report PDF.
Comprehensive audit after the auditor's fixes.
"""

import os
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# ── Font Registration ──────────────────────────────────────────────────────
FONT_DIR = '/usr/share/fonts'
pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')
pdfmetrics.registerFont(TTFont('NotoSansSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Medium.ttf'))
pdfmetrics.registerFont(TTFont('NotoSansSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
registerFontFamily('NotoSansSC', normal='NotoSansSC', bold='NotoSansSC-Bold')

# ── Color Palette ──────────────────────────────────────────────────────────
PRIMARY = colors.HexColor('#1e293b')
ACCENT = colors.HexColor('#0f766e')
ACCENT_LIGHT = colors.HexColor('#ccfbf1')
WARNING = colors.HexColor('#dc2626')
WARNING_LIGHT = colors.HexColor('#fef2f2')
SUCCESS = colors.HexColor('#16a34a')
SUCCESS_LIGHT = colors.HexColor('#f0fdf4')
NEUTRAL = colors.HexColor('#64748b')
BG_LIGHT = colors.HexColor('#f8fafc')
BORDER = colors.HexColor('#e2e8f0')

# ── Styles ─────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

style_title = ParagraphStyle('CustomTitle', parent=styles['Title'],
    fontName='NotoSansSC-Bold', fontSize=24, leading=30,
    textColor=PRIMARY, spaceAfter=6, alignment=TA_LEFT)
style_subtitle = ParagraphStyle('Subtitle', parent=styles['Normal'],
    fontName='NotoSansSC', fontSize=12, leading=16,
    textColor=NEUTRAL, spaceAfter=20, alignment=TA_LEFT)
style_h1 = ParagraphStyle('H1', parent=styles['Heading1'],
    fontName='NotoSansSC-Bold', fontSize=16, leading=22,
    textColor=PRIMARY, spaceBefore=24, spaceAfter=10)
style_h2 = ParagraphStyle('H2', parent=styles['Heading2'],
    fontName='NotoSansSC-Bold', fontSize=13, leading=18,
    textColor=ACCENT, spaceBefore=16, spaceAfter=8)
style_h3 = ParagraphStyle('H3', parent=styles['Heading3'],
    fontName='NotoSansSC-Bold', fontSize=11, leading=15,
    textColor=PRIMARY, spaceBefore=12, spaceAfter=6)
style_body = ParagraphStyle('Body', parent=styles['Normal'],
    fontName='NotoSerifSC', fontSize=10, leading=15,
    textColor=PRIMARY, spaceAfter=8, alignment=TA_JUSTIFY)
style_bullet = ParagraphStyle('Bullet', parent=style_body,
    leftIndent=20, bulletIndent=8, spaceAfter=4, alignment=TA_LEFT)
style_callout = ParagraphStyle('Callout', parent=style_body,
    fontSize=10, leading=14, textColor=PRIMARY,
    backColor=ACCENT_LIGHT, leftIndent=12, rightIndent=12,
    spaceBefore=8, spaceAfter=12, borderPadding=8, borderWidth=0, alignment=TA_LEFT)
style_warning = ParagraphStyle('Warning', parent=style_body,
    fontSize=10, leading=14, textColor=WARNING,
    backColor=WARNING_LIGHT, leftIndent=12, rightIndent=12,
    spaceBefore=8, spaceAfter=12, borderPadding=8, borderWidth=0, alignment=TA_LEFT)
style_success = ParagraphStyle('Success', parent=style_body,
    fontSize=10, leading=14, textColor=SUCCESS,
    backColor=SUCCESS_LIGHT, leftIndent=12, rightIndent=12,
    spaceBefore=8, spaceAfter=12, borderPadding=8, borderWidth=0, alignment=TA_LEFT)
style_table_header = ParagraphStyle('TableHeader', parent=styles['Normal'],
    fontName='NotoSansSC-Bold', fontSize=9, leading=12,
    textColor=colors.white, alignment=TA_LEFT)
style_table_cell = ParagraphStyle('TableCell', parent=styles['Normal'],
    fontName='NotoSerifSC', fontSize=9, leading=12,
    textColor=PRIMARY, alignment=TA_LEFT)
style_table_cell_center = ParagraphStyle('TableCellCenter', parent=style_table_cell, alignment=TA_CENTER)

# ── Document Setup ─────────────────────────────────────────────────────────
output_path = '/home/z/my-project/download/v18-post-auditor-audit-report.pdf'
os.makedirs(os.path.dirname(output_path), exist_ok=True)

doc = SimpleDocTemplate(output_path, pagesize=A4,
    leftMargin=20*mm, rightMargin=20*mm,
    topMargin=22*mm, bottomMargin=20*mm,
    title='V18 Post-Auditor Audit Report',
    author='BahiKhata Pro Engineering',
    subject='Comprehensive audit after auditor fixes',
    creator='Z.ai')

story = []

# ── COVER ──────────────────────────────────────────────────────────────────
story.append(Paragraph('V18 Post-Auditor Audit Report', style_title))
story.append(Paragraph('BahiKhata Pro &mdash; Comprehensive Audit After Auditor Fixes', style_subtitle))

summary_data = [
    [Paragraph('<b>Report Date</b>', style_table_cell), Paragraph('2026-07-12', style_table_cell)],
    [Paragraph('<b>Audit Scope</b>', style_table_cell), Paragraph('Full codebase audit after auditor commit 8d61e2f', style_table_cell)],
    [Paragraph('<b>Auditor Commit</b>', style_table_cell), Paragraph('V18: as-of TZ fix, dead-field cleanup, green test suite, branded Paise type', style_table_cell)],
    [Paragraph('<b>Tests</b>', style_table_cell), Paragraph('<font color="#16a34a"><b>739/739 PASSING</b></font> (was 736 + 3 failing + crash)', style_table_cell)],
    [Paragraph('<b>tsc --noEmit</b>', style_table_cell), Paragraph('<font color="#16a34a"><b>0 errors</b></font>', style_table_cell)],
    [Paragraph('<b>next build</b>', style_table_cell), Paragraph('<font color="#16a34a"><b>Succeeds</b></font>', style_table_cell)],
    [Paragraph('<b>Bugs Fixed by Auditor</b>', style_table_cell), Paragraph('BUG-002, BUG-008, BUG-010 + 3 correctness fixes', style_table_cell)],
    [Paragraph('<b>Bugs Still Open</b>', style_table_cell), Paragraph('1 (BUG-009, demo data only)', style_table_cell)],
    [Paragraph('<b>Remaining Issues</b>', style_table_cell), Paragraph('3 (H1: as any, H2: admin tests, Phase 4: DB migration)', style_table_cell)],
]
summary_table = Table(summary_data, colWidths=[45*mm, 125*mm])
summary_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (0, -1), BG_LIGHT),
    ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ('RIGHTPADDING', (0, 0), (-1, -1), 8),
]))
story.append(summary_table)
story.append(Spacer(1, 20))

# ── 1. EXECUTIVE SUMMARY ───────────────────────────────────────────────────
story.append(Paragraph('1. Executive Summary', style_h1))

story.append(Paragraph(
    'The auditor (commit 8d61e2f) made significant fixes across 8 files: '
    'correctness fixes (balance-as-of timezone, period-lock date formatting), '
    'dead code cleanup (BUG-002 parallel aggregates, BUG-010 removed dead '
    'discountAmount input), test suite repair (BUG-008 csv-export crash), and '
    'a forward-looking branded Paise type that enables type-safe paise migration. '
    'The test suite is now fully green at 739/739 (was 736 passing + 3 failing + '
    'a Jest worker crash).',
    style_body
))

story.append(Paragraph(
    'This audit verifies the auditor\'s fixes, scans for new issues, and identifies '
    'what remains. The codebase is in its healthiest state ever: zero tsc errors, '
    'zero build errors, all tests passing, no error-leaking routes, no SQL injection '
    'risks, no unhandled promise rejections, and all tenant isolation verified.',
    style_body
))

story.append(Paragraph(
    '<b>Bottom line:</b> The app is launch-ready from a code quality standpoint. '
    'The remaining items (H1: as any cleanup, H2: admin panel tests, Phase 4: DB '
    'migration) are improvements, not blockers. The branded Paise type the auditor '
    'introduced is the right foundation for a safe Phase 4 &mdash; it lets TypeScript '
    'catch rupee/paise mixups at compile time once the helper parameters are flipped.',
    style_callout
))

# ── 2. AUDITOR'S FIXES VERIFIED ────────────────────────────────────────────
story.append(PageBreak())
story.append(Paragraph('2. Auditor\'s Fixes &mdash; Verified', style_h1))

story.append(Paragraph(
    'The auditor\'s commit (8d61e2f) modified 8 files. Each fix was verified against '
    'the codebase and test suite.',
    style_body
))

# Auditor fixes table
fixes_data = [
    [Paragraph('<b>Fix</b>', style_table_header),
     Paragraph('<b>File(s)</b>', style_table_header),
     Paragraph('<b>Verification</b>', style_table_header)],
    [Paragraph('BUG-002: computePartyBalance parallel aggregates', style_table_cell),
     Paragraph('src/lib/party-balance.ts', style_table_cell),
     Paragraph('<font color="#16a34a"><b>VERIFIED</b></font> &mdash; 6 aggregates in single Promise.all, dead paymentsAgg removed', style_table_cell)],
    [Paragraph('BUG-008: csv-export test crash', style_table_cell),
     Paragraph('src/__tests__/lib/csv-export.test.ts', style_table_cell),
     Paragraph('<font color="#16a34a"><b>VERIFIED</b></font> &mdash; test passes, no Jest worker crash', style_table_cell)],
    [Paragraph('BUG-010: item.discountAmount dead input', style_table_cell),
     Paragraph('src/lib/validation.ts', style_table_cell),
     Paragraph('<font color="#16a34a"><b>VERIFIED</b></font> &mdash; field removed from transactionItemSchema', style_table_cell)],
    [Paragraph('Balance-as-of timezone fix', style_table_cell),
     Paragraph('src/app/api/parties/[id]/balance-as-of/route.ts', style_table_cell),
     Paragraph('<font color="#16a34a"><b>VERIFIED</b></font> &mdash; uses T23:59:59.999+05:30 (IST end-of-day)', style_table_cell)],
    [Paragraph('Balance-as-of accuracy caveat', style_table_cell),
     Paragraph('src/app/api/parties/[id]/balance-as-of/route.ts', style_table_cell),
     Paragraph('<font color="#16a34a"><b>VERIFIED</b></font> &mdash; accuracyWarning surfaced when invoice edited after as-of date', style_table_cell)],
    [Paragraph('Balance-as-of roundMoney parity', style_table_cell),
     Paragraph('src/app/api/parties/[id]/balance-as-of/route.ts', style_table_cell),
     Paragraph('<font color="#16a34a"><b>VERIFIED</b></font> &mdash; running balance uses roundMoney (was Math.round)', style_table_cell)],
    [Paragraph('Period-lock IST date formatting', style_table_cell),
     Paragraph('src/lib/period-lock.ts', style_table_cell),
     Paragraph('<font color="#16a34a"><b>VERIFIED</b></font> &mdash; PeriodLockedError formats in Asia/Kolkata', style_table_cell)],
    [Paragraph('Branded Paise type', style_table_cell),
     Paragraph('src/lib/money.ts', style_table_cell),
     Paragraph('<font color="#16a34a"><b>VERIFIED</b></font> &mdash; Paise branded type, helpers return Paise, compiles clean', style_table_cell)],
    [Paragraph('Tenant-isolation test updates', style_table_cell),
     Paragraph('src/__tests__/lib/tenant-isolation.test.ts', style_table_cell),
     Paragraph('<font color="#16a34a"><b>VERIFIED</b></font> &mdash; tests now verify M3 fix (enforced fields win)', style_table_cell)],
]
fixes_table = Table(fixes_data, colWidths=[55*mm, 50*mm, 65*mm])
fixes_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
    ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, BG_LIGHT]),
]))
story.append(fixes_table)
story.append(Spacer(1, 16))

story.append(Paragraph(
    '<b>No regressions found.</b> The auditor\'s changes are clean &mdash; all 739 '
    'tests pass, tsc reports 0 errors, and the production build succeeds. The '
    'branded Paise type is a particularly thoughtful addition: it widens to '
    '<code>number</code> freely (so existing callers compile), but creates a path '
    'for type-safe paise migration in Phase 4.',
    style_success
))

# ── 3. CODEBASE METRICS ────────────────────────────────────────────────────
story.append(PageBreak())
story.append(Paragraph('3. Codebase Metrics (Current State)', style_h1))

metrics_data = [
    [Paragraph('<b>Metric</b>', style_table_header),
     Paragraph('<b>V7 (Pre-Auditor)</b>', style_table_header),
     Paragraph('<b>V18 (Post-Auditor)</b>', style_table_header),
     Paragraph('<b>Trend</b>', style_table_header)],
    [Paragraph('Test Files', style_table_cell), Paragraph('30', style_table_cell_center), Paragraph('35', style_table_cell_center), Paragraph('<font color="#16a34a">+5</font>', style_table_cell_center)],
    [Paragraph('Individual Tests', style_table_cell), Paragraph('~573', style_table_cell_center), Paragraph('739', style_table_cell_center), Paragraph('<font color="#16a34a">+166</font>', style_table_cell_center)],
    [Paragraph('Tests Passing', style_table_cell), Paragraph('736/573* (3 failing + crash)', style_table_cell_center), Paragraph('739/739', style_table_cell_center), Paragraph('<font color="#16a34a">All green</font>', style_table_cell_center)],
    [Paragraph('tsc Errors', style_table_cell), Paragraph('0', style_table_cell_center), Paragraph('0', style_table_cell_center), Paragraph('<font color="#16a34a">Stable</font>', style_table_cell_center)],
    [Paragraph('API Routes', style_table_cell), Paragraph('~55', style_table_cell_center), Paragraph('62', style_table_cell_center), Paragraph('+7', style_table_cell_center)],
    [Paragraph('Prisma Models', style_table_cell), Paragraph('~51', style_table_cell_center), Paragraph('53', style_table_cell_center), Paragraph('+2', style_table_cell_center)],
    [Paragraph('Lib Modules', style_table_cell), Paragraph('~53', style_table_cell_center), Paragraph('56', style_table_cell_center), Paragraph('+3', style_table_cell_center)],
    [Paragraph('TODO/FIXME', style_table_cell), Paragraph('2', style_table_cell_center), Paragraph('2', style_table_cell_center), Paragraph('Stable', style_table_cell_center)],
    [Paragraph('console.log (prod code)', style_table_cell), Paragraph('7', style_table_cell_center), Paragraph('0**', style_table_cell_center), Paragraph('<font color="#16a34a">All removed</font>', style_table_cell_center)],
    [Paragraph('"as any" files', style_table_cell), Paragraph('49', style_table_cell_center), Paragraph('52', style_table_cell_center), Paragraph('+3 (see §5)', style_table_cell_center)],
    [Paragraph('Routes with apiError()', style_table_cell), Paragraph('29/55 (53%)', style_table_cell_center), Paragraph('35/62 (56%)', style_table_cell_center), Paragraph('<font color="#16a34a">+6</font>', style_table_cell_center)],
]
metrics_table = Table(metrics_data, colWidths=[40*mm, 40*mm, 45*mm, 35*mm])
metrics_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
    ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, BG_LIGHT]),
]))
story.append(metrics_table)
story.append(Spacer(1, 8))
story.append(Paragraph(
    '*V7 report counted ~573 tests but 3 were failing and csv-export crashed the '
    'worker. **4 remaining console.log references are all in comments/documentation, '
    'not actual code.',
    ParagraphStyle('Footnote', parent=style_body, fontSize=8, textColor=NEUTRAL)
))

# ── 4. SECURITY SCAN ───────────────────────────────────────────────────────
story.append(PageBreak())
story.append(Paragraph('4. Security Scan', style_h1))

story.append(Paragraph('4.1 Error Handling &mdash; No Leaks', style_h2))
story.append(Paragraph(
    'Scanned all 62 API routes for error details leaking to clients. <b>Zero routes '
    'leak <code>error.message</code> or <code>String(error)</code> to the client '
    'response.</b> 27 routes don\'t use the <code>apiError()</code> helper (which '
    'adds an errorId for log lookup), but they all return generic error messages. '
    'The 35 routes that do use <code>apiError()</code> log the full error server-side '
    'and return only a generic message + errorId.',
    style_body
))

story.append(Paragraph('4.2 SQL Injection &mdash; None', style_h2))
story.append(Paragraph(
    'Scanned all <code>$queryRaw</code> calls for string interpolation of user input. '
    'All raw SQL uses Prisma\'s tagged template literal syntax (<code>${"$"}{param}</code>) '
    'which parameterizes automatically. No string concatenation of user input into SQL. '
    '<b>Zero SQL injection risks found.</b>',
    style_body
))

story.append(Paragraph('4.3 Tenant Isolation &mdash; Verified', style_h2))
story.append(Paragraph(
    'Scanned all <code>db.*.findMany/findFirst/update/delete</code> calls for missing '
    '<code>userId</code> in the WHERE clause. All queries include <code>userId</code> '
    'filtering (via <code>activeTransactionWhere()</code> helper or inline). '
    '<b>Zero tenant isolation gaps found.</b>',
    style_body
))

story.append(Paragraph('4.4 Authentication Coverage', style_h2))
story.append(Paragraph(
    '8 API routes have no auth check &mdash; all are expected: <code>auth/*</code> (5 '
    'routes, they ARE the auth endpoints), <code>announcements</code> (public), '
    '<code>feature-flags</code> (public), <code>warmup</code> (DB ping, no user data), '
    'and the root <code>/api</code> route. <b>No auth gaps on data-bearing routes.</b>',
    style_body
))

story.append(Paragraph('4.5 Security Headers', style_h2))
headers_data = [
    [Paragraph('<b>Header</b>', style_table_header),
     Paragraph('<b>Main App</b>', style_table_header),
     Paragraph('<b>Admin Panel</b>', style_table_header)],
    [Paragraph('X-Frame-Options: DENY', style_table_cell), Paragraph('<font color="#16a34a">Present</font>', style_table_cell_center), Paragraph('<font color="#16a34a">Present</font>', style_table_cell_center)],
    [Paragraph('X-Content-Type-Options: nosniff', style_table_cell), Paragraph('<font color="#16a34a">Present</font>', style_table_cell_center), Paragraph('<font color="#16a34a">Present</font>', style_table_cell_center)],
    [Paragraph('Referrer-Policy', style_table_cell), Paragraph('<font color="#16a34a">Present</font>', style_table_cell_center), Paragraph('<font color="#16a34a">Present</font>', style_table_cell_center)],
    [Paragraph('HSTS (preload)', style_table_cell), Paragraph('<font color="#16a34a">Present</font>', style_table_cell_center), Paragraph('<font color="#16a34a">Present</font>', style_table_cell_center)],
    [Paragraph('Permissions-Policy', style_table_cell), Paragraph('<font color="#16a34a">Present (camera=self)</font>', style_table_cell_center), Paragraph('<font color="#16a34a">Present (all blocked)</font>', style_table_cell_center)],
    [Paragraph('CSP', style_table_cell), Paragraph('<font color="#16a34a">Enforced (nonce-based, middleware)</font>', style_table_cell_center), Paragraph('Report-only (unsafe-inline, no unsafe-eval)', style_table_cell_center)],
]
headers_table = Table(headers_data, colWidths=[50*mm, 60*mm, 50*mm])
headers_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
    ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, BG_LIGHT]),
]))
story.append(headers_table)

# ── 5. REMAINING ISSUES ────────────────────────────────────────────────────
story.append(PageBreak())
story.append(Paragraph('5. Remaining Issues', style_h1))

story.append(Paragraph('5.1 BUG Registry Status', style_h2))
story.append(Paragraph(
    'Of the 10 bugs cataloged during the paise migration, 8 are now FIXED (5 by '
    'the agent, 3 by the auditor). Only 1 remains open (plus 1 data issue).',
    style_body
))

bug_status_data = [
    [Paragraph('<b>ID</b>', style_table_header),
     Paragraph('<b>Severity</b>', style_table_header),
     Paragraph('<b>Description</b>', style_table_header),
     Paragraph('<b>Status</b>', style_table_header)],
    [Paragraph('BUG-010', style_table_cell_center), Paragraph('Low', style_table_cell_center),
     Paragraph('item.discountAmount dead input', style_table_cell),
     Paragraph('<font color="#16a34a"><b>FIXED by auditor</b></font>', style_table_cell_center)],
    [Paragraph('BUG-009', style_table_cell_center), Paragraph('Low', style_table_cell_center),
     Paragraph('GSTR-1 reconciliation demo data mismatch', style_table_cell),
     Paragraph('OPEN (data issue, not code)', style_table_cell_center)],
    [Paragraph('BUG-008', style_table_cell_center), Paragraph('Medium', style_table_cell_center),
     Paragraph('csv-export test crash', style_table_cell),
     Paragraph('<font color="#16a34a"><b>FIXED by auditor</b></font>', style_table_cell_center)],
    [Paragraph('BUG-007', style_table_cell_center), Paragraph('Medium', style_table_cell_center),
     Paragraph('Reconciliation test mock misroutes SQL', style_table_cell),
     Paragraph('<font color="#16a34a"><b>FIXED (agent)</b></font>', style_table_cell_center)],
    [Paragraph('BUG-006', style_table_cell_center), Paragraph('High', style_table_cell_center),
     Paragraph('Orphaned-items check always returns 0', style_table_cell),
     Paragraph('<font color="#16a34a"><b>FIXED (agent)</b></font>', style_table_cell_center)],
    [Paragraph('BUG-005', style_table_cell_center), Paragraph('Low', style_table_cell_center),
     Paragraph('validation.test.ts tsc errors', style_table_cell),
     Paragraph('<font color="#16a34a"><b>FIXED (agent)</b></font>', style_table_cell_center)],
    [Paragraph('BUG-004', style_table_cell_center), Paragraph('Medium', style_table_cell_center),
     Paragraph('openingBalance not rounded on PUT', style_table_cell),
     Paragraph('<font color="#16a34a"><b>FIXED (agent)</b></font>', style_table_cell_center)],
    [Paragraph('BUG-003', style_table_cell_center), Paragraph('Low/Med', style_table_cell_center),
     Paragraph('COUNT(*) includes income/expense', style_table_cell),
     Paragraph('<font color="#16a34a"><b>FIXED (agent)</b></font>', style_table_cell_center)],
    [Paragraph('BUG-002', style_table_cell_center), Paragraph('Low', style_table_cell_center),
     Paragraph('computePartyBalance sequential batches', style_table_cell),
     Paragraph('<font color="#16a34a"><b>FIXED by auditor</b></font>', style_table_cell_center)],
    [Paragraph('BUG-001', style_table_cell_center), Paragraph('&mdash;', style_table_cell_center),
     Paragraph('Reserved placeholder', style_table_cell),
     Paragraph('WONTFIX', style_table_cell_center)],
]
bug_table = Table(bug_status_data, colWidths=[18*mm, 18*mm, 80*mm, 44*mm])
bug_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
    ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, BG_LIGHT]),
]))
story.append(bug_table)
story.append(Spacer(1, 16))

story.append(Paragraph('5.2 Open Issues (Not Bugs)', style_h2))

story.append(Paragraph('<b>H1: <code>as any</code> in 52 files</b>', style_h3))
story.append(Paragraph(
    'Type safety debt. 52 files contain at least one <code>as any</code> cast. Top '
    'offenders: <code>period-lock.test.ts</code> (17), <code>auth.ts</code> (10), '
    '<code>Settings.tsx</code> (6), <code>csv-export.test.ts</code> (6), '
    '<code>get-auth.ts</code> (5). The auditor\'s branded Paise type is the '
    'foundation for fixing the money-related casts &mdash; once helper parameters '
    'require <code>Paise</code>, the compiler will catch rupee/paise mixups. '
    'The auth-related casts need NextAuth type declaration file (<code>next-auth.d.ts</code>). '
    'Severity: Medium (no known runtime bugs, but type-checker blind spots). '
    'Effort: 4-8 hours.',
    style_body
))

story.append(Paragraph('<b>H2: Admin panel has zero test files</b>', style_h3))
story.append(Paragraph(
    'The <code>bahikhata-admin</code> repo has no test infrastructure. All admin '
    'code (rate limiting, 2FA, SQL runner, CSRF) is untested. Severity: Medium '
    '(admin panel has few users but high security sensitivity). Effort: 1-2 days '
    'to set up Jest + write tests for auth, rate-limit, and middleware.',
    style_body
))

story.append(Paragraph('<b>Phase 4: DB Float-to-Int migration</b>', style_h3))
story.append(Paragraph(
    'The DB columns are still Float (rupees). Phases 1-3 of the paise migration '
    'eliminate all practical float-drift risks (SQL uses integer rounding, '
    'computation uses paise arithmetic). The auditor\'s branded <code>Paise</code> '
    'type enables a type-safe Phase 4: flip the helper parameters to require '
    '<code>Paise</code>, and the compiler catches every rupee/paise mixup. '
    'Severity: Low (no correctness issues today). Effort: 2-3 days when ready. '
    'Recommendation: defer until real customer data exists.',
    style_body
))

story.append(Paragraph('<b>Admin CSP: still report-only + unsafe-inline</b>', style_h3))
story.append(Paragraph(
    'The admin panel CSP is <code>Content-Security-Policy-Report-Only</code> (not '
    'enforced) and still allows <code>unsafe-inline</code> for scripts. Switching '
    'to enforced nonce-based CSP requires middleware changes. Severity: Low (admin '
    'panel is not public-facing). Effort: 2-4 hours (add nonce middleware).',
    style_body
))

# ── 6. NEW BUGS CHECK ──────────────────────────────────────────────────────
story.append(PageBreak())
story.append(Paragraph('6. New Bugs Check', style_h1))

story.append(Paragraph(
    'Scanned the auditor\'s 8 modified files for regressions or new issues '
    'introduced by the fixes. <b>No new bugs found.</b>',
    style_body
))

story.append(Paragraph('6.1 money.ts (branded Paise type)', style_h2))
story.append(Paragraph(
    'The branded <code>Paise</code> type (<code>type Paise = number &amp; '
    '{ readonly __brand: \'paise\' }</code>) widens to <code>number</code> freely, '
    'so every existing caller compiles. The paise-producing helpers '
    '(<code>toPaise</code>, <code>addPaise</code>, <code>multiplyPaise</code>, '
    '<code>calculateGstPaise</code>, <code>splitGstPaise</code>) now return '
    '<code>Paise</code>. The <code>0 as Paise</code> cast in <code>toPaise</code> '
    '(line 293) is the only hand-cast &mdash; acceptable for the zero-value '
    'fallback. <b>Clean.</b>',
    style_body
))

story.append(Paragraph('6.2 party-balance.ts (BUG-002 fix)', style_h2))
story.append(Paragraph(
    'The 6 aggregates now run in a single <code>Promise.all</code>. The dead '
    '<code>paymentsAgg</code> (total-of-both-types) was removed &mdash; verified '
    'that <code>paymentsReceived</code> and <code>paymentsPaid</code> now come '
    'from <code>receivedAgg</code> and <code>paidAgg</code> respectively (which '
    'were already being fetched). No logic change, just fewer round-trips. '
    '<b>Clean.</b>',
    style_body
))

story.append(Paragraph('6.3 balance-as-of route (timezone + accuracy caveat)', style_h2))
story.append(Paragraph(
    'The IST end-of-day fix (<code>T23:59:59.999+05:30</code>) is correct &mdash; '
    'a transaction at 2 AM IST on July 9 is no longer counted in "as of July 8". '
    'The <code>roundMoney</code> usage for running balance is correct (parity with '
    'headline). The <code>accuracyWarning</code> detection (invoice edited after '
    'as-of date) is a thoughtful user-facing honesty feature. <b>Clean.</b>',
    style_body
))

story.append(Paragraph('6.4 period-lock.ts (IST date formatting)', style_h2))
story.append(Paragraph(
    'The <code>PeriodLockedError</code> message now formats dates in '
    '<code>Asia/Kolkata</code> timezone. Verified: uses '
    '<code>toLocaleDateString</code> with <code>timeZone: \'Asia/Kolkata\'</code>. '
    '<b>Clean.</b>',
    style_body
))

story.append(Paragraph('6.5 validation.ts (BUG-010 fix)', style_h2))
story.append(Paragraph(
    'The per-item <code>discountAmount</code> field was removed from '
    '<code>transactionItemSchema</code>. The order-level '
    '<code>discountAmount</code> (on <code>createTransactionSchema</code> and '
    '<code>updateTransactionSchema</code>) is unchanged &mdash; correct, since '
    'that\'s the one actually used by <code>computeLineItems</code>. <b>Clean.</b>',
    style_body
))

story.append(Paragraph('6.6 Test files (csv-export, period-lock, tenant-isolation)', style_h2))
story.append(Paragraph(
    'csv-export.test.ts: the <code>await</code> fix and real jsdom anchor resolve '
    'the worker crash. tenant-isolation.test.ts: the two IDOR-asserting tests now '
    'verify the M3 fix (enforced fields win). period-lock.test.ts: updated for the '
    'IST date format. All 739 tests pass. <b>Clean.</b>',
    style_body
))

# ── 7. VERIFICATION RESULTS ────────────────────────────────────────────────
story.append(PageBreak())
story.append(Paragraph('7. Verification Results', style_h1))

story.append(Paragraph('7.1 Test Suite &mdash; Fully Green', style_h2))
story.append(Paragraph(
    '<b>739 tests, 35 test files, 0 failures, 0 crashes.</b> The test suite runs '
    'in ~3 seconds. This is the healthiest the test suite has ever been. The '
    'auditor\'s csv-export fix resolved the Jest worker crash that was masking 3 '
    'failing tests.',
    style_success
))

story.append(Paragraph('7.2 TypeScript &mdash; Clean', style_h2))
story.append(Paragraph(
    '<code>npx tsc --noEmit</code> reports 0 errors. The branded Paise type '
    'compiles cleanly &mdash; it widens to <code>number</code> so no caller '
    'needed updating.',
    style_body
))

story.append(Paragraph('7.3 Production Build &mdash; Succeeds', style_h2))
story.append(Paragraph(
    '<code>npx next build</code> succeeds. All 62 API routes compile. All pages '
    'prerender or are correctly marked as dynamic.',
    style_body
))

story.append(Paragraph('7.4 ESLint &mdash; Clean', style_h2))
story.append(Paragraph(
    '<code>npx eslint</code> on all modified files reports 0 errors.',
    style_body
))

# ── 8. RECOMMENDATION ──────────────────────────────────────────────────────
story.append(PageBreak())
story.append(Paragraph('8. Recommendation', style_h1))

story.append(Paragraph(
    'The codebase is in launch-ready condition. The auditor\'s fixes are clean, '
    'the test suite is fully green, and no new bugs were introduced. The remaining '
    'items are improvements, not blockers.',
    style_body
))

story.append(Paragraph('8.1 Launch Readiness', style_h2))

readiness_data = [
    [Paragraph('<b>Dimension</b>', style_table_header),
     Paragraph('<b>Score</b>', style_table_header),
     Paragraph('<b>Notes</b>', style_table_header)],
    [Paragraph('Correctness', style_table_cell), Paragraph('9.5/10', style_table_cell_center),
     Paragraph('All money paths use roundMoney or paise arithmetic. No float-drift bugs.', style_table_cell)],
    [Paragraph('Security', style_table_cell), Paragraph('9/10', style_table_cell_center),
     Paragraph('All headers present, no error leaks, tenant isolation verified. Admin CSP still report-only.', style_table_cell)],
    [Paragraph('Test Coverage', style_table_cell), Paragraph('9.5/10', style_table_cell_center),
     Paragraph('739 tests, all green. Admin panel has zero tests (the only gap).', style_table_cell)],
    [Paragraph('Type Safety', style_table_cell), Paragraph('8/10', style_table_cell_center),
     Paragraph('0 tsc errors, but 52 files have `as any`. Branded Paise type is foundation for improvement.', style_table_cell)],
    [Paragraph('Build/Deploy', style_table_cell), Paragraph('10/10', style_table_cell_center),
     Paragraph('Build succeeds, 0 tsc errors, all tests pass.', style_table_cell)],
    [Paragraph('Overall', style_table_cell), Paragraph('<b>9.2/10</b>', style_table_cell_center),
     Paragraph('<b>Launch-ready.</b> Remaining items are improvements, not blockers.', style_table_cell)],
]
readiness_table = Table(readiness_data, colWidths=[40*mm, 25*mm, 95*mm])
readiness_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
    ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, BG_LIGHT]),
    ('BACKGROUND', (0, -1), (-1, -1), ACCENT_LIGHT),
]))
story.append(readiness_table)
story.append(Spacer(1, 16))

story.append(Paragraph('8.2 Recommended Next Steps (Priority Order)', style_h2))

steps = [
    '<b>Launch the app.</b> The code is ready. Get real users and real data. The remaining items can be addressed iteratively post-launch.',
    '<b>Fix BUG-009 (GSTR-1 demo data).</b> Run /api/admin/repair-headers?fix=true to repair the demo data, or re-seed fresh demo data. This is a data issue, not a code bug.',
    '<b>H1: Reduce `as any` in auth.ts and get-auth.ts.</b> Create a next-auth.d.ts declaration file to properly extend NextAuth types. This removes 15 of the 52 `as any` casts from the most security-critical files. Effort: 1-2 hours.',
    '<b>H2: Add admin panel test infrastructure.</b> Set up Jest in bahikhata-admin, write tests for admin-auth.ts, admin-rate-limit.ts, and middleware.ts. Effort: 1-2 days.',
    '<b>Phase 4: DB Float-to-Int migration.</b> The auditor\'s branded Paise type makes this safer. Flip helper parameters to require Paise, then migrate columns. Defer until real customer data exists and there\'s a dedicated migration window. Effort: 2-3 days.',
    '<b>Admin CSP: switch to enforced nonce-based.</b> Add nonce middleware to admin panel, switch from Report-Only to Enforced. Effort: 2-4 hours.',
]
for s in steps:
    story.append(Paragraph(f'&bull; {s}', style_bullet))

story.append(Spacer(1, 16))
story.append(Paragraph(
    '<b>Report generated:</b> 2026-07-12<br/>'
    '<b>Repository:</b> github.com/rahulkothari677/bahikhata-pro<br/>'
    '<b>Auditor commit:</b> 8d61e2f (V18)<br/>'
    '<b>Test suite:</b> 739/739 passing<br/>'
    '<b>tsc:</b> 0 errors<br/>'
    '<b>Build:</b> succeeds',
    style_body
))

# ── BUILD ──────────────────────────────────────────────────────────────────
doc.build(story)
print(f"PDF generated: {output_path}")
print(f"Size: {os.path.getsize(output_path):,} bytes")
