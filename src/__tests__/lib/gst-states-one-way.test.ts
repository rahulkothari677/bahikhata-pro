/**
 * Phase 2 (2 Oct 2026) — a state is decided ONE way, by its code. (#118)
 *
 * Before: the bill's tax head compared raw typed names ("RJ" ≠ "Rajasthan" →
 * IGST charged on a sale inside Rajasthan, seen live 1 Oct), GSTR-1 used the
 * GSTIN prefix, and three callers passed the four-string deriveStateCode()
 * arguments in the wrong order.
 *
 * Law (verified report, "Place of supply"): codes in use 01–24, 26, 27,
 * 29–38 and 97; 25 and 28 are past-record codes. Same state → CGST + SGST,
 * different → IGST; no recorded buyer address → the supplier's location
 * (IGST Act s.10(1)(ca)).
 */
import fs from 'fs'
import path from 'path'
import {
  INDIAN_STATES, resolveStateCode, gstinStateCode, stateCodeOf, placeOfSupplyCode, supplyKind, stateNameForCode,
} from '@/lib/gst-states'

describe('the official list', () => {
  test('exactly the codes in current use: 01–24, 26, 27, 29–38 and 97', () => {
    const expected = [
      ...Array.from({ length: 24 }, (_, i) => String(i + 1).padStart(2, '0')),
      '26', '27',
      ...Array.from({ length: 10 }, (_, i) => String(29 + i)),
      '97',
    ]
    expect(INDIAN_STATES.map(s => s.code)).toEqual(expected)
  })
  test('past-record and unknown codes are refused for new entries', () => {
    for (const c of ['25', '28', '00', '39', '96', '99']) expect(resolveStateCode(c)).toBeNull()
  })
  test('names, codes and aliases are all unique — one text never means two states', () => {
    const seen = new Map<string, string>()
    const norm = (x: string) => x.toLowerCase().replace(/&/g, ' and ').replace(/\./g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    for (const s of INDIAN_STATES) {
      for (const key of [s.name, ...s.aliases]) {
        const k = norm(key)
        expect(seen.get(k) ?? s.code).toBe(s.code)
        seen.set(k, s.code)
      }
    }
  })
})

describe('resolveStateCode() — every way a state gets typed', () => {
  test('sweep: every state by name (any case, spacing), every alias, its code and its 1-digit form', () => {
    const failures: string[] = []
    for (const s of INDIAN_STATES) {
      const forms = [s.name, s.name.toUpperCase(), `  ${s.name.toLowerCase()}  `, s.code, ...s.aliases, ...s.aliases.map(a => a.toUpperCase())]
      if (s.code.startsWith('0')) forms.push(s.code.slice(1))
      for (const f of forms) if (resolveStateCode(f) !== s.code) failures.push(`${JSON.stringify(f)} → ${resolveStateCode(f)}, expected ${s.code}`)
    }
    expect(failures).toEqual([])
  })
  test('the short forms seen in real data', () => {
    expect(resolveStateCode('RJ')).toBe('08')
    expect(resolveStateCode('U.P.')).toBe('09')
    expect(resolveStateCode('J&K')).toBe('01')
    expect(resolveStateCode('Orissa')).toBe('21')
    expect(resolveStateCode('Pondicherry')).toBe('34')
    expect(resolveStateCode('Daman & Diu')).toBe('26')
    expect(resolveStateCode('New Delhi')).toBe('07')
  })
  test('nothing usable is null, never a guess', () => {
    for (const x of [null, undefined, '', '   ', 'Atlantis', 'U P S C']) expect(resolveStateCode(x)).toBeNull()
  })
  test('a code reads back as its official name', () => {
    expect(stateNameForCode('09')).toBe('Uttar Pradesh')
    expect(stateNameForCode('99')).toBeNull()
  })
})

describe('the stored fact wins: a GSTIN\'s prefix beats typed text', () => {
  test('gstinStateCode() only accepts a current code', () => {
    expect(gstinStateCode('08AAJFG2468H1Z7')).toBe('08')
    expect(gstinStateCode('28ABCDE1234F1Z5')).toBeNull()
    expect(gstinStateCode('XX123')).toBeNull()
    expect(gstinStateCode(null)).toBeNull()
  })
  test('#118 failure 2: typed "Maharashtra" with a 29… GSTIN is Karnataka', () => {
    expect(stateCodeOf({ gstin: '29ABCDE1234F1Z5', state: 'Maharashtra' })).toBe('29')
  })
})

describe('placeOfSupplyCode() and supplyKind()', () => {
  const RJ_SHOP = { gstin: '08AAJFG2468H1Z7', state: 'Rajasthan' }
  test('#118 live case: Rajasthan shop, customer typed "RJ" → same state, CGST + SGST', () => {
    expect(supplyKind({ shop: RJ_SHOP, party: { state: 'RJ' } })).toMatchObject({ isInterState: false, indeterminate: false, posCode: '08' })
  })
  test('#118 failure 1: shop "Uttar Pradesh", party "UP" → intra-state', () => {
    expect(supplyKind({ shop: { state: 'Uttar Pradesh' }, party: { state: 'UP' } }).isInterState).toBe(false)
  })
  test('a registered buyer in another state → IGST, place of supply = their GSTIN state', () => {
    expect(supplyKind({ shop: RJ_SHOP, party: { gstin: '09XYZAB5678C1Z9' } })).toMatchObject({ isInterState: true, posCode: '09' })
  })
  test('walk-in or no recorded state → the shop\'s own state (s.10(1)(ca))', () => {
    expect(placeOfSupplyCode({ shop: RJ_SHOP })).toBe('08')
    expect(supplyKind({ shop: RJ_SHOP, party: { state: '' } })).toMatchObject({ isInterState: false, indeterminate: false, posCode: '08' })
  })
  test('a delivery state (courier) decides the place of supply when given', () => {
    expect(supplyKind({ shop: RJ_SHOP, party: { state: 'Rajasthan' }, delivery: 'Uttar Pradesh' })).toMatchObject({ isInterState: true, posCode: '09' })
  })
  test('only a missing shop state leaves the answer open', () => {
    expect(supplyKind({ shop: { state: '' }, party: { state: 'Gujarat' } })).toMatchObject({ indeterminate: true, isInterState: false })
  })
})

/**
 * THE CLASS. Two shapes caused #118: four same-type positional strings (three
 * callers swapped them), and comparing typed names instead of codes. Callers
 * use the named-field functions; only gst-states.ts may define or wrap the old
 * ones.
 */
function codeLines(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, b => b.replace(/[^\n]/g, ''))
    .replace(/(^|[ \t])\/\/[^\n]*/gm, (_m, lead) => lead)
    .split(/\r?\n/)
}
const OLD_POSITIONAL = /\bderiveStateCode\(/
const OLD_NAME_COMPARE = /\bderiveInterStateFromStates\(/
const RAW_STATE_COMPARE = /\.state\??\.(?:trim\(\)\.)?toLowerCase\(\)\s*[!=]==/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('guard — states are compared by code, through named fields', () => {
  test('catches each old shape', () => {
    expect(codeLines(`const c = deriveStateCode(t.party?.state, null, t.party?.gstin, null)`).some(l => OLD_POSITIONAL.test(l))).toBe(true)
    expect(codeLines(`const r = deriveInterStateFromStates(shopState, party.state)`).some(l => OLD_NAME_COMPARE.test(l))).toBe(true)
    expect(codeLines(`if (shop.state.toLowerCase() !== party.state.toLowerCase())`).some(l => RAW_STATE_COMPARE.test(l))).toBe(true)
  })
  test('passes the new shapes and ignores comments', () => {
    const ok = codeLines(`// was deriveStateCode(a, b, c, d)\nconst k = supplyKind({ shop, party })\nconst p = placeOfSupplyCode({ shop, party })`)
    expect(ok.some(l => OLD_POSITIONAL.test(l) || OLD_NAME_COMPARE.test(l) || RAW_STATE_COMPARE.test(l))).toBe(false)
  })
  test('sweep: nothing outside gst-states.ts uses the old shapes', () => {
    const root = path.join(__dirname, '..', '..')
    const offenders: string[] = []
    for (const file of sourceFiles(root)) {
      const rel = path.relative(path.join(root, '..'), file).replace(/\\/g, '/')
      if (rel === 'src/lib/gst-states.ts') continue
      codeLines(fs.readFileSync(file, 'utf8')).forEach((l, i) => {
        if (OLD_POSITIONAL.test(l) || OLD_NAME_COMPARE.test(l) || RAW_STATE_COMPARE.test(l)) offenders.push(`${rel}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
