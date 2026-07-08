#!/usr/bin/env python3
"""
V13 Phase 2: Apply getAuthUserIdWithModule/getAuthUserIdOwnerOnly to API routes.
Replaces getAuthUserId() calls with the permission-checking versions.
"""
import re
import os

BASE = '/home/z/my-project'

# Route → (function to use, module/None for owner-only)
# For transactions, we use getAuthContext since the module depends on the type
ROUTES = {
    'src/app/api/dashboard/route.ts': ('getAuthUserIdWithModule', "'dashboard'"),
    'src/app/api/reports/route.ts': ('getAuthUserIdWithModule', "'reports'"),
    'src/app/api/gstr-export/route.ts': ('getAuthUserIdWithModule', "'reports'"),
    'src/app/api/parties/route.ts': ('getAuthUserIdWithModule', "'parties'"),
    'src/app/api/parties/[id]/route.ts': ('getAuthUserIdWithModule', "'parties'"),
    'src/app/api/products/route.ts': ('getAuthUserIdWithModule', "'inventory'"),
    'src/app/api/scan-bill/route.ts': ('getAuthUserIdWithModule', "'scanner'"),
    'src/app/api/scan-bill/compare/route.ts': ('getAuthUserIdWithModule', "'scanner'"),
    'src/app/api/scan-bill/compare/history/route.ts': ('getAuthUserIdWithModule', "'scanner'"),
    'src/app/api/scan-bill/compare/[id]/route.ts': ('getAuthUserIdWithModule', "'scanner'"),
    'src/app/api/upload-bill/route.ts': ('getAuthUserIdWithModule', "'scanner'"),
    'src/app/api/voice-parse/route.ts': ('getAuthUserIdWithModule', "'scanner'"),
    'src/app/api/insights/route.ts': ('getAuthUserIdWithModule', "'dashboard'"),
    'src/app/api/whatsapp-invoice/route.ts': ('getAuthUserIdWithModule', "'sales'"),
    'src/app/api/whatsapp-reminder/route.ts': ('getAuthUserIdWithModule', "'parties'"),
    'src/app/api/settings/route.ts': ('getAuthUserIdWithModule', "'settings'"),
    # Owner-only routes
    'src/app/api/staff/route.ts': ('getAuthUserIdOwnerOnly', None),
    'src/app/api/payment/create-order/route.ts': ('getAuthUserIdOwnerOnly', None),
    'src/app/api/payment/verify/route.ts': ('getAuthUserIdOwnerOnly', None),
    'src/app/api/account/delete/route.ts': ('getAuthUserIdOwnerOnly', None),
    'src/app/api/account/export/route.ts': ('getAuthUserIdOwnerOnly', None),
    'src/app/api/seed/route.ts': ('getAuthUserIdOwnerOnly', None),
    'src/app/api/shops/route.ts': ('getAuthUserIdOwnerOnly', None),
    'src/app/api/ai-usage/route.ts': ('getAuthUserIdOwnerOnly', None),
}

for route_path, (func_name, module) in ROUTES.items():
    full_path = os.path.join(BASE, route_path)
    if not os.path.exists(full_path):
        print(f"SKIP (not found): {route_path}")
        continue

    with open(full_path, 'r') as f:
        content = f.read()

    # Check if getAuthUserId is imported
    if 'getAuthUserId' not in content:
        print(f"SKIP (no getAuthUserId): {route_path}")
        continue

    # Update the import line
    if func_name == 'getAuthUserIdWithModule':
        new_import = "import { getAuthUserIdWithModule } from '@/lib/get-auth'"
        old_import_patterns = [
            r"import \{ getAuthUserId \} from '@/lib/get-auth'",
            r"import \{getAuthUserId\} from '@/lib/get-auth'",
        ]
    elif func_name == 'getAuthUserIdOwnerOnly':
        new_import = "import { getAuthUserIdOwnerOnly } from '@/lib/get-auth'"
        old_import_patterns = [
            r"import \{ getAuthUserId \} from '@/lib/get-auth'",
            r"import \{getAuthUserId\} from '@/lib/get-auth'",
        ]

    changed = False
    for pattern in old_import_patterns:
        new_content = re.sub(pattern, new_import, content)
        if new_content != content:
            content = new_content
            changed = True
            break

    if not changed:
        print(f"SKIP (import not found): {route_path}")
        continue

    # Replace getAuthUserId() calls with the new function
    if func_name == 'getAuthUserIdWithModule':
        old_call = "getAuthUserId()"
        new_call = f"getAuthUserIdWithModule({module})"
    elif func_name == 'getAuthUserIdOwnerOnly':
        old_call = "getAuthUserId()"
        new_call = "getAuthUserIdOwnerOnly()"

    # Count occurrences to replace
    count = content.count(old_call)
    if count == 0:
        print(f"SKIP (no calls found): {route_path}")
        continue

    content = content.replace(old_call, new_call)

    with open(full_path, 'w') as f:
        f.write(content)
    print(f"UPDATED: {route_path} ({count} call(s) replaced)")

print("\nDone.")
