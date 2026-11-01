/**
 * #336 - an icon-only button has no name for a screen reader and no tooltip
 * unless it carries aria-label. A button whose words are hidden at some width
 * (`hidden xl:inline`) is icon-only at the other widths, so it needs one too.
 *
 * Reads a component's source and returns the line of every <Button>/<button>
 * that has no visible words at some width and no aria-label. Pure, so the
 * guard test can call it on a known-good and a known-bad snippet.
 */
export function unnamedIconButtons(source: string): number[] {
  const out: number[] = []
  const open = /<(Button|button)(?=[\s>])/g
  for (let m = open.exec(source); m; m = open.exec(source)) {
    const tag = m[1]
    const start = m.index
    const tagEnd = endOfOpeningTag(source, start)
    if (tagEnd < 0) continue
    const attrs = source.slice(start, tagEnd)
    if (/\baria-label(ledby)?=/.test(attrs) || /\{\.\.\.\w+\}/.test(attrs)) continue
    if (source[tagEnd - 1] === '/') continue // self-closing: props decide, not ours to read
    const close = source.indexOf(`</${tag}>`, tagEnd)
    if (close < 0) continue
    const inner = source.slice(tagEnd + 1, close)
    if (!hasWordsAtEveryWidth(inner)) out.push(source.slice(0, start).split('\n').length)
  }
  return out
}

/** Index of the `>` closing the opening tag, skipping `{...}` and quoted text. */
function endOfOpeningTag(s: string, from: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (quote) { if (c === quote) quote = null; continue }
    if (depth === 0 && (c === '"' || c === "'")) { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return i
  }
  return -1
}

/**
 * True when the children show words at every width: some text or `{expr}`
 * that is not inside an element hidden at a width (`hidden`, `sr-only` counts
 * as named, `*:hidden` hides). Children that are only icons return false.
 */
function hasWordsAtEveryWidth(inner: string): boolean {
  // sr-only text is a name, even if never seen.
  if (/className="[^"]*\bsr-only\b/.test(inner)) return true
  // Drop elements that are hidden at some width, with their content.
  let visible = inner.replace(/<(\w+)[^>]*className="(?:[^"]*\s)?(?:hidden|[a-z]+:hidden)(?:\s|")[^>]*>[\s\S]*?<\/\1>/g, ' ')
  // Drop JSX comments and self-closing elements (icons).
  visible = visible.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/<[A-Za-z][^>]*\/>/g, ' ')
  // Drop tags, keep their text.
  visible = visible.replace(/<\/?[A-Za-z][^>]*>/g, ' ')
  return /[A-Za-z0-9₹]|\{[^}]+\}/.test(visible)
}
