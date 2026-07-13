#!/usr/bin/env python3
"""
Generate the V20 Post-Audit Report PDF for the external auditor.

Covers:
  1. Process-failure acknowledgment (V20 batches did not follow the cautious process)
  2. What V20 did (Batches 1-5C) — verified present in code
  3. What V20 skipped (with reasons)
  4. 3 NEW bugs found in the post-audit deep scan (BUG-011/012/013)
  5. Verification status (tsc + jest + build)
  6. Deferred items with rationale
"""

import os
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, ListFlowable, ListItem, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register fonts (Liberation Sans + Noto Sans for clean look)
FONT_PATHS = {
    'Body': '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    'Body-Bold': '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    'Body-Italic': '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf',
    'Mono': '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
}

for name, path in FONT_PATHS.items():
    if os.path.exists(path):
        pdfmetrics.registerFont(TTFont(name, path))

BODY = 'Body'
BODY_BOLD = 'Body-Bold'
BODY_ITALIC = 'Body-Italic'
MONO = 'Mono'

# Palette — professional, restrained, audit-report tone
C_PRIMARY = colors.HexColor('#0F172A')   # slate-900
C_ACCENT = colors.HexColor('#B45309')    # amber-700 (saffron-adjacent, Indian context)
C_CRITICAL = colors.HexColor('#B91C1C')  # red-700
C_HIGH = colors.HexColor('#C2410C')      # orange-700
C_MEDIUM = colors.HexColor('#A16207')    # yellow-700
C_LOW = colors.HexColor('#475569')       # slate-600
C_BG_LIGHT = colors.HexColor('#F8FAFC')  # slate-50
C_BORDER = colors.HexColor('#CBD5E1')    # slate-300
C_MUTED = colors.HexColor('#64748B')     # slate-500

PAGE_W, PAGE_H = A4
LEFT_MARGIN = 22 * mm
RIGHT_MARGIN = 22 * mm
TOP_MARGIN = 22 * mm
BOTTOM_MARGIN = 22 * mm
CONTENT_W = PAGE_W - LEFT_MARGIN - RIGHT_MARGIN

# ─── Styles ──────────────────────────────────────────────────────────────────

styles = getSampleStyleSheet()

S_TITLE = ParagraphStyle('Title', parent=styles['Normal'],
    fontName=BODY_BOLD, fontSize=22, leading=28, textColor=C_PRIMARY,
    spaceAfter=4, alignment=TA_LEFT)

S_SUBTITLE = ParagraphStyle('Subtitle', parent=styles['Normal'],
    fontName=BODY, fontSize=11, leading=15, textColor=C_MUTED,
    spaceAfter=12, alignment=TA_LEFT)

S_H1 = ParagraphStyle('H1', parent=styles['Normal'],
    fontName=BODY_BOLD, fontSize=15, leading=20, textColor=C_PRIMARY,
    spaceBefore=18, spaceAfter=8, alignment=TA_LEFT)

S_H2 = ParagraphStyle('H2', parent=styles['Normal'],
    fontName=BODY_BOLD, fontSize=12, leading=16, textColor=C_PRIMARY,
    spaceBefore=12, spaceAfter=6, alignment=TA_LEFT)

S_H3 = ParagraphStyle('H3', parent=styles['Normal'],
    fontName=BODY_BOLD, fontSize=10.5, leading=14, textColor=C_ACCENT,
    spaceBefore=8, spaceAfter=4, alignment=TA_LEFT)

S_BODY = ParagraphStyle('Body', parent=styles['Normal'],
    fontName=BODY, fontSize=10, leading=14.5, textColor=C_PRIMARY,
    spaceAfter=6, alignment=TA_LEFT)

S_BODY_JUST = ParagraphStyle('BodyJust', parent=S_BODY,
    alignment=TA_JUSTIFY)

S_BULLET = ParagraphStyle('Bullet', parent=S_BODY,
    leftIndent=14, bulletIndent=2, spaceAfter=3)

S_CODE = ParagraphStyle('Code', parent=styles['Normal'],
    fontName=MONO, fontSize=8.5, leading=11.5, textColor=C_PRIMARY,
    backColor=C_BG_LIGHT, borderColor=C_BORDER, borderWidth=0.5,
    borderPadding=6, spaceAfter=8, leftIndent=0, rightIndent=0)

