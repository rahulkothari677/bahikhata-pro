/**
 * 🔒 THE GUARD THAT SHOULD HAVE EXISTED — every money-bearing relation must be
 * declared in MODEL_RELATIONS.
 *
 * WHY: this exact omission has now shipped FOUR times.
 *
 *   V20-002  BankStatement -> transactions        bank recon showed 100x
 *   V20-008  five more relations at once          credit notes + matched
 *                                                 payments showed 100x
 *   AUDIT C5 Transaction -> paymentAllocations    a Rs 1,000 settlement
 *                                                 rendered as Rs 1,00,000
 *
 * Every time, the fix was "add the missing line", and every time the class was
 * left able to recur. Registering a model in MONEY_COLUMNS is only HALF the
 * job: the extension converts a nested row only if the relation is ALSO listed
 * in MODEL_RELATIONS. Nothing enforced the second half, and the failure is
 * invisible in code review — the nested rows simply come back in paise while
 * their siblings are in rupees.
 *
 * This test derives the truth from prisma/schema.prisma rather than from a
 * hand-written list, so a NEW relation to a money model fails immediately,
 * without anyone remembering this rule exists.
 *
 * It is intentionally strict. A relation that genuinely does not need
 * conversion must be named in INTENTIONALLY_UNCONVERTED with a reason.
 */

import fs from 'fs'
import path from 'path'
import { __testing } from '@/lib/prisma-money-extension'

const { MONEY_COLUMNS, MODEL_RELATIONS } = __testing

interface Relation {
  fromModel: string
  fieldName: string
  toModel: string
}

/**
 * Parse model blocks out of schema.prisma and return every relation field
 * (a field whose type is another model).
 */
function parseSchemaRelations(): { relations: Relation[]; models: Set<string> } {
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma')
  const raw = fs.readFileSync(schemaPath, 'utf8')
  const src = raw.replace(/\/\/.*$/gm, ' ')

  const models = new Set<string>()
  const blocks: Array<{ name: string; body: string }> = []

  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = modelRe.exec(src)) !== null) {
    models.add(m[1])
    blocks.push({ name: m[1], body: m[2] })
  }

  const relations: Relation[] = []
  for (const block of blocks) {
    for (const rawLine of block.body.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('@@')) continue

      // `fieldName  Type` — Type may carry [] and/or ?
      const fieldMatch = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/)
      if (!fieldMatch) continue

      const [, fieldName, typeName] = fieldMatch
      // A relation is a field whose type is itself a model.
      if (!models.has(typeName) && !blocks.some(b => b.name === typeName)) continue
      if (typeName === 'String' || typeName === 'Int') continue

      relations.push({ fromModel: block.name, fieldName, toModel: typeName })
    }
  }

  return { relations, models }
}

/**
 * Relations pointing at a money-bearing model that deliberately do NOT need a
 * MODEL_RELATIONS entry. Each needs a stated reason.
 */
const INTENTIONALLY_UNCONVERTED: Record<string, string> = {
  // The extension only intercepts models it has handlers for. User is not one
  // of them, so its relations are never traversed by convertRowOnRead.
  'User.transactions': 'User has no money columns and no extension handler.',
  'User.payments': 'User has no money columns and no extension handler.',
  'User.products': 'User has no money columns and no extension handler.',
  'User.subscriptions': 'User has no money columns and no extension handler.',
  'User.bankTransactions': 'User has no money columns and no extension handler.',
  'User.bankStatements': 'User has no money columns and no extension handler.',
  'User.gstReturns': 'User has no money columns and no extension handler.',
  'User.gstr1Snapshots': 'User has no money columns and no extension handler.',
  'User.gstr2bImports': 'User has no money columns and no extension handler.',
  'User.aiUsageLogs': 'User has no money columns and no extension handler.',
  'User.parties': 'User has no money columns and no extension handler.',
  'User.transactionsCreated': 'User has no money columns and no extension handler.',
  'Shop.transactions': 'Shop has no money columns and no extension handler.',
  'Shop.products': 'Shop has no money columns and no extension handler.',
  'Shop.parties': 'Shop has no money columns and no extension handler.',

  /*
   * BillShare is the public bill link. It has no money columns and no extension
   * handler, so a query ROOTED at it returns raw paise — which is precisely the
   * 100× bug this guard now exists to catch (see the note in the test below).
   *
   * The page therefore never reads money through it: it takes the token and the
   * expiry from BillShare, then fetches the bill through `db.transaction`, which
   * the extension does intercept. Enforced by the companion test below, which
   * fails if any caller adds an `include` back onto a billShare query.
   */
  'BillShare.transaction': 'Read via db.transaction instead; enforced by the billShare-include test.',
  'BillShare.user': 'User carries no money; the shop settings are fetched separately.',
}

