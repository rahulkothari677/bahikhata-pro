#!/usr/bin/env python3
"""
Focused missing-import scanner.

Only flags names that are USED AS JSX COMPONENTS (<Foo ... />) but not imported.
This is the exact pattern that caused the Clock and Select crashes.
"""
import re
import sys
from pathlib import Path
from collections import defaultdict

SRC = Path('/home/z/my-project/src')

IMPORT_RE = re.compile(
    r'^\s*import\s+(?:type\s+)?(?:(\w+)(?:\s*,\s*\{([^}]+)\})?|\{([^}]+)\}|\*\s+as\s+(\w+))\s+from\s+[\'"]([^\'"]+)[\'"]',
    re.MULTILINE,
)
DYNAMIC_RE = re.compile(r'(?:const|let|var)\s+(\w+)\s*=\s*dynamic\s*\(')
COMPONENT_DEF_RE = re.compile(
    r'(?:export\s+)?(?:default\s+)?(?:function|const)\s+([A-Z]\w*)\s*[\(\=\<]'
)
TYPE_DEF_RE = re.compile(r'^\s*export\s+(?:type|interface)\s+(\w+)', re.MULTILINE)

JSX_BUILTINS = {
    'div','span','p','a','img','button','input','form','label','select','option',
    'textarea','table','thead','tbody','tr','td','th','ul','ol','li','nav',
    'main','section','article','aside','header','footer','h1','h2','h3','h4',
    'h5','h6','br','hr','svg','path','circle','rect','line','polyline','polygon',
    'g','defs','linearGradient','radialGradient','stop','use','symbol','text',
    'tspan','ellipse','title','desc','mask','pattern','clipPath','filter',
    'figure','figcaption','details','summary','dialog','menu','dl','dt','dd',
    'pre','code','kbd','samp','var','blockquote','q','cite','abbr','address',
    'time','small','strong','em','b','i','u','s','sub','sup','mark','del','ins',
    'video','audio','source','canvas','iframe','embed','object','param','map',
    'area','meta','link','script','style','head','body','html','base',
    'col','colgroup','caption','thead','tfoot','tbody','wbr','bdi','bdo','ruby',
    'rt','rp','progress','meter','output','datalist','optgroup','fieldset',
    'legend','track','picture','template','slot',
}

REACT_GLOBALS = {
    'Fragment','Suspense','StrictMode','Profiler',
}

def collect_available(text):
    names = set()
    for m in IMPORT_RE.finditer(text):
        if m.group(1):
            names.add(m.group(1))
        if m.group(2):
            for n in m.group(2).split(','):
                n = n.strip().split(' as ')[-1].strip()
                if n:
                    names.add(n)
        if m.group(3):
            for n in m.group(3).split(','):
                n = n.strip().split(' as ')[-1].strip()
                if n:
                    names.add(n)
        if m.group(4):
            names.add(m.group(4))
    for m in DYNAMIC_RE.finditer(text):
        names.add(m.group(1))
    for m in COMPONENT_DEF_RE.finditer(text):
        names.add(m.group(1))
    for m in TYPE_DEF_RE.finditer(text):
        names.add(m.group(1))
    for m in re.finditer(r'const\s+\[([^,\]]+)', text):
        names.add(m.group(1).strip())
    for m in re.finditer(r'(?:^|\n)\s*const\s+([a-zA-Z_]\w*)\s*=', text):
        names.add(m.group(1))
    return names

def strip_comments_and_strings(text):
    """Remove string literals and comments so we don't flag names inside them."""
    # Remove block comments
    text = re.sub(r'/\*[\s\S]*?\*/', '', text)
    # Remove line comments
    text = re.sub(r'//[^\n]*', '', text)
    # Remove template literals (simple — doesn't handle nesting)
    text = re.sub(r'`[^`]*`', '``', text)
    # Remove string literals
    text = re.sub(r'"(?:[^"\\]|\\.)*"', '""', text)
    text = re.sub(r"'(?:[^'\\]|\\.)*'", "''", text)
    return text

def scan_file(path):
    raw = path.read_text(encoding='utf-8', errors='ignore')
    # Strip comments/strings BEFORE finding JSX tags, so we don't catch <Foo> in comments
    text = strip_comments_and_strings(raw)
    available = collect_available(raw)  # parse imports from raw (full text)
    available |= JSX_BUILTINS
    available |= REACT_GLOBALS

    # Find JSX usage: <Foo ...> but not <foo (lowercase) and not </Foo>
    used = set()
    for m in re.finditer(r'<([A-Z]\w*)', text):
        used.add(m.group(1))
    # Also catch Foo used as component reference (e.g. component={Foo})
    # but only if capitalized and used in JSX-like context
    # Skip for now — too many false positives

    missing = used - available
    # Filter: skip ones that are actually defined elsewhere as components
    # (we can't easily do cross-file analysis here, but local scan should catch most)
    return missing, available

def main():
    problems = defaultdict(set)
    files_scanned = 0
    for src_file in list(SRC.rglob('*.tsx')) + list(SRC.rglob('*.ts')):
        files_scanned += 1
        missing, _ = scan_file(src_file)
        for name in missing:
            problems[str(src_file)].add(name)

    print(f"Scanned {files_scanned} files")
    if not problems:
        print("No missing JSX imports found.")
        return 0
    print(f"\nMissing JSX imports in {len(problems)} files:\n")
    for f, names in problems.items():
        print(f"  {f}:")
        for n in sorted(names):
            print(f"    - {n}")
    return 1

if __name__ == '__main__':
    sys.exit(main())
