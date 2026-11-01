/**
 * #336 - every icon-only button has a name (aria-label), at every width.
 * The 4c touch guard checks a button's size; this checks it can be named:
 * a screen reader says "Search", and a mouse shows the tooltip.
 */
import fs from 'node:fs'
import path from 'node:path'
import { readRaw } from '@/test-support/read-source'
import { unnamedIconButtons } from '@/test-support/unnamed-icon-buttons'

function componentFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return componentFiles(p)
    return p.endsWith('.tsx') ? [p] : []
  })
}

describe('icon-only buttons have names (#336)', () => {
  it('flags an icon-only button and one whose words hide at some width', () => {
    const bad = [
      '<Button onClick={go}>',
      '  <Search className="w-4 h-4" />',
      '</Button>',
      '<Button onClick={scan}>',
      '  <Sparkles className="w-4 h-4" />',
      '  <span className="hidden xl:inline">{t("scan")}</span>',
      '</Button>',
    ].join('\n')
    expect(unnamedIconButtons(bad)).toEqual([1, 4])
  })

  it('accepts a label, visible words, sr-only words, or spread props', () => {
    const good = [
      '<Button aria-label="Search" onClick={go}><Search /></Button>',
      '<Button onClick={go}><Plus /> Add</Button>',
      '<button onClick={go}><Trash2 /><span className="sm:sr-only">Delete</span></button>',
      '<Button onClick={go}><Plus />{label}</Button>',
      '<Button {...props}><Plus /></Button>',
      '<Button onClick={() => a > b && go()}><X /> Close</Button>',
    ].join('\n')
    expect(unnamedIconButtons(good)).toEqual([])
  })

  it('no component has an unnamed icon-only button', () => {
    const root = path.join(process.cwd(), 'src', 'components')
    const misses = componentFiles(root).flatMap(f => {
      const rel = path.relative(process.cwd(), f).split(path.sep).join('/')
      return unnamedIconButtons(readRaw(rel)).map(line => `${rel}:${line}`)
    })
    expect(misses).toEqual([])
  })
})
