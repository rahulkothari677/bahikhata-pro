/**
 * 🔒 THE PROSE BUDGET, AS A RULE A TEST CAN RUN (Phase 4b, #177).
 *
 * CLAUDE.md, "It is an app, not a notebook": on screen go the label, the
 * number and the action, and at most one short line. A sweep on 1 Oct counted
 * ~17,000 words of prose inside screen components; the guard promised then
 * did not exist (#177). This is it.
 *
 * What counts as prose: the text an element shows directly — its JSX text
 * plus string literals written as children (a {value} counts as nothing) —
 * when that text runs past ONE_LINE_WORDS words. A label, a
 * button, a heading or a one-line hint never counts. Comments never count:
 * the parser does not see them.
 *
 * Parsed with the TypeScript compiler, not a regex, so a `>` in an arrow
 * function or a `{` in a template cannot be mistaken for markup (the
 * "measure the structure, not nearby text" lesson, CLAUDE.md Cause 7).
 */

import * as ts from 'typescript'

/** One short line on a phone: about 12 words. More than that is prose. */
export const ONE_LINE_WORDS = 12

export interface ProseRun {
  line: number
  words: number
  text: string
}

const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/** Every element whose own text runs past one line, with its word count. */
export function proseRuns(source: string, fileName = 'screen.tsx'): ProseRun[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const runs: ProseRun[] = []

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const parts: string[] = []
      for (const child of node.children) {
        if (ts.isJsxText(child)) parts.push(child.text)
        else if (ts.isJsxExpression(child) && child.expression) {
          const e = child.expression
          if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) parts.push(e.text)
          else if (ts.isTemplateExpression(e)) parts.push([e.head.text, ...e.templateSpans.map((s) => ' ' + s.literal.text)].join(''))
          // A value ({amount}, {name}) or a nested piece of markup is not a
          // word of prose; only text a person wrote counts.
          else parts.push(' ')
        } else parts.push(' ') // a nested element splits the run
      }
      const text = parts.join('').replace(/\s+/g, ' ').trim()
      const words = wordCount(text)
      if (words > ONE_LINE_WORDS) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        runs.push({ line: line + 1, words, text: text.slice(0, 80) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return runs
}

/** Total prose words in one file. */
export const proseWords = (source: string, fileName?: string) =>
  proseRuns(source, fileName).reduce((n, r) => n + r.words, 0)
