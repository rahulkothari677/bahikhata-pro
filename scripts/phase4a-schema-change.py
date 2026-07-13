#!/usr/bin/env python3
"""
Phase 4 CORRECTED: Change all money Float columns to Int in schema.prisma.
Same as before — preserves non-money Float columns.
"""

SCHEMA_PATH = 'prisma/schema.prisma'

NON_MONEY_FLOATS = {
    'gstRate', 'quantity', 'enteredQuantity',
    'currentStock', 'openingStock', 'lowStockThreshold',
    'matchConfidence',
    'geminiScore', 'openaiScore', 'groqScore',
    'currentValue', 'baselineValue', 'baselineStdDev', 'zScore',
    'threshold', 'metricValue',
    'conversionValue', 'priceInr',
}

MONEY_COLUMN_NAMES = {
    'purchasePrice', 'salePrice', 'mrp',
    'openingBalance',
    'subtotal', 'discountAmount', 'cgst', 'sgst', 'igst',
    'totalAmount', 'roundOff', 'paidAmount', 'grossProfit',
    'unitPrice', 'purchasePriceAtSale', 'csamt', 'total',
    'amount', 'balance',
    'totalValue', 'taxableValue', 'taxableTotal', 'totalOutputTax',
    'totalTaxableValue', 'totalCredits', 'totalDebits',
    'outwardTaxableValue', 'outwardCgst', 'outwardSgst', 'outwardIgst',
    'rcmTaxableValue', 'rcmCgst', 'rcmSgst', 'rcmIgst',
    'nilRatedValue', 'exemptValue', 'nonGstValue',
    'itcTaxableValue', 'itcCgst', 'itcSgst', 'itcIgst',
    'creditNoteTaxableValue', 'creditNoteCgst', 'creditNoteSgst', 'creditNoteIgst',
    'debitNoteTaxableValue', 'debitNoteCgst', 'debitNoteSgst', 'debitNoteIgst',
    'exemptInwardValue', 'interstateB2cTaxableValue', 'interstateB2cIgst',
    'netTaxPayable',
    'costInr', 'mrr', 'newMrr', 'churnedMrr', 'arr', 'totalGmv', 'aiCostInr',
    'igstTotal', 'cgstTotal', 'sgstTotal',
}

with open(SCHEMA_PATH, 'r') as f:
    lines = f.readlines()

changed = 0
for i, line in enumerate(lines):
    stripped = line.strip()
    if 'Float' not in stripped:
        continue
    parts = stripped.split()
    if not parts:
        continue
    col_name = parts[0]
    if col_name in NON_MONEY_FLOATS:
        continue
    if col_name not in MONEY_COLUMN_NAMES:
        continue
    if 'Float?' in stripped:
        lines[i] = line.replace('Float?', 'Int?')
    else:
        lines[i] = line.replace('Float', 'Int')
    changed += 1

with open(SCHEMA_PATH, 'w') as f:
    f.writelines(lines)

print(f"Schema: {changed} money columns changed Float → Int")
