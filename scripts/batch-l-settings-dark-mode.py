#!/usr/bin/env python3
"""
AUDIT V23 Batch L §13.9a: Add dark-mode variants to Settings → Data tab.

The Data tab (lines ~743-1020 of Settings.tsx) has 6 cards that use only
light-mode Tailwind classes (bg-{color}-50, text-{color}-900/800/700/600,
border-{color}-200/300/400, hover:bg-{color}-100). In dark mode these
render as glaring light panels — the auditor flagged this in §13.9.

This script applies a CONSISTENT mapping (matching the pattern already
used in the Appearance tab and elsewhere in Settings.tsx):

    bg-{c}-50           → bg-{c}-50 dark:bg-{c}-950/20
    border-{c}-200      → border-{c}-200 dark:border-{c}-900/40
    border-{c}-300      → border-{c}-300 dark:border-{c}-800
    border-{c}-400      → border-{c}-400 dark:border-{c}-800
    text-{c}-900        → text-{c}-900 dark:text-{c}-100
    text-{c}-800        → text-{c}-800 dark:text-{c}-200
    text-{c}-700        → text-{c}-700 dark:text-{c}-300
    text-{c}-600        → text-{c}-600 dark:text-{c}-400
    hover:bg-{c}-100    → hover:bg-{c}-100 dark:hover:bg-{c}-900/40

Scoped to ONE file: Settings.tsx
Scoped to ONE region: the Data tab ({settingsTab === 'data' && ... } block).
We detect this by finding "DATA TAB" comment marker and ending at the next
"APPEARANCE TAB" marker.

Skips lines that already contain a dark: variant for the same color family
(so we don't double-apply on lines that were already partially fixed).
"""

import re
from pathlib import Path

SRC = Path('/home/z/my-project/src/components/settings/Settings.tsx')
text = SRC.read_text()

# Extract Data tab region only — match the comment marker by its inner text
# (the dash count is brittle, so we search by the unique substring inside)
start_marker_idx = text.find('── DATA TAB ──')
end_marker_idx = text.find('── APPEARANCE TAB ──')
if start_marker_idx < 0 or end_marker_idx < 0:
    raise SystemExit(f"Could not find tab markers (start={start_marker_idx}, end={end_marker_idx})")
# Backtrack to the start of the `{/*` line and forward to the end of the `*/}` line
start_idx = text.rfind('{/*', 0, start_marker_idx)
end_idx = text.find('*/}', end_marker_idx) + len('*/}')
# Extend end_idx to the closing `)}` of the Data tab card
close_idx = text.find('      )}', end_idx)
if close_idx > 0:
    end_idx = close_idx + len('      )}')
region = text[start_idx:end_idx]
original_region = region

COLORS = ['blue', 'amber', 'emerald', 'rose', 'violet']

# Each rule: (regex, replacement generator). We use word-boundary matching to
# avoid corrupting e.g. text-amber-600 inside text-amber-6000 (hypothetical).
# Replacement checks: skip if the matched token is immediately followed by a
# dark: variant for the SAME color family on the same line.

def make_rule(pattern_str, repl_str, color_family):
    """Return (compiled_regex, replacement_string, color_family)."""
    return (re.compile(pattern_str), repl_str, color_family)

RULES = []
for c in COLORS:
    # bg-{c}-50  → add dark:bg-{c}-950/20
    RULES.append(make_rule(r'\bbg-' + c + r'-50\b', f'bg-{c}-50 dark:bg-{c}-950/20', c))
    # border-{c}-200 → dark:border-{c}-900/40
    RULES.append(make_rule(r'\bborder-' + c + r'-200\b', f'border-{c}-200 dark:border-{c}-900/40', c))
    # border-{c}-300 → dark:border-{c}-800
    RULES.append(make_rule(r'\bborder-' + c + r'-300\b', f'border-{c}-300 dark:border-{c}-800', c))
    # border-{c}-400 → dark:border-{c}-800
    RULES.append(make_rule(r'\bborder-' + c + r'-400\b', f'border-{c}-400 dark:border-{c}-800', c))
    # text-{c}-900 → dark:text-{c}-100
    RULES.append(make_rule(r'\btext-' + c + r'-900\b', f'text-{c}-900 dark:text-{c}-100', c))
    # text-{c}-800 → dark:text-{c}-200
    RULES.append(make_rule(r'\btext-' + c + r'-800\b', f'text-{c}-800 dark:text-{c}-200', c))
    # text-{c}-700 → dark:text-{c}-300
    RULES.append(make_rule(r'\btext-' + c + r'-700\b', f'text-{c}-700 dark:text-{c}-300', c))
    # text-{c}-600 → dark:text-{c}-400
    RULES.append(make_rule(r'\btext-' + c + r'-600\b', f'text-{c}-600 dark:text-{c}-400', c))
    # hover:bg-{c}-100 → dark:hover:bg-{c}-900/40
    RULES.append(make_rule(r'\bhover:bg-' + c + r'-100\b', f'hover:bg-{c}-100 dark:hover:bg-{c}-900/40', c))

