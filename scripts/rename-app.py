#!/usr/bin/env python3
"""
Rename app from 'BahiKhata Pro' to 'EkBook' across the codebase.
Only changes display names — NOT package names, repo names, or URLs.
"""
import os
import re

BASE = "/home/z/my-project"

# Files to update (not node_modules, not .next, not android/build)
TARGET_DIRS = [
    "src",
    "capacitor.config.json",
    "android/app/src/main/res",
]

# Replacement rules (order matters — more specific first)
REPLACEMENTS = [
    # App name variations
    ("BahiKhata Pro", "EkBook"),
    ("Bahikhata Pro", "EkBook"),
    ("Bahikhata", "EkBook"),
    ("BahiKhata", "EkBook"),
    ("bahikhata-pro", "ekbook"),  # for URLs in comments only
    # Caption/tagline
    ("India's smartest ledger app", "India's smartest ledger app"),  # keep as is
    # Splash screen text
    ("Bahi Khata", "EkBook"),
]

# Skip these files/directories
SKIP = [
    "node_modules",
    ".next",
    "android/build",
    "android/app/build",
    "android/gradle",
    "android/capacitor-cordova-android-plugins",
    ".git",
]

def should_skip(filepath):
    for s in SKIP:
        if s in filepath:
            return True
    return False

def process_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except:
        return False
    
    original = content
    for old, new in REPLACEMENTS:
        content = content.replace(old, new)
    
    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

def process_dir(dirpath):
    changed = []
    for root, dirs, files in os.walk(dirpath):
        # Skip directories
        if should_skip(root):
            continue
        
        for filename in files:
            filepath = os.path.join(root, filename)
            if should_skip(filepath):
                continue
            
            # Only process text files
            ext = os.path.splitext(filename)[1].lower()
            if ext in ['.ts', '.tsx', '.js', '.jsx', '.json', '.xml', '.md', '.css', '.html']:
                if process_file(filepath):
                    changed.append(filepath)
    
    return changed

# Process each target
all_changed = []
for target in TARGET_DIRS:
    fullpath = os.path.join(BASE, target)
    if os.path.isdir(fullpath):
        all_changed.extend(process_dir(fullpath))
    elif os.path.isfile(fullpath):
        if process_file(fullpath):
            all_changed.append(fullpath)

print(f"✓ Renamed in {len(all_changed)} files:")
for f in all_changed:
    relpath = os.path.relpath(f, BASE)
    print(f"  {relpath}")
