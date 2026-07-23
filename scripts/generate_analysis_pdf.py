import os
import re
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, ListFlowable, ListItem
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.pdfbase import pdfmetrics

# Define branding colors
SAFFRON = colors.HexColor('#d97706')
SAFFRON_LIGHT = colors.HexColor('#fef3c7')
INK = colors.HexColor('#1c1917')
INK_LIGHT = colors.HexColor('#475569') # Slate-600
MUTED = colors.HexColor('#64748b') # Slate-500
DIVIDER = colors.HexColor('#cbd5e1') # Slate-300
BG_CALLOUT = colors.HexColor('#f8fafc') # Slate-50
ACCENT_CALLOUT = colors.HexColor('#3b82f6') # Blue-500

# Base styles using built-in Helvetica (safe on all systems)
TITLE = ParagraphStyle('Title', fontName='Helvetica-Bold', fontSize=24, leading=30,
                       textColor=INK, alignment=TA_LEFT, spaceAfter=8)
SUBTITLE = ParagraphStyle('Subtitle', fontName='Helvetica', fontSize=12, leading=16,
                          textColor=MUTED, alignment=TA_LEFT, spaceAfter=20)
H1 = ParagraphStyle('H1', fontName='Helvetica-Bold', fontSize=18, leading=22,
                    textColor=SAFFRON, spaceBefore=18, spaceAfter=8, keepWithNext=True)
H2 = ParagraphStyle('H2', fontName='Helvetica-Bold', fontSize=13, leading=17,
                    textColor=INK, spaceBefore=12, spaceAfter=6, keepWithNext=True)
H3 = ParagraphStyle('H3', fontName='Helvetica-Bold', fontSize=11, leading=15,
                    textColor=INK_LIGHT, spaceBefore=8, spaceAfter=4, keepWithNext=True)
BODY = ParagraphStyle('Body', fontName='Helvetica', fontSize=10, leading=14.5,
                      textColor=INK, alignment=TA_JUSTIFY, spaceAfter=6)
BODY_BOLD = ParagraphStyle('BodyBold', fontName='Helvetica-Bold', fontSize=10, leading=14.5,
                           textColor=INK, alignment=TA_JUSTIFY, spaceAfter=6)
BODY_ITALIC = ParagraphStyle('BodyItalic', fontName='Helvetica-Oblique', fontSize=10, leading=14.5,
                             textColor=INK, alignment=TA_JUSTIFY, spaceAfter=6)
CALLOUT = ParagraphStyle('Callout', fontName='Helvetica', fontSize=9.5, leading=13.5,
                          textColor=INK, leftIndent=8, rightIndent=8, spaceAfter=4)
TABLE_HEADER = ParagraphStyle('TableHeader', fontName='Helvetica-Bold', fontSize=9,
                               leading=12, textColor=colors.white, alignment=TA_LEFT)
TABLE_CELL = ParagraphStyle('TableCell', fontName='Helvetica', fontSize=8.5,
                             leading=11.5, textColor=INK, alignment=TA_LEFT)
TABLE_CELL_BOLD = ParagraphStyle('TableCellBold', fontName='Helvetica-Bold', fontSize=8.5,
                                  leading=11.5, textColor=INK, alignment=TA_LEFT)

def on_page(canvas, doc):
    canvas.saveState()
    w, h = A4
    
    # Bottom running line and footer
    canvas.setStrokeColor(DIVIDER)
    canvas.setLineWidth(0.5)
    canvas.line(20 * mm, 15 * mm, w - 20 * mm, 15 * mm)
    
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(20 * mm, 10 * mm, 'BahiKhata Pro — Comprehensive Analysis & Investor Report')
    canvas.drawRightString(w - 20 * mm, 10 * mm, f'Page {doc.page}')
    
    # Top saffron accent strip
    canvas.setFillColor(SAFFRON)
    canvas.rect(0, h - 4 * mm, w, 4 * mm, fill=1, stroke=0)
    canvas.restoreState()

