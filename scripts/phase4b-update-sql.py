#!/usr/bin/env python3
"""
Phase 4 CORRECTED: Update all Phase 2 SQL queries for Int (paise) columns.

The Phase 2 SQL queries were designed for Float (rupee) columns and multiplied
by 100 to convert to paise. Now that columns are Int (paise), the * 100 is
double-converting. This script removes the * 100 + nudge patterns.

Key transformations:
1. ROUND(SUM(expr) * 100 + 0.0000001) → SUM(expr)
2. ROUND(SUM(expr) * 100 + 0.0000001 * SIGN(SUM(expr))) → SUM(expr)
3. ROUND(col * 100 + 0.0000001 * SIGN(col)) → col  (CTE outer SELECT)
4. COALESCE(ROUND(SUM(expr) * 100 + 0.0000001, 0), 0)::text → COALESCE(SUM(expr), 0)::text
5. ROUND(qty * price, 2) → ROUND(qty * price, 0)  (inner ROUND for taxable calc)
"""

import re
import os

FILES = [
    'src/app/api/insights/route.ts',
    'src/lib/party-balance.ts',
    'src/app/api/reports/route.ts',
    'src/app/api/gstr-export/route.ts',
    'src/app/api/analytics/route.ts',
    'src/app/api/parties/[id]/route.ts',
    'src/app/api/dashboard/route.ts',
    'src/app/api/gstr-3b/route.ts',
]

total_changes = 0

for filepath in FILES:
    if not os.path.exists(filepath):
        print(f"  SKIP (not found): {filepath}")
        continue

    with open(filepath, 'r') as f:
        content = f.read()

    original = content
    changes = 0

    # Pattern 1: Remove "ROUND(SUM(...) * 100 + 0.0000001)" → "SUM(...)"
    # This matches: ROUND(SUM(<expr>) * 100 + 0.0000001)
    # Replace with: SUM(<expr>)
    # We need to be careful with nested parentheses
    
    # Pattern 1a: Simple positive nudge
    # ROUND(SUM(expr) * 100 + 0.0000001) → SUM(expr)
    content = re.sub(
        r'ROUND\(SUM\((.*?)\) \* 100 \+ 0\.0000001\)',
        r'SUM(\1)',
        content
    )

    # Pattern 1b: With ROUND inside (for taxable calculations)
    # ROUND(SUM(ROUND(expr, 2)) * 100 + 0.0000001) → SUM(ROUND(expr, 0))
    # Already handled by 1a, but we need to change ROUND(..., 2) to ROUND(..., 0)
    # for taxable calculations inside SUM
    
    # Pattern 2: Sign-aware nudge
    # ROUND(SUM(expr) * 100 + 0.0000001 * SIGN(SUM(expr))) → SUM(expr)
    # This is trickier because the expr appears twice
    content = re.sub(
        r'ROUND\(\s*\((.*?)\) \* 100\s*\+\s*0\.0000001 \* SIGN\(\s*\1\s*\)\s*\)',
        r'(\1)',
        content
    )

    # Pattern 3: CTE outer SELECT
    # ROUND(col * 100 + 0.0000001 * SIGN(col)) AS col_paise → col AS col_paise
    content = re.sub(
        r'ROUND\((\w+) \* 100 \+ 0\.0000001 \* SIGN\(\1\)\) AS (\w+_paise)',
        r'\1 AS \2',
        content
    )
    # Also without _paise suffix
    content = re.sub(
        r'ROUND\((\w+) \* 100 \+ 0\.0000001 \* SIGN\(\1\)\)',
        r'\1',
        content
    )

    # Pattern 4: COALESCE with nudge and ::text
    # COALESCE(ROUND(SUM(expr) * 100 + 0.0000001, 0), 0)::text → COALESCE(SUM(expr), 0)::text
    content = re.sub(
        r'COALESCE\(ROUND\(SUM\((.*?)\) \* 100 \+ 0\.0000001, 0\), 0\)::text',
        r'COALESCE(SUM(\1), 0)::text',
        content
    )

    # Pattern 5: Change ROUND(qty * price, 2) to ROUND(qty * price, 0)
    # Only inside SUM() for taxable calculations
    # This is safe because the , 2 was for rupee precision; now we need paise precision (, 0)
    content = re.sub(
        r'ROUND\((ti\."quantity"::numeric \* ti\."unitPrice"::numeric.*?), 2\)',
        r'ROUND(\1, 0)',
        content
    )
    # Also for the discount subtraction variant
    content = re.sub(
        r'ROUND\(\(ti\."quantity"::numeric \* ti\."unitPrice"::numeric.*?\)::numeric, 2\)',
        lambda m: m.group(0).replace(', 2)', ', 0)'),
        content
    )

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        # Count changes (rough)
        changes = original.count('* 100') - content.count('* 100')
        if changes < 0:
            changes = 0
        total_changes += changes
        print(f"  UPDATED: {filepath} ({changes} * 100 patterns removed)")
    else:
        print(f"  NO CHANGES: {filepath}")

print(f"\nTotal: {total_changes} '* 100' patterns removed across {len(FILES)} files")
