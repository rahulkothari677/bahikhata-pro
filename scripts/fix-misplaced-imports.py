#!/usr/bin/env python3
"""
Fix the broken imports caused by the bulk-replace script.

The bulk-replace script inserted the offlineFetch import line right after the
last `import ` line, but some files have multi-line imports like:
  import {
    Foo, Bar, Baz,
  } from 'lucide-react'

So the inserted line ended up in the middle of a multi-line import block.

This script:
  1. Removes the misplaced `import { offlineFetch } from '@/lib/offline-fetch'` line
     wherever it appears inside a multi-line import.
  2. Re-inserts it as a standalone top-level import after the last complete
     import statement (where the `from '...'` is).
"""

import re
from pathlib import Path

FILES = [
    '/home/z/my-project/src/components/income/IncomeExpense.tsx',
    '/home/z/my-project/src/components/scanner/BillScanner.tsx',
    '/home/z/my-project/src/components/settings/StaffManagement.tsx',
    '/home/z/my-project/src/components/common/ProductPicker.tsx',
    '/home/z/my-project/src/components/settings/Settings.tsx',
    '/home/z/my-project/src/components/common/VoiceEntry.tsx',
    '/home/z/my-project/src/components/common/PartySelect.tsx',
    '/home/z/my-project/src/components/reports/Reports.tsx',
    '/home/z/my-project/src/components/common/GlobalSearch.tsx',
    '/home/z/my-project/src/components/ledger/TransactionDetail.tsx',
    '/home/z/my-project/src/components/dashboard/SmartInsights.tsx',
    '/home/z/my-project/src/components/ledger/TransactionEntry.tsx',
    '/home/z/my-project/src/components/dashboard/Dashboard.tsx',
    '/home/z/my-project/src/components/ledger/Ledger.tsx',
    '/home/z/my-project/src/components/layout/Onboarding.tsx',
    '/home/z/my-project/src/components/parties/Parties.tsx',
    '/home/z/my-project/src/components/parties/PartyProfile.tsx',
    '/home/z/my-project/src/components/layout/Header.tsx',
    '/home/z/my-project/src/components/inventory/Inventory.tsx',
]

IMPORT_LINE = "import { offlineFetch } from '@/lib/offline-fetch'"

for fp in FILES:
    p = Path(fp)
    content = p.read_text()
    lines = content.split('\n')

    # Step 1: Remove ALL occurrences of the misplaced import line
    cleaned = [ln for ln in lines if ln.strip() != IMPORT_LINE.strip()]

    # Step 2: Find the last "complete" import line — one that contains `from '...'`
    #         This handles both single-line imports and the closing line of multi-line imports.
    last_complete_import_idx = -1
    for i, ln in enumerate(cleaned):
        # An import statement ends with `from '...'` or `from "..."`
        if re.search(r"from\s+['\"][^'\"]+['\"]\s*;?\s*$", ln):
            # Verify this is actually an import (walk back to find `import` keyword)
            j = i
            while j >= 0:
                if cleaned[j].lstrip().startswith('import '):
                    last_complete_import_idx = i
                    break
                if cleaned[j].strip() and not cleaned[j].strip().startswith('//') and not cleaned[j].strip().startswith('/*') and not cleaned[j].strip().startswith('*'):
                    # Hit non-import, non-comment line — stop
                    if not cleaned[j].strip().startswith('{') and not cleaned[j].strip().startswith('}') and ',' not in cleaned[j]:
                        break
                j -= 1

    if last_complete_import_idx >= 0:
        cleaned.insert(last_complete_import_idx + 1, IMPORT_LINE)
    else:
        # Fallback: insert at top of file
        cleaned.insert(0, IMPORT_LINE)

    new_content = '\n'.join(cleaned)
    if new_content != content:
        p.write_text(new_content)
        print(f'FIXED: {fp}')
    else:
        print(f'NO-CHANGE: {fp}')
