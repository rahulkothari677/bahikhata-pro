#!/usr/bin/env python3
"""
Bulk-replace `fetch('/api/...')` calls with `offlineFetch('/api/...')` in
component files, and add the necessary import line.

Skips files in the blocklist (AuthScreen, since it has its own offline handling
and uses signIn() which is not a fetch).
"""

import re
from pathlib import Path

BLOCKLIST = {
    '/home/z/my-project/src/components/auth/AuthScreen.tsx',  # uses signIn() not fetch; auth endpoints bypass anyway
}

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
    if fp in BLOCKLIST:
        print(f'SKIP (blocklist): {fp}')
        continue
    p = Path(fp)
    content = p.read_text()
    original = content

    # Add import if missing
    if IMPORT_LINE not in content:
        # Find last top-level import
        lines = content.split('\n')
        last_import_idx = -1
        for i, line in enumerate(lines):
            if line.startswith('import '):
                last_import_idx = i
        if last_import_idx >= 0:
            lines.insert(last_import_idx + 1, IMPORT_LINE)
            content = '\n'.join(lines)

    # Replace fetch( calls that target /api/
    # Patterns: fetch('/api/...'), fetch(`/api/...`), fetch("/api/...")
    content = re.sub(r"\bfetch\(\s*['\"`]/api/", "offlineFetch('/api/", content)

    if content != original:
        p.write_text(content)
        # Count replacements
        n_before = original.count("fetch('/api/") + original.count('fetch("/api/') + original.count('fetch(`/api/')
        n_after = content.count("fetch('/api/") + content.count('fetch("/api/') + content.count('fetch(`/api/')
        n_offline = content.count("offlineFetch('/api/")
        print(f'OK: {fp}  (fetch→offlineFetch: {n_before - n_after}, total offlineFetch: {n_offline})')
    else:
        print(f'NO-CHANGE: {fp}')
