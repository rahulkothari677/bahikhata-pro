/**
 * #337 - the GST rate tables quote the notification verbatim behind ⓘ, and
 * they read "labell ed", "sucr ose", "fe nnel". The source text has CRLF line
 * ends; the parser dropped the \n of a soft wrap and the \r became a space
 * inside the word. The same \r also glued 7 rows onto the row above (sewing
 * needles had no 5% row at all).
 *
 * The rule, runnable both ways: a pair "a b" is a broken word when "ab" is a
 * word the table uses elsewhere and at least one half is not.
 */
import goods from '@/lib/data/gst-goods-rates.json'
import exempt from '@/lib/data/gst-exempt-goods.json'

type Table = { codes: Record<string, { description: string }[]> }

function descriptions(t: Table): string[] {
  return Object.values(t.codes).flatMap(rows => rows.map(r => r.description))
}

/** Two words the notification itself also writes as one ("Soyabean"). */
const REAL_PAIRS = new Set(['Soya bean'])

function brokenWords(texts: string[]): string[] {
  const vocab = new Map<string, number>()
  for (const t of texts) for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) vocab.set(w, (vocab.get(w) ?? 0) + 1)
  const found = new Set<string>()
  for (const t of texts) {
    const pairs = t.matchAll(/\b([A-Za-z]+) ([a-z]+)\b/g)
    for (const [, a, b] of pairs) {
      const joined = (a + b).toLowerCase()
      if (!vocab.has(joined) || REAL_PAIRS.has(`${a} ${b}`)) continue
      // A half used only inside this one pair is a fragment, not a word.
      const isWord = (w: string) => w.length > 1 && (vocab.get(w.toLowerCase()) ?? 0) > 1
      if (!isWord(a) || !isWord(b)) found.add(`${a} ${b}`)
    }
  }
  return [...found]
}

describe('statute rows have no words broken by the PDF wrap (#337)', () => {
  it('catches a broken word and leaves real word pairs alone', () => {
    const texts = ['pre-packaged and labell ed', 'packaged and labelled', 'packaged and labelled', 'ground nut oil', 'groundnut cake', 'nut', 'ground']
    expect(brokenWords(texts)).toEqual(['labell ed'])
  })

  it('the goods rate table has none', () => {
    expect(brokenWords(descriptions(goods as Table))).toEqual([])
  })

  it('the exempt goods table has none', () => {
    expect(brokenWords(descriptions(exempt as Table))).toEqual([])
  })

  it('rows the CRLF glue had hidden are their own rows (Notification 09/2025-CT(R))', () => {
    const rows = (goods as Table).codes
    const rate = (code: string, text: string) =>
      (rows[code] as { description: string; gstRate: number }[]).find(r => r.description.startsWith(text))?.gstRate
    expect(rate('7319', 'Sewing needles')).toBe(5)
    expect(rate('8807', 'Parts of goods of heading 8802 or 8806')).toBe(5)
    expect(rate('4901', 'Brochures, leaflets')).toBe(5)
    expect(rate('6704', 'Wigs, false beards')).toBe(18)
    expect(rate('6811', 'Articles of asbestos cement')).toBe(18)
    expect(rate('2512', 'Siliceous fossil meals')).toBe(5)
  })
})
