#!/usr/bin/env python3
"""
Fix GET handlers in cron routes — revert to session-only auth (no req parameter).
Keep POST handlers with cron auth (they have req parameter).
"""
import re

FILES = [
    "src/app/api/admin/anomalies/detect/route.ts",
    "src/app/api/admin/fraud-rules/evaluate/route.ts",
    "src/app/api/admin/data-monetization/compute/route.ts",
    "src/app/api/admin/compute-daily-stats/route.ts",
    "src/app/api/admin/webhooks/deliver/route.ts",
    "src/app/api/admin/bulk-jobs/execute/route.ts",
    "src/app/api/admin/churn-predictions/compute/route.ts",
]

BASE = "/home/z/bahikhata-admin"

# The cron auth block that was incorrectly added to GET handlers
CRON_AUTH_BLOCK = """const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get('authorization')
    const isCron = !!(cronSecret && authHeader === `Bearer ${cronSecret}`)
    const session = isCron ? null : await getServerSession(authOptions)
    if (!isCron && !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })"""

# What it should be for GET handlers (session-only)
SESSION_ONLY = """const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })"""

for filepath in FILES:
    fullpath = f"{BASE}/{filepath}"
    try:
        with open(fullpath, 'r') as f:
            content = f.read()
    except:
        print(f"SKIP (not found): {filepath}")
        continue

    # Split by GET and POST functions
    # Find all GET function blocks and revert their auth
    lines = content.split('\n')
    new_lines = []
    in_get_function = False
    in_post_function = False
    
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Track which function we're in
        if 'export async function GET(' in line:
            in_get_function = True
            in_post_function = False
        elif 'export async function POST(' in line:
            in_get_function = False
            in_post_function = True
        
        # If we're in a GET function and find the cron auth block, replace with session-only
        if in_get_function and 'const cronSecret = process.env.CRON_SECRET' in line:
            # Skip the next 4 lines (the full cron auth block) and replace with session-only
            new_lines.append('    const session = await getServerSession(authOptions)')
            new_lines.append('    if (!session) return NextResponse.json({ error: \'Unauthorized\' }, { status: 401 })')
            i += 4  # skip the 4 remaining lines of the cron auth block
            print(f"  Fixed GET handler in {filepath} at line {i}")
            i += 1
            continue
        
        new_lines.append(line)
        i += 1
    
    new_content = '\n'.join(new_lines)
    
    if new_content != content:
        with open(fullpath, 'w') as f:
            f.write(new_content)
        print(f"✓ FIXED: {filepath}")
    else:
        print(f"  No GET auth issue found: {filepath}")

print("\nDone!")
