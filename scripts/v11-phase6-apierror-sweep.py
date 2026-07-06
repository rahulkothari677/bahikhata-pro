#!/usr/bin/env python3
"""
V11 Phase 6: Apply apiError() to remaining routes.
For each route file, add the apiError import and replace console.error + NextResponse.json
patterns with apiError() calls.
"""
import re
import os

ROUTES_TO_UPDATE = [
    'src/app/api/shops/route.ts',
    'src/app/api/transactions/route.ts',
    'src/app/api/whatsapp-reminder/route.ts',
    'src/app/api/whatsapp-invoice/route.ts',
    'src/app/api/upload-bill/route.ts',
    'src/app/api/subscription/status/route.ts',
    'src/app/api/ai-usage/route.ts',
    'src/app/api/seed/route.ts',
    'src/app/api/gstr-export/route.ts',
]

BASE = '/home/z/my-project'

for route_path in ROUTES_TO_UPDATE:
    full_path = os.path.join(BASE, route_path)
    if not os.path.exists(full_path):
        print(f"SKIP (not found): {route_path}")
        continue
    
    with open(full_path, 'r') as f:
        content = f.read()
    
    # Check if apiError is already imported
    if 'apiError' in content:
        print(f"SKIP (already has apiError): {route_path}")
        continue
    
    # Add import after the last existing import
    import_pattern = r"(import [^\n]+\n)"
    matches = list(re.finditer(import_pattern, content))
    if matches:
        last_import = matches[-1]
        insert_pos = last_import.end()
        content = content[:insert_pos] + "import { apiError } from '@/lib/api-error'\n" + content[insert_pos:]
    
    # Replace patterns like:
    # console.error('xxx error:', error)
    # return NextResponse.json({ error: 'xxx' }, { status: 500 })
    # with:
    # return apiError(error, 'xxx', 500)
    
    # Pattern 1: console.error + NextResponse.json on consecutive lines
    pattern1 = r"console\.error\('[^']+', error\)\n\s*return NextResponse\.json\(\{ error: '([^']+)' \}, \{ status: (\d+) \}\)"
    
    def replace1(m):
        msg = m.group(1)
        status = m.group(2)
        return f"return apiError(error, '{msg}', {status})"
    
    new_content = re.sub(pattern1, replace1, content)
    
    if new_content != content:
        with open(full_path, 'w') as f:
            f.write(new_content)
        print(f"UPDATED: {route_path}")
    else:
        print(f"NO CHANGES (pattern not found): {route_path}")

print("\nDone.")