describe('money-bearing relations are all registered for conversion', () => {
  const { relations } = parseSchemaRelations()

  test('the schema parser actually finds relations (guards a broken regex)', () => {
    // A parser that silently finds nothing would make this suite pass forever
    // while protecting nothing — a failure mode already hit twice in this audit.
    expect(relations.length).toBeGreaterThan(20)
    expect(relations.some(r => r.fromModel === 'Transaction' && r.toModel === 'TransactionItem')).toBe(true)
  })

  test('MONEY_COLUMNS models are the ones we consider money-bearing', () => {
    expect(Object.keys(MONEY_COLUMNS).length).toBeGreaterThan(10)
    expect(MONEY_COLUMNS).toHaveProperty('PaymentAllocation')
  })

  test('every relation into a money model is declared in MODEL_RELATIONS', () => {
    const moneyModels = new Set(Object.keys(MONEY_COLUMNS))
    const missing: string[] = []

    for (const rel of relations) {
      // Only relations POINTING AT a money-bearing model matter — those are the
      // nested rows whose amounts need converting.
      if (!moneyModels.has(rel.toModel)) continue

      /*
       * ⚠️ NON-MONEY MODELS ARE CHECKED TOO, since 2026-08-06.
       *
       * This used to `continue` whenever the FROM model had no money columns,
       * on the reasoning that only an intercepted model can convert anything.
       * That is true — and it is exactly why the query is dangerous. `BillShare`
       * has no money of its own, so it was skipped here; but it is queried as a
       * ROOT with the transaction included, and with no handler the extension
       * never saw that query. Every amount on the public bill page came out
       * 100× too large: a ₹600 bill read as ₹60,000.
       *
       * The old rule assumed a money query always starts at a money model.
       * A join table, an audit row, a share link — any of them can be the root.
       * So a relation into a money model must now be either DECLARED (and its
       * model intercepted) or NAMED below with the reason it is safe.
       */
      const key = `${rel.fromModel}.${rel.fieldName}`
      if (key in INTENTIONALLY_UNCONVERTED) continue

      if (!moneyModels.has(rel.fromModel)) {
        missing.push(
          `${key} -> ${rel.toModel} — ${rel.fromModel} has no money columns and no extension handler, ` +
            `so a query rooted here returns raw paise. Read the money model directly, ` +
            `or add ${key} to INTENTIONALLY_UNCONVERTED with a reason.`,
        )
        continue
      }

      const declared = MODEL_RELATIONS[rel.fromModel]?.[rel.fieldName]
      if (!declared) {
        missing.push(`${key} -> ${rel.toModel}`)
      } else if (declared !== rel.toModel) {
        missing.push(`${key} -> declared as '${declared}' but schema says '${rel.toModel}'`)
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Money-bearing relation(s) missing from MODEL_RELATIONS:\n\n` +
        missing.map(x => '  ' + x).join('\n') +
        `\n\nWITHOUT the entry, a nested include returns that relation's money\n` +
        `columns in raw PAISE while every sibling field is in rupees — so a\n` +
        `Rs 1,000 value renders as Rs 1,00,000.\n\n` +
        `This has shipped FOUR times (V20-002, V20-008 x5, AUDIT C5). Add the\n` +
        `relation to MODEL_RELATIONS in src/lib/prisma-money-extension.ts, or —\n` +
        `if it genuinely needs no conversion — to INTENTIONALLY_UNCONVERTED in\n` +
        `this test WITH a reason.`,
      )
    }

    expect(missing).toEqual([])
  })

  test('MODEL_RELATIONS has no entries for relations the schema does not have', () => {
    // A stale entry means a relation was renamed or removed. Harmless at
    // runtime, but it makes the list untrustworthy — and this list is the only
    // thing standing between a nested money column and a 100x display.
    const stale: string[] = []
    for (const [fromModel, rels] of Object.entries(MODEL_RELATIONS)) {
      for (const [fieldName, toModel] of Object.entries(rels)) {
        const exists = relations.some(
          r => r.fromModel === fromModel && r.fieldName === fieldName && r.toModel === toModel,
        )
        if (!exists) stale.push(`${fromModel}.${fieldName} -> ${toModel}`)
      }
    }
    expect(stale).toEqual([])
  })
})

/**
 * The exemption for BillShare above is only true while no caller reads money
 * through it. This is what keeps it true.
 *
 * A source scan is the right tool here precisely because the claim is "no
 * caller does X": there is no runtime behaviour to observe until somebody
 * writes the query, and by then a customer has been shown a 100x bill.
 *
 * Deliberately NOT a clever regex. The first version of this test used one to
 * match a whole `db.billShare.findUnique({ ... })` call, passed while the bug
 * was reintroduced on purpose, and would have shipped protecting nothing —
 * the same failure class as the tests that read source as text and asserted
 * their own existence. Plain string scanning is verifiable by eye.
 */
describe('nothing reads money through BillShare', () => {
  function sourceFiles(dir: string): string[] {
    const out: string[] = []
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__tests__') continue
          walk(full)
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          out.push(full)
        }
      }
    }
    walk(dir)
    return out
  }

  const NEEDLE = 'db.billShare.'
  /** How far past the call to look for an `include`. One query, generously. */
  const WINDOW = 600

  test('the scan actually finds the billShare calls (guards a dead check)', () => {
    // Without this, deleting the page would make the test below pass forever
    // while protecting nothing.
    const found = sourceFiles(path.join(process.cwd(), 'src')).filter(f =>
      fs.readFileSync(f, 'utf8').includes(NEEDLE),
    )
    expect(found.length).toBeGreaterThan(0)
  })

  test('no billShare query pulls nested rows with include', () => {
    const offenders: string[] = []

    for (const file of sourceFiles(path.join(process.cwd(), 'src'))) {
      const src = fs.readFileSync(file, 'utf8')
      let from = 0
      for (;;) {
        const at = src.indexOf(NEEDLE, from)
        if (at === -1) break
        const window = src.slice(at, at + WINDOW)
        if (window.includes('include:')) {
          offenders.push(path.relative(process.cwd(), file))
        }
        from = at + NEEDLE.length
      }
    }

    expect(
      offenders.length === 0
        ? 'none'
        : 'Money read through BillShare, which the money extension does not ' +
          'intercept — every amount will be 100x too large: ' +
          offenders.join(' | '),
    ).toBe('none')
  })
})
