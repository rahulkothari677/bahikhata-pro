#!/usr/bin/env python3
"""
Phase 4A: Change all money Float columns to Int in schema.prisma.

Preserves non-money Float columns (gstRate, quantity, currentStock, etc.)
by checking against a known list.

Also updates @default values: Float @default(0) → Int @default(0) (same)
"""

import re

SCHEMA_PATH = 'prisma/schema.prisma'

# Non-money Float columns that must STAY as Float
NON_MONEY_FLOATS = {
    'gstRate', 'quantity', 'enteredQuantity',
    'currentStock', 'openingStock', 'lowStockThreshold',
    'matchConfidence',
    'geminiScore', 'openaiScore', 'groqScore',
    'currentValue', 'baselineValue', 'baselineStdDev', 'zScore',
    'threshold', 'metricValue',
    'conversionValue', 'priceInr',
}

# Money Float columns that should change to Int
# We identify them by name — any Float column NOT in NON_MONEY_FLOATS is money
MONEY_COLUMN_NAMES = {
    'purchasePrice', 'salePrice', 'mrp',
    'openingBalance',
    'subtotal', 'discountAmount', 'cgst', 'sgst', 'igst',
    'totalAmount', 'roundOff', 'paidAmount', 'grossProfit',
    'unitPrice', 'purchasePriceAtSale', 'csamt', 'total',
    'amount', 'balance',
    'totalValue', 'taxableValue', 'taxableTotal', 'totalOutputTax',
    'totalCredits', 'totalDebits',
    'outwardTaxableValue', 'outwardCgst', 'outwardSgst', 'outwardIgst',
    'rcmTaxableValue', 'rcmCgst', 'rcmSgst', 'rcmIgst',
    'nilRatedValue', 'exemptValue', 'nonGstValue',
    'itcTaxableValue', 'itcCgst', 'itcSgst', 'itcIgst',
    'creditNoteTaxableValue', 'creditNoteCgst', 'creditNoteSgst', 'creditNoteIgst',
    'debitNoteTaxableValue', 'debitNoteCgst', 'debitNoteSgst', 'debitNoteIgst',
    'exemptInwardValue', 'interstateB2cTaxableValue', 'interstateB2cIgst',
    'netTaxPayable',
    'costInr', 'mrr', 'newMrr', 'churnedMrr', 'arr', 'totalGmv', 'aiCostInr',
}

with open(SCHEMA_PATH, 'r') as f:
    lines = f.readlines()

changed = 0
kept = 0
changes_log = []

for i, line in enumerate(lines):
    stripped = line.strip()
    
    # Check if this line has a Float declaration
    if 'Float' not in stripped:
        continue
    
    # Extract the column name (first word on the line)
    parts = stripped.split()
    if not parts:
        continue
    
    col_name = parts[0]
    
    # Skip if it's a non-money Float
    if col_name in NON_MONEY_FLOATS:
        kept += 1
        continue
    
    # Skip if it's not in our money list (safety check)
    if col_name not in MONEY_COLUMN_NAMES:
        print(f"  WARNING: unknown Float column '{col_name}' on line {i+1} — not changing")
        kept += 1
        continue
    
    # Change Float → Int
    # Handle Float? (nullable) → Int?
    if 'Float?' in stripped:
        new_line = line.replace('Float?', 'Int?')
    else:
        new_line = line.replace('Float', 'Int')
    
    lines[i] = new_line
    changed += 1
    changes_log.append(f"  Line {i+1}: {col_name} Float → Int")

with open(SCHEMA_PATH, 'w') as f:
    f.writelines(lines)

print(f"Schema change complete: {changed} money columns changed Float → Int, {kept} non-money Floats preserved")
print(f"\nChanges made:")
for log in changes_log:
    print(log)
