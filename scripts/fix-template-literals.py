#!/usr/bin/env python3
"""
Fix broken template literals after the bulk replace.

The bulk replace script converted:
  fetch(`/api/foo/${id}`)
to:
  offlineFetch('/api/foo/${id}`)   ← WRONG (opens with ' but closes with `)

This script fixes them back to:
  offlineFetch(`/api/foo/${id}`)
"""

import re
from pathlib import Path

FILES = [
    '/home/z/my-project/src/components/income/IncomeExpense.tsx',
    '/home/z/my-project/src/components/reports/Reports.tsx',
    '/home/z/my-project/src/components/parties/PartyProfile.tsx',
    '/home/z/my-project/src/components/ledger/Ledger.tsx',
    '/home/z/my-project/src/components/ledger/TransactionDetail.tsx',
    '/home/z/my-project/src/components/settings/StaffManagement.tsx',
    '/home/z/my-project/src/components/dashboard/Dashboard.tsx',
]

# Pattern: offlineFetch('/api/...${...}`)  →  offlineFetch(`/api/...${...}`)
# Match: offlineFetch('  followed by  /api/...${...}`)
# Where the opening was ' but closing was `
# Strategy: find `offlineFetch('/api/` followed by content containing ${ and ending with `)
# Use a regex that captures everything up to the matching close backtick

for fp in FILES:
    p = Path(fp)
    content = p.read_text()
    original = content

    # Pattern: offlineFetch('/api/<stuff>`  where <stuff> contains ${
    # The broken pattern: offlineFetch('   ...   `)   or   ...   `, {
    # Match offlineFetch(' followed by /api/ followed by anything that contains ${
    # and ends with ` before ) or `,` or `, `
    #
    # Use a non-greedy match, look for the closing backtick
    pattern = re.compile(r"offlineFetch\('/api/([^']*?\$\{[^']*?)`(,\s*\{|\))")
    def fix(m):
        body = m.group(1)
        tail = m.group(2)
        return f"offlineFetch(`/api/{body}`{tail}"
    content = pattern.sub(fix, content)

    if content != original:
        p.write_text(content)
        print(f'FIXED: {fp}')
    else:
        print(f'NO-CHANGE: {fp}')
