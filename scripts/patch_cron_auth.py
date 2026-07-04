#!/usr/bin/env python3
"""
Update cron API routes to accept CRON_SECRET as alternative auth.
"""
import re

FILES = [
    "src/app/api/admin/compute-daily-stats/route.ts",
    "src/app/api/admin/anomalies/detect/route.ts",
    "src/app/api/admin/fraud-rules/evaluate/route.ts",
    "src/app/api/admin/webhooks/deliver/route.ts",
    "src/app/api/admin/bulk-jobs/execute/route.ts",
    "src/app/api/admin/data-monetization/compute/route.ts",
    "src/app/api/admin/churn-predictions/compute/route.ts",
]

BASE = "/home/z/bahikhata-admin"

for filepath in FILES:
    fullpath = f"{BASE}/{filepath}"
    try:
        with open(fullpath, 'r') as f:
            content = f.read()
    except:
        print(f"SKIP (not found): {filepath}")
        continue

    # Check if already patched
    if "isCron" in content:
        print(f"SKIP (already patched): {filepath}")
        continue

    # Pattern to find: const session = await getServerSession(authOptions)
    #                 if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    
    old_pattern = r"const session = await getServerSession\(authOptions\)\s*\n\s*if \(!session\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)"
    
    new_code = """const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get('authorization')
    const isCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)
    const session = isCron ? null : await getServerSession(authOptions)
    if (!isCron && !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })"""
    
    new_content = re.sub(old_pattern, new_code, content)
    
    if new_content == content:
        # Try alternate pattern (some files might have slightly different formatting)
        old_pattern2 = r"const session = await getServerSession\(authOptions\)\s*\n\s*if \(!session\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)"
        new_content = re.sub(old_pattern2, new_code, content, flags=re.MULTILINE)
    
    if new_content != content:
        with open(fullpath, 'w') as f:
            f.write(new_content)
        print(f"✓ PATCHED: {filepath}")
    else:
        print(f"⚠ PATTERN NOT FOUND (manual edit needed): {filepath}")

print("\nDone!")