def clean_markdown_formatting(text):
    """Replaces basic markdown formatting with html tags reportlab can render and removes emojis."""
    # Escape ampersands first (avoiding double-escaping existing entities)
    text = re.sub(r'&(?!(amp|lt|gt|quot|apos|bull);)', '&amp;', text)
    
    # Replace Rupee symbol with Rs.
    text = text.replace('₹', 'Rs. ')
    
    # Replace rating/status emojis with plain text representations
    text = text.replace('⭐⭐⭐⭐⭐', '5/5')
    text = text.replace('⭐⭐⭐⭐', '4/5')
    text = text.replace('⭐⭐⭐', '3/5')
    text = text.replace('⭐⭐', '2/5')
    text = text.replace('⭐', '1/5')
    
    # Status / Priority indicators
    text = text.replace('🔴', '[P0]')
    text = text.replace('🟡', '[P1]')
    text = text.replace('🟢', '[P2]')
    text = text.replace('🔜', '(Upcoming)')
    text = text.replace('🏆', '[USP]')
    text = text.replace('💪', '[Strength]')
    text = text.replace('⚠️', '[Warning]')
    text = text.replace('⚡', '[Threat]')
    text = text.replace('🎯', '[Goal]')
    text = text.replace('🇮🇳', '(India)')
    text = text.replace('🤖', '(AI)')
    text = text.replace('🎙️', '(Voice)')
    text = text.replace('🎙', '(Voice)')
    text = text.replace('🛒', '(Ledger)')
    text = text.replace('📦', '(Inventory)')
    text = text.replace('💰', '(Payments)')
    text = text.replace('👥', '(Parties)')
    text = text.replace('📈', '(Reports)')
    text = text.replace('⚙️', '(Settings)')
    text = text.replace('⚙', '(Settings)')
    text = text.replace('🔍', '(Search)')
    text = text.replace('📱', '(Mobile)')
    text = text.replace('🎛️', '(Toggles)')
    text = text.replace('🎛', '(Toggles)')
    text = text.replace('📅', '(Dates)')
    text = text.replace('🖨️', '(Print)')
    text = text.replace('🖨', '(Print)')
    text = text.replace('✨', '')
    text = text.replace('🌙', '')
    text = text.replace('⌨️', '')
    text = text.replace('⌨', '')
    text = text.replace('🎨', '')
    
    # Strip any remaining Unicode characters outside basic ASCII/punctuation (e.g. general Emojis)
    text = re.sub(r'[\U00010000-\U0010ffff]', '', text)
    text = re.sub(r'[\u2600-\u27bf]', '', text) # Miscellaneous Symbols and Dingbats
    
    # Bold
    text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
    # Italic
    text = re.sub(r'\*(.*?)\*', r'<i>\1</i>', text)
    # Links
    text = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', text)
    
    return text.strip()

