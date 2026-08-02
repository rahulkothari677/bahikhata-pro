const fs = require('fs')
const path = require('path')

const root = process.argv[2] || '.'
const hits = []

// Blank out comments so documentation examples aren't reported as live code.
// Replaces comment bodies with spaces to keep byte offsets (line numbers) exact.
function stripComments(s) {
  let out = s.split('')
  let i = 0
  while (i < s.length) {
    if (s[i] === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') { out[i] = ' '; i++ }
    } else if (s[i] === '/' && s[i + 1] === '*') {
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) {
        if (s[i] !== '\n') out[i] = ' '
        i++
      }
      if (i < s.length) { out[i] = ' '; out[i + 1] = ' '; i += 2 }
    } else i++
  }
  return out.join('')
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!p.includes('__tests__') && !p.includes('node_modules') && !p.includes('tests')) walk(p)
    } else if (/\.tsx?$/.test(e.name)) {
      const raw = fs.readFileSync(p, 'utf8')
      const s = stripComments(raw)
      const re = /(db|tx|prisma)\.(\w+)\.findMany\(/g
      let m
      while ((m = re.exec(s)) !== null) {
        const start = m.index + m[0].length - 1
        let depth = 0, j = start
        for (; j < Math.min(s.length, start + 5000); j++) {
          if (s[j] === '(') depth++
          else if (s[j] === ')') { depth--; if (depth === 0) break }
        }
        const block = s.slice(start, j + 1)
        if (/\btake\s*:/.test(block)) continue

        // Summarise the filter so bounded-by-nature queries are distinguishable
        // from ones that scan an entire per-user collection.
        const flat = block.replace(/\s+/g, ' ')
        const boundedById = /\bid:\s*\{\s*in:/.test(flat) || /\btransactionId:/.test(flat)
        const hasDate = /\bdate:\s*\{/.test(flat) || /gte:/.test(flat)
        hits.push({
          file: p.split(path.sep).join('/'),
          line: raw.slice(0, m.index).split('\n').length,
          model: m[2],
          boundedById,
          hasDate,
          where: (flat.match(/where:\s*\{[^}]*\}/) || ['(dynamic)'])[0].slice(0, 90),
        })
      }
    }
  }
}

walk(root)
const scanAll = hits.filter(h => !h.boundedById && !h.hasDate)
console.log('findMany with no take: ' + hits.length)
console.log('  bounded by id-set / parent id : ' + hits.filter(h => h.boundedById).length)
console.log('  bounded by a date range       : ' + hits.filter(h => !h.boundedById && h.hasDate).length)
console.log('  FULL COLLECTION SCAN          : ' + scanAll.length + '\n')
console.log('--- full-collection scans (the ones that matter) ---')
scanAll.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
for (const h of scanAll) console.log('  ' + h.file + ':' + h.line + ' [' + h.model + '] ' + h.where)