S_CALLOUT = ParagraphStyle('Callout', parent=S_BODY,
    backColor=colors.HexColor('#FEF3C7'),  # amber-100
    borderColor=C_ACCENT, borderWidth=0, borderPadding=8,
    leftIndent=0, rightIndent=0, spaceAfter=8, spaceBefore=4)

S_CRITICAL_CALLOUT = ParagraphStyle('CriticalCallout', parent=S_BODY,
    backColor=colors.HexColor('#FEE2E2'),  # red-100
    borderColor=C_CRITICAL, borderWidth=0, borderPadding=8,
    leftIndent=0, rightIndent=0, spaceAfter=8, spaceBefore=4)

S_TABLE_CELL = ParagraphStyle('TableCell', parent=S_BODY,
    fontSize=9, leading=12, spaceAfter=0)

S_TABLE_HEADER = ParagraphStyle('TableHeader', parent=S_BODY,
    fontName=BODY_BOLD, fontSize=9, leading=12, spaceAfter=0,
    textColor=colors.white)

S_FOOTER = ParagraphStyle('Footer', parent=styles['Normal'],
    fontName=BODY, fontSize=8, leading=10, textColor=C_MUTED,
    alignment=TA_CENTER)

# ─── Helpers ─────────────────────────────────────────────────────────────────

def hr(color=C_BORDER, thickness=0.5, space_before=4, space_after=8):
    return HRFlowable(width="100%", thickness=thickness, color=color,
                      spaceBefore=space_before, spaceAfter=space_after)

def p(text, style=S_BODY):
    return Paragraph(text, style)

def bullet(text, style=S_BULLET):
    return ListItem(Paragraph(text, style), leftIndent=10,
                    value='circle', bulletColor=C_ACCENT)

def bullets(items, style=S_BULLET):
    return ListFlowable(
        [ListItem(Paragraph(t, style), leftIndent=10, value='circle',
                  bulletColor=C_ACCENT) for t in items],
        bulletType='bullet', bulletFontName=BODY, bulletFontSize=7,
        leftIndent=14, bulletColor=C_ACCENT,
    )

def severity_badge(sev):
    color_map = {
        'CRITICAL': C_CRITICAL,
        'HIGH': C_HIGH,
        'MEDIUM': C_MEDIUM,
        'LOW': C_LOW,
    }
    c = color_map.get(sev.upper(), C_MUTED)
    return f'<font color="{c.hexval()}"><b>{sev}</b></font>'

def make_table(data, col_widths=None, header=True, zebra=True):
    """Build a styled table. `data` is a list of lists of strings/Paragraphs."""
    if col_widths is None:
        col_widths = [CONTENT_W / len(data[0])] * len(data[0])

    # Wrap raw strings in Paragraphs for wrapping
    wrapped = []
    for r_idx, row in enumerate(data):
        new_row = []
        for c_idx, cell in enumerate(row):
            if isinstance(cell, Paragraph):
                new_row.append(cell)
            else:
                style = S_TABLE_HEADER if (header and r_idx == 0) else S_TABLE_CELL
                new_row.append(Paragraph(str(cell), style))
        wrapped.append(new_row)

    t = Table(wrapped, colWidths=col_widths, repeatRows=1 if header else 0)
    cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('GRID', (0, 0), (-1, -1), 0.4, C_BORDER),
    ]
    if header:
        cmds.append(('BACKGROUND', (0, 0), (-1, 0), C_PRIMARY))
        cmds.append(('TEXTCOLOR', (0, 0), (-1, 0), colors.white))
    if zebra:
        start = 1 if header else 0
        for i in range(start, len(data)):
            if (i - start) % 2 == 1:
                cmds.append(('BACKGROUND', (0, i), (-1, i), C_BG_LIGHT))
    t.setStyle(TableStyle(cmds))
    return t


# ─── Page decorations ────────────────────────────────────────────────────────

def on_page(canvas, doc):
    canvas.saveState()
    # Top accent bar
    canvas.setFillColor(C_ACCENT)
    canvas.rect(0, PAGE_H - 6, PAGE_W, 6, fill=1, stroke=0)
    # Footer
    canvas.setFont(BODY, 8)
    canvas.setFillColor(C_MUTED)
    canvas.drawString(LEFT_MARGIN, 12 * mm,
                      "EkBook / BahiKhata Pro — V20 Post-Audit Report")
    canvas.drawRightString(PAGE_W - RIGHT_MARGIN, 12 * mm,
                           f"Page {doc.page}")
    canvas.restoreState()


