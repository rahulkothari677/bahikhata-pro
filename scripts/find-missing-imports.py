#!/usr/bin/env python3
"""
Comprehensive missing-import scanner for .tsx and .ts files.

Catches any JSX component / value that is USED in code but not IMPORTED.
This prevents runtime ReferenceErrors like the Clock / Select bugs we just hit.
"""
import re
import sys
from pathlib import Path
from collections import defaultdict

SRC = Path('/home/z/my-project/src')

# Patterns of known imports
IMPORT_RE = re.compile(
    r'^\s*import\s+(?:type\s+)?(?:(\w+)(?:\s*,\s*\{([^}]+)\})?|\{([^}]+)\}|\*\s+as\s+(\w+))\s+from\s+[\'"]([^\'"]+)[\'"]',
    re.MULTILINE,
)
DYNAMIC_RE = re.compile(
    r'(?:const|let|var)\s+(\w+)\s*=\s*dynamic\s*\(',
)
TYPE_RE = re.compile(r'^\s*export\s+(?:type|interface)\s+(\w+)', re.MULTILINE)
COMPONENT_DEF_RE = re.compile(
    r'(?:export\s+)?(?:default\s+)?(?:function|const)\s+([A-Z]\w*)\s*[\(\=\<]'
)

def collect_imports(text):
    """Return set of all names available via import statements in this file."""
    names = set()
    for m in IMPORT_RE.finditer(text):
        # Default import: group 1
        if m.group(1):
            names.add(m.group(1))
        # Named imports in braces after default: group 2
        if m.group(2):
            for n in m.group(2).split(','):
                n = n.strip().split(' as ')[-1].strip()
                if n:
                    names.add(n)
        # Named imports alone: group 3
        if m.group(3):
            for n in m.group(3).split(','):
                n = n.strip().split(' as ')[-1].strip()
                if n:
                    names.add(n)
        # Namespace import: group 4
        if m.group(4):
            names.add(m.group(4))
    # Dynamic imports: const Foo = dynamic(...)
    for m in DYNAMIC_RE.finditer(text):
        names.add(m.group(1))
    return names

def collect_local_defs(text):
    """Return set of names defined locally in this file (functions, consts, types)."""
    names = set()
    for m in COMPONENT_DEF_RE.finditer(text):
        names.add(m.group(1))
    for m in TYPE_RE.finditer(text):
        names.add(m.group(1))
    # function parameters, hooks like const [a, setA] = useState(...)
    for m in re.finditer(r'const\s+\[([^,\]]+)', text):
        names.add(m.group(1).strip())
    # const foo = ...
    for m in re.finditer(r'(?:^|\n)\s*const\s+([a-zA-Z_]\w*)\s*=', text):
        names.add(m.group(1))
    return names

# Known JSX built-ins (HTML elements) — never need importing
JSX_BUILTINS = {
    'div','span','p','a','img','button','input','form','label','select','option',
    'textarea','table','thead','tbody','tr','td','th','ul','ol','li','nav',
    'main','section','article','aside','header','footer','h1','h2','h3','h4',
    'h5','h6','br','hr','svg','path','circle','rect','line','polyline','polygon',
    'g','defs','linearGradient','radialGradient','stop','use','symbol','text',
    'tspan','ellipse','title','desc','mask','pattern','clipPath','filter',
    'feGaussianBlur','feOffset','feMerge','feMergeNode','feColorMatrix',
    'figure','figcaption','details','summary','dialog','menu','dl','dt','dd',
    'pre','code','kbd','samp','var','blockquote','q','cite','abbr','address',
    'time','small','strong','em','b','i','u','s','sub','sup','mark','del','ins',
    'video','audio','source','canvas','iframe','embed','object','param','map',
    'area','meta','link','script','style','head','body','html','title','base',
    'col','colgroup','caption','thead','tfoot','tbody','wbr','bdi','bdo','ruby',
    'rt','rp','progress','meter','output','datalist','optgroup','fieldset',
    'legend','keygen','track','picture','source','Suspense','Fragment',
    'template','slot','col','acronym','applet','basefont','big','center',
    'content','dir','font','frame','frameset','isindex','noframes','param',
    'strike','tt','xmp',
}

# React hooks and utilities (always available in React 17+ with new JSX transform)
REACT_GLOBALS = {
    'useState','useEffect','useRef','useMemo','useCallback','useContext',
    'useReducer','useLayoutEffect','useImperativeHandle','useDebugValue',
    'useTransition','useDeferredValue','useId','useSyncExternalStore',
    'useOptimistic','useActionState','useFormStatus','useFormState',
}

