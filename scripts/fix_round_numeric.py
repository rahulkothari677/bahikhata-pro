#!/usr/bin/env python3
"""
Fix all ROUND(expr, 2) calls in raw SQL to ROUND((expr)::numeric, 2).

The previous fix was wrong — it placed ::numeric at the end of the expression,
but Postgres parses `a * b::numeric` as `a * (b::numeric)`, not `(a * b)::numeric`.
So the expression was still double precision and ROUND still failed.

The correct fix: wrap the ENTIRE expression in extra parens and cast to numeric:
  ROUND((expr)::numeric, 2)

This guarantees ROUND receives numeric type, not double precision.
"""

import re
import os

files = [
    'src/app/api/dashboard/route.ts',
    'src/app/api/reports/route.ts',
    'src/app/api/gstr-export/route.ts',
    'src/app/api/parties/[id]/route.ts',
]

def fix_round_calls(content):
    """Find ROUND(expr, 2) and replace with ROUND((expr)::numeric, 2)"""
    result = []
    i = 0
    while i < len(content):
        # Find next ROUND(
        idx = content.find('ROUND(', i)
        if idx == -1:
            result.append(content[i:])
            break

        # Copy everything up to ROUND(
        result.append(content[i:idx])

        # Find the matching closing paren of ROUND(
        depth = 1
        j = idx + 6  # skip "ROUND("
        while j < len(content) and depth > 0:
            if content[j] == '(':
                depth += 1
            elif content[j] == ')':
                depth -= 1
            j += 1

        if depth != 0:
            result.append(content[idx:])
            break

        # content[idx:j] is "ROUND(...)"
        # j-1 is the index of the closing ")"
        inner = content[idx+6:j-1]  # everything between ROUND( and )

        # Check if it ends with ", 2" (the precision argument)
        if inner.endswith(', 2'):
            expr = inner[:-3].strip()  # remove ", 2" and strip whitespace

            # First, remove any existing ::numeric casts we added in the broken fix
            # (to avoid double-casting like ::numeric::numeric)
            expr = expr.replace('::numeric::numeric', '::numeric')

            # Check if expr already starts with ( and ends with ) — if so, it's
            # already a single grouped expression, and we can just append ::numeric
            # But to be safe, ALWAYS wrap in extra parens
            # ROUND((expr)::numeric, 2)

            # But first check if it's already in the correct format: (expr)::numeric
            if expr.startswith('(') and expr.endswith(')') and expr.count('(') == expr.count(')'):
                # Already wrapped — just add ::numeric if not already there
                if not expr.endswith('::numeric'):
                    result.append(f'ROUND({expr}::numeric, 2)')
                else:
                    result.append(f'ROUND({expr}, 2)')
            else:
                # Wrap in extra parens and cast
                result.append(f'ROUND(({expr})::numeric, 2)')

            i = j
        else:
            # Not ROUND(expr, 2) — copy as-is
            result.append(content[idx:j])
            i = j

    return ''.join(result)


base = '/home/z/my-project'
for f in files:
    filepath = os.path.join(base, f)
    with open(filepath, 'r') as fh:
        content = fh.read()

    original = content
    content = fix_round_calls(content)

    if content != original:
        with open(filepath, 'w') as fh:
            fh.write(content)
        print(f"Fixed: {f}")
    else:
        print(f"No changes: {f}")

print("\nVerifying all ROUND calls have ::numeric applied to the full expression...")
os.system(f"cd {base} && grep -rn 'ROUND(' src/app/api/ | grep -v node_modules | head -20")