# ─── Build the document ──────────────────────────────────────────────────────

def build():
    out_path = '/home/z/my-project/download/v20-post-audit-report.pdf'
    doc = SimpleDocTemplate(
        out_path, pagesize=A4,
        leftMargin=LEFT_MARGIN, rightMargin=RIGHT_MARGIN,
        topMargin=TOP_MARGIN, bottomMargin=BOTTOM_MARGIN,
        title="EkBook V20 Post-Audit Report",
        author="EkBook Engineering",
        subject="V20 Post-Audit: Process Failure + 3 New Bugs + Deferred Items",
        creator="Z.ai",
    )

    story = []

    # ─── HEADER ──────────────────────────────────────────────────────────────
    story.append(p("EkBook / BahiKhata Pro", S_SUBTITLE))
    story.append(p("V20 Post-Audit Report", S_TITLE))
    story.append(p("Process-failure review, deep-scan findings, and deferred-items register", S_SUBTITLE))
    story.append(p("<b>Prepared:</b> 2026-07-12 &nbsp;&nbsp; <b>Codebase HEAD:</b> 8f7b929 &nbsp;&nbsp; <b>Auditor baseline:</b> af62217", S_SUBTITLE))
    story.append(hr(color=C_PRIMARY, thickness=1.5, space_before=2, space_after=14))

    # ─── 0. TL;DR ────────────────────────────────────────────────────────────
    story.append(p("0. TL;DR", S_H1))
    story.append(p(
        "This report responds to your feedback that the V20 audit cycle did not follow the cautious process. "
        "You were correct. After your message I did a proper deep scan of the codebase against your V20 report and found "
        "<b>3 new bugs</b> that V20 Batches 1-5C missed — including a <b>CRITICAL 100× money display bug</b> (BUG-011) in the same class "
        "as the V20-002 bug you flagged. The root cause was that your §1.3 recommendation (\"audit <b>every</b> <code>include:</code> in the codebase\") "
        "was not fully executed in Batch 1. I have fixed all 3 bugs, added 10 regression tests, and verified tsc + jest + build are green. "
        "The deferred items (bundle analyzer, Sentry alerts, money round-trip integration test, etc.) are documented with rationale below.",
        S_BODY_JUST))

    story.append(p(
        "<b>Process-failure acknowledgment:</b> V20 Batches 1-5C committed code without worklog entries, "
        "without scanning for new bugs, and without verifying existing fixes. This was wrong and will not happen again. "
        "All future batches will follow: pre-change scan → implement → verify (tsc + jest + eslint + build) → post-change scan → push → worklog → STOP.",
        S_CRITICAL_CALLOUT))

    # ─── 1. PROCESS FAILURE ─────────────────────────────────────────────────
    story.append(p("1. Process-Failure Analysis", S_H1))
    story.append(p(
        "Your feedback identified three concrete failures in the V20 cycle. Each is acknowledged below with the specific "
        "step where it should have happened and the corrective action going forward.",
        S_BODY_JUST))

    story.append(p("1.1 No new bugs were found during V20", S_H2))
    story.append(p(
        "V20 Batches 1-5C only addressed the bugs you flagged in the V20 report. I did not run an independent scan for "
        "new bugs in the same areas. This is the single biggest failure — the whole point of the cautious process is "
        "that fixing one bug often reveals adjacent bugs in the same class. That is exactly what happened here: the "
        "V20-002 fix (BankStatement→transactions) should have triggered a full audit of every <code>include:</code> clause, "
        "but it did not. BUG-011 (5 more missing MODEL_RELATIONS entries) is the direct result.",
        S_BODY_JUST))

    story.append(p("1.2 No verification of existing fixes", S_H2))
    story.append(p(
        "The V20 commit messages claimed \"0 tsc errors, 746/746 tests pass, build succeeds\" but I never ran eslint during V20. "
        "When I ran it now, it surfaced 24 pre-existing errors (same count at your baseline af62217, so not new — but I should "
        "have caught and reported this in every V20 batch). The eslint errors are mostly React 19 compiler rules "
        "(<code>react-hooks/preserve-manual-memoization</code>) in hook files. They are not blocking, but they should be tracked.",
        S_BODY_JUST))

    story.append(p("1.3 No worklog entries for V20 batches", S_H2))
    story.append(p(
        "The worklog at <code>/home/z/my-project/worklog.md</code> had zero V20 entries. Every prior phase (V17 paise migration, "
        "V7 audit fixes, V19 deep audit) has a detailed worklog section. V20 broke this pattern. I have now added a complete "
        "V20 post-audit worklog entry (Task ID: <code>v20-post-audit-deep-scan-and-fixes</code>) covering the deep scan, the 3 new bugs, "
        "and the verification steps.",
        S_BODY_JUST))

    story.append(p("1.4 Corrective action", S_H2))
    story.append(p(
        "Going forward, every batch — without exception — will follow this sequence and I will STOP after each batch for your verification:",
        S_BODY))
    story.append(bullets([
        "<b>Pre-change scan:</b> read the target file completely + scan adjacent files in the same area for the same bug class",
        "<b>Implement:</b> make the change, add inline <code>🔒 V20-XXX FIX</code> comments explaining the bug",
        "<b>Verify:</b> run <code>tsc --noEmit</code> + <code>jest</code> + <code>eslint</code> + <code>next build</code> — all four, every time",
        "<b>Post-change scan:</b> grep for the same pattern across the codebase to catch adjacent bugs",
        "<b>Push:</b> commit with a descriptive message",
        "<b>Worklog:</b> append a section to <code>worklog.md</code> with Task ID, work log, and stage summary",
        "<b>STOP</b> and wait for your verification before starting the next batch",
    ]))

    # ─── 2. WHAT V20 DID (verified present) ──────────────────────────────────
    story.append(p("2. What V20 Did (Verified Present in Code)", S_H1))
    story.append(p(
        "I re-read every V20 commit and verified each fix is actually present in the current code. All are present. "
        "The table below maps each V20 fix to the file/line where it lives.",
        S_BODY_JUST))

    v20_done = [
        ["ID", "Fix", "File:Line", "Status"],
        ["V20-001", "upsert handler in generateModelHandlers (GST filing 100× bug)",
         "prisma-money-extension.ts:495", "Verified"],
        ["V20-002", "BankStatement→transactions in MODEL_RELATIONS (bank recon 100× bug)",
         "prisma-money-extension.ts:91", "Verified"],
        ["V20-003", "Lazy-load DayEndSummary + AnalyticsInsights in Dashboard",
         "Dashboard.tsx:1 (import dynamic)", "Verified"],
        ["V20-004", "Splash screen 2.0s → 1.1s",
         "SplashScreen.tsx:26-28", "Verified"],
        ["V20-005", "aggregate/groupBy _avg/_min/_max in generateModelHandlers",
         "prisma-money-extension.ts:505", "Verified"],
        ["V20-006", "Reconciliation tolerance <0.01 → <0.005",
         "reconciliation.ts:78,145", "Verified"],
        ["V20-007", "Lazy-load Vercel Analytics + Speed Insights",
         "layout.tsx", "Verified"],
        ["V20-008", "Lazy-load non-default views in page.tsx",
         "page.tsx", "Verified"],
        ["V20-5A", "inputMode='decimal' on 10 inputs",
         "ProductDialog, TransactionDetail", "Verified"],
        ["V20-5B", "Empty states, live totals, sticky save bar — audit only",
         "(all already existed)", "Verified"],
        ["V20-5C", "Language toggle on AuthScreen",
         "AuthScreen.tsx:124-139", "Verified (but see BUG-012)"],
    ]
    story.append(make_table(v20_done, col_widths=[18*mm, 70*mm, 50*mm, 28*mm]))

    story.append(p(
        "<b>Note on V20-006 (reconciliation tolerance):</b> Your §3 [VERIFY] note suggested the tolerance should be "
        "<code>=== 0</code> with integer paise storage. I tightened to <code>&lt; 0.005</code> instead. The rationale: "
        "the Prisma extension converts paise→rupees via <code>fromPaise(p) = p / 100</code>, which can introduce float drift "
        "(e.g. 1235 paise → 12.350000000000001). Two separate aggregate queries that both compute 1235 paise might produce "
        "slightly different float representations after <code>fromPaise()</code>, so <code>=== 0</code> would cause false positives. "
        "<code>&lt; 0.005</code> is tighter than the old <code>&lt; 0.01</code> while tolerating float noise. If you disagree, "
        "I can switch to <code>=== 0</code> with a <code>roundMoney()</code> wrapper on both sides.",
        S_CALLOUT))

    story.append(PageBreak())

    # ─── 3. NEW BUGS FOUND IN POST-AUDIT DEEP SCAN ──────────────────────────
    story.append(p("3. New Bugs Found in Post-Audit Deep Scan", S_H1))
    story.append(p(
        "After your feedback, I did the deep scan that should have happened during V20. I focused on the Prisma money extension "
        "(the single most dangerous piece of code, per your §5.2) and traced every <code>include:</code> clause in the codebase "
        "against the <code>MODEL_RELATIONS</code> map. Three bugs were found and are now fixed.",
        S_BODY_JUST))

    # BUG-011
    story.append(p("3.1 BUG-011 — MODEL_RELATIONS missing 5 money-bearing relations " + severity_badge("CRITICAL"), S_H2))
    story.append(p(
        "<b>Class:</b> Same as V20-002 (100× money display bug). <b>Reachable today:</b> Yes. <b>Status:</b> FIXED (commit 8f7b929).",
        S_BODY))
    story.append(p(
        "Your §1.3 explicitly said: <i>\"Audit <b>every</b> <code>include:</code> in the codebase against this map.\"</i> "
        "V20-002 added <code>BankStatement → transactions</code> but did not complete the audit. I traced every <code>include:</code> "
        "clause and found 5 more money-bearing relations missing from <code>MODEL_RELATIONS</code>:",
        S_BODY_JUST))
    story.append(bullets([
        "<code>BankTransaction → matchedPayment</code> (Payment.amount) — bank recon UI showed matched payments 100× inflated",
        "<code>BankTransaction → matchedTransaction</code> (Transaction.totalAmount, .cgst, .sgst, .igst, .paidAmount) — bank recon UI showed matched transactions 100× inflated",
        "<code>Transaction → originalTransaction</code> (self-relation, Transaction.totalAmount) — credit/debit note detail showed original sale 100× inflated",
        "<code>Transaction → reversalTransactions</code> (self-relation, Transaction.totalAmount) — sale detail \"Total adjusted\" showed 100× inflated",
        "<code>Transaction → matchedBankTransactions</code> (BankTransaction.amount) — back-reference, latent",
    ]))
    story.append(p(
        "<b>Reachable call sites:</b> <code>src/app/api/transactions/[id]/route.ts:33-58</code> includes <code>reversalTransactions</code> "
        "and <code>originalTransaction</code> (both with <code>totalAmount</code> selected). <code>src/app/api/bank-recon/reconcile/route.ts:30-42</code> "
        "includes <code>matchedPayment</code> and <code>matchedTransaction</code>. Both paths returned paise values to the UI without conversion. "
        "TransactionDetail.tsx:710 displays <code>formatINR(txn.reversalTransactions.reduce((s, r) =&gt; s + r.totalAmount, 0))</code> — "
        "a ₹1,000 credit note showed as ₹100,000 in the \"Total adjusted\" line.",
        S_BODY_JUST))
    story.append(p(
        "<b>Fix:</b> Added all 5 entries to <code>MODEL_RELATIONS</code> in <code>prisma-money-extension.ts:79-97</code>. "
        "Added a 7-test regression guard in <code>v20-money-extension-regression.test.ts</code> that parses the source file and verifies "
        "each relation is present. If a developer removes any entry, the test fails.",
        S_BODY_JUST))

    # BUG-012
    story.append(p("3.2 BUG-012 — AuthScreen language toggle didn't translate anything " + severity_badge("MEDIUM"), S_H2))
    story.append(p(
        "<b>Class:</b> Misleading feature (UX). <b>Reachable today:</b> Yes — every login. <b>Status:</b> FIXED (commit 8f7b929).",
        S_BODY))
    story.append(p(
        "V20 Batch 5C added a language toggle to the AuthScreen with 5 languages (EN, हिं, ગુ, मरा, தமி). However, the AuthScreen "
        "used hardcoded English strings (\"Sign In\", \"Create Account\", \"Email\", \"Password\", \"Your Name\", "
        "\"India's Smartest Ledger App\", data-secure notice). The toggle only set the store value without any visible effect — "
        "selecting Hindi did nothing. The i18n system (<code>src/lib/i18n.ts</code>) already had <code>auth.*</code> translation keys "
        "for all 5 languages, but the AuthScreen never called <code>useTranslation()</code>.",
        S_BODY_JUST))
    story.append(p(
        "<b>Fix:</b> Wired AuthScreen to <code>useTranslation()</code>. All visible strings now use <code>t('auth.*')</code> keys. "
        "Selecting Hindi now actually translates the login screen. This was a self-introduced bug (V20-5C) — the toggle was added "
        "without wiring it to the translation system that already existed.",
        S_BODY_JUST))

    # BUG-013
    story.append(p("3.3 BUG-013 — Hand-written aggregate handlers only converted _sum " + severity_badge("MEDIUM"), S_H2))
    story.append(p(
        "<b>Class:</b> Inconsistent with V20-005 (latent landmine). <b>Reachable today:</b> No (no code path uses <code>_avg/_min/_max</code> "
        "on money columns today). <b>Status:</b> FIXED (commit 8f7b929).",
        S_BODY))
    story.append(p(
        "V20-005 added <code>_avg/_min/_max</code> conversion to <code>generateModelHandlers</code> (used by GstReturn, Gstr1Snapshot, "
        "BankStatement, BankTransaction, Gstr2bImport, Gstr2bInvoice, AiUsageLog, DailyStats, RevenueSchedule, Subscription). "
        "But the hand-written handlers for Transaction (line 312) and Payment (line 426) — the two most-used models — still only "
        "converted <code>_sum</code>. If anyone writes <code>db.transaction.aggregate({ _avg: { totalAmount: true } })</code>, it would "
        "return paise (100× too large). Inconsistent and a latent landmine.",
        S_BODY_JUST))
    story.append(p(
        "<b>Fix:</b> Updated both hand-written handlers to iterate <code>['_sum', '_avg', '_min', '_max']</code> — matches the "
        "<code>generateModelHandlers</code> pattern. Added a 2-test regression guard verifying all 4 aggKeys are referenced in both handlers.",
        S_BODY_JUST))

    story.append(PageBreak())

    # ─── 4. VERIFICATION STATUS ─────────────────────────────────────────────
    story.append(p("4. Verification Status", S_H1))
    story.append(p(
        "After fixing BUG-011/012/013, I ran the full verification suite. All green.",
        S_BODY_JUST))

    verif = [
        ["Check", "Command", "Result"],
        ["TypeScript", "npx tsc --noEmit", "0 errors"],
        ["Unit tests", "npx jest", "756/756 pass (was 746, +10 new regression tests)"],
        ["ESLint", "npx eslint . --max-warnings=0", "24 pre-existing errors (React 19 compiler rules; same count at baseline af62217)"],
        ["Production build", "npx next build", "Compiled successfully in 34.3s"],
    ]
    story.append(make_table(verif, col_widths=[35*mm, 55*mm, 76*mm]))

    story.append(p(
        "<b>ESLint caveat:</b> The 24 eslint errors are pre-existing (verified by checking out af62217 and running eslint — same count). "
        "They are all <code>react-hooks/preserve-manual-memoization</code> and <code>react-hooks/rules-of-hooks</code> warnings in hook files "
        "(use-staff-permissions, use-rate-prompt, etc.) plus a few <code>@next/next/no-assign-module-variable</code> in sentry config files. "
        "None are blocking, but they should be cleaned up in a dedicated batch. I did not introduce any new eslint errors.",
        S_CALLOUT))

    # ─── 5. NEW REGRESSION TESTS ────────────────────────────────────────────
    story.append(p("5. New Regression Tests Added", S_H1))
    story.append(p(
        "Created <code>src/__tests__/lib/v20-money-extension-regression.test.ts</code> with 10 tests that verify the structural "
        "integrity of the money extension. These tests parse the extension source file (so they don't need a live DB) and assert that:",
        S_BODY_JUST))
    story.append(bullets([
        "All 7 money-bearing MODEL_RELATIONS entries are present (BUG-011 guard)",
        "Both hand-written aggregate handlers reference all 4 aggKeys (BUG-013 guard)",
        "The upsert handler exists in generateModelHandlers (V20-001 guard)",
    ]))
    story.append(p(
        "<b>Limitation:</b> These are source-code structure tests, not runtime round-trip tests. Your §5.2 recommendation — "
        "a full integration test that, for every model in MONEY_COLUMNS, runs create/update/upsert/findFirst/aggregate/groupBy with "
        "a known fractional value and asserts round-trip equality — is still deferred (see §6 below). The structural tests catch "
        "whitelist removals but not logic errors in the conversion functions themselves.",
        S_BODY_JUST))

    # ─── 6. DEFERRED ITEMS ──────────────────────────────────────────────────
    story.append(p("6. Deferred Items (With Rationale)", S_H1))
    story.append(p(
        "The following items from your V20 report were not addressed in V20 or in this post-audit fix. Each is listed with "
        "the reason for deferral and a rough effort estimate so you can prioritize.",
        S_BODY_JUST))

    deferred = [
        ["Item", "Auditor §", "Reason for Deferral", "Effort"],
        ["Money round-trip integration test (create/update/upsert/aggregate/groupBy per model)",
         "§5.2", "Requires a test DB or comprehensive mocking of Prisma client. The structural regression tests added in this commit are a partial substitute. Full integration test is a dedicated task.", "1 day"],
        ["Bundle analyzer (@next/bundle-analyzer)",
         "§2.2", "Requires installing the package + wiring into next.config.ts. The lazy-loading in V20-003/007/008 already cut the initial bundle; analyzer is for finding the next 20%.", "2 hours"],
        ["Mobile TTI CI budget test (throttled CPU)",
         "§2.6", "Requires Lighthouse CI + a GitHub Actions workflow. No existing CI step does this.", "4 hours"],
        ["Sentry alerts on 500s (especially GST filing routes)",
         "§5.5", "Sentry is wired (client + server config exist) but alert rules are not configured in the Sentry dashboard. This is a Sentry-UI task, not a code task.", "1 hour"],
        ["Nightly \"does the ledger tie out?\" job",
         "§5.6", "The reconciliation logic exists (src/lib/reconciliation.ts). Needs a cron trigger (Vercel Cron or GitHub Actions) + alert on mismatch.", "4 hours"],
        ["Staging environment with seed data",
         "§5.4", "Requires a separate Vercel preview deployment + Neon database branch. Infrastructure setup, not code.", "1 day"],
        ["Splash screen data-driven (not time-driven)",
         "§2.4", "V20-004 reduced the fixed delay from 2.0s to 1.1s. Making it data-driven (dismiss when session + dashboard payload ready) requires refactoring the boot sequence in page.tsx.", "4 hours"],
        ["Dark mode WCAG contrast audit (saffron palette)",
         "§4.10", "Requires running a contrast checker (axe-core or similar) on every component in dark mode. No existing test infrastructure for this.", "1 day"],
        ["H1: 'as any' cleanup (49 files, worst: auth.ts 10)",
         "V7 H1", "Large effort, deferred since V7. Needs careful TypeScript type work — each 'as any' needs a proper type or a documented suppress reason.", "2-3 days"],
        ["H2: Admin panel tests (zero test files)",
         "V7 H2", "Needs test infrastructure setup for the admin panel (separate Next.js app in bahikhata-admin/).", "1-2 days"],
        ["Admin CSP nonce-based enforcement",
         "V7 H3", "Currently 'unsafe-inline' in admin CSP. Nonce-based CSP needs middleware. Partial fix in V7 (removed 'unsafe-eval').", "2-4 hours"],
        ["PostHog analytics wiring",
         "—", "PostHog SDK is installed but not wired to any event. Needs product event taxonomy + instrumentation pass.", "4 hours"],
    ]
    story.append(make_table(deferred, col_widths=[55*mm, 16*mm, 70*mm, 25*mm]))

    story.append(PageBreak())

    # ─── 7. ITEMS MARKED FIXED BY AUDITOR (verified) ────────────────────────
    story.append(p("7. Items the Auditor Marked Fixed (Verified)", S_H1))
    story.append(p(
        "Your V20 report §3 referenced several BUGS-FOUND.md entries as \"still open.\" I verified each against the current code:",
        S_BODY_JUST))

    verified_fixed = [
        ["Bug", "Auditor said", "Actual status in code"],
        ["BUG-010 (item.discountAmount dead field)",
         "§3 LOW: still open", "FIXED — removed from transactionItemSchema (auditor commit 8d61e2f)"],
        ["BUG-002 (computePartyBalance 2 sequential Promise.all)",
         "§3 LOW: still open", "FIXED — merged into single Promise.all (auditor commit 8d61e2f)"],
        ["BUG-008 (csv-export.test.ts Jest crash)",
         "§3 LOW: still open", "FIXED — async/await + jsdom anchor fixed (auditor commit 8d61e2f)"],
        ["balance-as-of UTC day boundary (§3 MEDIUM)",
         "§3 MEDIUM: uses UTC", "ALREADY FIXED in V18 B.3 — code at line 47 uses '+05:30' IST offset. Auditor was reviewing code at HEAD af62217 which already had this fix; the §3 note was a re-flag."],
        ["balance-as-of Math.round → roundMoney (§3 LOW)",
         "§3 LOW: uses Math.round", "ALREADY FIXED in V18 — code at line 154 uses roundMoney(). Same re-flag situation."],
    ]
    story.append(make_table(verified_fixed, col_widths=[55*mm, 35*mm, 76*mm]))

    story.append(p(
        "<b>Implication:</b> Your V20 report was based on a snapshot (af62217) where these were already fixed, but the BUGS-FOUND.md "
        "registry had not been updated to reflect the auditor's commits. I have now verified the registry matches the code. "
        "BUG-010/002/008 are correctly marked FIXED. The balance-as-of items were never open in the V20 codebase — they were fixed in V18.",
        S_BODY_JUST))

    # ─── 8. RECOMMENDATIONS FOR NEXT CYCLE ──────────────────────────────────
    story.append(p("8. Recommendations for the Next Cycle", S_H1))
    story.append(p(
        "Based on this post-audit, the following priorities are recommended for the next cycle (in order):",
        S_BODY_JUST))
    story.append(bullets([
        "<b>Money round-trip integration test (§5.2):</b> the single highest-value item. The extension is a hand-maintained whitelist with no compiler safety net. An exhaustive per-model, per-operation round-trip test would catch the next 100× bug automatically.",
        "<b>Bundle analyzer + mobile TTI CI budget:</b> addresses your §2 performance concern at the CI level, preventing regression during beta.",
        "<b>Sentry alerts on GST filing routes:</b> if a §1.1-class bug slips through, telemetry should surface it within minutes of beta, not from an angry CA.",
        "<b>H1 'as any' cleanup:</b> deferred since V7, but each 'as any' is a place where a type bug can hide. Worth a dedicated batch.",
        "<b>Admin panel tests (H2):</b> the admin panel has zero tests. Before beta, at least smoke tests for the admin auth flow + user management routes are needed.",
    ]))

    # ─── 9. BOTTOM LINE ─────────────────────────────────────────────────────
    story.append(p("9. Bottom Line", S_H1))
    story.append(p(
        "You were right to call out the process failure. V20 Batches 1-5C shipped code without the discipline that prior cycles (V17/V18/V19) "
        "had established. The result was that BUG-011 — a CRITICAL 100× money display bug in the same class as the V20-002 bug you explicitly "
        "flagged — slipped through. This is exactly the failure mode your §1.3 \"audit every include\" recommendation was designed to prevent.",
        S_BODY_JUST))
    story.append(p(
        "The 3 new bugs are now fixed (commit 8f7b929), with 10 regression tests guarding against regression. tsc + jest + build are green. "
        "The money extension is now significantly safer — all 7 money-bearing relations in MODEL_RELATIONS are covered, all aggregate handlers "
        "(hand-written + generated) convert all 4 aggKeys, and the upsert handler is present. The deferred items are documented with rationale "
        "and effort estimates so you can prioritize the next cycle.",
        S_BODY_JUST))
    story.append(p(
        "Going forward, every batch will follow the cautious process without exception. I will STOP after each batch for your verification.",
        S_BODY))

    story.append(Spacer(1, 14))
    story.append(hr(color=C_BORDER, thickness=0.5))
    story.append(p(
        "<i>Verification: tsc 0 errors, jest 756/756 pass, build succeeds. "
        "Commit: 8f7b929. Worklog: /home/z/my-project/worklog.md (Task ID: v20-post-audit-deep-scan-and-fixes). "
        "Bug registry: /home/z/my-project/BUGS-FOUND.md (BUG-011/012/013 added).</i>",
        S_FOOTER))

    # Build
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f"PDF generated: {out_path}")
    print(f"Size: {os.path.getsize(out_path):,} bytes")

if __name__ == '__main__':
    build()
