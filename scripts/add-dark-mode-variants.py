#!/usr/bin/env python3
"""
V20-022: Add dark mode variants to hardcoded amber-600/emerald-600/red-600 colors.

In dark mode, Tailwind's amber-600 (#d97706) is too dark against the dark
background — it's designed for light backgrounds. The fix: add dark:text-amber-400
(a lighter amber that passes WCAG AA on dark backgrounds).

This script finds text-amber-600 without a dark: variant and adds dark:text-amber-400.
Same for text-emerald-600 → dark:text-emerald-400, text-red-600 → dark:text-red-400.
"""

import os
import re

# Color mappings: light mode → dark mode equivalent
COLOR_MAP = {
    'text-amber-600': 'dark:text-amber-400',
    'text-emerald-600': 'dark:text-emerald-400',
    'text-red-600': 'dark:text-red-400',
    'text-amber-700': 'dark:text-amber-300',  # amber-700 is darker, needs amber-300 in dark
    'text-emerald-700': 'dark:text-emerald-300',
    'text-red-700': 'dark:text-red-300',
}

src_dir = '/home/z/my-project/src/components'
files_modified = []

for root, dirs, files in os.walk(src_dir):
    for fname in files:
        if not fname.endswith('.tsx'):
            continue
        fpath = os.path.join(root, fname)
        with open(fpath, 'r') as f:
            content = f.read()

        original = content
        for light_color, dark_color in COLOR_MAP.items():
            # Pattern: the light color NOT followed by a dark: variant
            # We need to be careful with strings like 'text-amber-600 dark:text-amber-400'
            # (already fixed) vs 'text-amber-600' (needs fix)

            # Match the color not immediately followed by ' dark:'
            # Use negative lookahead
            pattern = re.escape(light_color) + r'(?!\s+' + re.escape(dark_color) + r')'
            
            # Replace: add the dark variant after the light color
            # But only if there isn't already a dark: variant for the same color family
            def replace(match):
                # Check if this line already has a dark: variant for this color
                line_start = content.rfind('\n', 0, match.start()) + 1
                line_end = content.find('\n', match.end())
                if line_end == -1:
                    line_end = len(content)
                line = content[line_start:line_end]
                
                # If the line already has dark:text-amber or dark:text-emerald etc, skip
                color_family = light_color.split('-')[1]  # 'amber', 'emerald', 'red'
                if f'dark:text-{color_family}' in line:
                    return match.group(0)  # Already has a dark variant
                
                return f'{light_color} {dark_color}'
            
            content = re.sub(pattern, replace, content)

        if content != original:
            with open(fpath, 'w') as f:
                f.write(content)
            files_modified.append(fpath)

print(f"Modified {len(files_modified)} files:")
for f in files_modified:
    print(f"  {f}")
