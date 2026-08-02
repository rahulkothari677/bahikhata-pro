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

      // Only models the extension actually intercepts can convert anything.
      if (!moneyModels.has(rel.fromModel)) continue

      const key = `${rel.fromModel}.${rel.fieldName}`
      if (key in INTENTIONALLY_UNCONVERTED) continue

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
