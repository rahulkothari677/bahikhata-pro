/**
 * Phase 7h — cards lose their double padding (#290).
 *
 * The shared Card pads itself (py-4) and most cards pad their content again
 * (p-3 / p-4), so 45 cards across 22 screens carried 28 px above the first line
 * — the bill form's customer card was 166 px tall for one search box. Now every
 * card that pads its content drops its own vertical padding (py-0).
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { doubledCardPadding } from '@/test-support/design-rules'

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '__tests__') tsxFiles(p, out) }
    else if (name.endsWith('.tsx')) out.push(p)
  }
  return out
}

describe('Card padding OR inner padding, never both', () => {
  it('the rule finds the doubled shape and passes the fixed ones', () => {
    expect(doubledCardPadding('<Card className="shadow-card">\n  <CardContent className="p-4">')).toHaveLength(1)
    expect(doubledCardPadding('<Card>\n  {/* note */}\n  <div className="p-3 sm:p-4">')).toHaveLength(1)
    expect(doubledCardPadding('<Card className="shadow-card py-0">\n  <CardContent className="p-4">')).toHaveLength(0)
    expect(doubledCardPadding("<Card className={cn('py-0', x && 'a')}>\n  <CardContent className=\"p-4\">")).toHaveLength(0)
    expect(doubledCardPadding('<Card className="shadow-card">\n  <CardHeader className="pb-2">')).toHaveLength(0)
  })
  it('no screen has a doubly padded card', () => {
    const src = join(process.cwd(), 'src')
    const found: string[] = []
    for (const f of tsxFiles(src)) {
      for (const tag of doubledCardPadding(readFileSync(f, 'utf8'))) found.push(`${relative(src, f)}: ${tag}`)
    }
    expect(found).toEqual([])
  })
})
