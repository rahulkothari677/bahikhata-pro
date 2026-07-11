#!/usr/bin/env python3
"""Update raw-sql-smoke.test.ts assertions for Phase 4 (no * 100, no nudge)."""

import re

filepath = 'src/__tests__/lib/raw-sql-smoke.test.ts'
with open(filepath, 'r') as f:
    content = f.read()

# 1. Change assertions that CHECK FOR * 100 + nudge → CHECK AGAINST
# Old: expect(q).toMatch(/\*\s*100\s*\+\s*0\.0000001/)
# New: expect(q).not.toMatch(/\*\s*100/)  (no * 100 at all in Phase 4)
content = re.sub(
    r"expect\((\w+)\)\.toMatch\(/\\\*\\s\*100\\s\\\*\\\+\\s\*0\\\.0000001/\)",
    r"expect(\1).not.toMatch(/\\\*\\s*100/)",
    content
)

# Also handle the moneyQueries loop pattern
content = re.sub(
    r"expect\(q\)\.toMatch\(/\\\*\\s\*100\\s\\\*\\\+\\s\*0\\\.0000001/\)",
    r"expect(q).not.toMatch(/\\\*\\s*100/)",
    content
)

# 2. Change SIGN assertions for sales trend (no longer uses SIGN in Phase 4)
# Old: expect(trendQuery).toMatch(/SIGN\s*\(/)
# New: expect(trendQuery).not.toMatch(/SIGN\s*\(/)  (no SIGN needed for Int columns)
content = content.replace(
    "expect(trendQuery).toMatch(/SIGN\\s*\\(/)",
    "expect(trendQuery).not.toMatch(/SIGN\\s*\\(/)"
)

# 3. Change top products SIGN assertion
content = content.replace(
    "expect(topProductsQuery).toMatch(/SIGN\\s*\\(/)",
    "expect(topProductsQuery).not.toMatch(/SIGN\\s*\\(/)"
)

# 4. Change category SIGN assertion  
content = content.replace(
    "expect(categoryQuery).toMatch(/SIGN\\s*\\(/)",
    "expect(categoryQuery).not.toMatch(/SIGN\\s*\\(/)"
)

# 5. Change CTE assertion (no longer has ROUND conversion in outer SELECT)
# Old: expect(kpiQuery).toMatch(/WITH\s+kpi_raw\s+AS\s*\(/i)
# New: keep this — CTE still exists, just no * 100 in outer SELECT
# Old: expect(kpiQuery).toMatch(/SIGN\s*\(/)
# New: expect(kpiQuery).not.toMatch(/SIGN\s*\(/)
content = content.replace(
    "expect(kpiQuery).toMatch(/SIGN\\s*\\(/)",
    "expect(kpiQuery).not.toMatch(/SIGN\\s*\\(/)"
)

# 6. Change KPI * 100 assertion
content = content.replace(
    "expect(kpiQuery).toMatch(/\\\\*\\\\s*100/)",
    "expect(kpiQuery).not.toMatch(/\\\\*\\\\s*100/)"
)

# 7. Fix analytics top-customers SIGN assertion
content = content.replace(
    "expect(topCustomersQuery).toMatch(/SIGN\\s*\\(/)",
    "expect(topCustomersQuery).not.toMatch(/SIGN\\s*\\(/)"
)

# 8. Fix party-balance SIGN assertion
content = content.replace(
    "expect(balanceQuery).toMatch(/0\\.0000001\\s*\\*\\s*SIGN/)",
    "expect(balanceQuery).not.toMatch(/0\\.0000001\\s*\\*\\s*SIGN/)"
)

# 9. Fix party-balance * 100 assertion
content = content.replace(
    "expect(balanceQuery).toMatch(/\\\\*\\\\s*100\\\\s*\\\\+\\\\s*0\\\\.0000001/)",
    "expect(balanceQuery).not.toMatch(/\\\\*\\\\s*100/)"
)

with open(filepath, 'w') as f:
    f.write(content)

print("Test assertions updated for Phase 4")