# Special-case: bg-rose-100 / bg-emerald-100 / bg-amber-100 result-row backgrounds
# (used in health check pass/fail rows). These need a dark variant too.
# IMPORTANT: use a negative lookbehind to NOT match `bg-{c}-100` when it's
# preceded by `hover:` (which is handled by the hover:bg rule above).
RESULT_BG_RULES = []
for c in COLORS:
    RESULT_BG_RULES.append(make_rule(r'(?<!hover:)\bbg-' + c + r'-100\b', f'bg-{c}-100 dark:bg-{c}-950/40', c))

def apply_rules(content, rules):
    """Apply each rule in order. Skip if the same line already has dark:{family}."""
    lines = content.split('\n')
    out_lines = []
    changes = 0
    for line in lines:
        new_line = line
        for regex, repl, family in rules:
            def replace_one(m):
                nonlocal changes
                # Check if the line already has dark:<*>-{family} for this family
                if f'dark:bg-{family}' in line or f'dark:border-{family}' in line \
                   or f'dark:text-{family}' in line or f'dark:hover:bg-{family}' in line:
                    # Already has at least one dark variant for this family on this line —
                    # but only skip THIS specific token if it's immediately followed by a dark:
                    # for the SAME class-type (bg/border/text/hover:bg).
                    # Use a more targeted check: look ahead in the line for the corresponding
                    # dark: variant of the EXACT same type.
                    pass
                # Check the immediate context (next 60 chars) for a same-type dark variant
                end = m.end()
                tail = line[end:end + 80]
                # Determine the "type" (bg/border/text/hover:bg) and look for matching dark:
                class_type = m.group(0).split('-')[0] if not m.group(0).startswith('hover:bg') else 'hover:bg'
                if class_type == 'hover:bg':
                    if f'dark:hover:bg-{family}' in tail:
                        return m.group(0)
                elif class_type == 'bg':
                    if f'dark:bg-{family}' in tail:
                        return m.group(0)
                elif class_type == 'border':
                    if f'dark:border-{family}' in tail:
                        return m.group(0)
                elif class_type == 'text':
                    if f'dark:text-{family}' in tail:
                        return m.group(0)
                changes += 1
                return m.group(0) + ' ' + repl.split(' ', 1)[1] if ' ' in repl else repl
            # Actually simpler: if regex matches AND the next 80 chars don't contain
            # the corresponding dark: variant, append it.
            def safer_replace(m, _regex=regex, _repl=repl, _family=family):
                nonlocal changes
                end = m.end()
                tail = line[end:end + 100]
                # determine class type from the matched token
                token = m.group(0)
                if token.startswith('hover:bg'):
                    dark_variant = f'dark:hover:bg-{_family}'
                elif token.startswith('bg'):
                    dark_variant = f'dark:bg-{_family}'
                elif token.startswith('border'):
                    dark_variant = f'dark:border-{_family}'
                elif token.startswith('text'):
                    dark_variant = f'dark:text-{_family}'
                else:
                    return token
                if dark_variant in tail:
                    return token  # already has it
                # extract the dark variant piece (the second part of repl)
                parts = _repl.split(' ')
                dark_part = next((p for p in parts if p.startswith('dark:')), None)
                if not dark_part:
                    return token
                changes += 1
                return token + ' ' + dark_part
            new_line = regex.sub(safer_replace, new_line)
        out_lines.append(new_line)
    return '\n'.join(out_lines), changes

# Apply main rules, then result-bg rules
region, c1 = apply_rules(region, RULES)
region, c2 = apply_rules(region, RESULT_BG_RULES)

total = c1 + c2

# Stitch back
new_text = text[:start_idx] + region + text[end_idx:]
SRC.write_text(new_text)
print(f"Settings.tsx Data tab dark-mode fixes applied: {total} tokens updated.")