def scan_file(path):
    text = path.read_text(encoding='utf-8', errors='ignore')
    imports = collect_imports(text)
    local_defs = collect_local_defs(text)

    # Find JSX usage: <Foo ...>
    used = set(re.findall(r'<([A-Z]\w*)', text))

    # Find capitalized identifiers used as values (not just JSX)
    # e.g. onClick={() => Foo(...)} or const x = Bar
    # but skip ones inside strings or comments — heuristic
    for m in re.finditer(r'\b([A-Z]\w*)\b', text):
        used.add(m.group(1))

    available = imports | local_defs | JSX_BUILTINS | REACT_GLOBALS
    # Add common JS globals
    available |= {
        'window','document','console','Math','Date','JSON','Object','Array',
        'String','Number','Boolean','RegExp','Error','Promise','Map','Set',
        'WeakMap','WeakSet','Symbol','Proxy','Reflect','parseInt','parseFloat',
        'isNaN','isFinite','setTimeout','setInterval','clearTimeout',
        'clearInterval','fetch','Request','Response','Headers','URL','URLSearchParams',
        'FormData','Blob','File','FileReader','Image','Audio','Video','localStorage',
        'sessionStorage','navigator','location','history','screen','alert','confirm',
        'prompt','process','Buffer','global','globalThis','require','module',
        'exports','__dirname','__filename','arguments','this','self','top','parent',
        'opener','frames','length','name','closed','status','defaultStatus',
        'defaultstatus','event','external','innerHeight','innerWidth','outerHeight',
        'outerWidth','pageXOffset','pageYOffset','scrollX','scrollY','self',
        'Infinity','NaN','undefined','true','false','null','void','typeof','instanceof',
        'in','of','new','delete','yield','await','async','function','class','extends',
        'super','this','static','get','set','public','private','protected','readonly',
        'abstract','as','enum','interface','type','namespace','declare','const','let',
        'var','if','else','for','while','do','switch','case','break','continue',
        'return','throw','try','catch','finally','with','import','export','from',
        'default','is','keyof','never','unknown','any','string','number','boolean',
        'object','symbol','bigint','true','false','null','undefined','void','never',
    }

    # Known third-party / library globals
    available |= {
        'React','Fragment','Suspense','Profiler','StrictMode','Component',
        'PureComponent','memo','forwardRef','lazy','createContext','createElement',
        'cloneElement','createRef','Children','isValidElement','version','createRoot',
        'hydrateRoot','renderToString','renderToStaticMarkup','renderToReadableStream',
    }

    missing = used - available
    # Filter false positives — only flag names that look like React components
    # (start with capital letter, length > 1) and aren't common TS keywords
    real_missing = set()
    for name in missing:
        if len(name) <= 1:
            continue
        if name in {'True','False','Null','Undefined','Object','Array','String',
                    'Number','Boolean','Error','Promise','Map','Set','Symbol','Date',
                    'Math','JSON','RegExp','Proxy','Reflect','WeakMap','WeakSet',
                    'Infinity','NaN','Window','Document','Console','Navigator','Location',
                    'History','Screen','Element','HTMLElement','Node','Event','FormEvent',
                    'MouseEvent','KeyboardEvent','TouchEvent','WheelEvent','PointerEvent',
                    'AnimationEvent','TransitionEvent','ClipboardEvent','DragEvent',
                    'FocusEvent','InputEvent','UIEvent','SubmitEvent','ProgressEvent',
                    'CustomEvent','MessageEvent','StorageEvent','PopStateEvent',
                    'HashChangeEvent','BeforeUnloadEvent','PageTransitionEvent',
                    'ErrorEvent','PromiseRejectionEvent','Audio','Video','Image',
                    'File','Blob','FileReader','FormData','Headers','Request','Response',
                    'URL','URLSearchParams','WebSocket','Worker','SharedWorker',
                    'AbortController','AbortSignal','ReadableStream','WritableStream',
                    'TransformStream','ByteLengthQueuingStrategy','CountQueuingStrategy',
                    'Notification','ServiceWorker','PushManager','PushSubscription',
                    'PaymentRequest','PaymentResponse','PaymentAddress','PaymentMethodChangeEvent',
                    'PaymentMethodData','PaymentDetailsModifier','PaymentDetailsUpdate',
                    'PaymentItem','PaymentShippingOption','PaymentShippingType'}:
            continue
        # Skip if name is used only inside a string (heuristic — check if it appears
        # in a quoted context). We can't perfectly do this, but let's at least skip
        # names that look like TypeScript generic types
        if name in {'T','U','V','W','X','Y','Z','K','A','B','C','D','E','F','G','H',
                    'I','J','L','M','N','O','P','Q','R','S','TS','JS','CSS','HTML',
                    'XML','JSON','API','UI','UX','ID','URL','URI','UUID','HTTP','HTTPS',
                    'SQL','CSV','PDF','PNG','JPG','JPEG','GIF','SVG','MP3','MP4','AVI',
                    'MOV','WEBM','WAV','OGG','FLAC','TTF','OTF','WOFF','WOFF2','EOT'}:
            continue
        real_missing.add(name)

    return real_missing, imports, local_defs

def main():
    all_problems = defaultdict(list)
    files_scanned = 0
    for src_file in SRC.rglob('*.tsx'):
        files_scanned += 1
        missing, _, _ = scan_file(src_file)
        if missing:
            for name in sorted(missing):
                all_problems[str(src_file)].append(name)
    for src_file in SRC.rglob('*.ts'):
        files_scanned += 1
        missing, _, _ = scan_file(src_file)
        if missing:
            for name in sorted(missing):
                all_problems[str(src_file)].append(name)

    print(f"Scanned {files_scanned} files")
    if not all_problems:
        print("No missing imports found.")
        return 0
    print(f"\nPotential missing imports in {len(all_problems)} files:")
    for f, names in all_problems.items():
        print(f"\n  {f}:")
        for n in names:
            print(f"    - {n}")
    return 1

if __name__ == '__main__':
    sys.exit(main())