def parse_markdown_to_story(md_path):
    with open(md_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    story = []
    in_table = False
    table_headers = []
    table_rows = []
    
    in_list = False
    list_items = []
    
    in_callout = False
    callout_lines = []
    callout_accent = ACCENT_CALLOUT
    callout_bg = BG_CALLOUT
    
    i = 0
    while i < len(lines):
        line = lines[i].rstrip('\n')
        
        # Table parsing
        if line.strip().startswith('|') and not in_table:
            # Check if next line is a divider
            if i + 1 < len(lines) and re.match(r'^\|[\s\-\|:]+$', lines[i+1].strip()):
                in_table = True
                # Parse headers
                table_headers = [clean_markdown_formatting(cell.strip()) for cell in line.split('|')[1:-1]]
                table_rows = []
                i += 2 # Skip header and separator line
                continue
        
        if in_table:
            if line.strip().startswith('|'):
                row = [clean_markdown_formatting(cell.strip()) for cell in line.split('|')[1:-1]]
                table_rows.append(row)
                i += 1
                continue
            else:
                # End of table, render it
                num_cols = len(table_headers)
                col_width = (170 * mm) / num_cols
                widths = [col_width] * num_cols
                
                # Check custom column layouts
                if num_cols == 3:
                    widths = [35 * mm, 30 * mm, 105 * mm] if "Weekly" in str(table_rows) or "Plan" in str(table_headers) else [45 * mm, 35 * mm, 90 * mm]
                elif num_cols == 2:
                    widths = [85 * mm, 85 * mm]
                elif num_cols == 4:
                    widths = [30 * mm, 30 * mm, 30 * mm, 80 * mm] if "Year" in str(table_rows) else [42 * mm, 42 * mm, 43 * mm, 43 * mm]
                elif num_cols == 8: # Competitors table
                    widths = [25*mm, 20*mm, 20*mm, 20*mm, 20*mm, 20*mm, 22*mm, 23*mm]
                elif num_cols == 7: # Tech Stack table
                    widths = [30*mm, 30*mm, 20*mm, 20*mm, 20*mm, 20*mm, 30*mm]
                
                # Build styled Table
                data = [[Paragraph(h, TABLE_HEADER) for h in table_headers]]
                for r in table_rows:
                    cells = []
                    for val in r:
                        # Make column cell bold if it starts with a tag, rating, or priority code
                        if val.startswith('<b>') or val.startswith('[P0]') or val.startswith('[P1]') or val.startswith('[P2]') or val.startswith('5/5') or val.startswith('4/5') or 'Standard' in val or 'Premium' in val or 'Enterprise' in val:
                            cells.append(Paragraph(val, TABLE_CELL_BOLD))
                        else:
                            cells.append(Paragraph(val, TABLE_CELL))
                    data.append(cells)
                
                t = Table(data, colWidths=widths)
                t.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), SAFFRON),
                    ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('GRID', (0, 0), (-1, -1), 0.5, DIVIDER),
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8fafc')]),
                    ('TOPPADDING', (0, 0), (-1, -1), 5),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                    ('LEFTPADDING', (0, 0), (-1, -1), 6),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                ]))
                story.append(t)
                story.append(Spacer(1, 4 * mm))
                in_table = False
                continue
        
        # Callout box parsing
        if line.strip().startswith('>') and not in_callout:
            in_callout = True
            callout_lines = []
            if '[!IMPORTANT]' in line or '[!WARNING]' in line or '[!CAUTION]' in line:
                callout_accent = colors.HexColor('#ef4444') if '[!CAUTION]' in line or '[!WARNING]' in line else SAFFRON
                callout_bg = colors.HexColor('#fef2f2') if '[!CAUTION]' in line or '[!WARNING]' in line else colors.HexColor('#fffbeb')
                line = re.sub(r'>\s*\[!(IMPORTANT|WARNING|CAUTION)\]', '', line)
            else:
                callout_accent = ACCENT_CALLOUT
                callout_bg = BG_CALLOUT
                line = re.sub(r'>\s*', '', line)
            
            callout_lines.append(clean_markdown_formatting(line.strip()))
            i += 1
            continue
            
        if in_callout:
            if line.strip().startswith('>'):
                cleaned = re.sub(r'>\s*', '', line)
                callout_lines.append(clean_markdown_formatting(cleaned.strip()))
                i += 1
                continue
            else:
                # End of callout
                inner_story = [Paragraph("<br/>".join(callout_lines), CALLOUT)]
                t = Table([[inner_story]], colWidths=[170 * mm])
                t.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, -1), callout_bg),
                    ('LEFTPADDING', (0, 0), (-1, -1), 10),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                    ('TOPPADDING', (0, 0), (-1, -1), 8),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
                    ('LINEBEFORE', (0, 0), (0, -1), 3, callout_accent),
                ]))
                story.append(KeepTogether(t))
                story.append(Spacer(1, 4 * mm))
                in_callout = False
                continue
                
        # List parsing
        is_bullet = line.strip().startswith('-') or line.strip().startswith('*')
        is_numbered = re.match(r'^\s*\d+\.\s', line.strip())
        
        if (is_bullet or is_numbered) and not in_list:
            in_list = True
            list_items = []
        
        if in_list:
            if is_bullet:
                cleaned = re.sub(r'^\s*[\-\*]\s*', '', line)
                list_items.append(clean_markdown_formatting(cleaned.strip()))
                i += 1
                continue
            elif is_numbered:
                cleaned = re.sub(r'^\s*\d+\.\s*', '', line)
                list_items.append(clean_markdown_formatting(cleaned.strip()))
                i += 1
                continue
            elif line.strip() == "":
                i += 1
                continue
            else:
                # End of list, render it
                flowable_items = []
                for item in list_items:
                    flowable_items.append(ListItem(Paragraph(item, BODY), leftIndent=12, bulletOffsetY=-2))
                story.append(ListFlowable(flowable_items, bulletType='bullet', start='circle', bulletFontName='Helvetica', bulletFontSize=8, spaceAfter=6))
                in_list = False
                continue

        # Skip horizontal dividers
        if line.strip() == "---":
            divider_table = Table([[""]], colWidths=[170 * mm], rowHeights=[1])
            divider_table.setStyle(TableStyle([
                ('LINEBELOW', (0, 0), (-1, -1), 0.5, DIVIDER),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
                ('TOPPADDING', (0, 0), (-1, -1), 0),
            ]))
            story.append(Spacer(1, 4 * mm))
            story.append(divider_table)
            story.append(Spacer(1, 4 * mm))
            i += 1
            continue
            
        # Headings
        if line.startswith('# '):
            story.append(Spacer(1, 6 * mm))
            story.append(Paragraph(clean_markdown_formatting(line[2:]), H1))
            i += 1
            continue
        elif line.startswith('## '):
            story.append(Spacer(1, 4 * mm))
            story.append(Paragraph(clean_markdown_formatting(line[3:]), H2))
            i += 1
            continue
        elif line.startswith('### '):
            story.append(Spacer(1, 3 * mm))
            story.append(Paragraph(clean_markdown_formatting(line[4:]), H3))
            i += 1
            continue
            
        # Plain body paragraph
        if line.strip() != "":
            cleaned_line = clean_markdown_formatting(line.strip())
            if cleaned_line.startswith('<b>Date:</b>') or cleaned_line.startswith('<b>Prepared for:</b>') or cleaned_line.startswith('<b>App:</b>'):
                story.append(Paragraph(cleaned_line, SUBTITLE))
            else:
                story.append(Paragraph(cleaned_line, BODY))
        
        i += 1
        
    return story

def main():
    doc_path = r"C:\Users\rahul2\.gemini\antigravity\brain\5ffb14a9-5ace-43a8-b65a-799036a563fc\BahiKhata_Pro_Comprehensive_Analysis_Report.md"
    pdf_path = r"C:\Users\rahul2\.gemini\antigravity\brain\5ffb14a9-5ace-43a8-b65a-799036a563fc\BahiKhata_Pro_Comprehensive_Analysis_Report.pdf"
    
    print("Parsing markdown report...")
    story = parse_markdown_to_story(doc_path)
    
    print("Building PDF...")
    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm
    )
    
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f"PDF generated successfully at: {pdf_path}")

if __name__ == "__main__":
    main()
